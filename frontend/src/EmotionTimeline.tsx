import { useState } from "react";
import type { CaptionCue, Scene } from "./types";
import {
  applyPerformanceCues,
  parsePerformanceScript,
  timePerformanceCues,
} from "./emotion";

interface Props {
  script: string;
  captions: CaptionCue[];
  scenes: Scene[];
  fps: number;
  narrationStart: number;
  duration: number;
  overrides: Record<string, number>;
  onOverridesChange: (next: Record<string, number>) => void;
  onApply: (next: Scene[]) => void;
  onSeek: (seconds: number) => void;
}

export default function EmotionTimeline({
  script,
  captions,
  scenes,
  fps,
  narrationStart,
  duration,
  overrides,
  onOverridesChange,
  onApply,
  onSeek,
}: Props) {
  const [notice, setNotice] = useState("");
  const parsed = parsePerformanceScript(script);
  const marks = timePerformanceCues(
    script,
    captions,
    duration,
    narrationStart,
    overrides,
  );
  const ordered = [...marks].sort((a, b) => a.time - b.time);

  return (
    <section className="emotion-timeline" aria-label="Verdict emotion timeline">
      <div className="section-heading">
        <div>
          <h3>Verdict emotion timeline</h3>
          <p>
            Script directions control the performance. Preview each cue, adjust
            its timing, then apply restrained camera suggestions.
          </p>
        </div>
      </div>
      {!marks.length ? (
        <p className="help">
          Add directions in the script, such as [DISBELIEF], [DEADPAN], [PAUSE
          0.8s], [WHISPERING], or [FRUSTRATED]. Known cues are never treated as
          spoken words. Everything else stays in the dialogue.
        </p>
      ) : (
        <>
          <div
            className="emotion-track"
            role="group"
            aria-label="Performance cues on the video timeline"
          >
            {ordered.map((cue) => (
              <button
                type="button"
                key={cue.id}
                className={`emotion-track-cue emotion-${cue.kind}`}
                style={{
                  left: `${duration ? Math.min(98, (cue.time / duration) * 100) : 0}%`,
                }}
                title={`${cue.label} at ${cue.time.toFixed(2)} seconds`}
                aria-label={`Seek to ${cue.label} at ${cue.time.toFixed(2)} seconds`}
                onClick={() => onSeek(cue.time)}
              >
                <span />
              </button>
            ))}
          </div>
          <div className="emotion-track-labels">
            <span>0:00</span>
            <span>{duration.toFixed(1)}s</span>
          </div>
          <div className="emotion-cue-list">
            {ordered.map((cue) => (
              <div className="emotion-cue-row" key={cue.id}>
                <span className={`emotion-cue-name emotion-${cue.kind}`}>
                  {cue.label}
                </span>
                <label>
                  At (seconds)
                  <input
                    aria-label={`Timing for ${cue.label}`}
                    type="number"
                    step="0.1"
                    min="0"
                    max={Math.max(0, duration)}
                    value={Number(cue.time.toFixed(2))}
                    onChange={(event) => {
                      if (event.target.value === "") return;
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) return;
                      onOverridesChange({
                        ...overrides,
                        [cue.id]: Math.max(0, Math.min(duration, next)),
                      });
                    }}
                  />
                </label>
                <span className="muted">
                  {cue.estimated ? "Estimated" : "Aligned"}
                </span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onSeek(cue.time)}
                >
                  Preview
                </button>
              </div>
            ))}
          </div>
          <div className="workflow-actions">
            <button
              type="button"
              className="button secondary small-button"
              disabled={!scenes.length}
              onClick={() => {
                const result = applyPerformanceCues(scenes, marks, fps);
                if (result.changed) onApply(result.scenes);
                setNotice(
                  result.changed
                    ? `Applied suggestions to ${result.changed} unlocked shots. Review before export.`
                    : "No eligible shots changed. Locked shots are always preserved.",
                );
              }}
            >
              Apply camera cues to unlocked shots
            </button>
            {Object.keys(overrides).length > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() => onOverridesChange({})}
              >
                Reset timing overrides
              </button>
            )}
          </div>
          <p className="help">
            Explicit directions take precedence over automatic suggestions when
            you apply them.
            {captions.length
              ? " Aligned markers use your timed captions when the words match; unmatched markers are estimated."
              : " Timing is estimated until you add timed narration captions."}{" "}
            Applying moves never changes scene length, dialogue, panel
            assignments, or locked shots.
          </p>
          {notice && (
            <p role="status" className="help">
              {notice}
            </p>
          )}
        </>
      )}
      {parsed.dialogue && (
        <details>
          <summary>Spoken dialogue only (without performance cues)</summary>
          <p className="emotion-dialogue">{parsed.dialogue}</p>
        </details>
      )}
    </section>
  );
}
