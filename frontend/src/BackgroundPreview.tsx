import { useEffect, useRef, useState } from "react";
import { api, ApiError, json } from "./api";
import type { Project, RenderJob } from "./types";
import { errorMessage } from "./utils";

export default function BackgroundPreview({
  project,
  dirty,
  busy,
  onChanged,
}: {
  project: Project;
  dirty: boolean;
  busy: boolean;
  onChanged: () => void;
}) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return (
        localStorage.getItem(`studio:background-preview:${project.id}`) !==
        "off"
      );
    } catch {
      return true;
    }
  });
  const [message, setMessage] = useState("");
  const previous = useRef(project.revision);
  const pending = useRef<number | null>(null);
  const callback = useRef(onChanged);
  callback.current = onChanged;
  useEffect(() => {
    if (previous.current !== project.revision) {
      pending.current = project.revision;
      previous.current = project.revision;
    }
    if (
      !enabled ||
      dirty ||
      busy ||
      !project.autopilot?.enabled ||
      !project.scene_count ||
      !project.narration_url
    )
      return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      if (!alive || pending.current === null) return;
      try {
        const jobs = await api<RenderJob[]>(
          `/renders?project_id=${project.id}`,
        );
        if (!alive) return;
        const current = jobs.find(
          (j) =>
            j.project_revision === pending.current &&
            !j.section &&
            !j.proposal_id,
        );
        if (current?.status === "completed") {
          pending.current = null;
          setMessage(
            current.work_report
              ? `Background preview ready. ${current.work_report.reused_shots} shots reused; ${current.work_report.rendered_shots} rendered.`
              : "Background preview ready.",
          );
          callback.current();
          return;
        }
        if (current?.status === "failed") {
          pending.current = null;
          setMessage(
            "Background preview stopped. Check Exports for the issue and retry when ready.",
          );
          return;
        }
        if (jobs.some((j) => ["queued", "running"].includes(j.status))) {
          setMessage("Preparing your preview in the background…");
        } else {
          await api(
            `/projects/${project.id}/background-preview`,
            json({ base_revision: pending.current }),
          );
          setMessage(
            "Rendering your saved edits. Keep Studio open; interrupted renders resume on restart.",
          );
        }
        if (alive) timer = setTimeout(check, 2500);
      } catch (error) {
        if (alive) {
          setMessage(errorMessage(error));
          if (error instanceof ApiError && error.status === 409)
            timer = setTimeout(check, 5000);
          else pending.current = null;
        }
      }
    }
    timer = setTimeout(check, 4000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    project.id,
    project.revision,
    project.autopilot?.enabled,
    project.scene_count,
    project.narration_url,
    dirty,
    busy,
    enabled,
  ]);
  if (!project.autopilot?.enabled || !project.scene_count) return null;
  return (
    <div className="background-preview">
      <label className="check-label">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            try {
              localStorage.setItem(
                `studio:background-preview:${project.id}`,
                e.target.checked ? "on" : "off",
              );
            } catch {
              /* Session setting still works. */
            }
          }}
        />
        Automatically preview my saved edits
      </label>
      <small role="status">
        {enabled
          ? message ||
            "Edits stay reversible. Preview rendering reuses unchanged shots."
          : "Background previews paused. You can still render manually."}
      </small>
    </div>
  );
}
