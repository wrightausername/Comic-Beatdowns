import { useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent } from "react";
import { Check, FileImage, Plus, Scissors, Upload, X } from "lucide-react";
import { api, json } from "./api";
import { Modal } from "./components";
import BrandOptions from "./BrandOptions";
import {
  defaultAutopilot,
  handToVerdict,
  orderForProduction,
} from "./VerdictAutopilot";
import { guessKind } from "./ProductionWorkflow";
import VisionConnectionForm from "./VisionConnectionForm";
import { intakeRoles, probeNarration, stagedChecks } from "./episodeIntake";
import type { IntakeFile } from "./episodeIntake";
import type {
  AutopilotOptions,
  DirectorJob,
  IntakeReadiness,
  VisionConnection,
  Easing,
  Motion,
  Panel,
  Project,
  Template,
  Transition,
  VideoSettings,
} from "./types";
import {
  EasingOptions,
  MotionOptions,
  TransitionOptions,
} from "./EffectOptions";
import { errorMessage } from "./utils";

type ErrorHandler = (message: string) => void;
const initialMetadata = {
  title: "",
  series: "",
  issue: "",
  page: "",
  characters: "",
  fight: "",
};
type Metadata = typeof initialMetadata;

function MetadataFields({
  values,
  change,
}: {
  values: Metadata;
  change: (values: Metadata) => void;
}) {
  return (
    <div className="form-grid">
      <label className="span-2">
        Panel title
        <input
          value={values.title}
          maxLength={200}
          onChange={(e) => change({ ...values, title: e.target.value })}
          placeholder="The moment it all went wrong"
        />
      </label>
      <label>
        Comic series
        <input
          value={values.series}
          maxLength={200}
          onChange={(e) => change({ ...values, series: e.target.value })}
          placeholder="Series name"
        />
      </label>
      <label>
        Issue number
        <input
          value={values.issue}
          maxLength={50}
          onChange={(e) => change({ ...values, issue: e.target.value })}
          placeholder="#12"
        />
      </label>
      <label>
        Page / starting page
        <input
          type="number"
          min="1"
          max="10000"
          value={values.page}
          onChange={(e) => change({ ...values, page: e.target.value })}
          placeholder="Optional"
        />
      </label>
      <label>
        Characters
        <input
          value={values.characters}
          maxLength={500}
          onChange={(e) => change({ ...values, characters: e.target.value })}
          placeholder="Who’s throwing hands?"
        />
      </label>
      <label className="span-2">
        Fight notes
        <textarea
          rows={3}
          maxLength={4000}
          value={values.fight}
          onChange={(e) => change({ ...values, fight: e.target.value })}
          placeholder="What happens in this panel? Record the evidence."
        />
      </label>
    </div>
  );
}

export function NewProject({
  templates,
  initialTemplateId,
  initialAutopilot = false,
  onClose,
  onCreated,
  onError,
}: {
  templates: Template[];
  initialTemplateId?: string;
  initialAutopilot?: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
  onError: ErrorHandler;
}) {
  const [autopilot, setAutopilot] = useState(initialAutopilot);
  const [mode, setMode] = useState<"" | "basic" | "vision">("");
  const [pace, setPace] = useState<AutopilotOptions["pace"]>("fast");
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [template, setTemplate] = useState(
    initialTemplateId ?? templates[0]?.id ?? "",
  );
  const [files, setFiles] = useState<IntakeFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<VisionConnection | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [visionConsent, setVisionConsent] = useState(false);
  const [rights, setRights] = useState(false);
  const [scriptConfirmed, setScriptConfirmed] = useState(false);
  const [readiness, setReadiness] = useState<IntakeReadiness | null>(null);
  const [reviewWarnings, setReviewWarnings] = useState(false);
  const [created, setCreated] = useState<Project | null>(null);
  const createdRef = useRef<Project | null>(null);
  const accepted = useRef(new Set<string>());
  const submitting = useRef(false);
  const clientChecks = stagedChecks(files);
  const hasScript = files.some((item) => item.kind === "script");
  const eligible =
    clientChecks.every((check) => check.state !== "blocking") &&
    rights &&
    !!mode &&
    (!hasScript || scriptConfirmed) &&
    (mode !== "vision" || (!!connection?.authorization_id && visionConsent));
  useEffect(() => {
    if (!autopilot) return;
    let alive = true;
    void api<VisionConnection>("/verdict/connection")
      .then((value) => {
        if (alive) {
          setConnection(value);
          setVisionConsent(false);
          setConnectionError("");
        }
      })
      .catch((reason) => {
        if (alive) setConnectionError(errorMessage(reason));
      });
    return () => {
      alive = false;
    };
  }, [autopilot]);
  function retain(project: Project) {
    createdRef.current = project;
    setCreated(project);
  }
  function invalidate() {
    setReadiness(null);
    setReviewWarnings(false);
    setError("");
  }
  function addProjectFiles(chosen: File[]) {
    if (busy) return;
    if (files.length + chosen.length > 20) {
      setError("Select at most 20 files per episode intake.");
      return;
    }
    invalidate();
    const additions: IntakeFile[] = chosen.map((file) => ({
      id: crypto.randomUUID(),
      file,
      kind: guessKind(file.name),
      status: "pending",
    }));
    setFiles((old) => [...old, ...additions]);
    if (!title && chosen.length)
      setTitle(chosen[0].name.replace(/\.[^.]+$/, "").slice(0, 200));
    for (const item of additions.filter((item) => item.kind === "narration"))
      void probeNarration(item.file).then((duration) =>
        setFiles((old) =>
          old.map((value) =>
            value.id === item.id ? { ...value, duration } : value,
          ),
        ),
      );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current || (autopilot && !eligible)) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const ordered = orderForProduction(files);
      if (!createdRef.current) {
        setProgress("Saving your project…");
        retain(
          await api<Project>(
            "/projects",
            json({ title, idea, template_id: template || null }),
          ),
        );
      }
      let project = createdRef.current!;
      // Retry an ambiguous handoff by following its real job, not starting another.
      if (autopilot) {
        const jobs = await api<DirectorJob[]>(
          `/projects/${project.id}/director`,
        );
        if (
          jobs.some((job) =>
            ["queued", "working", "rendering", "completed"].includes(
              job.status,
            ),
          )
        ) {
          if (ordered.some((item) => !accepted.current.has(item.id)))
            throw new Error(
              "Verdict already started. Open the saved project to add further files without creating another run.",
            );
          onCreated(await api<Project>(`/projects/${project.id}`));
          return;
        }
      }
      const current = await api<Project>(`/projects/${project.id}`);
      if (current.revision !== project.revision)
        throw new Error(
          "This saved project changed in another window. Open it in the editor before retrying.",
        );
      for (const item of ordered) {
        if (accepted.current.has(item.id)) continue;
        setProgress(`Importing ${item.file.name}…`);
        try {
          const body = new FormData();
          body.append("file", item.file);
          body.append("kind", item.kind);
          const result = await api<{ project: Project }>(
            `/projects/${project.id}/import-file`,
            { method: "POST", body },
          );
          project = result.project;
          retain(project);
          accepted.current.add(item.id);
          setFiles((old) =>
            old.map((value) =>
              value.id === item.id
                ? { ...value, status: "imported", error: undefined }
                : value,
            ),
          );
        } catch (reason) {
          setFiles((old) =>
            old.map((value) =>
              value.id === item.id
                ? { ...value, status: "error", error: errorMessage(reason) }
                : value,
            ),
          );
          throw new Error(
            `${item.file.name}: ${errorMessage(reason)}. Accepted files are kept. Correct or remove this file, then retry, or open the saved project.`,
          );
        }
      }
      if (!autopilot) {
        onCreated(project);
        return;
      }
      setProgress("Checking the imported sources…");
      if (mode === "vision") {
        const current = await api<VisionConnection>("/verdict/connection");
        if (
          !current.configured ||
          current.authorization_id !== connection?.authorization_id
        ) {
          setConnection(current);
          setVisionConsent(false);
          throw new Error(
            "The Vision connection changed. Confirm the current provider before retrying.",
          );
        }
      }
      const checked = await api<IntakeReadiness>(
        `/projects/${project.id}/intake-readiness?base_revision=${project.revision}&mode=${mode}`,
      );
      setReadiness(checked);
      if (!checked.ready)
        throw new Error(
          "Resolve the source checks below, or open the saved project to recover its inputs.",
        );
      if (checked.checks.some((check) => check.confirm) && !reviewWarnings)
        throw new Error(
          "Review the script/caption warnings below and confirm they will be checked in the preview.",
        );
      setProgress("Handing the saved episode to Verdict…");
      const options = {
        ...defaultAutopilot,
        enabled: true,
        mode: mode as "basic" | "vision",
        pace,
        delivery: "draft" as const,
      };
      project = await api<Project>(
        `/projects/${project.id}/autopilot`,
        json({ ...options, base_revision: checked.base_revision }, "PUT"),
      );
      retain(project);
      const job = await handToVerdict(
        project,
        mode === "vision" ? connection!.authorization_id! : undefined,
      );
      if (!job)
        throw new Error(
          "Add project panels and narration before starting Verdict.",
        );
      onCreated(project);
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      onError(message);
    } finally {
      setBusy(false);
      setProgress("");
      submitting.current = false;
    }
  }
  const advanced = (
    <>
      <label>
        The angle
        <textarea
          rows={3}
          maxLength={8000}
          value={idea}
          disabled={!!created}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="Fight context or production notes for the recorded commentary"
        />
      </label>
      <label>
        Video template
        <select
          value={template}
          disabled={!!created}
          onChange={(e) => setTemplate(e.target.value)}
        >
          {templates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {autopilot && (
        <label>
          Editing pace
          <select
            value={pace}
            onChange={(e) =>
              setPace(e.target.value as AutopilotOptions["pace"])
            }
          >
            <option value="fast">Fast · punchy camera moves</option>
            <option value="slow">Slow · longer readable shots</option>
          </select>
        </label>
      )}
    </>
  );
  return (
    <Modal
      title={autopilot ? "Create an episode" : "Start a new beatdown"}
      closeDisabled={busy}
      eyebrow={autopilot ? "ONE-CLICK EPISODE" : "THE NEXT VERDICT"}
      onClose={() => {
        if (!submitting.current) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className={autopilot ? "episode-intake" : undefined}
      >
        <fieldset className="studio-fieldset" disabled={busy}>
          <label className="autopilot-review">
            <input
              type="checkbox"
              checked={autopilot}
              onChange={(e) => setAutopilot(e.target.checked)}
            />
            Let Verdict handle the edit after upload
          </label>
          {autopilot && (
            <div className="episode-recipe">
              <strong>Verdict · Auto-Director</strong>
              <p>
                Host: Verdict · {pace === "fast" ? "Fast" : "Slow"} pacing ·
                Preview first
              </p>
              <small>
                360 × 640 review copy. Final 1080 × 1920 export requires
                approval. Publishing is a separate action.
              </small>
            </div>
          )}
          <div
            className="project-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addProjectFiles(Array.from(e.dataTransfer.files));
            }}
          >
            <strong>Artwork + Verdict recording</strong>
            <label className="button secondary">
              Choose project files
              <input
                type="file"
                aria-label="New project files"
                hidden
                multiple
                accept="image/*,.pdf,.cbz,audio/*,.srt,.txt,.md"
                onChange={(e) => {
                  addProjectFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
            <p className="muted">
              Images/PDF/CBZ, exactly one narration recording, optional reviewed
              TXT/MD script and SRT. Confirm file roles; other audio can be
              music or effects.
            </p>
          </div>
          {files.map((item) => (
            <div className="import-file-row" key={item.id}>
              <div>
                <span>{item.file.name}</span>
                <small
                  className={item.status === "error" ? "inline-error" : "muted"}
                >
                  {item.status === "imported"
                    ? "Saved · reused on retry"
                    : (item.error ?? "Not uploaded yet")}
                </small>
              </div>
              <select
                aria-label={`New project role for ${item.file.name}`}
                value={item.kind}
                disabled={item.status === "imported"}
                onChange={(e) => {
                  const kind = e.target.value;
                  invalidate();
                  setScriptConfirmed(false);
                  setFiles((old) =>
                    old.map((value) =>
                      value.id === item.id
                        ? { ...value, kind, status: "pending" }
                        : value,
                    ),
                  );
                  if (kind === "narration")
                    void probeNarration(item.file).then((duration) =>
                      setFiles((old) =>
                        old.map((value) =>
                          value.id === item.id ? { ...value, duration } : value,
                        ),
                      ),
                    );
                }}
              >
                {intakeRoles.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind === "unknown" ? "Choose role…" : kind}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove new file ${item.file.name}`}
                disabled={item.status === "imported"}
                onClick={() => {
                  invalidate();
                  setFiles((old) =>
                    old.filter((value) => value.id !== item.id),
                  );
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <label>
            Project title
            <input
              autoFocus
              required
              maxLength={200}
              value={title}
              disabled={!!created}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A fight worth talking about"
            />
          </label>
          {autopilot && (
            <>
              <label className="autopilot-review">
                <input
                  type="checkbox"
                  checked={rights}
                  onChange={(e) => setRights(e.target.checked)}
                />
                I am authorized to use this artwork and recording.
              </label>
              {hasScript && (
                <label className="autopilot-review">
                  <input
                    type="checkbox"
                    checked={scriptConfirmed}
                    onChange={(e) => setScriptConfirmed(e.target.checked)}
                  />
                  I reviewed the script for this recording. Final approval comes
                  after playback.
                </label>
              )}
              <fieldset className="episode-mode">
                <legend>Choose how Auto-Director decides</legend>
                <label>
                  <input
                    type="radio"
                    name="episode-mode"
                    checked={mode === "basic"}
                    onChange={() => {
                      setMode("basic");
                      invalidate();
                    }}
                  />
                  Basic local · order, tags and timing
                </label>
                <p className="muted">
                  No provider calls. Basic does not understand comic artwork.
                </p>
                <label>
                  <input
                    type="radio"
                    name="episode-mode"
                    checked={mode === "vision"}
                    onChange={() => {
                      setMode("vision");
                      invalidate();
                    }}
                  />
                  Vision AI · use a configured image-capable model
                </label>
                {mode === "vision" && (
                  <>
                    <VisionConnectionForm
                      connection={connection}
                      expanded={!connection?.configured}
                      disabled={busy}
                      onSaved={(value) => {
                        setConnection(value);
                        setVisionConsent(false);
                        setConnectionError("");
                        invalidate();
                      }}
                    />
                    {connection?.configured && (
                      <label className="autopilot-review">
                        <input
                          type="checkbox"
                          checked={visionConsent}
                          onChange={(e) => setVisionConsent(e.target.checked)}
                        />
                        I authorize sending resized panels and narration text to{" "}
                        {connection.base_url} ({connection.model})
                        {connection.transcription_model
                          ? ` and narration audio to its Speech model (${connection.transcription_model})`
                          : ""}
                        . Provider charges may apply.
                      </label>
                    )}
                    {!connection?.configured && (
                      <p className="notice">
                        Connect Vision above or select Basic local. Saving a
                        connection alone never sends artwork.
                      </p>
                    )}
                  </>
                )}
                {connectionError && (
                  <p className="notice">
                    Connection status unavailable: {connectionError}. Basic
                    local remains available.
                  </p>
                )}
              </fieldset>
              <section
                className="intake-readiness"
                aria-label="Episode input readiness"
              >
                <strong>
                  {readiness ? "Saved-source checks" : "Before starting"}
                </strong>
                <ul>
                  {(readiness?.checks ?? clientChecks)
                    .filter(
                      (check) =>
                        check.state !== "ready" ||
                        [
                          "artwork",
                          "voice",
                          "length",
                          "panels",
                          "narration",
                        ].includes(check.code),
                    )
                    .map((check) => (
                      <li key={check.code} data-state={check.state}>
                        {check.state === "blocking"
                          ? "Needs input: "
                          : check.state === "notice"
                            ? "Note: "
                            : "✓ "}
                        {check.message}
                      </li>
                    ))}
                </ul>
                {readiness?.checks.some((check) => check.confirm) && (
                  <label className="autopilot-review">
                    <input
                      type="checkbox"
                      checked={reviewWarnings}
                      onChange={(e) => setReviewWarnings(e.target.checked)}
                    />
                    I will check these script/caption differences in the
                    preview.
                  </label>
                )}
                <p className="muted">
                  65–90 seconds is a creative target, never an automatic trim.
                  The server validates media before Verdict starts. Script-only
                  production needs a recording; voice synthesis is not
                  implemented.
                </p>
              </section>
              <details className="episode-advanced">
                <summary>
                  Advanced settings · template, pacing and notes
                </summary>
                {advanced}
              </details>
            </>
          )}
          {!autopilot && advanced}
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          {progress && <p role="status">{progress}</p>}
          {created && (
            <p className="muted">
              Saved project: {created.title}. Accepted uploads will be reused in
              this dialog. After a browser refresh, open the saved project from
              the dashboard.
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            {created && (
              <button
                type="button"
                className="button secondary"
                onClick={() => onCreated(createdRef.current!)}
              >
                Open saved project in editor
              </button>
            )}
            <button
              className="button"
              disabled={busy || !title.trim() || (autopilot && !eligible)}
            >
              <Plus size={16} />
              {busy
                ? "Working…"
                : autopilot
                  ? "Create preview"
                  : "Create project"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

export function ImportPanels({
  onClose,
  onImported,
  onError,
}: {
  onClose: () => void;
  onImported: () => void;
  onError: ErrorHandler;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [metadata, setMetadata] = useState(initialMetadata);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = new FormData();
      files.forEach((file) => body.append("files", file));
      body.append(
        "metadata",
        JSON.stringify({
          ...metadata,
          page: metadata.page ? Number(metadata.page) : null,
        }),
      );
      await api<Panel[]>("/panels/import", { method: "POST", body });
      onImported();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Bring in the evidence"
      eyebrow="PANEL IMPORT"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form onSubmit={submit}>
        <div className="import-layout">
          <div>
            <button
              type="button"
              className="drop-zone"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                setFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <Upload size={28} />
              <strong>Drop your source files here</strong>
              <span>or click to browse</span>
              <small>Images, PDF, CBZ · 64 MB per batch · 100 pages max</small>
            </button>
            <input
              ref={fileInput}
              type="file"
              aria-label="Source files"
              hidden
              multiple
              accept="image/*,.pdf,.cbz"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <div className="file-list">
              {files.map((file, i) => (
                <div key={`${file.name}-${i}`}>
                  <FileImage size={16} />
                  <span>
                    {file.name}
                    <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setFiles(files.filter((_, index) => index !== i))
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <p className="help">
              Use files you own or are authorized to use. Source pages stay
              intact; crops create new panels. Metadata applies to this batch.
            </p>
          </div>
          <MetadataFields values={metadata} change={setMetadata} />
        </div>
        <div className="modal-actions">
          <span className="muted">
            {files.length} file{files.length !== 1 && "s"} selected
          </span>
          <button className="button" disabled={busy || !files.length}>
            <Upload size={16} />
            {busy ? "Importing pages…" : "Import to library"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PanelDetail({
  panel,
  onClose,
  onSaved,
  onError,
}: {
  panel: Panel;
  onClose: () => void;
  onSaved: () => void;
  onError: ErrorHandler;
}) {
  const [metadata, setMetadata] = useState<Metadata>({
    title: panel.title,
    series: panel.series,
    issue: panel.issue,
    page: panel.page?.toString() ?? "",
    characters: panel.characters,
    fight: panel.fight,
  });
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const [outputWidth, setOutputWidth] = useState("");
  const [busy, setBusy] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  function point(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }
  function cropStart(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = point(e);
  }
  function cropMove(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const p = point(e),
      a = start.current;
    setCrop({
      x: Math.min(p.x, a.x),
      y: Math.min(p.y, a.y),
      width: Math.abs(p.x - a.x),
      height: Math.abs(p.y - a.y),
    });
  }
  async function save(asCrop: boolean) {
    setBusy(true);
    try {
      await api(
        `/panels/${panel.id}`,
        json(
          { ...metadata, page: metadata.page ? Number(metadata.page) : null },
          "PATCH",
        ),
      );
      if (asCrop)
        await api(
          `/panels/${panel.id}/crop`,
          json({
            ...crop,
            output_width: outputWidth ? Number(outputWidth) : null,
          }),
        );
      onSaved();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={panel.title} eyebrow="PANEL WORKSPACE" onClose={onClose} wide>
      <div className="import-layout">
        <div>
          <p className="help">
            Drag a rectangle on the image to select a crop.
          </p>
          <div
            className="crop-stage"
            onPointerDown={cropStart}
            onPointerMove={cropMove}
            onPointerUp={() => {
              start.current = null;
            }}
            onPointerCancel={() => {
              start.current = null;
            }}
          >
            <img src={panel.image_url} alt={panel.title} draggable={false} />
            <span
              className="crop-selection"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.width * 100}%`,
                height: `${crop.height * 100}%`,
              }}
            />
          </div>
          <div className="crop-info">
            <span>
              {panel.width} × {panel.height} px
            </span>
            <button
              className="text-button"
              onClick={() => setCrop({ x: 0, y: 0, width: 1, height: 1 })}
            >
              Reset selection
            </button>
          </div>
          <label>
            Resize crop to width (px)
            <input
              type="number"
              min="16"
              max="4096"
              placeholder="Keep crop size"
              value={outputWidth}
              onChange={(e) => setOutputWidth(e.target.value)}
            />
          </label>
          <p className="help">
            Aspect ratio is preserved. Source: {panel.source_name}
            {panel.parent_id && " · derived crop"}
          </p>
        </div>
        <MetadataFields values={metadata} change={setMetadata} />
      </div>
      <div className="modal-actions">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void save(false)}
        >
          <Check size={16} />
          Save metadata
        </button>
        <button
          className="button"
          disabled={busy || crop.width <= 0.005 || crop.height <= 0.005}
          onClick={() => void save(true)}
        >
          <Scissors size={16} />
          {busy ? "Saving…" : "Save as new panel"}
        </button>
      </div>
    </Modal>
  );
}

export function PanelPicker({
  panels,
  onClose,
  onAdd,
}: {
  panels: Panel[];
  onClose: () => void;
  onAdd: (panels: Panel[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const filtered = panels.filter((p) =>
    `${p.title} ${p.series} ${p.characters} ${p.fight}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <Modal
      title="Choose your panels"
      eyebrow="BUILD THE TIMELINE"
      onClose={onClose}
      wide
    >
      <input
        aria-label="Search panels to add"
        placeholder="Search panels, characters, or series…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="picker-grid">
        {filtered.map((panel) => (
          <button
            className={`picker-card ${selected.includes(panel.id) ? "selected" : ""}`}
            key={panel.id}
            onClick={() =>
              setSelected(
                selected.includes(panel.id)
                  ? selected.filter((id) => id !== panel.id)
                  : [...selected, panel.id],
              )
            }
          >
            <img src={panel.thumbnail_url} alt={panel.title} />
            <span>{panel.title}</span>
            {selected.includes(panel.id) && (
              <i>
                <Check size={16} />
              </i>
            )}
          </button>
        ))}
      </div>
      {!filtered.length && (
        <p className="help">
          No panels yet. Import your images, PDF, or CBZ into the panel library
          first.
        </p>
      )}
      <div className="modal-actions">
        <span className="muted">Selection order becomes scene order</span>
        <button
          className="button"
          disabled={!selected.length}
          onClick={() =>
            onAdd(selected.map((id) => panels.find((p) => p.id === id)!))
          }
        >
          <Plus size={16} />
          Add {selected.length || ""} panels
        </button>
      </div>
    </Modal>
  );
}

export function VideoOptions({
  value,
  onChange,
}: {
  value: VideoSettings;
  onChange: (value: VideoSettings) => void;
}) {
  return (
    <div className="form-grid">
      <label>
        Frame rate
        <select
          value={value.fps}
          onChange={(e) =>
            onChange({ ...value, fps: Number(e.target.value) as 24 | 30 })
          }
        >
          <option value={24}>24 fps · cinematic</option>
          <option value={30}>30 fps · smooth</option>
        </select>
      </label>
      <label>
        Transition
        <select
          value={value.transition}
          onChange={(e) =>
            onChange({ ...value, transition: e.target.value as Transition })
          }
        >
          <TransitionOptions />
        </select>
      </label>
      <label>
        Transition duration (seconds)
        <input
          type="number"
          min="0.08"
          max="0.8"
          step="0.01"
          value={value.transition_duration}
          disabled={value.transition === "cut"}
          onChange={(e) =>
            onChange({ ...value, transition_duration: Number(e.target.value) })
          }
        />
      </label>
      <label>
        Default scene duration
        <input
          type="number"
          min="0.25"
          max="30"
          step="0.25"
          value={value.default_duration}
          onChange={(e) =>
            onChange({ ...value, default_duration: Number(e.target.value) })
          }
        />
      </label>
      <label>
        Default motion
        <select
          value={value.default_motion}
          onChange={(e) =>
            onChange({ ...value, default_motion: e.target.value as Motion })
          }
        >
          <MotionOptions />
        </select>
      </label>
      <label>
        Default movement strength ·{" "}
        {Math.round(value.default_motion_strength * 100)}%
        <input
          type="range"
          min="0.02"
          max="0.3"
          step="0.01"
          value={value.default_motion_strength}
          onChange={(e) =>
            onChange({
              ...value,
              default_motion_strength: Number(e.target.value),
            })
          }
        />
      </label>
      <label>
        Default motion easing
        <select
          value={value.default_easing}
          onChange={(e) =>
            onChange({ ...value, default_easing: e.target.value as Easing })
          }
        >
          <EasingOptions />
        </select>
      </label>
      <label className="checkbox span-2">
        <input
          type="checkbox"
          checked={value.captions}
          onChange={(e) => onChange({ ...value, captions: e.target.checked })}
        />
        Burn captions into the export
      </label>
      <BrandOptions value={value} onChange={onChange} />
    </div>
  );
}
