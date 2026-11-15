import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Download,
  Film,
  FolderOpen,
  PencilRuler,
  Sparkles,
} from "lucide-react";
import type { Project, RenderJob, Scene } from "./types";

export type GuidedState =
  "files" | "save" | "working" | "generate" | "review" | "export" | "done";

export function guidedState(
  project: Project,
  scenes: Scene[],
  jobs: RenderJob[],
  dirty: boolean,
): GuidedState {
  const hasPanels =
    scenes.length > 0 ||
    project.scene_count > 0 ||
    (project.workflow?.panel_ids?.length ?? 0) > 0;
  if (!hasPanels || !project.narration_url) return "files";
  if (dirty) return "save";

  const current = jobs.filter(
    (job) =>
      job.project_id === project.id &&
      job.project_revision === project.revision,
  );
  if (
    current.some((job) => job.status === "queued" || job.status === "running")
  )
    return "working";
  if (
    current.some((job) => job.status === "completed" && job.quality === "final")
  )
    return "done";
  if (project.script_approved) return "export";
  if (
    current.some((job) => job.status === "completed" && job.quality === "draft")
  )
    return "review";
  return "generate";
}

type Props = {
  project: Project;
  scenes: Scene[];
  jobs: RenderJob[];
  dirty: boolean;
  canRender: boolean;
  onFiles: () => void;
  onAutopilot: () => void;
  onSave: () => void;
  onReview: () => void;
  onRender: () => void;
  onAdvanced: () => void;
};

export default function GuidedWorkspace({
  project,
  scenes,
  jobs,
  dirty,
  canRender,
  onFiles,
  onAutopilot,
  onSave,
  onReview,
  onRender,
  onAdvanced,
}: Props) {
  const status = guidedState(project, scenes, jobs, dirty);
  const panelsReady =
    scenes.length > 0 ||
    project.scene_count > 0 ||
    (project.workflow?.panel_ids?.length ?? 0) > 0;
  const audioReady = Boolean(project.narration_url);
  const final = jobs.find(
    (job) =>
      job.project_id === project.id &&
      job.project_revision === project.revision &&
      job.status === "completed" &&
      job.quality === "final",
  );
  const preview = jobs.find(
    (job) =>
      job.project_id === project.id &&
      job.project_revision === project.revision &&
      job.status === "completed" &&
      job.quality === "draft",
  );
  const plan: Record<
    GuidedState,
    { title: string; help: string; button: string }
  > = {
    files: {
      title: !panelsReady
        ? "Start by adding your comic panels"
        : "Next, add your voice recording",
      help: !panelsReady
        ? "Drop your comic images, PDF, or CBZ into the file area below. You can add a voice recording at the same time."
        : "Upload one narration recording. Automatic Verdict voice generation is planned, but isn't available in this build yet.",
      button: "Add missing files",
    },
    save: {
      title: "Your edits are still being saved",
      help: "Keep your changes safe before you start another automated cut. Autosave is already on.",
      button: "Save changes now",
    },
    working: {
      title: "Verdict is making your video",
      help: "Keep this window open. You can watch progress and review the finished preview below.",
      button: "View progress",
    },
    generate: {
      title: "Everything's ready. Let Verdict edit.",
      help: "Verdict will arrange the panels, add camera movement and captions, and render a preview. You approve the result before final export.",
      button: "Make my video preview",
    },
    review: {
      title: "Your preview is ready to watch",
      help: "Watch it once, check the crops and captions, and approve it below. You can change anything first.",
      button: "Watch and approve",
    },
    export: {
      title: "Approved. Make the final MP4.",
      help: "This creates a full-resolution vertical video. You stay in control of publishing.",
      button: "Render final 1080p video",
    },
    done: {
      title: "Your video is ready!",
      help: "Download the finished MP4. Nothing has been published automatically.",
      button: "Download finished video",
    },
  };
  const next = plan[status];
  const task =
    status === "files"
      ? onFiles
      : status === "save"
        ? onSave
        : status === "working" || status === "generate" || status === "review"
          ? onAutopilot
          : status === "export"
            ? onRender
            : undefined;
  const mainLabel = status === "done" ? "Finished" : "YOUR NEXT STEP";

  return (
    <section className="guided-studio surface" aria-label="Easy video creation">
      <div className="guided-studio-top">
        <div>
          <span className="eyebrow">
            <Sparkles size={14} /> EASY MODE
          </span>
          <h2>One step at a time.</h2>
          <p className="muted">
            Do the next thing shown here. Verdict handles the edit and you keep
            the final say.
          </p>
        </div>
        <button
          type="button"
          className="button secondary small-button"
          onClick={onAdvanced}
        >
          <PencilRuler size={16} /> Open full editor
        </button>
      </div>
      <div className="guided-progress" aria-label="Video production progress">
        <div className={panelsReady && audioReady ? "complete" : "active"}>
          {panelsReady && audioReady ? (
            <CheckCircle2 size={18} />
          ) : (
            <Circle size={18} />
          )}
          <span>1. Add panels + voice</span>
        </div>
        <div
          className={
            preview || project.script_approved || final
              ? "complete"
              : status === "working" || status === "generate"
                ? "active"
                : ""
          }
        >
          {preview || project.script_approved || final ? (
            <CheckCircle2 size={18} />
          ) : (
            <Circle size={18} />
          )}
          <span>2. Make a preview</span>
        </div>
        <div
          className={
            final
              ? "complete"
              : status === "review" || status === "export"
                ? "active"
                : ""
          }
        >
          {final ? <CheckCircle2 size={18} /> : <Circle size={18} />}
          <span>3. Review + export</span>
        </div>
      </div>
      <div className="guided-next">
        <div>
          <span className="eyebrow">{mainLabel}</span>
          <h3>{next.title}</h3>
          <p>{next.help}</p>
          {status === "files" && (
            <div className="guided-requirements">
              <span>{panelsReady ? "✓" : "○"} Comic panels</span>
              <span>{audioReady ? "✓" : "○"} Narration recording</span>
            </div>
          )}
        </div>
        {status === "done" && final?.download_url ? (
          <a className="button primary" href={final.download_url}>
            <Download size={17} /> {next.button}
          </a>
        ) : (
          <button
            type="button"
            className="button primary"
            onClick={task}
            disabled={status === "export" && !canRender}
          >
            {status === "files" ? <FolderOpen size={17} /> : <Film size={17} />}
            {next.button}
            <ArrowRight size={15} />
          </button>
        )}
      </div>
      {status === "export" && !canRender && (
        <p className="notice" role="status">
          Finish saving and confirm that the approved timeline has panels and
          narration before exporting.
          <button className="text-button" type="button" onClick={onReview}>
            Open review
          </button>
        </p>
      )}
      {status === "done" && !final?.download_url && (
        <p className="notice" role="status">
          The export record has no downloadable file. Check the Exports page.
        </p>
      )}
      <p className="guided-footnote">
        No auto-posting. AI writing, artwork understanding, and voice generation
        require separate configuration or future integrations.
      </p>
    </section>
  );
}
