import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AudioLines,
  Check,
  Download,
  Film,
  GripVertical,
  LoaderCircle,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { api, audioUpload, json } from "./api";
import { AudioFile, Checklist, Empty, StatusPill } from "./components";
import { PanelPicker, VideoOptions } from "./dialogs";
import { MotionOptions } from "./EffectOptions";
import CameraControls from "./CameraControls";
import Preview from "./Preview";
import type {
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
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [script, setScript] = useState("");
  const [idea, setIdea] = useState("");
  const [title, setTitle] = useState("");
  const [settings, setSettings] = useState<VideoSettings | null>(null);
  const [dirtyScenes, setDirtyScenes] = useState(false);
  const [previewRequest, setPreviewRequest] = useState<{
    index: number;
    nonce: number;
  } | null>(null);
  const [tab, setTab] = useState<"timeline" | "script" | "settings">(
    "timeline",
  );
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [notice, setNotice] = useState("");
  const dragged = useRef<number | null>(null);
  useEffect(() => {
    let alive = true;
    api<Project>(`/projects/${projectId}`)
      .then((p) => {
        if (!alive) return;
        setProject(p);
        setScenes(p.scenes ?? []);
        setScript(p.script);
        setIdea(p.idea);
        setTitle(p.title);
        setSettings(p.settings);
      })
      .catch((e) => onError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [projectId, onError]);
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
        if (alive) setJobs(values);
        if (
          alive &&
          values.some((j) => j.status === "completed" || j.status === "failed")
        ) {
          const p = await api<Project>(`/projects/${projectId}`);
          if (alive)
            setProject((current) =>
              !current || p.revision >= current.revision ? p : current,
            );
        }
      } catch (error) {
        if (alive) onError(errorMessage(error));
      } finally {
        fetching = false;
      }
    }
    void poll();
    const interval = setInterval(() => void poll(), 3000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [projectId, onError]);
  const scriptDirty = Boolean(
    project && (script !== project.script || idea !== project.idea),
  );
  const settingsDirty = Boolean(
    project &&
    (title !== project.title ||
      JSON.stringify(settings) !== JSON.stringify(project.settings)),
  );
  const dirty = dirtyScenes || scriptDirty || settingsDirty;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function changed(p: Project) {
    setProject(p);
    onChanged();
  }
  async function saveScenes() {
    const p = await api<Project>(
      `/projects/${projectId}/scenes`,
      json(
        {
          scenes: scenes.map((s) => ({
            id: s.id ?? null,
            panel_id: s.panel_id,
            duration: s.duration,
            motion: s.motion,
            motion_strength: s.motion_strength,
            easing: s.easing,
            focus_x: s.focus_x,
            focus_y: s.focus_y,
            transition: s.transition,
            transition_duration: s.transition_duration,
            caption: s.caption,
          })),
        },
        "PUT",
      ),
    );
    changed(p);
    setScenes(p.scenes ?? []);
    setDirtyScenes(false);
    setNotice(
      "Timeline saved. Review and approve the script for these scenes.",
    );
  }
  function editScene(index: number, values: Partial<Scene>) {
    setScenes(scenes.map((s, i) => (i === index ? { ...s, ...values } : s)));
    setDirtyScenes(true);
  }
  function reorder(from: number, to: number) {
    setScenes(moveItem(scenes, from, to));
    setDirtyScenes(true);
  }
  if (!project || !settings)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        Loading production workspace…
      </div>
    );
  const duration = timelineSeconds(scenes, settings.fps);
  const activeJob = jobs.find(
    (j) => j.status === "queued" || j.status === "running",
  );
  const canRender =
    scenes.length > 0 &&
    project.script_approved &&
    Boolean(project.narration_url) &&
    !dirty &&
    !activeJob;
  return (
    <>
      <button className="breadcrumb text-button" onClick={onBack}>
        <ArrowLeft size={15} />
        Production desk<span>/</span>
        {project.title}
      </button>
      <div className="page-title editor-title">
        <div>
          <div className="eyebrow">PROJECT WORKSPACE</div>
          <h1>{project.title}</h1>
          <div className="project-meta">
            <StatusPill status={project.status} />
            <span>{scenes.length} scenes</span>
            <span>{timecode(duration)} runtime</span>
            {dirty && <span className="unsaved">Unsaved changes</span>}
          </div>
        </div>
        <button
          className="button"
          disabled={!canRender || busy}
          title={
            !canRender
              ? "Save changes, upload narration, and approve the script first"
              : "Render a 1080 × 1920 MP4"
          }
          onClick={() =>
            void perform(async () => {
              const job = await api<RenderJob>(
                `/projects/${projectId}/renders`,
                json({}),
              );
              setJobs([job, ...jobs]);
              setProject({ ...project, status: "rendering" });
              onChanged();
              setNotice(
                "Render queued. You can keep working; this export uses the saved revision.",
              );
            })
          }
        >
          {activeJob ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Film size={17} />
          )}
          {activeJob ? `Rendering ${activeJob.progress}%` : "Render MP4"}
        </button>
      </div>
      <div className="editor-layout">
        <div className="editor-workspace">
          <div className="tabs">
            <button
              className={tab === "timeline" ? "active" : ""}
              onClick={() => setTab("timeline")}
            >
              <Film size={15} />
              Timeline
            </button>
            <button
              className={tab === "script" ? "active" : ""}
              onClick={() => setTab("script")}
            >
              <Sparkles size={15} />
              Verdict script
            </button>
            <button
              className={tab === "settings" ? "active" : ""}
              onClick={() => setTab("settings")}
            >
              <Settings2 size={15} />
              Settings
            </button>
          </div>
          {notice && (
            <div className="notice" role="status">
              <Check size={16} />
              {notice}
            </div>
          )}
          {tab === "timeline" && (
            <>
              <section className="surface timeline-section">
                <div className="section-heading">
                  <div>
                    <h3>Panel sequence</h3>
                    <p>Drag scenes into order. Every panel gets its moment.</p>
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
                    Build your sequence from the panel library, then dial in the
                    timing.
                  </Empty>
                ) : (
                  <div className="scene-list">
                    {scenes.map((scene, index) => (
                      <div
                        className="scene-card"
                        key={scene.id ?? `new-${scene.panel_id}-${index}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragged.current !== null)
                            reorder(dragged.current, index);
                          dragged.current = null;
                        }}
                      >
                        <div className="scene-top">
                          <span
                            className="scene-handle"
                            draggable
                            onDragStart={(e) => {
                              dragged.current = index;
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData(
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
                            {scene.panel.page && ` · p.${scene.panel.page}`}
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
                            onClick={() => {
                              setScenes(scenes.filter((_, i) => i !== index));
                              setDirtyScenes(true);
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="scene-body">
                          <img
                            src={scene.panel.thumbnail_url}
                            alt={scene.panel.title}
                          />
                          <div className="scene-fields">
                            <strong>{scene.panel.title}</strong>
                            <div className="form-grid">
                              <label>
                                Duration (seconds)
                                <input
                                  aria-label={`Scene ${index + 1} duration`}
                                  type="number"
                                  min="0.25"
                                  max="30"
                                  step="0.25"
                                  value={scene.duration}
                                  onChange={(e) =>
                                    editScene(index, {
                                      duration: Number(e.target.value),
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Camera motion
                                <select
                                  aria-label={`Scene ${index + 1} motion`}
                                  value={scene.motion}
                                  onChange={(e) =>
                                    editScene(index, {
                                      motion: e.target.value as Motion,
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
                                onChange={(e) =>
                                  editScene(index, { caption: e.target.value })
                                }
                                placeholder="The punchline goes here."
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
                              <AudioLines size={14} />
                              <span>Sound effect attached · 35% volume</span>
                              <button
                                className="text-button"
                                disabled={busy || dirtyScenes}
                                onClick={() =>
                                  void perform(async () => {
                                    const p = await api<Project>(
                                      `/projects/${projectId}/scenes/${scene.id}/sfx`,
                                      { method: "DELETE" },
                                    );
                                    changed(p);
                                    setScenes(p.scenes ?? []);
                                  })
                                }
                              >
                                Remove
                              </button>
                            </>
                          ) : (
                            <label
                              className={`file-button ${!scene.id || dirtyScenes ? "disabled" : ""}`}
                            >
                              <AudioLines size={14} />
                              Add sound effect
                              <input
                                hidden
                                type="file"
                                accept="audio/*"
                                disabled={busy || !scene.id || dirtyScenes}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  e.target.value = "";
                                  if (file)
                                    void perform(async () => {
                                      const p = await api<Project>(
                                        `/projects/${projectId}/scenes/${scene.id}/sfx`,
                                        audioUpload(file),
                                      );
                                      changed(p);
                                      setScenes(p.scenes ?? []);
                                    });
                                }}
                              />
                            </label>
                          )}
                          <small>
                            {!scene.id || dirtyScenes
                              ? "Save timeline before attaching sound"
                              : "Optional · maximum 30 seconds"}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="timeline-summary">
                  <span
                    className={
                      duration > 90 || duration < 65 ? "muted" : "accent"
                    }
                  >
                    {timecode(duration)} / 1:05–1:30 target
                  </span>
                  <button
                    className="button small-button"
                    disabled={
                      busy ||
                      !dirtyScenes ||
                      duration > 180 ||
                      scenes.some((s) => s.duration < 0.25 || s.duration > 30)
                    }
                    onClick={() => void perform(saveScenes)}
                  >
                    <Save size={15} />
                    Save timeline
                  </button>
                </div>
              </section>
              <section className="surface narration-section">
                <div className="section-heading">
                  <div>
                    <h3>
                      <AudioLines size={17} /> Narration track
                    </h3>
                    <p>
                      Upload Verdict’s performance. WAV, MP3, M4A, OGG, FLAC, or
                      WebM.
                    </p>
                  </div>
                  <label
                    className={`button secondary small-button ${busy ? "disabled" : ""}`}
                  >
                    <Upload size={15} />
                    {project.narration_url ? "Replace audio" : "Upload audio"}
                    <input
                      type="file"
                      hidden
                      accept="audio/*"
                      aria-label="Upload narration"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file)
                          void perform(async () => {
                            changed(
                              await api<Project>(
                                `/projects/${projectId}/narration`,
                                audioUpload(file),
                              ),
                            );
                            setNotice("Narration uploaded and normalized.");
                          });
                      }}
                    />
                  </label>
                </div>
                {project.narration_url && (
                  <AudioFile
                    url={project.narration_url}
                    label={`Narration · ${timecode(project.narration_duration ?? 0)}`}
                  />
                )}
                {project.narration_duration &&
                project.narration_duration > duration + 0.05 ? (
                  <p className="inline-error">
                    Narration runs longer than your timeline. Extend scenes to
                    preserve all speech.
                  </p>
                ) : (
                  <p className="help">
                    Audio starts at 0:00. Shorter narration is padded with
                    silence; longer narration blocks export.
                  </p>
                )}
              </section>
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
                  className={`mini-tag ${project.script_approved ? "approved" : ""}`}
                >
                  {project.script_approved ? "APPROVED" : "DRAFT"}
                </span>
              </div>
              <label>
                The angle
                <textarea
                  rows={3}
                  value={idea}
                  maxLength={8000}
                  onChange={(e) => setIdea(e.target.value)}
                />
              </label>
              <label>
                Verdict’s script
                <textarea
                  className="script-editor"
                  rows={15}
                  value={script}
                  maxLength={20000}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder={
                    "[HOOK] Start with the most outrageous panel.\n\n[BEAT 1] Name the move. Roast the decision.\n\n[BEAT 2] Escalate with evidence from the next panel.\n\n[LOOP] End with a line that leads straight back to your hook."
                  }
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
                  disabled={busy || !scriptDirty}
                  onClick={() =>
                    void perform(async () => {
                      changed(
                        await api<Project>(
                          `/projects/${projectId}`,
                          json({ script, idea }, "PATCH"),
                        ),
                      );
                      setNotice(
                        "Script revision saved. Review it before approval.",
                      );
                    })
                  }
                >
                  <Save size={16} />
                  Save draft
                </button>
                <button
                  className="button"
                  disabled={
                    busy || dirty || !script.trim() || project.script_approved
                  }
                  onClick={() =>
                    void perform(async () => {
                      changed(
                        await api<Project>(
                          `/projects/${projectId}`,
                          json({ script_approved: true }, "PATCH"),
                        ),
                      );
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
                      ? "Generate an optional draft using your configured provider. Review before approving."
                      : "Optional. Connect an OpenAI-compatible API in environment settings. Manual writing is always available."}
                  </p>
                </div>
                <button
                  className="button secondary small-button"
                  disabled={!integrations.writing_enabled || busy || dirty}
                  onClick={() =>
                    void perform(async () => {
                      const result = await api<{ script: string }>(
                        `/projects/${projectId}/draft`,
                        json({}),
                      );
                      setScript(result.script);
                      setNotice(
                        "AI draft loaded into the editor. It has not been saved or approved.",
                      );
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
              <h3>Project settings</h3>
              <label>
                Project title
                <input
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <VideoOptions value={settings} onChange={setSettings} />
              <p className="help">
                Default motion and duration apply to newly added scenes. Output
                is always 1080 × 1920. Changing settings requires script
                reapproval.
              </p>
              <button
                className="button"
                disabled={busy || !settingsDirty || !title.trim()}
                onClick={() =>
                  void perform(async () => {
                    changed(
                      await api<Project>(
                        `/projects/${projectId}`,
                        json({ title, settings }, "PATCH"),
                      ),
                    );
                    setNotice("Project settings saved.");
                  })
                }
              >
                <Save size={15} />
                Save settings
              </button>
              <hr />
              <h3>Save as a reusable template</h3>
              <p className="help">
                Preserve these motion, timing, transition, and subtitle defaults
                for your next project.
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
                      json({ name: templateName, settings }),
                    );
                    setTemplateName("");
                    onChanged();
                    setNotice(
                      "Template saved. Select it when creating a project.",
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
                      Revision {job.project_revision} · {job.status}
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
          <Preview
            scenes={scenes}
            project={{ ...project, settings }}
            request={previewRequest}
          />
          <section className="surface preflight">
            <span className="eyebrow">EXPORT CHECKLIST</span>
            <Checklist
              checks={[
                ["Save your timeline", scenes.length > 0 && !dirtyScenes],
                ["Upload narration", Boolean(project.narration_url)],
                [
                  "Approve Verdict’s script",
                  project.script_approved && !scriptDirty,
                ],
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
            setScenes([
              ...scenes,
              ...chosen.map((panel, i) => ({
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
            ]);
            setDirtyScenes(true);
            setPicker(false);
          }}
        />
      )}
    </>
  );
}
