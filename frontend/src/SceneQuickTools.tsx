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
  const region = scene.source_crop;
  const ratio = region
    ? (scene.panel.width * region.width) / (scene.panel.height * region.height)
    : scene.panel.width / scene.panel.height;
  const setRegion = (key: "x" | "y" | "width" | "height", percent: number) => {
    if (!region || !Number.isFinite(percent)) return;
    const value = percent / 100;
    const next = { ...region };
    if (key === "x") next.x = Math.min(1 - next.width, Math.max(0, value));
    if (key === "y") next.y = Math.min(1 - next.height, Math.max(0, value));
    if (key === "width")
      next.width = Math.min(1 - next.x, Math.max(0.01, value));
    if (key === "height")
      next.height = Math.min(1 - next.y, Math.max(0.01, value));
    onChange({ source_crop: next });
  };
  const view = 9 / 16;
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
      {region && (
        <details className="workflow-advanced">
          <summary>Detected comic panel · edit source window</summary>
          <p className="help">
            This is a virtual crop of your original full-page screenshot. The
            page remains intact. Adjust this outline if the gutter detector
            mistook one long panel for two or cropped a speech balloon.
          </p>
          <div
            style={{ position: "relative", width: "min(100%, 360px)" }}
            aria-label={`Source page region for scene ${index + 1}`}
          >
            <img
              src={scene.panel.image_url}
              alt={scene.panel.title}
              style={{ display: "block", width: "100%" }}
            />
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
                outline: "2px solid #ed4e5b",
                background: "rgba(237,78,91,0.10)",
                pointerEvents: "none",
              }}
            />
          </div>
          <div className="form-grid">
            {(["x", "y", "width", "height"] as const).map((field) => (
              <label key={field}>
                {field === "x"
                  ? "Left"
                  : field === "y"
                    ? "Top"
                    : field === "width"
                      ? "Width"
                      : "Height"}{" "}
                (%)
                <input
                  aria-label={`Scene ${index + 1} panel ${field}`}
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  disabled={scene.locked}
                  value={Math.round(region[field] * 1000) / 10}
                  onChange={(event) =>
                    setRegion(field, Number(event.target.value))
                  }
                />
              </label>
            ))}
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="button secondary small-button"
              disabled={scene.locked}
              onClick={() =>
                onChange({
                  source_crop: null,
                  glide_axis: null,
                  motion: "hold",
                  framing: "fit",
                })
              }
            >
              Keep entire page together
            </button>
            <button
              type="button"
              className="button secondary small-button"
              disabled={scene.locked}
              onClick={() =>
                onChange({
                  motion: "panel_glide",
                  glide_axis: ratio >= 9 / 16 ? "horizontal" : "vertical",
                  framing: "fit",
                })
              }
            >
              Follow panel with camera
            </button>
            <button
              type="button"
              className="button secondary small-button"
              disabled={scene.locked}
              onClick={() => onChange({ motion: "hold", framing: "fit" })}
            >
              Hold entire panel
            </button>
          </div>
        </details>
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
