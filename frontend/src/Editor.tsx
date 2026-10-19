import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Download,
  Film,
  GripVertical,
  LoaderCircle,
  Plus,
  Redo2,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { api, audioUpload, json } from "./api";
import { AudioFile, Checklist, Empty, StatusPill } from "./components";
import { PanelPicker, VideoOptions } from "./dialogs";
import { MotionOptions } from "./EffectOptions";
import CameraControls from "./CameraControls";
import Preview from "./Preview";
import useStudioDraft from "./useStudioDraft";
import { AutoEditControls, BulkControls, CaptionEditor } from "./WorkflowTools";
import type { AutoEditOptions } from "./WorkflowTools";
import WaveformTimeline from "./WaveformTimeline";
import type {
  CaptionCue,
  Integrations,
  Motion,
  Panel,
  Project,
  RenderJob,
  Scene,
  VideoSettings,
} from "./types";
import {
  errorMessage,
  moveItem,
  spokenSeconds,
  timecode,
  timelineSeconds,
} from "./utils";

interface Props {
  projectId: string;
  panels: Panel[];
  integrations: Integrations;
  onBack: () => void;
  onChanged: () => void;
  onError: (error: string) => void;
  onDirty: (dirty: boolean) => void;
  onImport: () => void;
}
const newId = () => crypto.randomUUID().replaceAll("-", "");

export default function Editor({
  projectId,
  panels,
  integrations,
  onBack,
  onChanged,
  onError,
  onDirty,
  onImport,
}: Props) {
  const [busy, setBusy] = useState(false);
  const studio = useStudioDraft(projectId, busy, onChanged, onError);
  const { project, draft, update, accept, flush, dirty, status } = studio;
  const [tab, setTab] = useState<"timeline" | "script" | "settings">(
    "timeline",
  );
  const [picker, setPicker] = useState(false),
    [notice, setNotice] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [previewRequest, setPreviewRequest] = useState<{
    index?: number;
    seconds?: number;
    nonce: number;
  } | null>(null);
  const dragged = useRef<number | null>(null),
    finished = useRef("");
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    let alive = true,
      fetching = false;
    async function poll() {
      if (fetching) return;
      fetching = true;
      try {
        const values = await api<RenderJob[]>(
          `/renders?project_id=${projectId}`,
        );
        if (!alive) return;
        setJobs(values);
        const key = values
          .filter((j) => j.status === "completed" || j.status === "failed")
          .map((j) => j.id)
          .join();
        if (key !== finished.current) {
          finished.current = key;
          onChanged();
        }
      } catch (error) {
        if (alive) onError(errorMessage(error));
      } finally {
        fetching = false;
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId, onChanged, onError]);
  async function perform(action: () => Promise<void>, saveFirst = true) {
    setBusy(true);
    setNotice("");
    try {
      if (saveFirst) await flush();
      await action();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || busy) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void perform(async () => {
          setNotice("Workspace saved.");
        });
        return;
      }
      if (
        (event.target as HTMLElement).closest(
          "input, textarea, select, [contenteditable=true]",
        )
      )
        return;
      if (["z", "y"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        void perform(
          () =>
            studio.history(
              event.shiftKey || event.key.toLowerCase() === "y"
                ? "redo"
                : "undo",
            ),
          false,
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  if (!project || !draft)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        Loading production workspace…
      </div>
    );
  const { scenes, settings, script, title, idea, cues } = draft;
  const duration = timelineSeconds(scenes, settings.fps);
  const narrationLength = Math.max(
    0,
    Math.min(
      settings.narration_end ?? project.narration_duration ?? 0,
      project.narration_duration ?? 0,
    ) - settings.narration_start,
  );
  const activeJob = jobs.find(
    (j) => j.status === "queued" || j.status === "running",
  );
  const exported = jobs.some(
    (j) =>
      j.status === "completed" &&
      j.quality !== "draft" &&
      j.project_revision === project.revision,
  );
  const canDraft =
    scenes.length > 0 &&
    Boolean(project.narration_url) &&
    narrationLength <= duration + 0.05 &&
    !activeJob;
  const canRender = canDraft && project.script_approved && !dirty;
  const view: Project = {
    ...project,
    ...draft,
    caption_cues: cues,
    status: activeJob
      ? "rendering"
      : project.script_approved
        ? exported
          ? "exported"
          : "ready"
        : scenes.length
          ? "scripting"
          : project.status,
  };
  const editScene = (index: number, patch: Partial<Scene>) =>
    update({
      scenes: scenes.map((scene, i) =>
        i === index ? { ...scene, ...patch } : scene,
      ),
    });
  const reorder = (from: number, to: number) =>
    update({ scenes: moveItem(scenes, from, to) });
  async function render(quality: "draft" | "final") {
    await perform(async () => {
      const job = await api<RenderJob>(
        `/projects/${projectId}/renders`,
        json({ quality }),
      );
      setJobs((previous) => [job, ...previous]);
      onChanged();
      setNotice(
        quality === "draft"
          ? "Draft queued at 360 × 640. Review it before the final export."
          : "Final render queued. You can keep editing while this saved revision exports.",
      );
    });
  }
  async function runAutoEdit(options: AutoEditOptions) {
    await perform(async () => {
      const result = await api<{
        scenes: Scene[];
        settings: VideoSettings;
        duration: number;
      }>(`/projects/${projectId}/auto-edit`, json(options));
      update({
        settings: result.settings,
        scenes: result.scenes.map((scene, index) => ({
          ...scene,
          position: index,
          panel: panels.find((panel) => panel.id === scene.panel_id)!,
          sfx_url: scenes.find((old) => old.id === scene.id)?.sfx_url ?? null,
        })),
      });
      setSelected(new Set());
      setNotice(
        `${options.pace === "fast" ? "Fast" : "Slow"} first cut created: ${result.scenes.length} shots, ${timecode(result.duration)}. Review framing, captions, and the ending before approval.`,
      );
    });
  }
  function fitNarration() {
    const count = scenes.length,
      fps = settings.fps,
      target = Math.ceil(narrationLength * fps - 1e-6),
      minimum = Math.ceil(0.25 * fps);
    if (!count || target < count * minimum || target > count * 30 * fps) {
      onError(
        "Add or remove scenes so each can fit between 0.25 and 30 seconds.",
      );
      return;
    }
    const base = Math.floor(target / count),
      extra = target % count;
    update({
      scenes: scenes.map((scene, i) => ({
        ...scene,
        duration: (base + (i < extra ? 1 : 0)) / fps,
      })),
    });
    setNotice(
      "Timeline fitted to the selected narration. Drag waveform cuts to refine the timing.",
    );
  }
  const uploadAsset = (kind: "narration" | "music" | "logo", file: File) =>
    void perform(async () => {
      accept(
        await api<Project>(`/projects/${projectId}/${kind}`, audioUpload(file)),
      );
      onChanged();
      setNotice(
        kind === "narration"
          ? "Narration uploaded and normalized."
          : `${kind === "music" ? "Music" : "Logo"} saved.`,
      );
    });
  const removeAsset = (kind: "music" | "logo") =>
    void perform(async () => {
      accept(
        await api<Project>(`/projects/${projectId}/assets/${kind}`, {
          method: "DELETE",
        }),
      );
      onChanged();
    });
  function fileInput(
    label: string,
    acceptTypes: string,
    action: (file: File) => void,
  ) {
    return (
      <input
        type="file"
        hidden
        accept={acceptTypes}
        aria-label={label}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) action(file);
        }}
      />
    );
  }
  return (
    <fieldset className="studio-fieldset" disabled={busy}>
      <button
        className="breadcrumb text-button"
        onClick={() => void perform(async () => onBack())}
      >
        <ArrowLeft size={15} />
        Production desk<span>/</span>
        {project.title}
      </button>
      <div className="page-title editor-title">
        <div>
          <div className="eyebrow">PROJECT WORKSPACE</div>
          <h1>{title}</h1>
          <div className="project-meta">
            <StatusPill status={view.status} />
            <span>{scenes.length} scenes</span>
            <span>{timecode(duration)} runtime</span>
            <span
              className={
                status.startsWith("Save failed")
                  ? "inline-error"
                  : dirty
                    ? "unsaved"
                    : "accent"
              }
              role="status"
              aria-label="Autosave status"
            >
              {status}
            </span>
          </div>
        </div>
        <div className="workflow-actions">
          <button
            className="button secondary"
            disabled={!canDraft || busy}
            onClick={() => void render("draft")}
          >
            <Film size={16} />
            Draft preview
          </button>
          <button
            className="button"
            disabled={!canRender || busy}
            title={
              !canRender
                ? "Save changes, upload narration, and approve the script first"
                : "Render a 1080 × 1920 MP4"
            }
            onClick={() => void render("final")}
          >
            {activeJob ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Film size={17} />
            )}
            {activeJob ? `Rendering ${activeJob.progress}%` : "Render MP4"}
          </button>
        </div>
      </div>
      <div className="workspace-toolbar">
        <button
          className="button secondary small-button"
          disabled={busy || (!dirty && !project.can_undo)}
          onClick={() => void perform(() => studio.history("undo"), false)}
        >
          <Undo2 size={15} />
          Undo
        </button>
        <button
          className="button secondary small-button"
          disabled={busy || dirty || !project.can_redo}
          onClick={() => void perform(() => studio.history("redo"), false)}
        >
          <Redo2 size={15} />
          Redo
        </button>
        <span>
          Autosave on · Ctrl+S to save · Ctrl+Z / Ctrl+Shift+Z to undo / redo
        </span>
      </div>
      {studio.recovery && (
        <div className="notice recovery-notice">
          <span>
            An unsaved browser draft is available. The server version is open.
          </span>
          <button
            className="button secondary small-button"
            onClick={studio.recover}
          >
            Recover browser draft
          </button>
          <button className="text-button" onClick={studio.dismissRecovery}>
            Dismiss
          </button>
        </div>
      )}
      {status.startsWith("Save failed") && (
        <div className="notice recovery-notice">
          <span>{status}</span>
          <button
            className="button secondary small-button"
            onClick={() => void perform(async () => {})}
          >
            Retry save
          </button>
          <button
            className="text-button"
            onClick={() => {
              if (
                window.confirm(
                  "Reload the saved version? Copy any local changes you want to keep first.",
                )
              )
                void perform(studio.reload, false);
            }}
          >
            Reload saved version
          </button>
        </div>
      )}
      {busy && (
        <div className="notice" role="status">
          <LoaderCircle size={16} className="spin" />
          Working… keep Studio open.
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      <div className="editor-layout">
        <div className="editor-workspace">
          <div className="tabs">
            {(
              [
                ["timeline", Film, "Timeline"],
                ["script", Sparkles, "Verdict script"],
                ["settings", Settings2, "Settings"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                className={tab === value ? "active" : ""}
                onClick={() => setTab(value)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          {tab === "timeline" && (
            <>
              <AutoEditControls
                pace={settings.edit_pace}
                ready={Boolean(scenes.length && project.narration_url)}
                busy={busy}
                onRun={(options) => void runAutoEdit(options)}
              />
              <section className="surface timeline-section">
                <div className="section-heading">
                  <div>
                    <h3>Panel sequence</h3>
                    <p>
                      Drag scenes into order. Select several to edit them
                      together.
                    </p>
                  </div>
                  <button
                    className="button secondary small-button"
                    onClick={() => setPicker(true)}
                  >
                    <Plus size={15} />
                    Add panels
                  </button>
                </div>
                {!scenes.length ? (
                  <Empty
                    title="Set the fight in motion"
                    action={
                      <button
                        className="button secondary"
                        onClick={() =>
                          panels.length ? setPicker(true) : onImport()
                        }
                      >
                        <Plus size={16} />
                        {panels.length
                          ? "Choose panels"
                          : "Import source panels"}
                      </button>
                    }
                  >
                    Build your sequence from the panel library, then upload
                    narration and choose Auto Edit.
                  </Empty>
                ) : (
                  <>
                    <WaveformTimeline
                      projectId={projectId}
                      audioUrl={project.narration_url}
                      scenes={scenes}
                      fps={settings.fps}
                      start={settings.narration_start}
                      onChange={(values) => update({ scenes: values })}
                      onSeek={(seconds) =>
                        setPreviewRequest({ seconds, nonce: Date.now() })
                      }
                    />
                    <BulkControls
                      scenes={scenes}
                      selected={
                        new Set(
                          [...selected].filter((id) =>
                            scenes.some((scene) => scene.id === id),
                          ),
                        )
                      }
                      setSelected={setSelected}
                      onApply={(patch) =>
                        update({
                          scenes: scenes.map((scene) =>
                            selected.has(scene.id!)
                              ? { ...scene, ...patch }
                              : scene,
                          ),
                        })
                      }
                      onDelete={() => {
                        update({
                          scenes: scenes.filter(
                            (scene) => !selected.has(scene.id!),
                          ),
                        });
                        setSelected(new Set());
                      }}
                    />
                    <div className="scene-list">
                      {scenes.map((scene, index) => (
                        <div
                          className="scene-card"
                          key={scene.id}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (dragged.current !== null)
                              reorder(dragged.current, index);
                            dragged.current = null;
                          }}
                        >
                          <div className="scene-top">
                            <input
                              className="scene-select"
                              type="checkbox"
                              aria-label={`Select scene ${index + 1}`}
                              checked={selected.has(scene.id!)}
                              onChange={(event) => {
                                const values = new Set(selected);
                                if (event.target.checked) values.add(scene.id!);
                                else values.delete(scene.id!);
                                setSelected(values);
                              }}
                            />
                            <span
                              className="scene-handle"
                              draggable
                              onDragStart={(event) => {
                                dragged.current = index;
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  "text/plain",
                                  String(index),
                                );
                              }}
                              onDragEnd={() => {
                                dragged.current = null;
                              }}
                            >
                              <GripVertical size={17} />
                              <b>{String(index + 1).padStart(2, "0")}</b>
                            </span>
                            <span className="scene-source">
                              {scene.panel.series || "Source panel"}
                              {scene.panel.issue && ` · #${scene.panel.issue}`}
                            </span>
                            <button
                              className="icon-button"
                              aria-label={`Move scene ${index + 1} up`}
                              disabled={index === 0}
                              onClick={() => reorder(index, index - 1)}
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Move scene ${index + 1} down`}
                              disabled={index === scenes.length - 1}
                              onClick={() => reorder(index, index + 1)}
                            >
                              <ArrowDown size={14} />
                            </button>
                            <button
                              className="icon-button danger"
                              aria-label={`Remove scene ${index + 1}`}
                              onClick={() =>
                                update({
                                  scenes: scenes.filter((_, i) => i !== index),
                                })
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="scene-body">
                            <img
                              src={scene.panel.thumbnail_url}
                              alt={scene.panel.title}
                            />
                            <div>
                              <strong>{scene.panel.title}</strong>
                              <div className="form-grid">
                                <label>
                                  Duration (seconds)
                                  <input
                                    aria-label={`Scene ${index + 1} duration`}
                                    type="number"
                                    min="0.25"
                                    max="30"
                                    step="0.01"
                                    value={scene.duration}
                                    onChange={(event) =>
                                      editScene(index, {
                                        duration: +event.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  Camera motion
                                  <select
                                    aria-label={`Scene ${index + 1} motion`}
                                    value={scene.motion}
                                    onChange={(event) =>
                                      editScene(index, {
                                        motion: event.target.value as Motion,
                                      })
                                    }
                                  >
                                    <MotionOptions />
                                  </select>
                                </label>
                              </div>
                              <label>
                                On-screen caption
                                <input
                                  aria-label={`Scene ${index + 1} caption`}
                                  maxLength={300}
                                  value={scene.caption}
                                  placeholder="The punchline goes here."
                                  onChange={(event) =>
                                    editScene(index, {
                                      caption: event.target.value,
                                    })
                                  }
                                />
                              </label>
                            </div>
                          </div>
                          <CameraControls
                            scene={scene}
                            index={index}
                            settings={settings}
                            onChange={(patch) => editScene(index, patch)}
                            onPreview={() =>
                              setPreviewRequest({ index, nonce: Date.now() })
                            }
                          />
                          <div className="scene-footer">
                            {scene.sfx_url ? (
                              <>
                                <AudioFile
                                  url={scene.sfx_url}
                                  label="Scene sound effect"
                                />
                                <button
                                  className="text-button danger"
                                  onClick={() =>
                                    void perform(async () => {
                                      accept(
                                        await api<Project>(
                                          `/projects/${projectId}/scenes/${scene.id}/sfx`,
                                          { method: "DELETE" },
                                        ),
                                      );
                                      onChanged();
                                    })
                                  }
                                >
                                  Remove sound
                                </button>
                              </>
                            ) : (
                              <label className="text-button">
                                Add sound effect
                                {fileInput(
                                  `Upload sound effect for scene ${index + 1}`,
                                  "audio/*",
                                  (file) =>
                                    void perform(async () => {
                                      accept(
                                        await api<Project>(
                                          `/projects/${projectId}/scenes/${scene.id}/sfx`,
                                          audioUpload(file),
                                        ),
                                      );
                                      onChanged();
                                    }),
                                )}
                              </label>
                            )}
                            <small>Optional · maximum 30 seconds</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <div className="timeline-summary">
                  <span>
                    {timecode(duration)} / 1:05–1:30 target
                    {duration > 180 && " · Over 180-second limit"}
                  </span>
                  <div className="workflow-actions">
                    <button
                      className="text-button"
                      disabled={!project.narration_url || !scenes.length}
                      onClick={fitNarration}
                    >
                      Fit narration
                    </button>
                    <button
                      className="button small-button"
                      disabled={busy || !scenes.length || duration > 180}
                      onClick={() =>
                        void perform(async () => {
                          setNotice(
                            "Timeline saved. Review and approve the script for these scenes.",
                          );
                        })
                      }
                    >
                      <Save size={15} />
                      Save timeline
                    </button>
                  </div>
                </div>
              </section>
              <section className="surface narration-section">
                <div className="section-heading">
                  <div>
                    <h3>Narration track</h3>
                    <p>
                      Upload Verdict’s performance. Audio stays on your
                      computer.
                    </p>
                  </div>
                  <label className="button secondary small-button">
                    <Upload size={15} />
                    {project.narration_url ? "Replace audio" : "Upload audio"}
                    {fileInput("Upload narration", "audio/*", (file) =>
                      uploadAsset("narration", file),
                    )}
                  </label>
                </div>
                {project.narration_url && (
                  <>
                    <AudioFile
                      url={project.narration_url}
                      label={`Original narration · ${timecode(project.narration_duration ?? 0)}`}
                    />
                    <div className="form-grid">
                      <label>
                        Narration in (seconds)
                        <input
                          aria-label="Narration in"
                          type="number"
                          min="0"
                          max={project.narration_duration ?? 180}
                          step="0.01"
                          value={settings.narration_start}
                          onChange={(e) =>
                            update({
                              settings: {
                                ...settings,
                                narration_start: +e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Narration out (seconds)
                        <input
                          aria-label="Narration out"
                          type="number"
                          min="0.25"
                          max={project.narration_duration ?? 180}
                          step="0.01"
                          value={
                            settings.narration_end ??
                            project.narration_duration ??
                            0
                          }
                          onChange={(e) =>
                            update({
                              settings: {
                                ...settings,
                                narration_end: +e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        update({
                          settings: {
                            ...settings,
                            narration_start: 0,
                            narration_end: null,
                          },
                        })
                      }
                    >
                      Use full narration
                    </button>
                    <p
                      className={
                        narrationLength > duration + 0.05
                          ? "inline-error"
                          : "help"
                      }
                    >
                      {narrationLength > duration + 0.05
                        ? "Selected narration is longer than the timeline. Use Fit narration or Auto Edit to preserve the selected speech."
                        : `Selected audio: ${narrationLength.toFixed(2)} seconds. Preview and export use this range.`}
                    </p>
                  </>
                )}
              </section>
              <CaptionEditor
                cues={cues}
                busy={busy}
                hasNarration={Boolean(project.narration_url)}
                onChange={(values) => update({ cues: values })}
                scriptAvailable={Boolean(script.trim())}
                onTranscribe={(useScript) =>
                  void perform(async () => {
                    if (
                      cues.length &&
                      !window.confirm(
                        "Replace the current timed captions with a new recognition draft?",
                      )
                    )
                      return;
                    const result = await api<{ cues: CaptionCue[] }>(
                      `/projects/${projectId}/captions/transcribe`,
                      json({ use_script: useScript }),
                    );
                    update({ cues: result.cues });
                    setNotice(
                      result.cues.length
                        ? "Caption draft generated locally. Review names, wording, and timing before export."
                        : "No speech was recognized. Import an SRT or add captions manually.",
                    );
                  })
                }
                onImport={(file) =>
                  void perform(async () => {
                    const result = await api<{ cues: CaptionCue[] }>(
                      `/projects/${projectId}/captions/import`,
                      audioUpload(file),
                    );
                    update({ cues: result.cues });
                    setNotice(
                      "SRT captions loaded. Review and correct them before export.",
                    );
                  })
                }
                onDownload={() =>
                  void perform(async () => {
                    const link = document.createElement("a");
                    link.href = `/api/projects/${projectId}/captions/srt`;
                    link.download = "verdict-captions.srt";
                    link.click();
                  })
                }
              />
            </>
          )}
          {tab === "script" && (
            <section className="surface script-section">
              <div className="section-heading">
                <div>
                  <h3>Give Verdict a voice.</h3>
                  <p>Funny. Aggressive. Specific to what’s on the panel.</p>
                </div>
                <span
                  className={`mini-tag ${project.script_approved && !dirty ? "approved" : ""}`}
                >
                  {project.script_approved && !dirty ? "APPROVED" : "DRAFT"}
                </span>
              </div>
              <label>
                The angle
                <textarea
                  rows={3}
                  maxLength={8000}
                  value={idea}
                  onChange={(e) => update({ idea: e.target.value })}
                />
              </label>
              <label>
                Verdict’s script
                <textarea
                  className="script-editor"
                  aria-label="Verdict’s script"
                  rows={15}
                  maxLength={20000}
                  value={script}
                  onChange={(e) => update({ script: e.target.value })}
                  placeholder="Hook. Roast the decision. Escalate with evidence. End with a line that leads back to the hook."
                />
              </label>
              <div className="script-stats">
                <span>
                  {script.trim().split(/\s+/).filter(Boolean).length} words
                </span>
                <span>
                  ~{timecode(spokenSeconds(script))} spoken · target 1:05–1:30
                </span>
              </div>
              <div className="script-actions">
                <button
                  className="button secondary"
                  onClick={() =>
                    void perform(async () => {
                      setNotice("Verdict draft saved.");
                    })
                  }
                >
                  <Save size={15} />
                  Save draft
                </button>
                <button
                  className="button"
                  disabled={busy || !script.trim()}
                  onClick={() =>
                    void perform(async () => {
                      accept(
                        await api<Project>(
                          `/projects/${projectId}`,
                          json({ script_approved: true }, "PATCH"),
                        ),
                      );
                      onChanged();
                      setNotice(
                        "Verdict script approved. The saved revision is ready for production.",
                      );
                    })
                  }
                >
                  <Check size={16} />
                  Approve script
                </button>
              </div>
              <div className="ai-assist">
                <Sparkles size={18} />
                <div>
                  <strong>Writing assistant</strong>
                  <p>
                    {integrations.writing_enabled
                      ? "Generate an optional draft with your configured provider. Review before approving."
                      : "Optional. Connect an OpenAI-compatible API in environment settings. Manual writing is always available."}
                  </p>
                </div>
                <button
                  className="button secondary small-button"
                  disabled={!integrations.writing_enabled || busy}
                  onClick={() =>
                    void perform(async () => {
                      const result = await api<{ script: string }>(
                        `/projects/${projectId}/draft`,
                        json({}),
                      );
                      update({ script: result.script });
                      setNotice("AI draft loaded. Review before approval.");
                    })
                  }
                >
                  Draft with AI
                </button>
              </div>
              <div className="note">
                <strong>Make the ending loop.</strong>
                <p>
                  Write the last line so it sets up the opening hook. Preview
                  the completed MP4 on repeat to check the handoff.
                </p>
              </div>
            </section>
          )}
          {tab === "settings" && (
            <section className="surface settings-section">
              <h3>Project settings & brand kit</h3>
              <label>
                Project title
                <input
                  maxLength={200}
                  value={title}
                  onChange={(e) => update({ title: e.target.value })}
                />
              </label>
              <VideoOptions
                value={settings}
                onChange={(value) => update({ settings: value })}
              />
              <p className="help">
                Camera defaults apply to newly added scenes. Final exports are
                1080 × 1920; drafts are 360 × 640. Changes save automatically
                and require script reapproval.
              </p>
              <button
                className="button"
                disabled={!title.trim()}
                onClick={() =>
                  void perform(async () => {
                    setNotice("Project settings saved.");
                  })
                }
              >
                <Save size={15} />
                Save settings
              </button>
              <hr />
              <h3>Brand assets</h3>
              <div className="workflow-actions">
                <label className="button secondary small-button">
                  <Upload size={14} />
                  {project.logo_url ? "Replace logo" : "Upload logo"}
                  {fileInput("Upload brand logo", "image/*", (file) =>
                    uploadAsset("logo", file),
                  )}
                </label>
                {project.logo_url && (
                  <>
                    <img
                      className="brand-logo-sample"
                      src={project.logo_url}
                      alt="Brand logo"
                    />
                    <button
                      className="text-button"
                      onClick={() => removeAsset("logo")}
                    >
                      Remove logo
                    </button>
                  </>
                )}
              </div>
              <div className="workflow-actions">
                <label className="button secondary small-button">
                  <Upload size={14} />
                  {project.music_url ? "Replace music" : "Upload music"}
                  {fileInput("Upload background music", "audio/*", (file) =>
                    uploadAsset("music", file),
                  )}
                </label>
                {project.music_url && (
                  <button
                    className="text-button"
                    onClick={() => removeAsset("music")}
                  >
                    Remove music
                  </button>
                )}
              </div>
              {project.music_url && (
                <AudioFile
                  url={project.music_url}
                  label="Original background music"
                />
              )}
              <p className="help">
                Music loops to the timeline length. Volume balancing and ducking
                are applied during export.
              </p>
              <hr />
              <h3>Save as a reusable template</h3>
              <p className="help">
                Remember pace, cameras, transitions, caption appearance, logo,
                music, and audio levels. Narration selections reset for each new
                project.
              </p>
              <label>
                Template name
                <input
                  value={templateName}
                  maxLength={120}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="My Verdict template"
                />
              </label>
              <button
                className="button secondary"
                disabled={busy || !templateName.trim()}
                onClick={() =>
                  void perform(async () => {
                    await api(
                      "/templates",
                      json({
                        name: templateName,
                        settings,
                        project_id: projectId,
                      }),
                    );
                    setTemplateName("");
                    onChanged();
                    setNotice(
                      "Brand template saved. Select it when creating a project.",
                    );
                  })
                }
              >
                <Plus size={15} />
                Save template
              </button>
            </section>
          )}
          {jobs.length > 0 && (
            <section className="surface render-history">
              <div className="section-heading">
                <h3>Export history</h3>
                <span className="mini-tag">{jobs.length} JOBS</span>
              </div>
              {jobs.map((job) => (
                <div key={job.id} className="render-row">
                  <Film size={18} />
                  <div>
                    <strong>
                      {job.quality === "draft"
                        ? "Draft · 360p"
                        : "Final · 1080p"}{" "}
                      · Revision {job.project_revision} · {job.status}
                    </strong>
                    <small>{new Date(job.created_at).toLocaleString()}</small>
                    {job.error && <p className="inline-error">{job.error}</p>}
                    {["queued", "running"].includes(job.status) && (
                      <progress
                        value={job.progress}
                        max={100}
                        aria-label="Render progress"
                      />
                    )}
                  </div>
                  {job.download_url && (
                    <a
                      className="button secondary small-button"
                      href={job.download_url}
                      download
                    >
                      <Download size={15} />
                      MP4
                    </a>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>
        <aside className="editor-preview">
          <Preview scenes={scenes} project={view} request={previewRequest} />
          <section className="surface preflight">
            <span className="eyebrow">EXPORT CHECKLIST</span>
            <Checklist
              checks={[
                ["Save your timeline", scenes.length > 0 && !dirty],
                ["Upload narration", Boolean(project.narration_url)],
                ["Approve Verdict’s script", project.script_approved && !dirty],
                ["Save all project changes", !dirty],
              ]}
            />
          </section>
        </aside>
      </div>
      {picker && (
        <PanelPicker
          panels={panels}
          onClose={() => setPicker(false)}
          onAdd={(chosen) => {
            update({
              scenes: [
                ...scenes,
                ...chosen.map((panel, i) => ({
                  id: newId(),
                  panel,
                  panel_id: panel.id,
                  position: scenes.length + i,
                  duration: settings.default_duration,
                  motion: settings.default_motion,
                  motion_strength: settings.default_motion_strength,
                  easing: settings.default_easing,
                  focus_x: 0.5,
                  focus_y: 0.5,
                  transition: null,
                  transition_duration: null,
                  caption: "",
                  sfx_url: null,
                })),
              ],
            });
            setPicker(false);
          }}
        />
      )}
    </fieldset>
  );
}
