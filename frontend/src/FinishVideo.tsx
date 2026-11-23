import { useState } from "react";
import { api, json } from "./api";
import type { Project, RenderJob } from "./types";
import { errorMessage, timecode } from "./utils";

type Check = {
  revision: number;
  critical: number;
  scanned_render_id: string | null;
  limits: string;
  findings: {
    code: string;
    message: string;
    severity: string;
    seconds: number | null;
    dismissed_reason?: string;
  }[];
};

export default function FinishVideo({
  project,
  dirty,
  busy,
  perform,
  onQueued,
  onReviewCopy,
  onSeek,
}: {
  project: Project;
  dirty: boolean;
  busy: boolean;
  perform: (action: () => Promise<void>, saveFirst?: boolean) => Promise<void>;
  onQueued: (project: Project, job: RenderJob) => void;
  onReviewCopy: () => void;
  onSeek: (seconds: number) => void;
}) {
  const [check, setCheck] = useState<Check | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const stale = Boolean(
    check && (dirty || check.revision !== project.revision),
  );
  async function run(action: () => Promise<void>, saveFirst: boolean) {
    if (working || busy) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await perform(async () => {
        try {
          await action();
        } catch (e) {
          setError(errorMessage(e));
        }
      }, saveFirst);
    } finally {
      setWorking(false);
    }
  }
  return (
    <section className="surface finish-video" aria-label="Finish video">
      <h3>Ready to export?</h3>
      <p>
        Check this saved edit, review any warnings, then approve one 1080 × 1920
        master.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <div className="workflow-actions">
        <button
          className="button secondary"
          disabled={busy || working}
          onClick={() =>
            void run(async () => {
              setReviewed(false);
              setCheck(null);
              setCheck(
                await api<Check>(`/projects/${project.id}/finish-check`),
              );
            }, true)
          }
        >
          {working ? "Checking…" : "Check and export"}
        </button>
        <button
          className="text-button"
          disabled={
            busy || working || !project.scenes?.length || !project.narration_url
          }
          onClick={onReviewCopy}
        >
          Render full review copy
        </button>
      </div>
      {check && (
        <div aria-label="Export checks">
          <p className={check.critical ? "inline-error" : "help"}>
            {check.critical
              ? `${check.critical} blocking item${check.critical === 1 ? "" : "s"} need fixing.`
              : "No blocking source problems found."}{" "}
            {check.scanned_render_id
              ? "The current full-video render was scanned."
              : "Rendered-video scan is not complete."}
          </p>
          {stale && (
            <p className="inline-error">
              Your video changed. Check this revision again before export.
            </p>
          )}
          <ul>
            {check.findings.map((f, i) => (
              <li key={`${f.code}-${i}`}>
                <strong>
                  {f.severity === "critical" ? "Fix · " : "Review · "}
                </strong>
                {f.message}
                {f.dismissed_reason && (
                  <span> · Previously accepted: {f.dismissed_reason}</span>
                )}
                {f.seconds !== null && (
                  <button
                    className="text-button"
                    onClick={() => onSeek(f.seconds!)}
                  >
                    Jump to {timecode(f.seconds)}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="help">{check.limits}</p>
          <label className="check-label">
            <input
              type="checkbox"
              aria-label="I reviewed this video and accept the warnings"
              checked={reviewed && !stale}
              disabled={stale || Boolean(check.critical) || working || busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            I reviewed this video, its script or imported narration, and accept
            the listed warnings.
          </label>
          <button
            className="button"
            disabled={
              !reviewed || stale || Boolean(check.critical) || busy || working
            }
            onClick={() =>
              void run(async () => {
                const result = await api<{ project: Project; job: RenderJob }>(
                  `/projects/${project.id}/finish-export`,
                  json({ base_revision: check.revision, reviewed: true }),
                );
                onQueued(result.project, result.job);
                setCheck(null);
                setReviewed(false);
                setMessage(
                  "Approved and queued for 1080 × 1920 export. Keep Studio running; your MP4 will appear in render history.",
                );
              }, false)
            }
          >
            Approve and export · 1080p
          </button>
        </div>
      )}
    </section>
  );
}
