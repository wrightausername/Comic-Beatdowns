import { useEffect, useState } from "react";
import { api, json } from "./api";
import ReferenceStyle from "./ReferenceStyle";
import type { Project, RenderJob, VideoSettings } from "./types";
import { errorMessage, timelineSeconds, timecode } from "./utils";

export type Proposal = {
  id: string;
  base_revision: number;
  status: string;
  changes: { shot?: number; field: string; before: unknown; after: unknown }[];
  plan: { script?: string | null; kind?: string };
  report?: {
    summary: string[];
    warnings: string[];
    counts: Record<string, number>;
    alignment_sources: string[];
    unsupported_effects: string[];
    trace?: {
      shot: number;
      source_shot: number;
      reference_beat: number;
      reference_time: number | null;
      purpose: string;
      evidence: string;
      reason: string;
    }[];
  } | null;
};
type Finding = {
  id: string;
  code: string;
  message: string;
  severity: string;
  seconds: number | null;
  scene_index: number | null;
  dismissed_reason?: string;
};
type Queue = { revision: number; findings: Finding[]; limits: string };
type Preferences = {
  template_id: string | null;
  observe_edits: boolean;
  approved_defaults: Partial<VideoSettings>;
};
type Rule = {
  id: string;
  instruction: string;
  source: string;
  status: string;
  updated_at: string;
};

function fieldLabel(field: string) {
  const labels: Record<string, string> = {
    path_move_fraction: "Camera travel time",
    path_zoom: "Camera zoom",
    camera_path: "Camera route",
    source_crop: "Artwork crop",
    duration: "Shot duration",
    motion_strength: "Movement amount",
    motion: "Camera movement",
    framing: "Artwork framing",
    easing: "Camera easing",
    transition: "Cut transition",
    transition_duration: "Transition duration",
    focus_x: "Horizontal focus",
    focus_y: "Vertical focus",
    caption: "Shot caption",
    script: "Written script",
    voice_volume: "Narration volume",
    sfx_volume: "Sound-effect volume",
    music_volume: "Music volume",
    edit_pace: "Editing pace",
    captions: "Show captions",
    caption_font_size: "Caption text size",
    caption_style: "Caption style",
    caption_position: "Caption position",
    caption_color: "Caption color",
    caption_accent: "Caption accent color",
    duck_audio: "Lower music during speech",
    normalize_voice: "Normalize narration",
    default_duration: "Default shot duration",
    default_motion: "Default camera movement",
    default_motion_strength: "Default movement amount",
    default_easing: "Default camera easing",
  };
  const cue = /^caption\.(\d+)\.(text|start|end)$/.exec(field);
  if (cue)
    return `Subtitle ${cue[1]} · ${cue[2] === "text" ? "Words" : cue[2] === "start" ? "Start time" : "End time"}`;
  const key = field.replace(/^settings\./, "");
  return labels[key] ?? key.replaceAll("_", " ");
}

function friendlyValue(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value)) return `${value.length} route points`;
  if (typeof value === "number")
    return Number.isInteger(value)
      ? String(value)
      : String(Number(value.toFixed(3)));
  if (
    typeof value === "object" &&
    "source_shot" in value &&
    "duration" in value
  ) {
    const shot = value as {
      source_shot: number;
      duration: number;
      motion?: string;
      transition?: string;
    };
    return `From shot ${shot.source_shot} · ${Number(shot.duration.toFixed(3))}s · ${friendlyValue(shot.motion)} · ${friendlyValue(shot.transition)}`;
  }
  if (typeof value === "string") {
    const names: Record<string, string> = {
      zoom_in: "Zoom in",
      zoom_out: "Zoom out",
      pan_left: "Pan left",
      pan_right: "Pan right",
      pan_up: "Pan up",
      pan_down: "Pan down",
      panel_glide: "Panel glide",
      impact_shake: "Impact shake",
    };
    return names[value] ?? value;
  }
  return JSON.stringify(value);
}

function preferenceLabel(instruction: string) {
  const prefix = "Preferred defaults: ";
  if (!instruction.startsWith(prefix)) return instruction;
  try {
    const values = JSON.parse(instruction.slice(prefix.length)) as Record<
      string,
      unknown
    >;
    return Object.entries(values)
      .map(([key, value]) => `${fieldLabel(key)}: ${friendlyValue(value)}`)
      .join(" · ");
  } catch {
    return instruction;
  }
}

export default function CreatorAssistant({
  project,
  dirty,
  busy,
  perform,
  accept,
  onChanged,
  onPreview,
  onSeek,
  onRenderShot,
}: {
  project: Project;
  dirty: boolean;
  busy: boolean;
  perform: (action: () => Promise<void>, saveFirst?: boolean) => Promise<void>;
  accept: (project: Project) => void;
  onChanged: () => void;
  onPreview: (project: Project | null) => void;
  onSeek: (seconds: number) => void;
  onRenderShot: (start: number, end: number) => void;
}) {
  const scenes = project.scenes ?? [];
  const [target, setTarget] = useState(scenes[0]?.id ?? "");
  const [text, setText] = useState("");
  const [useAI, setUseAI] = useState(false),
    [aiReady, setAIReady] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalRender, setProposalRender] = useState<RenderJob | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [brief, setBrief] = useState("");
  const [working, setWorking] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [recipeName, setRecipeName] = useState("My usual episode");
  const ready = !working && !busy;
  const selected = scenes.find((s) => s.id === target);
  const start = timelineSeconds(
    scenes.slice(
      0,
      scenes.findIndex((s) => s.id === target),
    ),
    project.settings.fps,
  );
  const stale = Boolean(
    proposal && (proposal.base_revision !== project.revision || dirty),
  );
  useEffect(() => {
    setProposalRender(null);
  }, [proposal?.id]);
  useEffect(() => {
    if (
      !proposalRender ||
      !["queued", "running"].includes(proposalRender.status)
    )
      return;
    let active = true;
    const timer = setInterval(() => {
      void api<RenderJob>(`/renders/${proposalRender.id}`)
        .then((job) => {
          if (active) setProposalRender(job);
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [proposalRender?.id, proposalRender?.status]);
  useEffect(() => {
    if (!scenes.some((s) => s.id === target)) setTarget(scenes[0]?.id ?? "");
  }, [project.id, project.revision]);
  useEffect(() => {
    let alive = true;
    setError("");
    Promise.all([
      api<{ ai_configured: boolean }>(
        `/projects/${project.id}/assistant/context`,
      ),
      api<Queue>(`/projects/${project.id}/review-queue`),
      api<Preferences>("/creator-preferences"),
      api<{ rules: Rule[] }>("/creative-dna?limit=100"),
    ])
      .then(([context, review, preferences, dna]) => {
        if (alive) {
          setAIReady(context.ai_configured);
          setQueue(review);
          setPrefs(preferences);
          setRules(dna.rules.filter((r) => r.source === "correction_pattern"));
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [project.id, project.revision]);
  async function run(action: () => Promise<void>, saveFirst = true) {
    if (!ready) return;
    setWorking(true);
    setError("");
    setNotice("");
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
  async function current() {
    return api<Project>(`/projects/${project.id}`);
  }
  async function refresh() {
    setQueue(await api<Queue>(`/projects/${project.id}/review-queue`));
  }
  async function propose() {
    const saved = await current();
    setProposal(
      await api<Proposal>(
        `/projects/${project.id}/assistant/proposals`,
        json({
          base_revision: saved.revision,
          text,
          scene_id: target || null,
          use_ai: useAI,
        }),
      ),
    );
    onPreview(null);
  }
  async function copyBrief() {
    const result = await api<{ context: unknown }>(
      `/projects/${project.id}/assistant/context`,
    );
    const value =
      "Help me fix this Comic Beatdowns video. Ask what I want changed if unclear. Return a single JSON edit plan following this brief, with these exact project/scene IDs and revision. I will paste your plan into the app and review before applying it.\n\n" +
      (text.trim()
        ? `My request or observed problem: ${text.trim()}\n\n`
        : "") +
      (target ? `Selected shot ID: ${target}\n\n` : "") +
      JSON.stringify(result.context, null, 2);
    setBrief(value);
    try {
      await navigator.clipboard.writeText(value);
      setNotice(
        "Editing brief copied. Paste it into ChatGPT and describe the problem; paste the returned JSON plan into the instruction box.",
      );
    } catch {
      setNotice(
        "Select and copy the editing brief below, then paste it into ChatGPT.",
      );
    }
  }
  function hint(finding: Finding) {
    setAskOpen(true);
    if (finding.scene_index !== null)
      setTarget(scenes[finding.scene_index]?.id ?? "");
    setText(
      finding.code === "low_resolution"
        ? "Show the whole panel"
        : `${finding.scene_index === null ? "" : `Shot ${finding.scene_index + 1}: `}${finding.message} Suggest a conservative fix I can preview.`,
    );
    if (finding.code !== "low_resolution")
      setNotice(
        "Copy the editing brief for ChatGPT to get a plan for this problem, or use your connected writing AI.",
      );
    requestAnimationFrame(() =>
      document.getElementById("editing-instruction-box")?.focus(),
    );
  }
  const active = queue?.findings.filter((f) => !f.dismissed_reason) ?? [];
  const display =
    queue?.findings.filter((f) => showSkipped || !f.dismissed_reason) ?? [];
  const describe = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value);
  return (
    <section
      className="creator-assistant surface"
      aria-label="Creator editing assistant"
    >
      <div className="section-heading">
        <div>
          <h3>Fix just what needs fixing</h3>
          <p>
            Tell Verdict what to change, or paste a plan written by ChatGPT.
            Preview first, apply when it looks right, and Undo any applied edit.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <details
        className="assistant-request"
        open={askOpen}
        onToggle={(e) => setAskOpen(e.currentTarget.open)}
      >
        <summary>
          Fix just this · paste an instruction or a ChatGPT editing plan
        </summary>
        <label>
          Shot to fix
          <select
            aria-label="Assistant target shot"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={!ready}
          >
            {!scenes.length && (
              <option value="">Add or generate shots first</option>
            )}
            {scenes.map((s, i) => (
              <option key={s.id} value={s.id}>
                {i + 1}. {s.panel.title}
                {s.locked ? " · Locked" : ""}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="editing-instruction-box">
          Paste an editing instruction
        </label>
        <textarea
          id="editing-instruction-box"
          aria-label="Paste an editing instruction"
          rows={4}
          maxLength={30000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            "Example: “Show the whole panel” or “Shot 3: hold for 2 seconds”. You can also paste the JSON editing plan ChatGPT writes for you."
          }
        />
        <div className="workflow-actions">
          {[
            "Show the whole panel",
            "Hold the shot",
            "Make the camera slower",
            "Use crossfade",
          ].map((value) => (
            <button
              key={value}
              className="text-button"
              onClick={() => setText(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={useAI}
            disabled={!aiReady || !ready}
            onChange={(e) => setUseAI(e.target.checked)}
          />{" "}
          Use my connected writing AI to interpret this request
        </label>
        <p className="help">
          Duration changes roll a neighboring unlocked cut to keep the recording
          aligned. Local commands and pasted edit plans need no API key.
          Connected AI sends this instruction, your script, shot settings and
          panel labels to your writing provider; provider charges may apply.
          Artwork files and credentials are excluded.{" "}
          {aiReady
            ? ""
            : "No writing provider is configured; the local options work without one."}
        </p>
        <div className="workflow-actions">
          <button
            className="button"
            disabled={!ready || !text.trim()}
            onClick={() => void run(propose)}
          >
            Preview proposed changes
          </button>
          <button
            className="button secondary"
            disabled={!ready}
            onClick={() => void run(copyBrief)}
          >
            Copy editing brief for ChatGPT
          </button>
          <button
            className="text-button"
            disabled={!ready || !selected}
            onClick={() =>
              onRenderShot(start, start + (selected?.duration ?? 0))
            }
          >
            Render just this shot
          </button>
        </div>
        {brief && (
          <details className="assistant-brief">
            <summary>Editing brief · copy this into ChatGPT</summary>
            <textarea
              aria-label="Editing brief for ChatGPT"
              rows={7}
              readOnly
              value={brief}
              onFocus={(e) => e.target.select()}
            />
            <p>
              After changing your video, copy a fresh brief. Older plans are
              rejected so they cannot overwrite a newer edit.
            </p>
          </details>
        )}
      </details>
      <ReferenceStyle
        project={project}
        busy={!ready}
        run={run}
        onProposed={(value) => {
          setProposal(value);
          onPreview(null);
        }}
        onNotice={setNotice}
      />
      {proposal && (
        <div
          className="assistant-proposal"
          aria-label="Proposed editing changes"
        >
          <h4>
            {proposal.status === "applied"
              ? "Changes applied"
              : proposal.status === "rejected"
                ? "Proposal discarded"
                : "Review these exact changes"}
          </h4>
          {stale && proposal.status === "proposed" && (
            <p className="inline-error">
              This video has changed. Save and generate a fresh proposal before
              applying.
            </p>
          )}
          {proposal.report && (
            <div aria-label="Why these style changes">
              <h4>Why these changes?</h4>
              <ul>
                {proposal.report.summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {!!proposal.report.alignment_sources.length && (
                <p className="help">
                  Timing evidence:{" "}
                  {proposal.report.alignment_sources.join("; ")}. This does not
                  establish word-level or story alignment.
                </p>
              )}
              {!!proposal.report.counts.unreviewed_effects_skipped && (
                <p className="help">
                  Skipped {proposal.report.counts.unreviewed_effects_skipped}{" "}
                  unreviewed automatic effect suggestions.
                </p>
              )}
              {proposal.report.warnings.map((line) => (
                <p className="notice" key={line}>
                  {line}
                </p>
              ))}
              {!!proposal.report.unsupported_effects.length && (
                <details>
                  <summary>Reference effects needing manual work</summary>
                  <ul>
                    {proposal.report.unsupported_effects.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
              )}
              {!!proposal.report.trace?.length && (
                <details>
                  <summary>Trace each edited shot to the reference</summary>
                  <ol>
                    {proposal.report.trace.map((item) => (
                      <li key={item.shot}>
                        <strong>
                          Shot {item.shot} ← reference beat{" "}
                          {item.reference_beat}
                          {item.reference_time !== null
                            ? ` at ${item.reference_time.toFixed(2)}s`
                            : ""}
                        </strong>
                        <p>
                          {item.reason}. {item.evidence}
                        </p>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          )}
          <ul>
            {proposal.changes
              .filter((c) => c.field !== "Style adaptation")
              .map((c, i) => (
                <li key={i}>
                  <strong>
                    {c.shot ? `Shot ${c.shot} · ` : ""}
                    {fieldLabel(c.field)}
                  </strong>
                  <details>
                    <summary>
                      {friendlyValue(c.before).slice(0, 90)} →{" "}
                      {friendlyValue(c.after).slice(0, 90)}
                    </summary>
                    <pre>
                      {describe(c.before)}
                      {"\n→\n"}
                      {describe(c.after)}
                    </pre>
                  </details>
                </li>
              ))}
          </ul>
          {proposal.plan.script !== null &&
            proposal.plan.script !== undefined && (
              <p className="notice">
                This updates the written script only. Generate a matching
                ElevenLabs recording and review caption/timing alignment before
                export.
              </p>
            )}
          {proposal.status === "proposed" && (
            <div className="workflow-actions">
              <button
                className="button secondary"
                disabled={!ready || stale}
                onClick={() =>
                  void run(
                    async () =>
                      onPreview(
                        await api<Project>(
                          `/projects/${project.id}/assistant/proposals/${proposal.id}/preview`,
                        ),
                      ),
                    false,
                  )
                }
              >
                Watch proposed edit
              </button>
              <button
                className="button secondary"
                disabled={!ready || stale}
                onClick={() =>
                  void run(async () => {
                    setProposalRender(
                      await api<RenderJob>(
                        `/projects/${project.id}/assistant/proposals/${proposal.id}/render`,
                        json({ base_revision: proposal.base_revision }),
                      ),
                    );
                    onChanged();
                    setNotice(
                      "Rendering the proposed edit with the actual effects and audio mix. Your saved video is unchanged.",
                    );
                  }, false)
                }
              >
                Render proposed edit · actual effects
              </button>
              <button
                className="button"
                disabled={!ready || stale}
                onClick={() =>
                  void run(async () => {
                    const saved = await api<Project>(
                      `/projects/${project.id}/assistant/proposals/${proposal.id}/apply`,
                      json({ base_revision: proposal.base_revision }),
                    );
                    accept(saved);
                    onPreview(null);
                    onChanged();
                    setProposal({ ...proposal, status: "applied" });
                    setNotice(
                      "Changes applied and saved. Undo restores the previous edit. Review and approve this new revision before export.",
                    );
                  })
                }
              >
                Apply reviewed changes
              </button>
              <button
                className="text-button"
                disabled={!ready}
                onClick={() =>
                  void run(async () => {
                    await api(
                      `/projects/${project.id}/assistant/proposals/${proposal.id}/reject`,
                      json({}),
                    );
                    setProposal({ ...proposal, status: "rejected" });
                    onPreview(null);
                  }, false)
                }
              >
                Discard proposal
              </button>
            </div>
          )}
          {proposalRender && (
            <div
              className="proposed-render"
              aria-label="Rendered proposed edit"
            >
              <p>Rendered proposal · {proposalRender.status}</p>
              {proposalRender.status === "completed" &&
                proposalRender.video_url && (
                  <video
                    aria-label="Proposed edit rendered playback"
                    controls
                    preload="metadata"
                    src={proposalRender.video_url}
                  />
                )}
              {proposalRender.status === "failed" && (
                <p role="alert" className="inline-error">
                  {proposalRender.error ||
                    "Proposed preview failed; your saved edit is unchanged."}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      <details className="assistant-review" open={active.length > 0}>
        <summary>
          Review queue · {active.length} item{active.length === 1 ? "" : "s"}{" "}
          needing attention
        </summary>
        {dirty && (
          <p className="help">
            These checks describe the saved revision. Save your edits or refresh
            to check the latest version.
          </p>
        )}
        <p className="help">{queue?.limits}</p>
        <div className="workflow-actions">
          <button
            className="button secondary small-button"
            disabled={!ready}
            onClick={() => void run(refresh)}
          >
            Refresh checks
          </button>
          <button
            className="button secondary small-button"
            disabled={!ready || dirty || !active.length}
            onClick={() =>
              void run(async () => {
                const saved = await current();
                setProposal(
                  await api<Proposal>(
                    `/projects/${project.id}/review-queue/fix`,
                    json({ base_revision: saved.revision }),
                  ),
                );
              })
            }
          >
            Propose safe fixes
          </button>
          <label className="check-label">
            <input
              type="checkbox"
              checked={showSkipped}
              onChange={(e) => setShowSkipped(e.target.checked)}
            />{" "}
            Show skipped items
          </label>
        </div>
        {!active.length && (
          <p>
            No outstanding technical review items for this saved revision. Watch
            the complete preview before approving.
          </p>
        )}
        <ol>
          {display.map((f) => (
            <li
              key={f.id}
              className={f.severity === "critical" ? "review-critical" : ""}
            >
              <strong>
                {f.severity === "critical" ? "Needs fixing · " : "Review · "}
              </strong>
              {f.message}
              {f.dismissed_reason && (
                <p>Skipped for this revision: {f.dismissed_reason}</p>
              )}
              <div className="workflow-actions">
                <button
                  className="text-button"
                  onClick={() =>
                    onSeek(
                      f.seconds ??
                        (f.scene_index === null
                          ? 0
                          : timelineSeconds(
                              scenes.slice(0, f.scene_index),
                              project.settings.fps,
                            )),
                    )
                  }
                >
                  Jump to {timecode(f.seconds ?? 0)}
                </button>
                {f.scene_index !== null && (
                  <button className="text-button" onClick={() => hint(f)}>
                    Ask for a shot fix
                  </button>
                )}
                {f.severity !== "critical" && !f.dismissed_reason && (
                  <button
                    className="text-button"
                    disabled={!ready || dirty}
                    onClick={() => {
                      const reason = window.prompt(
                        "Why is this warning acceptable for this revision?",
                      );
                      if (reason?.trim())
                        void run(async () => {
                          await api(
                            `/projects/${project.id}/review-queue/dismiss`,
                            json({
                              base_revision: project.revision,
                              finding_id: f.id,
                              reason,
                            }),
                          );
                          await refresh();
                        }, false);
                    }}
                  >
                    Skip with a reason
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </details>
      <details className="assistant-preferences">
        <summary>My recipe and learning · optional</summary>
        <p>
          Your preferred recipe starts new episodes with saved captions, pacing,
          audio settings, music and logo. It does not change existing videos. An
          explicitly chosen template takes priority.
        </p>
        <label>
          Recipe name
          <input
            aria-label="Preferred recipe name"
            value={recipeName}
            maxLength={100}
            onChange={(e) => setRecipeName(e.target.value)}
          />
        </label>
        <button
          className="button secondary small-button"
          disabled={!ready || !recipeName.trim()}
          onClick={() =>
            void run(async () => {
              const saved = await current();
              const template = await api<{ id: string }>(
                "/templates",
                json({
                  name: recipeName.trim(),
                  settings: saved.settings,
                  project_id: saved.id,
                }),
              );
              setPrefs(
                await api<Preferences>(
                  "/creator-preferences",
                  json(
                    {
                      template_id: template.id,
                      observe_edits: prefs?.observe_edits ?? true,
                    },
                    "PUT",
                  ),
                ),
              );
              onChanged();
              setNotice(
                "Preferred recipe saved. New episodes will use it automatically.",
              );
            })
          }
        >
          Use this video as my preferred recipe
        </button>
        {prefs?.template_id && (
          <button
            className="text-button"
            disabled={!ready}
            onClick={() =>
              void run(async () => {
                setPrefs(
                  await api<Preferences>(
                    "/creator-preferences",
                    json(
                      { template_id: null, observe_edits: prefs.observe_edits },
                      "PUT",
                    ),
                  ),
                );
                setNotice(
                  "Preferred template cleared. Approved Creative DNA defaults still apply until disabled.",
                );
              }, false)
            }
          >
            Clear preferred template
          </button>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            checked={prefs?.observe_edits ?? true}
            disabled={!ready || !prefs}
            onChange={(e) => {
              const observe_edits = e.target.checked;
              void run(async () => {
                setPrefs(
                  await api<Preferences>(
                    "/creator-preferences",
                    json(
                      {
                        template_id: prefs?.template_id ?? null,
                        observe_edits,
                      },
                      "PUT",
                    ),
                  ),
                );
              }, false);
            }}
          />{" "}
          Observe settings corrections locally to suggest preferences
        </label>
        <p className="help">
          Only repeated settings changes across at least three different videos
          are proposed. Nothing is approved automatically. This is inspectable
          preference memory, not autonomous training or a claim to understand
          your taste.
        </p>
        <button
          className="button secondary small-button"
          disabled={!ready}
          onClick={() =>
            void run(async () => {
              const result = await api<{ message: string }>(
                "/creative-dna/learning-proposals",
                json({}),
              );
              setNotice(result.message);
              const dna = await api<{ rules: Rule[] }>(
                "/creative-dna?limit=100",
              );
              setRules(
                dna.rules.filter((r) => r.source === "correction_pattern"),
              );
            }, false)
          }
        >
          Find repeated preferences
        </button>
        <ul>
          {rules
            .filter((r) => r.status !== "rejected")
            .map((rule) => (
              <li key={rule.id}>
                <span>{preferenceLabel(rule.instruction)}</span> · {rule.status}
                <button
                  className="text-button"
                  disabled={!ready}
                  onClick={() =>
                    void run(async () => {
                      const updated = await api<Rule>(
                        `/creative-dna/rules/${rule.id}`,
                        json(
                          {
                            status:
                              rule.status === "approved"
                                ? "rejected"
                                : "approved",
                            expected_updated_at: rule.updated_at,
                          },
                          "PATCH",
                        ),
                      );
                      setRules((values) =>
                        values.map((r) => (r.id === rule.id ? updated : r)),
                      );
                      setNotice(
                        updated.status === "approved"
                          ? "Preference approved for future default episodes. Existing edits are unchanged."
                          : "Preference disabled for future episodes.",
                      );
                    }, false)
                  }
                >
                  {rule.status === "approved"
                    ? "Disable preference"
                    : "Approve as a future default"}
                </button>
              </li>
            ))}
        </ul>
        <button
          className="text-button danger"
          disabled={!ready}
          onClick={() => {
            if (
              window.confirm(
                "Erase local correction observations? Existing projects, templates and approved rules are kept.",
              )
            )
              void run(async () => {
                await api("/creative-dna/observations", { method: "DELETE" });
                setNotice("Local correction observations erased.");
              }, false);
          }}
        >
          Erase correction observations
        </button>
      </details>
    </section>
  );
}
