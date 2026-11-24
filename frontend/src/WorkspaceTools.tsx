import {
  ArrowUpRight,
  Bookmark,
  CheckCircle2,
  Film,
  FolderOpen,
  MessageSquare,
  ScanEye,
  Sparkles,
  Wand2,
} from "lucide-react";

export type WorkspaceTool =
  | "files"
  | "draft"
  | "style"
  | "instructions"
  | "timeline"
  | "finish"
  | "camera"
  | "review"
  | "preferences";

export default function WorkspaceTools({
  hasShots,
  onOpen,
}: {
  hasShots: boolean;
  onOpen: (tool: WorkspaceTool) => void;
}) {
  const tools = [
    {
      id: "files",
      title: "Add files",
      description: "Comic pages, voice, script and captions.",
      icon: FolderOpen,
      group: "Start here",
    },
    {
      id: "draft",
      title: "Make a draft",
      description: "Let Verdict build your first edit.",
      icon: Sparkles,
      group: "Build",
    },
    {
      id: "style",
      title: "Reference style",
      description: "Use a video's pacing and effects.",
      icon: Wand2,
      group: "Style",
    },
    {
      id: "instructions",
      title: "AI editing assistant",
      description: "Describe a fix or paste a ChatGPT plan.",
      icon: MessageSquare,
      group: "Refine",
    },
    {
      id: "timeline",
      title: "Video timeline",
      description: "Trim shots, adjust timing and mix audio.",
      icon: Film,
      group: "Edit",
    },
    {
      id: "finish",
      title: "Review & export",
      description: hasShots
        ? "Check your edit and make the final MP4."
        : "Add or generate shots to unlock export.",
      icon: CheckCircle2,
      group: "Finish",
    },
  ] as const;
  return (
    <section
      id="studio-tools"
      className="workspace-tools surface"
      aria-label="Workspace tools"
      tabIndex={-1}
    >
      <div className="workspace-tools-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h2>What would you like to work on?</h2>
          <p>Jump straight to a tool. Every edit stays reviewable.</p>
        </div>
        <span className="workspace-tools-hint">Start → Shape → Finish</span>
      </div>
      <nav className="workspace-tool-grid" aria-label="Choose a video tool">
        {tools.map(({ id, title, description, icon: Icon, group }) => (
          <button
            key={id}
            type="button"
            className={`workspace-tool tool-${id}`}
            disabled={id === "finish" && !hasShots}
            onClick={() => onOpen(id)}
            aria-label={`Open ${title}`}
          >
            <span className="workspace-tool-top">
              <span className="workspace-tool-icon">
                <Icon size={20} aria-hidden="true" />
              </span>
              <span className="workspace-tool-group">{group}</span>
              <ArrowUpRight
                size={15}
                className="workspace-tool-arrow"
                aria-hidden="true"
              />
            </span>
            <strong>{title}</strong>
            <span className="workspace-tool-description">{description}</span>
          </button>
        ))}
      </nav>
      <nav className="workspace-tool-shortcuts" aria-label="More video tools">
        <span>Also in your workspace</span>
        <button
          type="button"
          disabled={!hasShots}
          title={!hasShots ? "Add or generate shots first" : undefined}
          onClick={() => onOpen("camera")}
        >
          <ScanEye size={15} aria-hidden="true" />
          Camera & crops
        </button>
        <button type="button" onClick={() => onOpen("review")}>
          <CheckCircle2 size={15} aria-hidden="true" />
          Review queue
        </button>
        <button type="button" onClick={() => onOpen("preferences")}>
          <Bookmark size={15} aria-hidden="true" />
          Saved defaults
        </button>
      </nav>
    </section>
  );
}
