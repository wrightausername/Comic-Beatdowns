import {
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
  | "preferences"
  | "advanced";

export default function WorkspaceTools({
  hasShots,
  activeTool,
  onOpen,
}: {
  hasShots: boolean;
  activeTool: WorkspaceTool;
  onOpen: (tool: WorkspaceTool) => void;
}) {
  const steps = [
    {
      id: "files",
      title: "Add files",
      label: "Open Add files",
      icon: FolderOpen,
    },
    {
      id: "draft",
      title: "Make a draft",
      label: "Open Make a draft",
      icon: Sparkles,
    },
    {
      id: "camera",
      title: "Edit shots",
      label: "Camera & crops",
      icon: ScanEye,
    },
    {
      id: "finish",
      title: "Review & export",
      label: "Open Review & export",
      icon: CheckCircle2,
    },
  ] as const;
  const tools = [
    {
      id: "style",
      title: "Reference style",
      label: "Open Reference style",
      icon: Wand2,
    },
    {
      id: "instructions",
      title: "AI editing assistant",
      label: "Open AI editing assistant",
      icon: MessageSquare,
    },
    {
      id: "timeline",
      title: "Video timeline",
      label: "Open Video timeline",
      icon: Film,
    },
    {
      id: "review",
      title: "Review queue",
      label: "Review queue",
      icon: CheckCircle2,
    },
    {
      id: "preferences",
      title: "Saved defaults",
      label: "Saved defaults",
      icon: Bookmark,
    },
  ] as const;
  return (
    <section
      id="studio-tools"
      className="workspace-tools surface workspace-tools-focused"
      aria-label="Workspace tools"
      tabIndex={-1}
    >
      <nav className="workspace-flow" aria-label="Your video workflow">
        {steps.map(({ id, title, label, icon: Icon }, index) => (
          <button
            key={id}
            type="button"
            className={activeTool === id ? "active" : ""}
            aria-label={label}
            aria-current={activeTool === id ? "step" : undefined}
            disabled={(id === "finish" || id === "camera") && !hasShots}
            title={
              (id === "finish" || id === "camera") && !hasShots
                ? "Add or generate shots first"
                : undefined
            }
            onClick={() => onOpen(id)}
          >
            <span className="workspace-step-number">{index + 1}</span>
            <Icon size={17} aria-hidden="true" />
            <strong>{title}</strong>
          </button>
        ))}
      </nav>
      <nav className="workspace-tool-shortcuts" aria-label="Editing tools">
        <span>Editing tools</span>
        {tools.map(({ id, title, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={activeTool === id}
            onClick={() => onOpen(id)}
          >
            <Icon size={16} aria-hidden="true" />
            {title}
          </button>
        ))}
      </nav>
      {!hasShots && (
        <p className="workspace-unlock-help">
          Add or generate shots to unlock editing and export. You can prepare a
          reference style now.
        </p>
      )}
    </section>
  );
}
