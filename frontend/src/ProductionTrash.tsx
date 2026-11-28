import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { api, json } from "./api";
import { Modal } from "./components";
import type { Project } from "./types";
import { errorMessage } from "./utils";

export function DeleteProduction({
  project,
  onClose,
  onDeleted,
}: {
  project: Project;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api(
        `/projects/${project.id}`,
        json({ base_revision: project.revision }, "DELETE"),
      );
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Delete production?"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        Move <strong>{project.title}</strong> to Trash?
      </p>
      <p className="muted">
        You can restore its files, shots and edit history from Trash. Shared
        library pages and sounds stay in your library. This keeps the files on
        your computer.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="button danger"
          disabled={busy}
          onClick={() => void remove()}
        >
          <Trash2 size={16} />
          {busy ? "Moving to Trash…" : "Move to Trash"}
        </button>
      </div>
    </Modal>
  );
}

export function ProductionTrash({
  projects,
  onClose,
  onRestored,
}: {
  projects: Project[];
  onClose: () => void;
  onRestored: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function restore(project: Project) {
    setBusy(project.id);
    setError("");
    try {
      await api(
        `/projects/${project.id}/restore`,
        json({ base_revision: project.revision }),
      );
      await onRestored();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal title="Production Trash" onClose={onClose}>
      <p className="muted">
        Deleted productions stay here until you restore them. Files and edit
        history are kept on your computer.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {projects.length === 0 ? (
        <p>Trash is empty.</p>
      ) : (
        <ul className="production-trash-list">
          {projects.map((project) => (
            <li key={project.id}>
              <div>
                <strong>{project.title}</strong>
                <small className="muted">
                  Deleted {new Date(project.deleted_at!).toLocaleString()}
                </small>
              </div>
              <button
                className="button secondary"
                disabled={busy !== null}
                onClick={() => void restore(project)}
                aria-label={`Restore ${project.title}`}
              >
                <RotateCcw size={16} />
                {busy === project.id ? "Restoring…" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
