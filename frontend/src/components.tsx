import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { AudioLines, Box, CircleCheck, X, Zap } from "lucide-react";
import type { Status } from "./types";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Zap size={24} fill="currentColor" />
      </span>
      {!compact && (
        <span>
          COMIC BEATDOWNS<small>PRODUCTION STUDIO</small>
        </span>
      )}
    </div>
  );
}

export function Verdict({ small = false }: { small?: boolean }) {
  return (
    <div
      className={`verdict ${small ? "small" : ""}`}
      aria-label="Verdict holographic avatar"
      role="img"
    >
      <div className="orb-grid" />
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <defs>
          <linearGradient id={small ? "face-small" : "face"} x2="0" y2="1">
            <stop stopColor="#9bffff" />
            <stop offset="1" stopColor="#159db4" />
          </linearGradient>
        </defs>
        <path
          d="m90 25 40 24 12 51-20 40-32 17-32-17-20-40 12-51z"
          fill="#06303c"
          stroke="#53e0ec"
          strokeWidth="1.4"
        />
        <path
          d="m90 25-8 45-32-21 17 48-29 3 40 22 12 35 12-35 40-22-29-3 17-48-32 21z"
          fill={`url(#${small ? "face-small" : "face"})`}
          opacity=".21"
        />
        <path d="m54 79 28 8-4 13-23-7m71-14-28 8 4 13 23-7" fill="#97ffff" />
        <path
          d="m71 122 19 6 19-6M90 71v39l-8 5m8-90v28M50 49l17 21m63-21-17 21"
          fill="none"
          stroke="#70edfa"
          strokeWidth="2"
        />
      </svg>
      <span className="orb-ring" />
    </div>
  );
}

const statuses: Record<Status, string> = {
  idea: "Idea",
  scripting: "In production",
  ready: "Approved",
  rendering: "Rendering",
  exported: "Exported",
};
export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`status ${status}`}>
      <i />
      {statuses[status]}
    </span>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Box size={30} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Checklist({ checks }: { checks: [string, boolean][] }) {
  return (
    <ul className="checklist">
      {checks.map(([label, done]) => (
        <li key={label} className={done ? "done" : ""}>
          <CircleCheck size={16} />
          {label}
        </li>
      ))}
    </ul>
  );
}

export function AudioFile({ url, label }: { url: string; label: string }) {
  return (
    <div className="audio-file">
      <AudioLines size={18} />
      <span>{label}</span>
      <audio controls preload="metadata" src={url} aria-label={label} />
    </div>
  );
}
