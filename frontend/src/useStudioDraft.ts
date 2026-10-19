import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, json } from "./api";
import type { CaptionCue, Project, Scene, VideoSettings } from "./types";
import { errorMessage } from "./utils";

export interface StudioDraft {
  title: string;
  idea: string;
  script: string;
  settings: VideoSettings;
  scenes: Scene[];
  cues: CaptionCue[];
}
export const fromProject = (p: Project): StudioDraft => ({
  title: p.title,
  idea: p.idea,
  script: p.script,
  settings: p.settings,
  scenes: p.scenes ?? [],
  cues: p.caption_cues ?? [],
});
export function draftPayload(draft: StudioDraft) {
  return {
    ...draft,
    scenes: draft.scenes.map(
      ({
        id,
        panel_id,
        duration,
        motion,
        motion_strength,
        easing,
        focus_x,
        focus_y,
        transition,
        transition_duration,
        caption,
      }) => ({
        id,
        panel_id,
        duration,
        motion,
        motion_strength,
        easing,
        focus_x,
        focus_y,
        transition,
        transition_duration,
        caption,
      }),
    ),
  };
}
const keyOf = (draft: StudioDraft) => JSON.stringify(draftPayload(draft));

export default function useStudioDraft(
  projectId: string,
  paused: boolean,
  onChanged: () => void,
  onError: (message: string) => void,
) {
  const [project, setProject] = useState<Project | null>(null);
  const [draft, setDraft] = useState<StudioDraft | null>(null);
  const [savedKey, setSavedKey] = useState("");
  const [status, setStatus] = useState("Loading…");
  const [recovery, setRecovery] = useState<StudioDraft | null>(null);
  const server = useRef<Project | null>(null);
  const current = useRef<StudioDraft | null>(null);
  const pending = useRef<Promise<Project | null> | null>(null);
  const baseline = useRef("");
  const blocked = useRef(false);
  const alive = useRef(true);
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  const storageKey = `comic-beatdowns:draft:${projectId}`;
  const accept = useCallback(
    (p: Project) => {
      server.current = p;
      const value = fromProject(p);
      current.current = value;
      baseline.current = keyOf(value);
      blocked.current = false;
      if (alive.current) {
        setProject(p);
        setDraft(value);
        setSavedKey(baseline.current);
        setStatus("All changes saved");
      }
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* Database autosave remains available. */
      }
    },
    [storageKey],
  );
  useEffect(() => {
    alive.current = true;
    api<Project>(`/projects/${projectId}`)
      .then((p) => {
        if (!alive.current) return;
        let local: { draft: StudioDraft; revision: number } | null = null;
        try {
          local = JSON.parse(localStorage.getItem(storageKey) || "null");
        } catch {
          /* Ignore malformed browser data. */
        }
        accept(p);
        if (
          local?.draft &&
          local.draft.title &&
          Array.isArray(local.draft.scenes) &&
          Array.isArray(local.draft.cues) &&
          keyOf(local.draft) !== keyOf(fromProject(p))
        ) {
          setRecovery(local.draft);
          try {
            localStorage.setItem(storageKey, JSON.stringify(local));
          } catch {
            /* Preserve database functionality. */
          }
        }
      })
      .catch((error) => onError(errorMessage(error)));
    return () => {
      alive.current = false;
    };
  }, [projectId, storageKey, accept, onError]);
  const update = useCallback(
    (change: Partial<StudioDraft> | ((value: StudioDraft) => StudioDraft)) => {
      if (!current.current) return;
      const next =
        typeof change === "function"
          ? change(current.current)
          : { ...current.current, ...change };
      current.current = next;
      setDraft(next);
      setStatus("Unsaved changes");
    },
    [],
  );
  const flush = useCallback(
    async function save(): Promise<Project | null> {
      if (pending.current) {
        await pending.current;
        return save();
      }
      if (
        !current.current ||
        !server.current ||
        keyOf(current.current) === baseline.current
      )
        return server.current;
      if (blocked.current)
        throw new Error(
          "Saving is paused after a conflict. Recover or reload your draft first.",
        );
      const captured = current.current,
        capturedKey = keyOf(captured),
        revision = server.current.revision;
      setStatus("Saving…");
      const operation = api<Project>(
        `/projects/${projectId}/workspace`,
        json({ ...draftPayload(captured), base_revision: revision }, "PUT"),
      );
      pending.current = operation;
      try {
        const p = await operation;
        if (!alive.current) return p;
        server.current = p;
        baseline.current = capturedKey;
        setProject(p);
        setSavedKey(capturedKey);
        if (current.current && keyOf(current.current) === capturedKey) {
          current.current = fromProject(p);
          setDraft(current.current);
          baseline.current = keyOf(current.current);
          setSavedKey(baseline.current);
          try {
            localStorage.removeItem(storageKey);
          } catch {
            /* Keep database saves working. */
          }
        }
        setStatus(
          current.current && keyOf(current.current) !== baseline.current
            ? "Unsaved changes"
            : "All changes saved",
        );
        changedRef.current();
        return p;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409)
          blocked.current = true;
        if (alive.current) setStatus(`Save failed: ${errorMessage(error)}`);
        throw error;
      } finally {
        pending.current = null;
      }
    },
    [projectId, storageKey],
  );
  const dirty = Boolean(draft && keyOf(draft) !== savedKey);
  useEffect(() => {
    if (!dirty || !draft) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ revision: server.current?.revision, draft }),
      );
    } catch {
      /* Autosave to the server remains the primary persistence mechanism. */
    }
    if (paused || blocked.current) return;
    const timer = setTimeout(() => void flush().catch(() => {}), 900);
    return () => clearTimeout(timer);
  }, [draft, dirty, paused, savedKey, flush, storageKey]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const history = async (direction: "undo" | "redo") => {
    let p: Project | null;
    try {
      p = await flush();
    } catch (error) {
      if (
        direction === "undo" &&
        error instanceof ApiError &&
        error.status === 422 &&
        server.current
      ) {
        accept(server.current);
        return;
      }
      throw error;
    }
    if (!p) return;
    accept(
      await api<Project>(
        `/projects/${projectId}/history/${direction}`,
        json({ base_revision: p.revision }),
      ),
    );
    changedRef.current();
  };
  const recover = () => {
    if (recovery) {
      update(recovery);
      setRecovery(null);
    }
  };
  return {
    project,
    draft,
    update,
    accept,
    flush,
    history,
    dirty,
    status,
    recovery,
    recover,
    dismissRecovery: () => {
      setRecovery(null);
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* Database state is unchanged. */
      }
    },
    reload: async () => {
      accept(await api<Project>(`/projects/${projectId}`));
      setRecovery(null);
    },
  };
}
