import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  FolderInput,
  Play,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { api, audioUpload, json } from "./api";
import type { StudioDraft } from "./useStudioDraft";
import type {
  CaptionCue,
  Panel,
  Project,
  RenderJob,
  Scene,
  StoryCard,
  SoundEffect,
  VideoSettings,
} from "./types";
import {
  applyStoryboard,
  fitScenes,
  framingWarnings,
  makeScene,
  newId,
  selectExcerpt,
} from "./editing";
import { errorMessage, timecode, timelineSeconds } from "./utils";

export type Stage = "files" | "match" | "edit" | "review" | "export";
export const stages: [Stage, string][] = [
  ["files", "Add files"],
  ["match", "Match narration"],
  ["edit", "Edit"],
  ["review", "Review"],
  ["export", "Export"],
];
export interface ProposedDraft {
  scenes: Scene[];
  settings: VideoSettings;
  cues: CaptionCue[];
  reasons: string[];
  base_revision: number;
  notice: string;
}
interface Inbox {
  path: string;
  enabled: boolean;
  files: { id: string; name: string; status: string; message: string }[];
}
interface Asset {
  kind: string;
  id: string;
  name: string;
  missing: boolean;
}
interface Version {
  id: string;
  name: string;
  created_at?: string;
}
interface AudioPreview {
  id: string;
  before_url: string;
  after_url: string;
  duration: number;
  removed_seconds: number;
  base_revision: number;
}
interface Short {
  start: number;
  end: number;
  text: string;
  reason: string;
}
interface Props {
  noteMoment?: { time: number; nonce: number } | null;
  stage: Stage;
  setStage: (stage: Stage) => void;
  draft: StudioDraft;
  project: Project;
  panels: Panel[];
  jobs: RenderJob[];
  effects: SoundEffect[];
  update: (change: Partial<StudioDraft>) => void;
  accept: (project: Project) => void;
  perform: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
  onPreview: (project: Project | null) => void;
  onSeek: (seconds: number) => void;
  onRender: (quality: "draft" | "final", start?: number, end?: number) => void;
  onPick: () => void;
  onScript: () => void;
  onSettings: () => void;
}
export function WorkflowSteps({
  stage,
  setStage,
  completed = new Set<Stage>(),
}: {
  stage: Stage;
  setStage: (stage: Stage) => void;
  completed?: Set<Stage>;
}) {
  return (
    <nav className="workflow-steps" aria-label="Production steps">
      {stages.map(([id, label], i) => (
        <button
          key={id}
          aria-current={id === stage ? "step" : undefined}
          className={id === stage ? "current" : ""}
          onClick={() => setStage(id)}
        >
          <span>{completed.has(id) ? <Check size={15} /> : i + 1}</span>
          {label}
        </button>
      ))}
    </nav>
  );
}
export default function ProductionWorkflow(props: Props) {
  const {
    noteMoment,
    stage,
    setStage,
    draft,
    project,
    panels,
    jobs,
    effects,
    update,
    accept,
    perform,
    onChanged,
    onPreview,
    onSeek,
    onRender,
    onPick,
    onScript,
    onSettings,
  } = props;
  const { scenes, settings, workflow = {} } = draft;
  const url = `/projects/${project.id}`;
  const [files, setFiles] = useState<
    { file: File; kind: string; status: string }[]
  >([]);
  const [message, setMessage] = useState("");
  const [inbox, setInbox] = useState<Inbox | null>(null),
    [assets, setAssets] = useState<Asset[]>([]);
  const [unused, setUnused] = useState(false);
  const [cards, setCards] = useState<StoryCard[]>(workflow.storyboard ?? []);
  const [options, setOptions] = useState({
    pace: settings.edit_pace,
    match_panels: true,
    camera_moves: true,
    sound_effects: true,
    captions: false,
  });
  const [proposal, setProposal] = useState<ProposedDraft | null>(null),
    [kept, setKept] = useState<Set<string>>(new Set());
  const [versions, setVersions] = useState<Version[]>([]),
    [versionName, setVersionName] = useState("Edit A");
  const [shorts, setShorts] = useState<Short[]>([]),
    [audio, setAudio] = useState<AudioPreview | null>(null);
  const [noise, setNoise] = useState(true),
    [pauses, setPauses] = useState(false);
  const [section, setSection] = useState({
    start: 0,
    end: Math.min(5, timelineSeconds(scenes, settings.fps)) || 5,
  });
  const [note, setNote] = useState(""),
    [noteTime, setNoteTime] = useState(0);
  useEffect(() => {
    if (noteMoment) setNoteTime(noteMoment.time);
  }, [noteMoment]);
  const [copyName, setCopyName] = useState(`${project.title} — next episode`);
  const [previewVersion, setPreviewVersion] = useState("");
  const duration = timelineSeconds(scenes, settings.fps);
  const narrationLength = Math.max(
    0,
    Math.min(
      settings.narration_end ?? project.narration_duration ?? 0,
      project.narration_duration ?? 0,
    ) - settings.narration_start,
  );
  const projectIds = new Set([
    ...(workflow.panel_ids ?? []),
    ...scenes.map((s) => s.panel_id),
  ]);
  const available = panels.filter((p) => projectIds.has(p.id));
  const used = new Set(scenes.map((s) => s.panel_id));
  const notes = workflow.notes ?? [];
  useEffect(() => {
    setCards(workflow.storyboard ?? []);
  }, [workflow.storyboard]);
  useEffect(() => {
    let alive = true;
    if (stage === "files") {
      api<Inbox>(url + "/inbox")
        .then((v) => {
          if (alive) setInbox(v);
        })
        .catch(() => {});
      api<{ assets: Asset[] }>(url + "/asset-check")
        .then((v) => {
          if (alive) setAssets(v.assets);
        })
        .catch(() => {});
    }
    if (stage === "review" || stage === "export")
      api<Version[]>(url + "/versions")
        .then((v) => {
          if (alive) setVersions(v);
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [stage, url, project.revision]);
  useEffect(() => {
    if (stage !== "files" || !inbox?.enabled) return;
    let alive = true;
    const timer = setInterval(() => {
      void api<Inbox>(url + "/inbox")
        .then((v) => {
          if (alive) setInbox(v);
        })
        .catch(() => {});
    }, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [stage, inbox?.enabled, url]);
  function addFiles(chosen: File[]) {
    setFiles((old) => [
      ...old,
      ...chosen.map((file) => ({
        file,
        kind: guessKind(file.name),
        status: "Ready",
      })),
    ]);
  }
  async function importFiles() {
    await perform(async () => {
      let latest: Project | null = null;
      for (let i = 0; i < files.length; i++) {
        if (files[i].status === "Imported") continue;
        setFiles((old) =>
          old.map((v, j) => (i === j ? { ...v, status: "Importing…" } : v)),
        );
        try {
          const body = new FormData();
          body.append("file", files[i].file);
          body.append("kind", files[i].kind);
          const result = await api<{ project: Project; message: string }>(
            url + "/import-file",
            { method: "POST", body },
          );
          latest = result.project;
          accept(latest);
          setFiles((old) =>
            old.map((v, j) => (i === j ? { ...v, status: "Imported" } : v)),
          );
        } catch (error) {
          setFiles((old) =>
            old.map((v, j) =>
              i === j ? { ...v, status: errorMessage(error) } : v,
            ),
          );
        }
      }
      if (latest) {
        onChanged();
        setMessage(
          "Files sorted. Choose panels below, or continue to Match narration.",
        );
      }
    });
  }
  function hydrate(values: Scene[]): Scene[] {
    return values.map((scene, index) => ({
      ...scene,
      position: index,
      panel: panels.find((p) => p.id === scene.panel_id)!,
      sfx_url: scene.sfx_id
        ? null
        : (scenes.find((s) => s.id === scene.id)?.sfx_url ?? null),
    }));
  }
  const selectedProposal = () =>
    proposal
      ? hydrate(
          proposal.scenes.map((scene) =>
            kept.has(scene.id!) || scene.locked
              ? scene
              : ((scenes.find((old) => old.id === scene.id)
                  ? {
                      ...scenes.find((old) => old.id === scene.id)!,
                      duration: scene.duration,
                    }
                  : undefined) ?? {
                  ...scene,
                  motion: "hold",
                  transition: "cut",
                  sfx_id: null,
                  sfx_url: null,
                }),
          ),
        )
      : [];
  function previewProposal() {
    if (proposal)
      onPreview({
        ...project,
        settings: proposal.settings,
        scenes: selectedProposal(),
        caption_cues: proposal.cues,
      });
  }
  function applyProposal() {
    if (!proposal) return;
    if (proposal.base_revision !== project.revision) {
      setMessage(
        "The project changed. Build a new draft before accepting these suggestions.",
      );
      return;
    }
    update({
      scenes: selectedProposal(),
      settings: proposal.settings,
      cues: proposal.cues,
    });
    onPreview(null);
    setProposal(null);
    setMessage(
      "Draft accepted. Refine individual shots below; Undo restores the previous edit.",
    );
  }
  const active = jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  const canDraft =
    scenes.length > 0 &&
    Boolean(project.narration_url) &&
    narrationLength <= duration + 0.05 &&
    !active;
  async function refreshVersions() {
    setVersions(await api<Version[]>(url + "/versions"));
  }
  const bottom = (
    <div className="workflow-next">
      <button
        className="button secondary"
        disabled={stage === "files"}
        onClick={() =>
          setStage(
            stages[
              Math.max(0, stages.findIndex(([id]) => id === stage) - 1)
            ][0],
          )
        }
      >
        <ArrowLeft size={16} />
        Back
      </button>
      <span>Step {stages.findIndex(([id]) => id === stage) + 1} of 5</span>
      <button
        className="button"
        disabled={stage === "export"}
        onClick={() =>
          setStage(
            stages[
              Math.min(4, stages.findIndex(([id]) => id === stage) + 1)
            ][0],
          )
        }
      >
        Next
        <ArrowRight size={16} />
      </button>
    </div>
  );
  return (
    <div className="guided-content">
      {message && (
        <div className="notice" role="status">
          {message}
          <button
            className="icon-button"
            aria-label="Dismiss workflow message"
            onClick={() => setMessage("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {stage === "files" && (
        <section className="surface">
          <h2>1. Add your files</h2>
          <p>
            Drop panels, narration, music, effects, and captions together. Check
            each file’s role, then import.
          </p>
          <div
            className="project-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(Array.from(e.dataTransfer.files));
            }}
          >
            <FolderInput size={30} />
            <strong>Drop project files here</strong>
            <label className="button secondary">
              <Upload size={16} />
              Choose files
              <input
                aria-label="Project files"
                type="file"
                multiple
                accept="image/*,.pdf,.cbz,audio/*,.srt"
                hidden
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {files.length > 0 && (
            <>
              <div className="import-queue">
                {files.map((item, i) => (
                  <div className="import-file-row" key={i}>
                    <span>
                      {item.file.name}
                      <small>{item.status}</small>
                    </span>
                    <select
                      aria-label={`Role for ${item.file.name}`}
                      value={item.kind}
                      disabled={item.status === "Imported"}
                      onChange={(e) =>
                        setFiles((old) =>
                          old.map((v, j) =>
                            j === i ? { ...v, kind: e.target.value } : v,
                          ),
                        )
                      }
                    >
                      {["panels", "narration", "music", "sfx", "captions"].map(
                        (kind) => (
                          <option key={kind} value={kind}>
                            {kind === "sfx" ? "Sound effect" : kind}
                          </option>
                        ),
                      )}
                    </select>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() =>
                        setFiles((old) => old.filter((_, j) => j !== i))
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <button className="button" onClick={() => void importFiles()}>
                Import queued files
              </button>
            </>
          )}
          <div className="section-heading">
            <h3>Project panels</h3>
            <button className="button secondary small-button" onClick={onPick}>
              Choose from library
            </button>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={unused}
              onChange={(e) => setUnused(e.target.checked)}
            />
            Show unused only
          </label>
          <div className="project-panel-tray">
            {available
              .filter((p) => !unused || !used.has(p.id))
              .map((panel) => (
                <button
                  key={panel.id}
                  className="tray-panel"
                  onClick={() =>
                    update({ scenes: [...scenes, makeScene(panel, settings)] })
                  }
                >
                  <img src={panel.thumbnail_url} alt="" />
                  <strong>{panel.title}</strong>
                  <small>
                    {used.has(panel.id)
                      ? "Used · add another shot"
                      : "Unused · add to timeline"}
                  </small>
                </button>
              ))}
          </div>
          {!available.length && (
            <p className="help">
              Import files above or choose existing library panels.
            </p>
          )}
          {project.narration_url && (
            <p className="asset-confirmation">
              <Check size={16} />
              Narration ready · {timecode(project.narration_duration ?? 0)}
            </p>
          )}
          <details className="workflow-advanced">
            <summary>Import automatically from a Windows folder</summary>
            <p>
              Studio watches this project’s local inbox while it is running.
              Files stay in the folder. Prefix audio names with{" "}
              <code>music-</code> or <code>sfx-</code>; other audio becomes
              narration.
            </p>
            {inbox && (
              <>
                <code className="folder-path">{inbox.path}</code>
                <button
                  className="button secondary small-button"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(inbox.path)
                      .then(() => setMessage("Folder path copied."))
                      .catch(() =>
                        setMessage("Select and copy the folder path above."),
                      )
                  }
                >
                  <Copy size={14} />
                  Copy folder path
                </button>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={inbox.enabled}
                    onChange={(e) =>
                      void perform(async () => {
                        const value = await api<{ enabled: boolean }>(
                          url + "/inbox",
                          json({ enabled: e.target.checked }, "PUT"),
                        );
                        setInbox({ ...inbox, enabled: value.enabled });
                      })
                    }
                  />
                  Watch this folder
                </label>
                {inbox.files.map((file) => (
                  <p
                    key={file.id}
                    className={
                      file.status === "failed" ? "inline-error" : "help"
                    }
                  >
                    {file.name}: {file.message}
                  </p>
                ))}
                <button
                  className="text-button"
                  onClick={() =>
                    void perform(async () => {
                      accept(await api<Project>(url));
                      onChanged();
                      setMessage("Project reloaded with inbox imports.");
                    })
                  }
                >
                  Load imported files into editor
                </button>
              </>
            )}
          </details>
          <details className="workflow-advanced">
            <summary>Recover missing files</summary>
            <button
              className="text-button"
              onClick={() =>
                void perform(async () =>
                  setAssets(
                    (await api<{ assets: Asset[] }>(url + "/asset-check"))
                      .assets,
                  ),
                )
              }
            >
              Check files again
            </button>
            {assets
              .filter((a) => a.missing)
              .map((asset) => (
                <label key={asset.kind + asset.id} className="recover-file">
                  {asset.name}
                  <input
                    aria-label={`Recover ${asset.name}`}
                    type="file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        void perform(async () => {
                          const body = new FormData();
                          body.append("file", file);
                          body.append("kind", asset.kind);
                          body.append("asset_id", asset.id);
                          await api(url + "/recover-file", {
                            method: "POST",
                            body,
                          });
                          setAssets(
                            (
                              await api<{ assets: Asset[] }>(
                                url + "/asset-check",
                              )
                            ).assets,
                          );
                          setMessage(
                            "Original file reconnected. Scene settings are preserved.",
                          );
                        });
                    }}
                  />
                </label>
              ))}
            {!assets.some((a) => a.missing) && (
              <p className="help">Project source files are present.</p>
            )}
          </details>
        </section>
      )}
      {stage === "match" && (
        <section className="surface">
          <h2>2. Match panels to narration</h2>
          <p>
            Spoken lines become cards. Choose the panel and type of moment for
            each line.
          </p>
          <div className="workflow-actions">
            <button
              className="button"
              onClick={() =>
                void perform(async () => {
                  const result = await api<{ cards: StoryCard[] }>(
                    url + "/storyboard",
                  );
                  setCards(result.cards);
                  setMessage(
                    result.cards.length
                      ? "Review the suggested matches. Script-only times are estimates."
                      : "Write a script or generate/import captions first.",
                  );
                })
              }
            >
              <Sparkles size={16} />
              Suggest panel matches
            </button>
            <button className="button secondary" onClick={onScript}>
              Write / edit script
            </button>
            <button
              className="button secondary"
              onClick={() => setStage("edit")}
            >
              Generate / import captions
            </button>
          </div>
          <div className="storyboard-cards">
            {cards.map((card, index) => (
              <article className="storyboard-card" key={index}>
                <div>
                  <button
                    className="text-button"
                    onClick={() =>
                      onSeek(Math.max(0, card.start - settings.narration_start))
                    }
                  >
                    <Play size={14} />
                    {card.start.toFixed(2)}–{card.end.toFixed(2)}s
                  </button>
                  <small>
                    {card.estimated
                      ? "Estimated script timing"
                      : (card.reason ?? "Your assignment")}
                  </small>
                </div>
                <textarea
                  aria-label={`Storyboard line ${index + 1}`}
                  maxLength={300}
                  value={card.text}
                  onChange={(e) =>
                    setCards((old) =>
                      old.map((v, i) =>
                        i === index ? { ...v, text: e.target.value } : v,
                      ),
                    )
                  }
                />
                <div className="storyboard-panel">
                  <img
                    src={
                      panels.find((p) => p.id === card.panel_id)?.thumbnail_url
                    }
                    alt="Selected panel"
                  />
                  <label>
                    Panel
                    <select
                      aria-label={`Panel for line ${index + 1}`}
                      value={card.panel_id}
                      onChange={(e) =>
                        setCards((old) =>
                          old.map((v, i) =>
                            i === index
                              ? { ...v, panel_id: e.target.value }
                              : v,
                          ),
                        )
                      }
                    >
                      {panels.map((panel) => (
                        <option key={panel.id} value={panel.id}>
                          {panel.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Start (seconds)
                    <input
                      aria-label={`Line ${index + 1} start`}
                      type="number"
                      min="0"
                      max="180"
                      step=".01"
                      value={card.start}
                      onChange={(e) =>
                        setCards((old) =>
                          old.map((v, i) =>
                            i === index ? { ...v, start: +e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    End (seconds)
                    <input
                      aria-label={`Line ${index + 1} end`}
                      type="number"
                      min=".01"
                      max="180"
                      step=".01"
                      value={card.end}
                      onChange={(e) =>
                        setCards((old) =>
                          old.map((v, i) =>
                            i === index ? { ...v, end: +e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                <label>
                  Moment
                  <select
                    aria-label={`Moment for line ${index + 1}`}
                    value={card.beat ?? "custom"}
                    onChange={(e) =>
                      setCards((old) =>
                        old.map((v, i) =>
                          i === index
                            ? { ...v, beat: e.target.value as Scene["beat"] }
                            : v,
                        ),
                      )
                    }
                  >
                    {["custom", "hit", "reveal", "reaction", "read"].map(
                      (beat) => (
                        <option key={beat}>{beat}</option>
                      ),
                    )}
                  </select>
                </label>
              </article>
            ))}
          </div>
          {cards.length > 0 && (
            <button
              className="button"
              onClick={() => {
                const saved = cards.map(
                  ({ start, end, text, panel_id, beat }) => ({
                    start,
                    end,
                    text,
                    panel_id,
                    beat,
                  }),
                );
                update({
                  workflow: {
                    ...workflow,
                    storyboard: saved,
                    panel_ids: [
                      ...new Set([
                        ...(workflow.panel_ids ?? []),
                        ...cards.map((c) => c.panel_id),
                      ]),
                    ],
                  },
                  scenes: applyStoryboard(
                    scenes,
                    cards,
                    settings.narration_start,
                    settings.fps,
                  ).map((scene) => ({
                    ...scene,
                    panel: panels.find((p) => p.id === scene.panel_id)!,
                  })),
                });
                setMessage(
                  "Panel assignments saved. Build My Draft will follow these cards.",
                );
              }}
            >
              Use these assignments
            </button>
          )}
        </section>
      )}
      {stage === "edit" && (
        <section className="surface build-draft-section">
          <h2>3. Build your draft</h2>
          <p>
            Choose what Studio should handle. Locked scenes keep their edits.
          </p>
          <div className="pace-choices">
            {(["fast", "slow"] as const).map((pace) => (
              <button
                key={pace}
                className={
                  options.pace === pace ? "pace-choice selected" : "pace-choice"
                }
                aria-pressed={options.pace === pace}
                onClick={() => setOptions({ ...options, pace })}
              >
                <strong>
                  {pace === "fast" ? "Fast cuts" : "Smooth holds"}
                </strong>
                <span>
                  {pace === "fast"
                    ? "Quick cuts and stronger moves"
                    : "Longer holds and smoother moves"}
                </span>
              </button>
            ))}
          </div>
          <div className="automation-checks">
            {(
              [
                ["match_panels", "Match panels"],
                ["camera_moves", "Add camera moves"],
                ["sound_effects", "Suggest sound effects"],
                ["captions", "Generate English captions"],
              ] as const
            ).map(([key, label]) => (
              <label className="check-label" key={key}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) =>
                    setOptions({ ...options, [key]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <button
            className="button"
            disabled={!project.narration_url || !available.length}
            onClick={() =>
              void perform(async () => {
                const result = await api<ProposedDraft>(
                  url + "/build-draft",
                  json(options),
                );
                setProposal({ ...result, scenes: hydrate(result.scenes) });
                setKept(new Set(result.scenes.map((s) => s.id!)));
                setMessage(
                  "Draft suggestions are ready. Preview and accept the changes you want.",
                );
              })
            }
          >
            <Sparkles size={17} />
            Build My Draft
          </button>
          {proposal && (
            <div className="draft-suggestions">
              <h3>Review suggested shots</h3>
              <p className="help">{proposal.notice}</p>
              <div className="suggestion-list">
                {proposal.scenes.map((scene, index) => (
                  <label className="suggestion-row" key={scene.id}>
                    <input
                      type="checkbox"
                      checked={kept.has(scene.id!)}
                      disabled={scene.locked}
                      onChange={(e) =>
                        setKept((old) => {
                          const next = new Set(old);
                          if (e.target.checked) next.add(scene.id!);
                          else next.delete(scene.id!);
                          return next;
                        })
                      }
                    />
                    <img src={scene.panel.thumbnail_url} alt="" />
                    <span>
                      <strong>
                        Shot {index + 1} · {scene.panel.title} ·{" "}
                        {scene.duration.toFixed(2)}s
                      </strong>
                      <small>{proposal.reasons[index]}</small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="workflow-actions">
                <button className="button secondary" onClick={previewProposal}>
                  Preview proposed draft
                </button>
                <button className="button" onClick={applyProposal}>
                  Accept selected suggestions
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setProposal(null);
                    onPreview(null);
                  }}
                >
                  Discard suggestions
                </button>
              </div>
              <p className="help">
                Unselected existing shots keep their settings; unselected new
                shots become plain holds. Proposed pacing applies to the whole
                draft.
              </p>
            </div>
          )}
          <details className="workflow-advanced">
            <summary>Add your own sound favorites</summary>
            <p>
              Upload an effect once, then choose it from any shot’s Sound
              favorites controls.
            </p>
            {["impact", "whoosh", "reaction"].map((kind) => (
              <label key={kind}>
                Default {kind} sound
                <select
                  aria-label={`Default ${kind} sound`}
                  value={workflow.sound_choices?.[kind] ?? `builtin-${kind}`}
                  onChange={(e) =>
                    update({
                      workflow: {
                        ...workflow,
                        sound_choices: {
                          ...workflow.sound_choices,
                          [kind]: e.target.value,
                        },
                      },
                    })
                  }
                >
                  {effects.map((effect) => (
                    <option key={effect.id} value={effect.id}>
                      {effect.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="button secondary">
              Upload a favorite
              <input
                aria-label="Upload favorite sound"
                type="file"
                accept="audio/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void perform(async () => {
                      await api("/sound-effects", audioUpload(file));
                      window.dispatchEvent(new Event("studio:sounds-changed"));
                      setMessage("Sound added to favorites for all projects.");
                    });
                  e.target.value = "";
                }}
              />
            </label>
          </details>
          <details className="workflow-advanced">
            <summary>Find a short / clean narration</summary>
            <h3>Find a complete short</h3>
            <button
              className="button secondary"
              disabled={!project.narration_url || !scenes.length}
              onClick={() =>
                void perform(async () => {
                  setShorts(
                    (await api<{ candidates: Short[] }>(url + "/shorts"))
                      .candidates,
                  );
                })
              }
            >
              Suggest short excerpts
            </button>
            {shorts.map((short, i) => (
              <div className="short-candidate" key={i}>
                <strong>
                  {timecode(short.start)}–{timecode(short.end)}
                </strong>
                <p>{short.text || short.reason}</p>
                <small>{short.reason} · review the hook and payoff</small>
                <div className="workflow-actions">
                  <button
                    className="text-button"
                    onClick={() => {
                      try {
                        const selection = selectExcerpt(
                          scenes,
                          settings,
                          short.start,
                          short.end,
                        );
                        onPreview({
                          ...project,
                          settings: selection.settings,
                          scenes: selection.scenes,
                        });
                      } catch (error) {
                        setMessage(errorMessage(error));
                      }
                    }}
                  >
                    Preview excerpt
                  </button>
                  <button
                    className="button secondary small-button"
                    onClick={() => {
                      try {
                        update(
                          selectExcerpt(
                            scenes,
                            settings,
                            short.start,
                            short.end,
                          ),
                        );
                        onPreview(null);
                        setMessage(
                          "Excerpt applied. Save a named version first if you want to compare both edits.",
                        );
                      } catch (error) {
                        setMessage(errorMessage(error));
                      }
                    }}
                  >
                    Use this short
                  </button>
                </div>
              </div>
            ))}
            <h3>Clean narration</h3>
            <label className="check-label">
              <input
                type="checkbox"
                checked={noise}
                onChange={(e) => setNoise(e.target.checked)}
              />
              Reduce steady background noise
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={pauses}
                onChange={(e) => setPauses(e.target.checked)}
              />
              Shorten pauses longer than 0.6 seconds
            </label>
            <button
              className="button secondary"
              disabled={!project.narration_url || (!noise && !pauses)}
              onClick={() =>
                void perform(async () => {
                  setAudio(
                    await api<AudioPreview>(
                      url + "/audio/prepare",
                      json({ reduce_noise: noise, shorten_pauses: pauses }),
                    ),
                  );
                })
              }
            >
              Preview audio cleanup
            </button>
            {audio && (
              <div className="audio-comparison">
                <label>
                  Before
                  <audio controls src={audio.before_url} />
                </label>
                <label>
                  After
                  <audio controls src={audio.after_url} />
                </label>
                <p>
                  {audio.removed_seconds.toFixed(2)}s removed · captions and
                  scenes will follow the trimmed recording.
                </p>
                <button
                  className="button"
                  onClick={() =>
                    void perform(async () => {
                      accept(
                        await api<Project>(
                          url + `/versions/${audio.id}/restore`,
                          json({ base_revision: project.revision }),
                        ),
                      );
                      setAudio(null);
                      onChanged();
                      setMessage(
                        "Audio cleanup accepted. Undo restores the original recording and timing.",
                      );
                    })
                  }
                >
                  Accept cleaned narration
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    void perform(async () => {
                      await api(url + `/versions/${audio.id}`, {
                        method: "DELETE",
                      });
                      setAudio(null);
                    })
                  }
                >
                  Discard audio preview
                </button>
              </div>
            )}
          </details>
        </section>
      )}
      {stage === "review" && (
        <section className="surface">
          <h2>4. Review and fix</h2>
          <p>
            Watch the draft on the right. Fix a shot, compare versions, or leave
            a note at an exact moment.
          </p>
          <div className="workflow-actions">
            <button
              className="button"
              disabled={!canDraft}
              onClick={() => onRender("draft")}
            >
              Render review copy
            </button>
            <button
              className="button secondary"
              onClick={() => setStage("edit")}
            >
              Fix individual shots
            </button>
            <button className="button secondary" onClick={onScript}>
              Review / approve script
            </button>
          </div>
          <h3>One-click fixes</h3>
          <div className="fix-list">
            {!project.narration_url && (
              <button onClick={() => setStage("files")}>
                Add missing narration →
              </button>
            )}
            {!scenes.length && (
              <button onClick={() => setStage("files")}>Add panels →</button>
            )}
            {scenes.length > 0 &&
              Math.abs(narrationLength - duration) > 0.05 && (
                <button
                  onClick={() => {
                    try {
                      update({
                        scenes: fitScenes(
                          scenes,
                          narrationLength,
                          settings.fps,
                        ),
                      });
                      setMessage(
                        "Scene timing fitted to the selected narration.",
                      );
                    } catch (error) {
                      setMessage(errorMessage(error));
                    }
                  }}
                >
                  Fit shots to narration →
                </button>
              )}
            <button
              onClick={() => {
                update({
                  settings: { ...settings, caption_position: "middle" },
                });
                setMessage(
                  "Captions moved toward the center. Check the preview for artwork overlap.",
                );
              }}
            >
              Move captions away from platform controls →
            </button>
            <button onClick={onSettings}>
              Adjust caption appearance and audio →
            </button>
          </div>
          <details className="workflow-advanced">
            <summary>
              Framing checks ·{" "}
              {scenes.filter((s) => framingWarnings(s, project).length).length}{" "}
              shots to inspect
            </summary>
            <p className="help">
              These are crop and readability checks, not recognition of faces or
              dialogue. Use the safe-area overlay and inspect the picture.
            </p>
            {scenes.map((scene, index) => {
              const warnings = framingWarnings(scene, project);
              return warnings.length ? (
                <div className="framing-check" key={scene.id}>
                  <button
                    className="text-button"
                    onClick={() => {
                      onSeek(
                        timelineSeconds(scenes.slice(0, index), settings.fps),
                      );
                    }}
                  >
                    Shot {index + 1}: {scene.panel.title}
                  </button>
                  {warnings.map((warning) => (
                    <p className="help" key={warning}>
                      {warning}
                    </p>
                  ))}
                </div>
              ) : null;
            })}
          </details>
          <h3>Notes at a moment</h3>
          <div className="form-grid">
            <label>
              At (seconds)
              <input
                aria-label="Note time"
                type="number"
                min="0"
                max={duration || 180}
                step=".01"
                value={noteTime}
                onChange={(e) => setNoteTime(+e.target.value)}
              />
            </label>
            <label>
              What needs changing?
              <input
                aria-label="Review note"
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
          <button
            className="button secondary"
            disabled={!note.trim()}
            onClick={() => {
              update({
                workflow: {
                  ...workflow,
                  notes: [
                    ...notes,
                    { id: newId(), time: noteTime, text: note, done: false },
                  ],
                },
              });
              setNote("");
            }}
          >
            Add note
          </button>
          <div className="review-notes">
            {notes.map((n) => (
              <div key={n.id}>
                <input
                  aria-label={`Resolve note ${n.text}`}
                  type="checkbox"
                  checked={n.done}
                  onChange={(e) =>
                    update({
                      workflow: {
                        ...workflow,
                        notes: notes.map((v) =>
                          v.id === n.id ? { ...v, done: e.target.checked } : v,
                        ),
                      },
                    })
                  }
                />
                <button className="text-button" onClick={() => onSeek(n.time)}>
                  {timecode(n.time)} · {n.text}
                </button>
                <button
                  className="icon-button"
                  aria-label={`Delete note ${n.text}`}
                  onClick={() =>
                    update({
                      workflow: {
                        ...workflow,
                        notes: notes.filter((v) => v.id !== n.id),
                      },
                    })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <h3>Compare edits</h3>
          <label>
            Version name
            <input
              aria-label="Version name"
              value={versionName}
              maxLength={120}
              onChange={(e) => setVersionName(e.target.value)}
            />
          </label>
          <button
            className="button secondary"
            disabled={!versionName.trim()}
            onClick={() =>
              void perform(async () => {
                await api(url + "/versions", json({ name: versionName }));
                await refreshVersions();
                setMessage(
                  "Named version saved with panels, timing, captions, and audio.",
                );
              })
            }
          >
            Save named version
          </button>
          <div className="version-list">
            {versions.map((v) => (
              <div key={v.id}>
                <strong>{v.name}</strong>
                <button
                  className="text-button"
                  onClick={() =>
                    void perform(async () => {
                      onPreview(await api<Project>(url + `/versions/${v.id}`));
                      setPreviewVersion(v.name);
                    })
                  }
                >
                  Preview
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    void perform(async () => {
                      accept(
                        await api<Project>(
                          url + `/versions/${v.id}/restore`,
                          json({
                            base_revision: (await api<Project>(url)).revision,
                          }),
                        ),
                      );
                      onPreview(null);
                      onChanged();
                      setPreviewVersion("");
                      setMessage(
                        `${v.name} restored. Undo keeps your previous edit.`,
                      );
                    })
                  }
                >
                  Use version
                </button>
                <button
                  className="icon-button"
                  aria-label={`Delete version ${v.name}`}
                  onClick={() =>
                    void perform(async () => {
                      await api(url + `/versions/${v.id}`, {
                        method: "DELETE",
                      });
                      await refreshVersions();
                    })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          {previewVersion && (
            <button
              className="button secondary"
              onClick={() => {
                onPreview(null);
                setPreviewVersion("");
              }}
            >
              Return from {previewVersion} to current edit
            </button>
          )}
          <details className="workflow-advanced">
            <summary>Duplicate this episode</summary>
            <p>
              Reuse the structure, camera moves, and sound placements. Replace
              its panels and narration for the next video.
            </p>
            <label>
              New episode name
              <input
                aria-label="Duplicate episode name"
                maxLength={120}
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
              />
            </label>
            <button
              className="button secondary"
              disabled={!copyName.trim()}
              onClick={() =>
                void perform(async () => {
                  await api(url + "/duplicate", json({ name: copyName }));
                  onChanged();
                  setMessage(
                    "Episode duplicated. Open it from the Production desk.",
                  );
                })
              }
            >
              <Copy size={16} />
              Duplicate episode
            </button>
          </details>
        </section>
      )}
      {stage === "export" && (
        <section className="surface">
          <h2>5. Export your video</h2>
          <p>
            Review the saved revision, approve the script, then export. Files
            get the project title and revision automatically.
          </p>
          <div className="workflow-actions">
            <button
              className="button secondary"
              disabled={!canDraft}
              onClick={() => onRender("draft")}
            >
              Export draft · 360p
            </button>
            <button
              className="button"
              disabled={!canDraft || !project.script_approved}
              onClick={() => onRender("final")}
            >
              Export final · 1080p
            </button>
            {!project.script_approved && (
              <button className="text-button" onClick={onScript}>
                Approve script first →
              </button>
            )}
          </div>
          <details className="workflow-advanced">
            <summary>Preview only a section</summary>
            <p>
              Render just the selected seconds with the final captions, camera
              framing, and sound mix.
            </p>
            <div className="form-grid">
              <label>
                Section start
                <input
                  aria-label="Section start"
                  type="number"
                  min="0"
                  max={duration}
                  step=".01"
                  value={section.start}
                  onChange={(e) =>
                    setSection({ ...section, start: +e.target.value })
                  }
                />
              </label>
              <label>
                Section end
                <input
                  aria-label="Section end"
                  type="number"
                  min=".25"
                  max={duration}
                  step=".01"
                  value={section.end}
                  onChange={(e) =>
                    setSection({ ...section, end: +e.target.value })
                  }
                />
              </label>
            </div>
            <button
              className="button secondary"
              disabled={
                !canDraft ||
                section.end - section.start < 0.25 ||
                section.end > duration
              }
              onClick={() => onRender("draft", section.start, section.end)}
            >
              Render selected section
            </button>
          </details>
          <p className="help">
            To export several approved projects together, use Export queue on
            the Production desk.
          </p>
        </section>
      )}
      {stage !== "edit" && bottom}
    </div>
  );
}
export function guessKind(filename: string) {
  if (/\.srt$/i.test(filename)) return "captions";
  if (/\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(filename))
    return /^(music|bgm)/i.test(filename)
      ? "music"
      : /^(sfx|effect|impact|whoosh)/i.test(filename)
        ? "sfx"
        : "narration";
  return "panels";
}
