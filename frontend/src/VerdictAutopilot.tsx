import { useEffect, useRef, useState } from "react";
import { Bot, Download, Sparkles } from "lucide-react";
import { api, json } from "./api";
import type {
  AutopilotOptions,
  DirectorJob,
  Panel,
  Project,
  VisionConnection,
} from "./types";
import { errorMessage, timecode } from "./utils";

export const defaultAutopilot: AutopilotOptions = {
  enabled: false,
  mode: "basic",
  pace: "fast",
  delivery: "draft",
};
export const readyForVerdict = (project: Project) =>
  Boolean(
    project.narration_url &&
    ((project.workflow?.panel_ids?.length ?? 0) || project.scene_count),
  );
export function orderForProduction<T extends { kind: string }>(
  files: T[],
): T[] {
  if (files.filter((item) => item.kind === "narration").length > 1)
    throw new Error(
      "Choose one narration recording. Set other audio files to music or sound effects, or remove them.",
    );
  // Narration replacement resets old captions. Apply this batch's SRT last.
  return [...files].sort(
    (a, b) => Number(a.kind === "captions") - Number(b.kind === "captions"),
  );
}
export async function handToVerdict(project: Project) {
  if (project.autopilot?.enabled && readyForVerdict(project)) {
    return api<DirectorJob>(
      `/projects/${project.id}/director`,
      json({ base_revision: project.revision }),
    );
  }
  return null;
}

function SmartCropReview({
  crops,
  panels,
  onReview,
}: {
  crops: NonNullable<DirectorJob["report"]["smart_crops"]>;
  panels: Panel[];
  onReview: () => void;
}) {
  const needsReview = crops.filter((crop) => crop.review_required).length;
  return (
    <details className="autopilot-crop-review">
      <summary>
        Smart Crop review · {crops.length} shots
        {needsReview ? ` · ${needsReview} flagged` : ""}
      </summary>
      <p className="muted">
        Each marker shows Verdict's suggested focal point on the source artwork,
        not an exact crop boundary. Confirm the punch, reaction and any important
        dialogue remain visible in the rendered preview.
      </p>
      <div className="autopilot-crop-list">
        {crops.slice(0, 12).map((crop, index) => {
          const panel = panels.find((item) => item.id === crop.panel_id);
          return (
            <div className="autopilot-crop-item" key={crop.scene_id + index}>
              {panel && (
                <div className="autopilot-crop-image">
                  <img src={panel.thumbnail_url || panel.image_url} alt={panel.title || "Comic source artwork"} />
                  <span
                    aria-hidden="true"
                    className="autopilot-crop-target"
                    style={{ left: `${crop.target_x * 100}%`, top: `${crop.target_y * 100}%` }}
                  />
                </div>
              )}
              <div className="autopilot-crop-text">
                <strong>Shot {index + 1} · {timecode(crop.start)}</strong>
                <p>{crop.text}</p>
                <p className="muted">{crop.reason || "No visual evidence described"}</p>
                <small>
                  {crop.framing === "fit" ? "Whole-panel framing" : "Close framing"}
                  {" · "}
                  {crop.confidence == null
                    ? "Confidence not supplied"
                    : `Model confidence: ${Math.round(crop.confidence * 100)}%`}
                  {crop.review_required ? " · Check this shot" : ""}
                  {!crop.applied ? " · Fallback framing" : ""}
                </small>
              </div>
            </div>
          );
        })}
      </div>
      {crops.length > 12 && (
        <p className="muted">
          Showing the first 12 of {crops.length} shots. Review the full video for remaining crops.
        </p>
      )}
      <button className="button secondary" onClick={onReview}>
        Review the edit and camera framing
      </button>
    </details>
  );
}

export default function VerdictAutopilot({
  project,
  panels = [],
  dirty,
  busy,
  accept,
  perform,
  onChanged,
  onReview,
  onError,
}: {
  project: Project;
  panels?: Panel[];
  dirty: boolean;
  busy: boolean;
  accept: (project: Project) => void;
  perform: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
  onReview: () => void;
  onError: (message: string) => void;
}) {
  const [jobs, setJobs] = useState<DirectorJob[]>([]);
  const [connection, setConnection] = useState<VisionConnection | null>(null);
  const [connectionForm, setConnectionForm] = useState({
    base_url: "https://api.openai.com/v1",
    model: "",
    transcription_model: "",
    api_key: "",
  });
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");
  const [pollError, setPollError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const gate = useRef({ dirty, busy, revision: project.revision });
  gate.current = { dirty, busy, revision: project.revision };
  const callbacks = useRef({ accept, onChanged });
  callbacks.current = { accept, onChanged };
  const latest = jobs[0];
  const running =
    latest && ["queued", "working", "rendering"].includes(latest.status);
  const options = { ...defaultAutopilot, ...project.autopilot };
  const currentResult = latest?.output_revision === project.revision;
  useEffect(() => {
    setReviewed(false);
  }, [latest?.id, project.revision]);
  useEffect(() => {
    let alive = true;
    void api<VisionConnection>("/verdict/connection")
      .then((value) => {
        if (!alive) return;
        setConnection(value);
        if (value.configured)
          setConnectionForm({
            base_url: value.base_url,
            model: value.model,
            transcription_model: value.transcription_model,
            api_key: "",
          });
      })
      .catch((error) => {
        if (alive) setProviderMessage(errorMessage(error));
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true,
      fetching = false;
    async function poll() {
      if (fetching) return;
      fetching = true;
      try {
        const values = await api<DirectorJob[]>(
          `/projects/${project.id}/director`,
        );
        if (!alive) return;
        setJobs(values);
        setPollError("");
        const applied = values.find(
          (job) =>
            job.output_revision && job.output_revision > gate.current.revision,
        );
        if (applied && !gate.current.dirty && !gate.current.busy) {
          const revision = gate.current.revision;
          const updated = await api<Project>(`/projects/${project.id}`);
          if (
            alive &&
            !gate.current.dirty &&
            !gate.current.busy &&
            revision === gate.current.revision
          ) {
            callbacks.current.accept(updated);
            callbacks.current.onChanged();
          }
        }
      } catch (error) {
        if (alive) setPollError(errorMessage(error));
      } finally {
        fetching = false;
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project.id]);
  async function changeOptions(change: Partial<AutopilotOptions>) {
    await perform(async () => {
      const saved = await api<Project>(`/projects/${project.id}`);
      const next = await api<Project>(
        `/projects/${project.id}/autopilot`,
        json(
          {
            enabled: options.enabled,
            mode: options.mode,
            pace: options.pace,
            delivery: options.delivery,
            ...change,
            base_revision: saved.revision,
          },
          "PUT",
        ),
      );
      accept(next);
      onChanged();
    });
  }
  async function run() {
    await perform(async () => {
      const saved = await api<Project>(`/projects/${project.id}`);
      const job = await handToVerdict(saved);
      if (job) setJobs([job, ...jobs]);
    });
  }
  async function saveProvider() {
    setProviderBusy(true);
    setProviderMessage("");
    try {
      const saved = await api<VisionConnection>(
        "/verdict/connection",
        json(
          { ...connectionForm, api_key: connectionForm.api_key || null },
          "PUT",
        ),
      );
      setConnection(saved);
      setConnectionForm((old) => ({ ...old, api_key: "" }));
      setProviderMessage(
        "Connection saved. Choose Vision AI above to use it. The model is checked when Verdict runs.",
      );
    } catch (error) {
      setProviderMessage(errorMessage(error));
    } finally {
      setProviderBusy(false);
    }
  }
  return (
    <section className="autopilot-card" aria-label="Verdict Autopilot">
      <div className="autopilot-heading">
        <Bot size={30} />
        <div>
          <span className="eyebrow">VERDICT TAKES THE CHAIR</span>
          <h2>Upload. Hand it over. Watch.</h2>
          <p>
            Add your panels and one voice recording. I’ll build the vertical
            edit.
          </p>
        </div>
        <label className="autopilot-toggle">
          <input
            type="checkbox"
            checked={options.enabled}
            disabled={!!running}
            onChange={(e) => void changeOptions({ enabled: e.target.checked })}
          />
          Verdict Autopilot
        </label>
      </div>
      {options.enabled && (
        <>
          <div className="form-grid autopilot-options">
            <label>
              How Verdict decides
              <select
                disabled={!!running}
                value={options.mode}
                onChange={(e) =>
                  void changeOptions({
                    mode: e.target.value as AutopilotOptions["mode"],
                  })
                }
              >
                <option value="basic">Basic · upload order + tags</option>
                <option value="vision">Vision AI · understands panels</option>
              </select>
            </label>
            <label>
              Pacing
              <select
                disabled={!!running}
                value={options.pace}
                onChange={(e) =>
                  void changeOptions({
                    pace: e.target.value as AutopilotOptions["pace"],
                  })
                }
              >
                <option value="fast">Fast · punchy Shorts camera</option>
                <option value="slow">Slow · longer readable shots</option>
              </select>
            </label>
            <label>
              Delivery
              <select
                disabled={!!running}
                value={options.delivery}
                onChange={(e) =>
                  void changeOptions({
                    delivery: e.target.value as AutopilotOptions["delivery"],
                  })
                }
              >
                <option value="draft">
                  Preview first · I approve the final
                </option>
                <option value="final">
                  Finish for me · automatic 1080p MP4
                </option>
              </select>
            </label>
          </div>
          <p className="muted">
            {options.mode === "basic"
              ? "Runs locally without API credentials. Keep panels in story order; Basic cannot inspect the artwork. Offline English captions may need corrections."
              : "Sends resized project panels and narration text to your connected vision model. Audio is sent only if you set a Speech model. Provider charges may apply."}{" "}
            Your full selected recording is kept. No automatic publishing.
          </p>
          {options.delivery === "final" && (
            <p className="notice">
              You’re authorizing Verdict to approve this edit and render the
              final MP4 without another review.
            </p>
          )}
          <div className="toolbar">
            <button
              className="button primary"
              disabled={
                !!running ||
                !readyForVerdict(project) ||
                (options.mode === "vision" && !connection?.configured)
              }
              onClick={() => void run()}
            >
              <Sparkles size={17} />
              {running ? "Verdict is working…" : "Let Verdict handle it"}
            </button>
            {!readyForVerdict(project) && (
              <span className="muted">
                First add panels and narration in Add files below.
              </span>
            )}
            {latest && ["queued", "working"].includes(latest.status) && (
              <button
                className="button secondary"
                onClick={() =>
                  void perform(async () => {
                    await api(
                      `/projects/${project.id}/director/${latest.id}/cancel`,
                      json({}),
                    );
                  })
                }
              >
                Stop planning
              </button>
            )}
          </div>
        </>
      )}
      {latest && (
        <div className="autopilot-progress" role="status">
          <strong>{latest.message}</strong>
          {running && (
            <progress
              max={100}
              value={latest.progress}
              aria-label="Verdict progress"
            />
          )}
          <p>{latest.report.summary}</p>
          {latest.report.warnings?.map((warning) => (
            <p className="muted" key={warning}>
              {warning}
            </p>
          ))}
          {latest.report.smart_crops && latest.report.smart_crops.length > 0 && (
            <SmartCropReview
              crops={latest.report.smart_crops}
              panels={panels}
              onReview={onReview}
            />
          )}
          {latest.render?.status === "completed" && (
            <>
              {!currentResult && (
                <p className="muted">
                  This video belongs to an earlier edit. Run Verdict again to
                  include your latest changes.
                </p>
              )}
              <video
                key={latest.render.id}
                className="autopilot-video"
                src={latest.render.video_url!}
                controls
                preload="metadata"
                aria-label="Verdict rendered video"
              />
              <div className="toolbar">
                <a
                  className="button secondary"
                  href={latest.render.download_url!}
                >
                  <Download size={16} />
                  Download{" "}
                  {latest.render.quality === "final" ? "1080p MP4" : "preview"}
                </a>
                <button className="button secondary" onClick={onReview}>
                  Adjust the edit
                </button>
              </div>
              {latest.render.quality === "draft" && currentResult && (
                <>
                  <label className="autopilot-review">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={dirty}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    I checked the preview, captions, and panel matches.
                  </label>
                  <button
                    className="button primary"
                    disabled={!reviewed || dirty}
                    onClick={() =>
                      void perform(async () => {
                        await api(
                          `/projects/${project.id}/director/approve`,
                          json({ base_revision: project.revision }),
                        );
                        accept(await api<Project>(`/projects/${project.id}`));
                        onChanged();
                        onReview();
                      })
                    }
                  >
                    Approve & export 1080p
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
      {pollError && (
        <p className="notice">
          Verdict status unavailable: {pollError}. Retrying…
        </p>
      )}
      <details className="autopilot-connection">
        <summary>Optional: connect Verdict’s vision AI</summary>
        <p className="muted">
          Use an OpenAI-compatible vision model, including a local server such
          as Ollama. Your key is stored privately in this studio’s data folder
          and is never returned to the browser. Choose Vision AI above to send
          files.
        </p>
        <div className="form-grid">
          <label>
            API base URL
            <input
              type="url"
              value={connectionForm.base_url}
              onChange={(e) =>
                setConnectionForm({
                  ...connectionForm,
                  base_url: e.target.value,
                })
              }
              placeholder="http://localhost:11434/v1"
            />
          </label>
          <label>
            Vision model
            <input
              value={connectionForm.model}
              onChange={(e) =>
                setConnectionForm({ ...connectionForm, model: e.target.value })
              }
              placeholder="Your provider’s image-capable model"
            />
          </label>
          <label>
            API key {connection?.has_key && "(saved; leave blank to keep)"}
            <input
              type="password"
              autoComplete="new-password"
              value={connectionForm.api_key}
              onChange={(e) =>
                setConnectionForm({
                  ...connectionForm,
                  api_key: e.target.value,
                })
              }
              placeholder="Optional for local servers"
            />
          </label>
          <label>
            Speech model (optional)
            <input
              value={connectionForm.transcription_model}
              onChange={(e) =>
                setConnectionForm({
                  ...connectionForm,
                  transcription_model: e.target.value,
                })
              }
              placeholder="Blank = offline English captions"
            />
          </label>
        </div>
        <p className="muted">
          Speech models must support verbose_json segment timestamps. Import SRT
          captions for exact wording.
        </p>
        <div className="toolbar">
          <button
            className="button secondary"
            disabled={providerBusy || !!running}
            onClick={() => void saveProvider()}
          >
            Save AI connection
          </button>
          {connection?.configured && (
            <button
              className="text-button"
              disabled={providerBusy || !!running}
              onClick={() => {
                setProviderBusy(true);
                void api<VisionConnection>("/verdict/connection", {
                  method: "DELETE",
                })
                  .then((value) => {
                    setConnection(value);
                    setProviderMessage("Connection removed.");
                  })
                  .catch((error) => onError(errorMessage(error)))
                  .finally(() => setProviderBusy(false));
              }}
            >
              Remove connection & key
            </button>
          )}
        </div>
        {providerMessage && <p role="status">{providerMessage}</p>}
      </details>
    </section>
  );
}
