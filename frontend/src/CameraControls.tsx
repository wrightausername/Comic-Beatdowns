import { Eye, RotateCcw } from "lucide-react";
import { CAMERA_PRESETS, transitionLabel } from "./effects";
import { EasingOptions, TransitionOptions } from "./EffectOptions";
import type { Easing, Scene, Transition, VideoSettings } from "./types";

export default function CameraControls({
  scene,
  index,
  settings,
  onChange,
  onPreview,
}: {
  scene: Scene;
  index: number;
  settings: VideoSettings;
  onChange: (patch: Partial<Scene>) => void;
  onPreview: () => void;
}) {
  return (
    <div className="camera-controls">
      <div className="camera-preset-bar">
        <span>QUICK CAMERA</span>
        <div>
          {CAMERA_PRESETS.map((preset) => (
            <button
              key={preset.name}
              className="camera-preset"
              onClick={() => onChange(preset.settings)}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <button className="text-button" onClick={onPreview}>
          <Eye size={13} />
          Preview scene
        </button>
      </div>
      <div className="form-grid">
        <label>
          Transition into this scene
          <select
            aria-label={`Scene ${index + 1} transition`}
            value={scene.transition ?? "inherit"}
            disabled={index === 0}
            onChange={(e) =>
              onChange({
                transition:
                  e.target.value === "inherit"
                    ? null
                    : (e.target.value as Transition),
              })
            }
          >
            <option value="inherit">
              Project default · {transitionLabel(settings.transition)}
            </option>
            <TransitionOptions />
          </select>
        </label>
        <label>
          Transition duration (seconds)
          <input
            aria-label={`Scene ${index + 1} transition duration`}
            type="number"
            min="0.08"
            max="0.8"
            step="0.01"
            value={scene.transition_duration ?? settings.transition_duration}
            disabled={
              index === 0 || (scene.transition ?? settings.transition) === "cut"
            }
            onChange={(e) =>
              onChange({ transition_duration: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <p className="camera-help">
        {index === 0
          ? "The first scene opens directly. Set transitions on the scenes that follow."
          : "Short blends keep the edit clean. Scene timing and narration stay unchanged."}
      </p>
      <details className="camera-details">
        <summary>Camera strength, easing & framing</summary>
        <div className="form-grid">
          <label>
            Movement strength · {Math.round(scene.motion_strength * 100)}%
            <input
              aria-label={`Scene ${index + 1} movement strength`}
              type="range"
              min="0.02"
              max="0.3"
              step="0.01"
              value={scene.motion_strength}
              disabled={scene.motion === "hold"}
              onChange={(e) =>
                onChange({ motion_strength: Number(e.target.value) })
              }
            />
            <small>6–12% works well for subtle motion.</small>
          </label>
          <label>
            Motion easing
            <select
              aria-label={`Scene ${index + 1} easing`}
              value={scene.easing}
              onChange={(e) => onChange({ easing: e.target.value as Easing })}
            >
              <EasingOptions />
            </select>
          </label>
          <label>
            Horizontal framing · {Math.round(scene.focus_x * 100)}%
            <input
              aria-label={`Scene ${index + 1} horizontal framing`}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={scene.focus_x}
              onChange={(e) => onChange({ focus_x: Number(e.target.value) })}
            />
            <small>Left → center → right</small>
          </label>
          <label>
            Vertical framing · {Math.round(scene.focus_y * 100)}%
            <input
              aria-label={`Scene ${index + 1} vertical framing`}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={scene.focus_y}
              onChange={(e) => onChange({ focus_y: Number(e.target.value) })}
            />
            <small>Top → center → bottom</small>
          </label>
        </div>
        <button
          className="text-button"
          onClick={() => onChange({ focus_x: 0.5, focus_y: 0.5 })}
        >
          <RotateCcw size={12} />
          Center framing
        </button>
      </details>
    </div>
  );
}
