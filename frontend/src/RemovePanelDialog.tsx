import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "./api";
import { Modal } from "./components";
import type { Panel } from "./types";
import { errorMessage } from "./utils";

export default function RemovePanelDialog({
  panel,
  onClose,
  onRemoved,
}: {
  panel: Panel;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function remove() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/panels/${panel.id}`, { method: "DELETE" });
      onRemoved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Remove panel from library?"
      eyebrow="PANEL LIBRARY"
      onClose={onClose}
      closeDisabled={busy}
    >
      <div className="remove-panel-summary">
        <img src={panel.thumbnail_url} alt={panel.title} />
        <div>
          <strong>{panel.title}</strong>
          <p className="help">
            This panel will leave the library and panel picker. Existing
            projects, saved versions, undo history, and crops keep working.
          </p>
        </div>
      </div>
      <p className="help">
        Artwork stays in Studio storage for those projects. You can restore this
        panel from <strong>Removed panels</strong> at any time.
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button
          className="button secondary"
          autoFocus
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="button secondary danger"
          disabled={busy}
          onClick={() => void remove()}
        >
          <Trash2 size={16} />
          {busy ? "Removing…" : "Remove from library"}
        </button>
      </div>
    </Modal>
  );
}
