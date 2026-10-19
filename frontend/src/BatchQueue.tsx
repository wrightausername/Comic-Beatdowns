import { useState } from "react";
import { api, json } from "./api";
import type { Project, RenderJob } from "./types";
import { errorMessage } from "./utils";

export default function BatchQueue({
  projects,
  jobs,
  onChanged,
}: {
  projects: Project[];
  jobs: RenderJob[];
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const ready = projects.filter(
    (p) =>
      p.script_approved &&
      p.narration_url &&
      p.scene_count > 0 &&
      !jobs.some(
        (j) =>
          j.project_id === p.id && ["queued", "running"].includes(j.status),
      ),
  );
  return (
    <details className="surface batch-queue">
      <summary>Export queue · render several approved videos</summary>
      <p className="help">
        Select up to 20 projects. Studio renders them one at a time; you can
        keep editing.
      </p>
      <button
        className="text-button"
        disabled={busy || !ready.length}
        onClick={() =>
          setSelected(new Set(ready.slice(0, 20).map((p) => p.id)))
        }
      >
        Select ready projects
      </button>
      {ready.map((p) => (
        <label key={p.id}>
          <input
            type="checkbox"
            aria-label={`Queue ${p.title}`}
            checked={selected.has(p.id)}
            onChange={(e) =>
              setSelected((old) => {
                const next = new Set(old);
                if (e.target.checked) next.add(p.id);
                else next.delete(p.id);
                return next;
              })
            }
          />
          {p.title}
        </label>
      ))}
      {!ready.length && (
        <p className="help">
          Approve a project with panels and narration to add it here.
        </p>
      )}
      <button
        className="button"
        disabled={busy || !selected.size || selected.size > 20}
        onClick={() => {
          setBusy(true);
          void api<{
            jobs: RenderJob[];
            errors: { project_id: string; message: string }[];
          }>(
            "/renders/batch",
            json({
              project_ids: [...selected].filter((id) =>
                ready.some((p) => p.id === id),
              ),
            }),
          )
            .then((result) => {
              setMessage(
                `${result.jobs.length} export(s) queued.${result.errors.map((e) => ` ${projects.find((p) => p.id === e.project_id)?.title}: ${e.message}`).join("")}`,
              );
              setSelected(new Set());
              onChanged();
            })
            .catch((e) => setMessage(errorMessage(e)))
            .finally(() => setBusy(false));
        }}
      >
        Queue selected exports
      </button>
      {message && <p role="status">{message}</p>}
      {jobs
        .filter((j) => ["queued", "running"].includes(j.status))
        .map((j) => (
          <p className="help" key={j.id}>
            {j.title} · {j.status} · {j.progress}%
          </p>
        ))}
    </details>
  );
}
