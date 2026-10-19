import { useState } from "react";
import { Copy, Lock, Play, Scissors, Unlock } from "lucide-react";
import type { Scene, SoundEffect } from "./types";
import { beatPresets } from "./editing";

export default function SceneQuickTools({
  scene,
  index,
  effects,
  onChange,
  onSplit,
  onDuplicate,
  onReplace,
  onPreview,
  onRender,
}: {
  scene: Scene;
  index: number;
  effects: SoundEffect[];
  onChange: (patch: Partial<Scene>) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onReplace: () => void;
  onPreview: () => void;
  onRender: () => void;
}) {
  const [aim, setAim] = useState(false);
  const ratio = scene.panel.width / scene.panel.height,
    view = 9 / 16;
  const cropX = ratio > view ? view / ratio : 1,
    cropY = ratio < view ? ratio / view : 1;
  return (
    <div className="scene-quick-tools">
      <div className="scene-actions">
        <button
          className={`button secondary small-button ${scene.locked ? "locked" : ""}`}
          aria-label={`${scene.locked ? "Unlock" : "Lock"} scene ${index + 1}`}
          aria-pressed={Boolean(scene.locked)}
          onClick={() => onChange({ locked: !scene.locked })}
        >
          {scene.locked ? <Lock size={14} /> : <Unlock size={14} />}{" "}
          {scene.locked ? "Locked" : "Lock"}
        </button>
        <button
          className="button secondary small-button"
          disabled={scene.locked}
          onClick={onReplace}
        >
          Replace panel
        </button>
        <button
          className="button secondary small-button"
          disabled={scene.locked || scene.duration < 0.5}
          onClick={onSplit}
        >
          <Scissors size={14} />
          Split
        </button>
        <button className="button secondary small-button" onClick={onDuplicate}>
          <Copy size={14} />
          Duplicate
        </button>
        <button className="button secondary small-button" onClick={onPreview}>
          <Play size={14} />
          Preview shot
        </button>
        <button className="text-button" onClick={onRender}>
          Render shot
        </button>
      </div>
      <div
        className="shot-buttons"
        role="group"
        aria-label={`Scene ${index + 1} moment`}
      >
        {[
          ["hit", "Hit"],
          ["reveal", "Reveal"],
          ["reaction", "Reaction"],
          ["read", "Read Panel"],
        ].map(([beat, label]) => (
          <button
            key={beat}
            disabled={scene.locked}
            aria-pressed={scene.beat === beat}
            onClick={() =>
              onChange({
                ...beatPresets[beat],
                framing: beat === "read" ? "fit" : "fill",
              })
            }
          >
            {label}
          </button>
        ))}
        <button
          disabled={scene.locked}
          onClick={() => setAim(!aim)}
          aria-expanded={aim}
        >
          Aim camera
        </button>
      </div>
      {aim && (
        <div className="camera-aim">
          <p>
            Click the face or impact to center it in the vertical frame. The
            cross shows your target.
          </p>
          <button
            className="aim-image"
            disabled={scene.locked}
            aria-label={`Aim scene ${index + 1} camera`}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect(),
                x = (e.clientX - rect.left) / rect.width,
                y = (e.clientY - rect.top) / rect.height;
              const clamp = (v: number) => Math.max(0, Math.min(1, v));
              onChange({
                framing: "fill",
                focus_x:
                  cropX === 1 ? 0.5 : clamp((x - cropX / 2) / (1 - cropX)),
                focus_y:
                  cropY === 1 ? 0.5 : clamp((y - cropY / 2) / (1 - cropY)),
              });
            }}
          >
            <img src={scene.panel.image_url} alt="Click the area to frame" />
            <span
              className="aim-cross"
              style={{
                left: `${((1 - cropX) * scene.focus_x + cropX / 2) * 100}%`,
                top: `${((1 - cropY) * scene.focus_y + cropY / 2) * 100}%`,
              }}
            >
              +
            </span>
          </button>
          <button
            className="text-button"
            disabled={scene.locked}
            onClick={() => onChange({ focus_x: 0.5, focus_y: 0.5 })}
          >
            Center camera
          </button>
          <label className="check-label">
            <input
              type="checkbox"
              disabled={scene.locked}
              checked={scene.framing === "fit"}
              onChange={(e) =>
                onChange({ framing: e.target.checked ? "fit" : "fill" })
              }
            />
            Show the entire panel with borders
          </label>
        </div>
      )}
      <details className="workflow-advanced">
        <summary>Sound favorites & shot note</summary>
        <label>
          Favorite sound
          <select
            aria-label={`Scene ${index + 1} favorite sound`}
            disabled={scene.locked}
            value={scene.sfx_id ?? ""}
            onChange={(e) => {
              const effect = effects.find((v) => v.id === e.target.value);
              onChange({
                sfx_id: effect?.id ?? null,
                sfx_url: effect?.url ?? null,
                sfx_source_id: null,
                clear_sfx: !effect,
              });
            }}
          >
            <option value="">
              {scene.sfx_url && !scene.sfx_id
                ? "Uploaded sound"
                : "No favorite"}
            </option>
            {effects.map((effect) => (
              <option key={effect.id} value={effect.id}>
                {effect.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Play sound after (seconds)
          <input
            aria-label={`Scene ${index + 1} sound offset`}
            type="number"
            min="0"
            max={scene.duration}
            step=".01"
            disabled={scene.locked}
            value={scene.sfx_offset ?? 0}
            onChange={(e) => onChange({ sfx_offset: +e.target.value })}
          />
        </label>
        <label>
          Shot note
          <input
            aria-label={`Scene ${index + 1} note`}
            maxLength={2000}
            value={scene.note ?? ""}
            onChange={(e) => onChange({ note: e.target.value })}
          />
        </label>
      </details>
    </div>
  );
}
