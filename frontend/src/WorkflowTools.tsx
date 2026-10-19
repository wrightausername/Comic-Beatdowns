import { useState } from "react";
import { Scissors, Sparkles, Upload } from "lucide-react";
import { MotionOptions, TransitionOptions } from "./EffectOptions";
import type { CaptionCue, Motion, Scene, Transition } from "./types";

export interface AutoEditOptions {
  pace: "fast" | "slow";
  length: "full" | "short";
  shot_seconds: number;
}
export function AutoEditControls({
  pace: initial,
  ready,
  busy,
  onRun,
}: {
  pace: "fast" | "slow";
  ready: boolean;
  busy: boolean;
  onRun: (options: AutoEditOptions) => void;
}) {
  const [pace, setPace] = useState(initial),
    [length, setLength] = useState<"full" | "short">("full");
  const [shot, setShot] = useState(initial === "fast" ? 1.25 : 5);
  return (
    <section className="surface auto-edit-section">
      <div className="section-heading">
        <div>
          <h3>
            <Sparkles size={17} /> Auto Edit
          </h3>
          <p>Choose your pace. Build a first cut, then make it yours.</p>
        </div>
      </div>
      <div className="pace-choices" role="group" aria-label="Auto Edit pace">
        {(["fast", "slow"] as const).map((value) => (
          <button
            key={value}
            className={pace === value ? "pace-choice selected" : "pace-choice"}
            aria-pressed={pace === value}
            onClick={() => {
              setPace(value);
              setShot(value === "fast" ? 1.25 : 5);
            }}
          >
            <strong>
              {value === "fast" ? "Fast · punchy" : "Slow · smooth"}
            </strong>
            <span>
              {value === "fast"
                ? "Quick cuts, punch-ins, multiple shots per panel"
                : "Longer holds, gentle moves, clean crossfades"}
            </span>
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label>
          Video length
          <select
            aria-label="Auto Edit length"
            value={length}
            onChange={(e) => setLength(e.target.value as "full" | "short")}
          >
            <option value="full">Full narration</option>
            <option value="short">Short · first 30 seconds or less</option>
          </select>
        </label>
        <label>
          Average shot length (seconds)
          <input
            aria-label="Auto Edit shot length"
            type="number"
            min="0.5"
            max="10"
            step="0.25"
            value={shot}
            onChange={(e) => setShot(Number(e.target.value))}
          />
        </label>
      </div>
      <p className="help">
        Fast and slow both work for Shorts. The short option uses a deliberate
        narration excerpt, ending near a pause when possible. Review close-ups
        and the ending before export.
      </p>
      <button
        className="button"
        disabled={busy || !ready || shot < 0.5 || shot > 10}
        onClick={() => onRun({ pace, length, shot_seconds: shot })}
      >
        <Sparkles size={15} /> Create first cut
      </button>
      {!ready && (
        <p className="help">
          Add panels and upload narration to enable Auto Edit.
        </p>
      )}
    </section>
  );
}

export function BulkControls({
  scenes,
  selected,
  setSelected,
  onApply,
  onDelete,
}: {
  scenes: Scene[];
  selected: Set<string>;
  setSelected: (ids: Set<string>) => void;
  onApply: (values: Partial<Scene>) => void;
  onDelete: () => void;
}) {
  const [motion, setMotion] = useState(""),
    [transition, setTransition] = useState("");
  const [seconds, setSeconds] = useState(""),
    [strength, setStrength] = useState("");
  return (
    <div className="bulk-controls">
      <div className="bulk-heading">
        <label className="checkbox">
          <input
            type="checkbox"
            aria-label="Select all scenes"
            checked={scenes.length > 0 && selected.size === scenes.length}
            onChange={(e) =>
              setSelected(
                new Set(e.target.checked ? scenes.map((s) => s.id!) : []),
              )
            }
          />{" "}
          Select all
        </label>
        <span>{selected.size} selected</span>
      </div>
      {selected.size > 0 && (
        <>
          <div className="bulk-fields">
            <label>
              Camera
              <select
                aria-label="Bulk camera motion"
                value={motion}
                onChange={(e) => setMotion(e.target.value)}
              >
                <option value="">Keep current</option>
                <MotionOptions />
              </select>
            </label>
            <label>
              Transition
              <select
                aria-label="Bulk transition"
                value={transition}
                onChange={(e) => setTransition(e.target.value)}
              >
                <option value="">Keep current</option>
                <option value="inherit">Project default</option>
                <TransitionOptions />
              </select>
            </label>
            <label>
              Seconds
              <input
                aria-label="Bulk duration"
                type="number"
                min="0.25"
                max="30"
                step="0.25"
                placeholder="Keep"
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
              />
            </label>
            <label>
              Strength %
              <input
                aria-label="Bulk movement strength"
                type="number"
                min="2"
                max="30"
                placeholder="Keep"
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
              />
            </label>
          </div>
          <div className="workflow-actions">
            <button
              className="button secondary small-button"
              disabled={Boolean(
                (seconds && (+seconds < 0.25 || +seconds > 30)) ||
                (strength && (+strength < 2 || +strength > 30)),
              )}
              onClick={() =>
                onApply({
                  ...(motion ? { motion: motion as Motion } : {}),
                  ...(transition
                    ? {
                        transition:
                          transition === "inherit"
                            ? null
                            : (transition as Transition),
                      }
                    : {}),
                  ...(seconds ? { duration: +seconds } : {}),
                  ...(strength ? { motion_strength: +strength / 100 } : {}),
                })
              }
            >
              Apply to selected
            </button>
            <button className="text-button danger" onClick={onDelete}>
              Remove selected
            </button>
            <button
              className="text-button"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function CaptionEditor({
  cues,
  busy,
  hasNarration,
  onChange,
  onTranscribe,
  onImport,
  onDownload,
  scriptAvailable,
}: {
  cues: CaptionCue[];
  busy: boolean;
  hasNarration: boolean;
  onChange: (cues: CaptionCue[]) => void;
  onTranscribe: (useScript: boolean) => void;
  onImport: (file: File) => void;
  onDownload: () => void;
  scriptAvailable: boolean;
}) {
  const [useScript, setUseScript] = useState(false);
  const edit = (index: number, values: Partial<CaptionCue>) =>
    onChange(cues.map((cue, i) => (i === index ? { ...cue, ...values } : cue)));
  return (
    <section className="surface caption-section">
      <div className="section-heading">
        <div>
          <h3>
            <Scissors size={17} /> Timed captions
          </h3>
          <p>
            Times refer to the original narration. Your selected excerpt is
            applied automatically.
          </p>
        </div>
      </div>
      <div className="workflow-actions">
        <button
          className="button secondary small-button"
          disabled={busy || !hasNarration}
          onClick={() => onTranscribe(useScript)}
        >
          <Sparkles size={14} /> Generate captions
        </button>
        <label className="button secondary small-button">
          <Upload size={14} /> Import SRT
          <input
            hidden
            type="file"
            accept=".srt,text/plain"
            aria-label="Import SRT captions"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onImport(file);
            }}
          />
        </label>
        {cues.length > 0 && (
          <button className="text-button" onClick={onDownload}>
            Download SRT
          </button>
        )}
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={useScript}
          disabled={!scriptAvailable}
          onChange={(e) => setUseScript(e.target.checked)}
        />
        Use script wording · only when it matches the recording
      </label>
      <p className="help">
        Offline English recognition. Review every caption, especially character
        names. Timed captions take priority over scene captions.
      </p>
      <div className="caption-list">
        {cues.map((cue, index) => (
          <div className="caption-row" key={index}>
            <span>{index + 1}</span>
            <label>
              Start
              <input
                aria-label={`Caption ${index + 1} start`}
                type="number"
                min="0"
                max="180"
                step="0.01"
                value={cue.start}
                onChange={(e) => edit(index, { start: +e.target.value })}
              />
            </label>
            <label>
              End
              <input
                aria-label={`Caption ${index + 1} end`}
                type="number"
                min="0"
                max="180"
                step="0.01"
                value={cue.end}
                onChange={(e) => edit(index, { end: +e.target.value })}
              />
            </label>
            <label>
              Text
              <input
                aria-label={`Caption ${index + 1} text`}
                maxLength={300}
                value={cue.text}
                onChange={(e) => edit(index, { text: e.target.value })}
              />
            </label>
            <button
              className="icon-button"
              aria-label={`Remove caption ${index + 1}`}
              onClick={() => onChange(cues.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="workflow-actions">
        <button
          className="text-button"
          disabled={cues.length >= 600}
          onClick={() => {
            const start = cues.at(-1)?.end ?? 0;
            if (start < 179.75)
              onChange([
                ...cues,
                { start, end: Math.min(180, start + 1), text: "New caption" },
              ]);
          }}
        >
          + Add caption
        </button>
        {cues.length > 0 && (
          <button className="text-button" onClick={() => onChange([])}>
            Clear timed captions
          </button>
        )}
      </div>
    </section>
  );
}
