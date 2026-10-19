import type { VideoSettings } from "./types";

export default function BrandOptions({
  value,
  onChange,
}: {
  value: VideoSettings;
  onChange: (settings: VideoSettings) => void;
}) {
  const patch = (values: Partial<VideoSettings>) =>
    onChange({ ...value, ...values });
  return (
    <div className="brand-options span-2">
      <h4>Caption appearance & brand placement</h4>
      <div className="form-grid">
        <label>
          Default editing pace
          <select
            value={value.edit_pace}
            onChange={(e) =>
              patch({ edit_pace: e.target.value as "fast" | "slow" })
            }
          >
            <option value="fast">Fast · punchy Shorts</option>
            <option value="slow">Slow · smooth storytelling</option>
          </select>
        </label>
        <label>
          Caption style
          <select
            aria-label="Caption style"
            value={value.caption_style}
            onChange={(e) =>
              patch({
                caption_style: e.target.value as VideoSettings["caption_style"],
              })
            }
          >
            <option value="outline">Bold outline</option>
            <option value="box">Dark caption box</option>
            <option value="punchy">Punchy · accent last word</option>
          </select>
        </label>
        <label>
          Caption size · {value.caption_font_size}px
          <input
            type="range"
            min="32"
            max="100"
            value={value.caption_font_size}
            onChange={(e) => patch({ caption_font_size: +e.target.value })}
          />
        </label>
        <label>
          Caption position
          <select
            value={value.caption_position}
            onChange={(e) =>
              patch({
                caption_position: e.target
                  .value as VideoSettings["caption_position"],
              })
            }
          >
            <option value="bottom">Lower safe area</option>
            <option value="middle">Center</option>
            <option value="top">Upper safe area</option>
          </select>
        </label>
        <label>
          Caption color
          <input
            type="color"
            value={value.caption_color}
            onChange={(e) => patch({ caption_color: e.target.value })}
          />
        </label>
        <label>
          Accent color
          <input
            type="color"
            value={value.caption_accent}
            onChange={(e) => patch({ caption_accent: e.target.value })}
          />
        </label>
        <label>
          Logo position
          <select
            value={value.logo_position}
            onChange={(e) =>
              patch({
                logo_position: e.target.value as VideoSettings["logo_position"],
              })
            }
          >
            {(
              ["top_left", "top_right", "bottom_left", "bottom_right"] as const
            ).map((p) => (
              <option key={p} value={p}>
                {p.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Logo width · {value.logo_width}px
          <input
            type="range"
            min="80"
            max="360"
            step="10"
            value={value.logo_width}
            onChange={(e) => patch({ logo_width: +e.target.value })}
          />
        </label>
      </div>
      <h4>Automatic audio balancing</h4>
      <div className="form-grid">
        <label className="checkbox span-2">
          <input
            type="checkbox"
            checked={value.normalize_voice}
            onChange={(e) => patch({ normalize_voice: e.target.checked })}
          />
          Normalize narration loudness
        </label>
        <label>
          Narration volume · {Math.round(value.voice_volume * 100)}%
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={value.voice_volume}
            onChange={(e) => patch({ voice_volume: +e.target.value })}
          />
        </label>
        <label>
          Sound effects volume · {Math.round(value.sfx_volume * 100)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={value.sfx_volume}
            onChange={(e) => patch({ sfx_volume: +e.target.value })}
          />
        </label>
        <label>
          Music volume · {Math.round(value.music_volume * 100)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={value.music_volume}
            onChange={(e) => patch({ music_volume: +e.target.value })}
          />
        </label>
        <label className="checkbox span-2">
          <input
            type="checkbox"
            checked={value.duck_audio}
            onChange={(e) => patch({ duck_audio: e.target.checked })}
          />
          Lower music and effects automatically during speech
        </label>
      </div>
    </div>
  );
}
