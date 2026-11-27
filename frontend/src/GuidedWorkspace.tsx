import {
  ArrowRight,
  Download,
  Film,
  FolderOpen,
  PencilRuler,
  Sparkles,
} from "lucide-react";
import type { Project, RenderJob, Scene } from "./types";

export type GuidedState =
  | "files"
  | "save"
  | "working"
  | "generate"
  | "refresh"
  | "review"
  | "export"
  | "done";

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
      job.project_revision === project.revision &&
      !job.proposal_id &&
      !job.section,
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
  if (
    scenes.length &&
    jobs.some(
      (job) =>
        job.project_id === project.id &&
        job.status === "completed" &&
        !job.proposal_id,
    )
  )
    return "refresh";
  return "generate";
}

type Props = {
  project: Project;
  scenes: Scene[];
  jobs: RenderJob[];
  dirty: boolean;
  busy: boolean;
  canRender: boolean;
  onFiles: () => void;
  onAutopilot: () => void;
  onGenerate: () => void;
  onSave: () => void;
  onReview: () => void;
  onRender: () => void;
  onAdvanced: () => void;
  onEdit?: () => void;
  onPreview?: () => void;
  inProgress?: boolean;
};

export default function GuidedWorkspace({
  project,
  scenes,
  jobs,
  dirty,
  busy,
  canRender,
  onFiles,
  onAutopilot,
  onGenerate,
  onSave,
  onReview,
  onRender,
  onAdvanced,
  onEdit,
  onPreview,
  inProgress = false,
}: Props) {
  const status = inProgress
    ? "working"
    : guidedState(project, scenes, jobs, dirty);
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
      job.quality === "final" &&
      !job.section &&
      !job.proposal_id,
  );
  const preview = jobs.find(
    (job) =>
      job.project_id === project.id &&
      job.project_revision === project.revision &&
      job.status === "completed" &&
      job.quality === "draft" &&
      !job.proposal_id &&
      !job.section,
  );
  const plan: Record<
    GuidedState,
    { title: string; help: string; button: string }
  > = {
    files: {
      title: !panelsReady
        ? "Start by adding your comic panels"
        : "Add ElevenLabs narration (MP3/WAV)",
      help: !panelsReady
        ? "Drop your comic images, PDF, or CBZ into the file area below. You can add a voice recording at the same time."
        : "Generate Verdict’s voice in ElevenLabs, then upload the MP3 or WAV here. Your recording sets the timing for the edit.",
      button:
        panelsReady && !audioReady ? "Add narration" : "Add missing files",
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
    refresh: {
      title: "Ready to preview your changes",
      help: "Render the current edit with your crop, timing and order changes.",
      button: "Preview my changes",
    },
    review: {
      title: "Your preview is ready to watch",
      help: "Watch it once, check the crops and captions, and approve it below. You can change anything first.",
      button: "Watch and approve",
    },
    export: {
      title: "Approved. Make the final MP4.",
      help: "This creates a full-resolution vertical video. You stay in control of publishing.",
      button: "Check and export",
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
        : status === "refresh"
          ? onPreview
          : status === "generate"
            ? onGenerate
            : status === "review"
              ? onReview
              : status === "working"
                ? onAutopilot
                : status === "export"
                  ? onRender
                  : undefined;
  const mainLabel = status === "done" ? "Finished" : "YOUR NEXT STEP";

  return (
    <section
      className="guided-studio surface guided-studio-focused"
      aria-label="Easy video creation"
    >
      <div className="guided-studio-top">
        <div>
          <span className="eyebrow">
            <Sparkles size={14} /> YOUR NEXT STEP
          </span>
        </div>
        <div className="guided-header-actions">
          {scenes.length > 0 && onEdit && (
            <button
              type="button"
              className="button secondary guided-edit-draft"
              disabled={busy}
              onClick={onEdit}
            >
              <PencilRuler size={16} />
              Edit this draft
            </button>
          )}
          <button
            type="button"
            className="button secondary small-button"
            onClick={onAdvanced}
          >
            <PencilRuler size={16} /> Open full editor
          </button>
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
            disabled={busy || (status === "export" && !canRender)}
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
      {(preview?.video_url || final?.video_url) && (
        <details className="guided-render">
          <summary>Watch rendered video</summary>
          <video
            src={final?.video_url ?? preview?.video_url ?? undefined}
            controls
            preload="metadata"
            aria-label="Current rendered video"
          />
        </details>
      )}
    </section>
  );
}
