import { useEffect, useRef, useState } from "react";
import { api, json } from "./api";
import type { Proposal } from "./CreatorAssistant";
import { CAMERA_MOVES } from "./effects";
import { TransitionOptions } from "./EffectOptions";
import type { Project, Scene } from "./types";
import { errorMessage, timecode } from "./utils";

type Beat = {
  seconds: number;
  transition: Scene["transition"];
  motion: Scene["motion"];
};
type Recipe = {
  beats: Beat[];
  transition_duration: number;
  motion_strength: number;
};
type Style = {
  id: string;
  name: string;
  revision: number;
  duration: number;
  source_name: string;
  video_url: string;
  recipe: Recipe;
  analysis: {
    start: number;
    end: number;
    sample_fps: number;
    median_shot_seconds: number;
    limits: string;
    events: { source_time: number; transition: string; evidence: string }[];
  };
};
const supportedMoves = new Set([
  "hold",
  "zoom_in",
  "zoom_out",
  "pan_left",
  "pan_right",
  "pan_up",
  "pan_down",
  "punch_in",
  "punch_out",
  "breathe",
  "impact_shake",
]);

export default function ReferenceStyle({
  project,
  busy,
  run,
  onProposed,
  onNotice,
}: {
  project: Project;
  busy: boolean;
  run: (action: () => Promise<void>, saveFirst?: boolean) => Promise<void>;
  onProposed: (proposal: Proposal | null) => void;
  onNotice: (message: string) => void;
}) {
  const [styles, setStyles] = useState<Style[]>([]);
  const [selected, setSelected] = useState<Style | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [start, setStart] = useState(0),
    [end, setEnd] = useState("");
  const [intensity, setIntensity] = useState(0.75),
    [tempo, setTempo] = useState(1);
  const [pacing, setPacing] = useState(true),
    [transitions, setTransitions] = useState(true),
    [camera, setCamera] = useState(true);
  const [range, setRange] = useState(false),
    [first, setFirst] = useState(0),
    [last, setLast] = useState(0);
  const [error, setError] = useState(""),
    [videoError, setVideoError] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const scenes = project.scenes ?? [];
  const changed = Boolean(
    selected &&
    (name !== selected.name ||
      JSON.stringify(recipe) !== JSON.stringify(selected.recipe)),
  );
  useEffect(() => {
    let alive = true;
    api<Style[]>("/reference-styles")
      .then((values) => {
        if (alive) setStyles(values);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    setFirst((value) => Math.min(value, Math.max(0, scenes.length - 1)));
    setLast(Math.max(0, scenes.length - 1));
  }, [project.id, scenes.length]);
  function invalidate() {
    onProposed(null);
  }
  function choose(style: Style | null) {
    setSelected(style);
    setName(style?.name ?? "");
    setRecipe(style ? structuredClone(style.recipe) : null);
    setVideoError(false);
    invalidate();
  }
  function adopt(style: Style) {
    setStyles((values) => [style, ...values.filter((s) => s.id !== style.id)]);
    choose(style);
  }
  function editBeat(index: number, change: Partial<Beat>) {
    if (recipe)
      setRecipe({
        ...recipe,
        beats: recipe.beats.map((b, i) =>
          i === index ? { ...b, ...change } : b,
        ),
      });
    invalidate();
  }
  return (
    <details className="reference-style" aria-label="Reference video style">
      <summary>Use a video's editing style · reference and tweak</summary>
      <p>
        Import a reference, review its rhythm and suggested effects, then
        propose an editable pass using your own artwork and narration.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <label>
        Saved reference style
        <select
          aria-label="Saved reference style"
          value={selected?.id ?? ""}
          disabled={busy}
          onChange={(e) =>
            choose(styles.find((s) => s.id === e.target.value) ?? null)
          }
        >
          <option value="">Choose a style or import a reference</option>
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <details className="reference-import" open={!selected}>
        <summary>Import a reference video</summary>
        <label>
          Reference video · MP4, MOV or WebM
          <input
            aria-label="Reference video file"
            type="file"
            accept=".mp4,.mov,.webm"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError("");
            }}
          />
        </label>
        <div className="form-grid">
          <label>
            Analyze from · seconds
            <input
              aria-label="Reference range start"
              type="number"
              min="0"
              step="0.1"
              value={start}
              disabled={busy}
              onChange={(e) => setStart(+e.target.value)}
            />
          </label>
          <label>
            Analyze until · optional
            <input
              aria-label="Reference range end"
              type="number"
              min="0.5"
              step="0.1"
              value={end}
              placeholder="First 60 seconds"
              disabled={busy}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <p className="help">
          Up to 64 MB. Analyze 0.5–180 seconds at a time; a blank end uses up to
          60 seconds. Analysis runs locally, without an API key or uploads to an
          AI provider.
        </p>
        <button
          className="button secondary"
          disabled={busy || !file}
          onClick={() =>
            void run(async () => {
              if (!file) return;
              if (file.size > 64 * 1024 * 1024) {
                setError("Use a reference clip up to 64 MB.");
                return;
              }
              const body = new FormData();
              body.append("file", file);
              body.append("start", String(start));
              if (end) body.append("end", end);
              const style = await api<Style>("/reference-styles", {
                method: "POST",
                body,
              });
              adopt(style);
              setFile(null);
              onNotice(
                "Reference analyzed and saved. Review the suggested recipe before proposing changes.",
              );
            }, false)
          }
        >
          {busy ? "Analyzing locally…" : "Analyze reference video"}
        </button>
      </details>
      {selected && recipe && (
        <>
          <video
            ref={video}
            key={selected.id}
            aria-label="Reference video playback"
            controls
            preload="metadata"
            src={selected.video_url}
            onLoadedMetadata={() => {
              if (video.current)
                video.current.currentTime = selected.analysis.start;
            }}
            onError={() => setVideoError(true)}
          />
          {videoError && (
            <p className="help">
              This browser cannot play the reference file. The saved recipe is
              still usable; use an H.264 MP4 for browser playback.
            </p>
          )}
          <p>
            Measured range {timecode(selected.analysis.start)}–
            {timecode(selected.analysis.end)} ·{" "}
            {selected.analysis.events.length} suggested boundaries · typical
            measured hold {selected.analysis.median_shot_seconds.toFixed(2)}s
          </p>
          <p className="help">
            Review the suggested cues against the reference, then adjust any
            beat below.
          </p>
          <details>
            <summary>Analysis details and supported effects</summary>
            <p className="help">{selected.analysis.limits}</p>
          </details>
          <details>
            <summary>Inspect detected cues · approximate, review first</summary>
            <ul>
              {selected.analysis.events.map((e, i) => (
                <li key={i}>
                  <button
                    className="text-button"
                    onClick={() => {
                      if (video.current) {
                        video.current.currentTime = e.source_time;
                        video.current.pause();
                      }
                    }}
                  >
                    {timecode(e.source_time)} ·{" "}
                    {e.transition.replaceAll("_", " ")}
                  </button>{" "}
                  {e.evidence}
                </li>
              ))}
              {!selected.analysis.events.length && (
                <li>
                  No reliable cut/effect boundaries detected. This is a
                  hold-based recipe; you can add and change beats below.
                </li>
              )}
            </ul>
          </details>
          <details className="reference-recipe">
            <summary>Tweak and save this style recipe</summary>
            <label>
              Style name
              <input
                aria-label="Reference style name"
                value={name}
                maxLength={100}
                disabled={busy}
                onChange={(e) => {
                  setName(e.target.value);
                  invalidate();
                }}
              />
            </label>
            <div className="form-grid">
              <label>
                Transition duration · seconds
                <input
                  aria-label="Reference transition duration"
                  type="number"
                  min="0.08"
                  max="0.8"
                  step="0.01"
                  value={recipe.transition_duration}
                  disabled={busy}
                  onChange={(e) => {
                    setRecipe({
                      ...recipe,
                      transition_duration: +e.target.value,
                    });
                    invalidate();
                  }}
                />
              </label>
              <label>
                Camera movement amount ·{" "}
                {Math.round(recipe.motion_strength * 100)}%
                <input
                  aria-label="Reference motion strength"
                  type="range"
                  min="0.02"
                  max="0.3"
                  step="0.01"
                  value={recipe.motion_strength}
                  disabled={busy}
                  onChange={(e) => {
                    setRecipe({ ...recipe, motion_strength: +e.target.value });
                    invalidate();
                  }}
                />
              </label>
            </div>
            <div className="reference-beats">
              {recipe.beats.map((beat, i) => (
                <div className="reference-beat" key={i}>
                  <strong>Beat {i + 1}</strong>
                  <label>
                    Hold · seconds
                    <input
                      aria-label={`Reference beat ${i + 1} duration`}
                      type="number"
                      min="0.25"
                      max="30"
                      step="0.05"
                      value={beat.seconds}
                      disabled={busy}
                      onChange={(e) =>
                        editBeat(i, { seconds: +e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Entry transition
                    <select
                      aria-label={`Reference beat ${i + 1} transition`}
                      value={beat.transition ?? "cut"}
                      disabled={busy}
                      onChange={(e) =>
                        editBeat(i, {
                          transition: e.target.value as Beat["transition"],
                        })
                      }
                    >
                      <TransitionOptions />
                    </select>
                  </label>
                  <label>
                    Camera effect
                    <select
                      aria-label={`Reference beat ${i + 1} camera`}
                      value={beat.motion}
                      disabled={busy}
                      onChange={(e) =>
                        editBeat(i, {
                          motion: e.target.value as Beat["motion"],
                        })
                      }
                    >
                      {CAMERA_MOVES.filter((m) =>
                        supportedMoves.has(m.value),
                      ).map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="text-button"
                    aria-label={`Remove reference beat ${i + 1}`}
                    disabled={busy || recipe.beats.length === 1}
                    onClick={() => {
                      setRecipe({
                        ...recipe,
                        beats: recipe.beats.filter((_, n) => n !== i),
                      });
                      invalidate();
                    }}
                  >
                    Remove beat
                  </button>
                </div>
              ))}
            </div>
            <div className="workflow-actions">
              <button
                className="text-button"
                disabled={busy || recipe.beats.length >= 240}
                onClick={() => {
                  setRecipe({
                    ...recipe,
                    beats: [
                      ...recipe.beats,
                      { seconds: 1, transition: "cut", motion: "punch_in" },
                    ],
                  });
                  invalidate();
                }}
              >
                Add style beat
              </button>
              <button
                className="button secondary"
                disabled={busy || !changed || !name.trim()}
                onClick={() =>
                  void run(async () => {
                    adopt(
                      await api<Style>(
                        `/reference-styles/${selected.id}`,
                        json(
                          { base_revision: selected.revision, name, recipe },
                          "PUT",
                        ),
                      ),
                    );
                    onNotice(
                      "Style recipe saved. You can reuse it in any episode.",
                    );
                  }, false)
                }
              >
                Save tweaked style
              </button>
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this saved style and its reference video? Existing episode edits stay intact.",
                    )
                  )
                    void run(async () => {
                      await api(
                        `/reference-styles/${selected.id}`,
                        json({ base_revision: selected.revision }, "DELETE"),
                      );
                      setStyles((values) =>
                        values.filter((s) => s.id !== selected.id),
                      );
                      choose(null);
                    }, false);
                }}
              >
                Delete saved reference
              </button>
            </div>
          </details>
          <h4>How much should this video follow the style?</h4>
          <div className="form-grid">
            <label>
              Style intensity · {Math.round(intensity * 100)}%
              <input
                aria-label="Reference style intensity"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={intensity}
                disabled={busy}
                onChange={(e) => {
                  setIntensity(+e.target.value);
                  invalidate();
                }}
              />
            </label>
            <label>
              Pacing multiplier · {tempo.toFixed(2)}×
              <input
                aria-label="Reference style tempo"
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={tempo}
                disabled={busy}
                onChange={(e) => {
                  setTempo(+e.target.value);
                  invalidate();
                }}
              />
            </label>
          </div>
          <div className="workflow-actions">
            {(
              [
                ["Match cut rhythm", pacing, setPacing],
                ["Transfer transitions", transitions, setTransitions],
                ["Transfer camera effects", camera, setCamera],
              ] as const
            ).map(([label, checked, set]) => (
              <label className="check-label" key={label}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={(e) => {
                    set(e.target.checked);
                    invalidate();
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          <label>
            Apply to
            <select
              aria-label="Reference style scope"
              value={range ? "range" : "all"}
              disabled={busy}
              onChange={(e) => {
                setRange(e.target.value === "range");
                invalidate();
              }}
            >
              <option value="all">Whole video</option>
              <option value="range">A range of shots</option>
            </select>
          </label>
          {range && (
            <div className="form-grid">
              {(
                [
                  ["First shot", first, setFirst],
                  ["Last shot", last, setLast],
                ] as const
              ).map(([label, value, set]) => (
                <label key={label}>
                  {label}
                  <select
                    aria-label={`Reference ${label.toLowerCase()}`}
                    value={value}
                    disabled={busy}
                    onChange={(e) => {
                      set(+e.target.value);
                      invalidate();
                    }}
                  >
                    {scenes.map((s, i) => (
                      <option key={s.id} value={i}>
                        {i + 1}. {s.panel.title}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          <p className="help">
            Pacing may add editable reframings and move visual cuts. Your
            recording, timed subtitles and total runtime stay fixed. Locked
            shots, custom camera routes and long-panel glides stay unchanged.
            Shot captions and sound placements keep their original timing. All
            artwork stays in order; very slow references may need more time than
            this recording allows. Review the result against the narration.
          </p>
          {changed && (
            <p className="notice">
              Save your recipe tweaks before generating a proposal.
            </p>
          )}
          <button
            className="button"
            disabled={
              busy ||
              changed ||
              !scenes.length ||
              intensity === 0 ||
              (!pacing && !transitions && !camera) ||
              (range && first > last)
            }
            onClick={() =>
              void run(async () => {
                const saved = await api<Project>(`/projects/${project.id}`);
                onProposed(
                  await api<Proposal>(
                    `/projects/${project.id}/reference-style/proposals`,
                    json({
                      base_revision: saved.revision,
                      reference_id: selected.id,
                      reference_revision: selected.revision,
                      options: {
                        first_shot: range ? first : 0,
                        last_shot: range ? last : null,
                        intensity,
                        tempo,
                        pacing,
                        transitions,
                        camera,
                      },
                    }),
                  ),
                );
                onNotice(
                  "Style proposal ready below. Watch it first, then apply or discard. Every resulting shot remains editable on your timeline.",
                );
              })
            }
          >
            Propose this reference style
          </button>
        </>
      )}
    </details>
  );
}
