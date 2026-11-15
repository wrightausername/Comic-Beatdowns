import { useState } from "react";
import { BookOpenCheck, ThumbsDown, ThumbsUp } from "lucide-react";
import { api, json } from "./api";
import type { Project } from "./types";
import { errorMessage } from "./utils";

type Topic =
  | "humor"
  | "voice"
  | "story"
  | "pacing"
  | "panel"
  | "crop"
  | "captions"
  | "audio"
  | "other";
type Decision = "keep" | "change" | "one_off";

interface Props {
  projectId: string;
  sceneId: string | null | undefined;
  index: number;
  onSave: () => Promise<Project | null>;
}

export default function SceneFeedback({ projectId, sceneId, index, onSave }: Props) {
  const [topic, setTopic] = useState<Topic>("panel");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function record(decision: Decision) {
    if (!sceneId || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      // Save the exact scene first, so feedback is attached to a stable revision.
      // Edits remain protected by the existing optimistic revision lock.
      const saved = await onSave();
      if (!saved || !saved.scenes?.some((scene) => scene.id === sceneId))
        throw new Error("Save this scene before teaching Verdict about it.");
      await api(
        "/creative-dna/feedback",
        json({
          project_id: projectId,
          base_revision: saved.revision,
          scene_id: sceneId,
          category: topic,
          decision,
          note: note.trim(),
        }),
      );
      setNote("");
      setMessage(
        decision === "keep"
          ? "Saved as a positive example, not a global rule."
          : decision === "change"
            ? "Correction recorded. Approve a reusable rule in Creative DNA when you want it applied to future episodes."
            : "Recorded as an episode-specific exception.",
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="scene-feedback">
      <summary><BookOpenCheck size={15} /> Teach Verdict from this scene</summary>
      <p className="muted">
        Keep praise and corrections tied to scene {index + 1}. Nothing becomes a permanent
        style rule until you approve it in Creative DNA.
      </p>
      <div className="scene-feedback-controls">
        <label>
          About
          <select
            aria-label={`Scene ${index + 1} feedback topic`}
            value={topic}
            disabled={busy}
            onChange={(e) => setTopic(e.target.value as Topic)}
          >
            <option value="panel">Panel choice</option>
            <option value="humor">Humor and nicknames</option>
            <option value="voice">Verdict delivery</option>
            <option value="story">Story structure</option>
            <option value="pacing">Pacing and timing</option>
            <option value="crop">Crop and framing</option>
            <option value="captions">Captions</option>
            <option value="audio">Sound and music</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          What should Verdict remember?
          <input
            aria-label={`Scene ${index + 1} feedback note`}
            maxLength={1000}
            placeholder="That punch-in was perfect; keep the reaction readable…"
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="toolbar">
        <button className="button secondary small-button" disabled={busy || !sceneId} onClick={() => void record("keep")}>
          <ThumbsUp size={14} /> Keep
        </button>
        <button className="button secondary small-button" disabled={busy || !sceneId || !note.trim()} onClick={() => void record("change")}>
          <ThumbsDown size={14} /> Fix next time
        </button>
        <button className="button secondary small-button" disabled={busy || !sceneId} onClick={() => void record("one_off")}>
          One-off exception
        </button>
      </div>
      {message && <p className="muted" role="status">{message}</p>}
      {error && <p className="notice" role="alert">{error}</p>}
    </details>
  );
}
