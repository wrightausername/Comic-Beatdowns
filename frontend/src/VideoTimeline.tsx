import { useState, type CSSProperties } from "react";
import type { Project, Scene, SoundEffect } from "./types";
import { CAMERA_MOVES, TRANSITIONS } from "./effects";
import { splitScene } from "./editing";
import { timelineSeconds, timecode } from "./utils";
import WaveformTimeline from "./WaveformTimeline";

export default function VideoTimeline({
  project,
  scenes,
  effects,
  cursor,
  disabled,
  onChange,
  onSeek,
}: {
  project: Project;
  scenes: Scene[];
  effects: SoundEffect[];
  cursor: number;
  disabled: boolean;
  onChange: (scenes: Scene[]) => void;
  onSeek: (seconds: number) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [zoom, setZoom] = useState(48);
  const index = Math.max(
    0,
    scenes.findIndex((s) => s.id === selectedId),
  );
  const selected = scenes[index];
  const fps = project.settings.fps;
  const duration = timelineSeconds(scenes, fps);
  let next = 0;
  const clips = scenes.map((scene, i) => {
    const start = next;
    next += Math.round(scene.duration * fps) / fps;
    return { scene, index: i, start, end: next };
  });
  const position = (start: number, end: number): CSSProperties => ({
    left: `${(Math.max(0, start) / duration) * 100}%`,
    width: `${(Math.max(0, Math.min(duration, end) - Math.max(0, start)) / duration) * 100}%`,
  });
  function choose(i: number) {
    setSelectedId(scenes[i].id);
    onSeek(clips[i].start);
  }
  function patch(value: Partial<Scene>) {
    onChange(scenes.map((s, i) => (i === index ? { ...s, ...value } : s)));
  }
  function move(to: number) {
    if (
      to < 0 ||
      to >= scenes.length ||
      scenes
        .slice(Math.min(index, to), Math.max(index, to) + 1)
        .some((s) => s.locked)
    )
      return;
    const result = [...scenes];
    result.splice(index, 1);
    result.splice(to, 0, selected);
    onChange(result);
  }
  const captionClips = project.caption_cues.length
    ? project.caption_cues.map((c) => ({
        start: c.start - project.settings.narration_start,
        end: c.end - project.settings.narration_start,
        text: c.text,
      }))
    : clips
        .filter((c) => c.scene.caption)
        .map((c) => ({ start: c.start, end: c.end, text: c.scene.caption }));
  return (
    <section
      className="surface video-timeline"
      aria-label="Video edit timeline"
    >
      <div className="section-heading">
        <div>
          <h3>Video timeline</h3>
          <p>
            The current edit, including the cuts Verdict creates. Changes here
            save with your project and appear in renders.
          </p>
        </div>
        <label>
          Timeline zoom
          <input
            aria-label="Timeline zoom"
            type="range"
            min="20"
            max="160"
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
        </label>
      </div>
      {!scenes.length ? (
        <p>
          Add panels and narration, then generate a preview. Verdict’s shots
          will appear here automatically.
        </p>
      ) : (
        <>
          <label className="timeline-seek">
            Playhead · {timecode(cursor)} / {timecode(duration)}
            <input
              aria-label="Video timeline playhead"
              type="range"
              min="0"
              max={duration}
              step={1 / fps}
              value={Math.min(cursor, duration)}
              onChange={(e) => onSeek(+e.target.value)}
            />
          </label>
          <div
            className="video-timeline-scroll"
            tabIndex={0}
            aria-label="Scrollable video tracks"
          >
            <div
              className="video-tracks"
              style={{ width: Math.max(700, duration * zoom) }}
            >
              <div className="video-ruler">
                {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => (
                  <span key={i} style={{ left: `${(i / duration) * 100}%` }}>
                    {timecode(i)}
                  </span>
                ))}
              </div>
              <div
                className="video-track video-panel-track"
                aria-label="Video panels track"
              >
                <span className="track-name">VIDEO</span>
                {clips.map((c) => (
                  <button
                    key={c.scene.id}
                    type="button"
                    aria-label={`Timeline shot ${c.index + 1}: ${c.scene.panel.title}`}
                    aria-pressed={c.index === index}
                    className="video-clip"
                    style={position(c.start, c.end)}
                    onClick={() => choose(c.index)}
                  >
                    <img src={c.scene.panel.thumbnail_url} alt="" />
                    <span>
                      {c.index + 1} · {c.scene.panel.title}
                      {c.scene.locked ? " · Locked" : ""}
                    </span>
                    <small>{(c.end - c.start).toFixed(2)}s</small>
                  </button>
                ))}
              </div>
              <div
                className="video-track"
                aria-label="Camera and transitions track"
              >
                <span className="track-name">CAMERA / CUTS</span>
                {clips.map((c) => (
                  <button
                    key={c.scene.id}
                    className="timeline-block camera-block"
                    style={position(c.start, c.end)}
                    onClick={() => choose(c.index)}
                    title={`${c.scene.motion}; ${c.scene.transition ?? project.settings.transition}`}
                  >
                    <span>{c.scene.motion.replaceAll("_", " ")}</span>
                    <small>
                      {(
                        c.scene.transition ?? project.settings.transition
                      ).replaceAll("_", " ")}
                    </small>
                  </button>
                ))}
              </div>
              <div className="video-track" aria-label="Captions track">
                <span className="track-name">
                  CAPTIONS{!project.settings.captions ? " · OFF" : ""}
                </span>
                {project.settings.captions &&
                  captionClips
                    .filter((c) => c.end > 0 && c.start < duration)
                    .map((c, i) => (
                      <button
                        key={i}
                        className="timeline-block caption-block"
                        style={position(c.start, c.end)}
                        title={c.text}
                        onClick={() => onSeek(Math.max(0, c.start))}
                      >
                        {c.text}
                      </button>
                    ))}
              </div>
              <div className="video-track" aria-label="Narration track">
                <span className="track-name">NARRATION</span>
                {project.narration_url && (
                  <button
                    className="timeline-block narration-block"
                    style={position(
                      0,
                      Math.max(
                        0,
                        Math.min(
                          project.settings.narration_end ??
                            project.narration_duration ??
                            0,
                          project.narration_duration ?? 0,
                        ) - project.settings.narration_start,
                      ),
                    )}
                    onClick={() => onSeek(0)}
                  >
                    ElevenLabs / imported recording · source{" "}
                    {timecode(project.settings.narration_start)}
                  </button>
                )}
              </div>
              <div className="video-track" aria-label="Sound effects track">
                <span className="track-name">SOUND EFFECTS</span>
                {clips
                  .filter((c) => c.scene.sfx_url || c.scene.sfx_id)
                  .map((c) => {
                    const sound = effects.find((e) => e.id === c.scene.sfx_id);
                    const start = c.start + (c.scene.sfx_offset ?? 0);
                    return (
                      start < c.end && (
                        <button
                          key={c.scene.id}
                          className="timeline-block sfx-block"
                          style={position(
                            start,
                            Math.min(c.end, start + (sound?.duration ?? 0.02)),
                          )}
                          onClick={() => choose(c.index)}
                          title={
                            sound?.name ??
                            "Scene sound effect · duration unavailable"
                          }
                        >
                          {sound?.name ?? "SFX"}
                        </button>
                      )
                    );
                  })}
              </div>
              <div className="video-track" aria-label="Music track">
                <span className="track-name">MUSIC</span>
                {project.music_url && (
                  <button
                    className="timeline-block music-block"
                    style={position(0, duration)}
                    onClick={() => onSeek(0)}
                  >
                    Music · looped to video length
                  </button>
                )}
              </div>
              <div
                className="video-playhead"
                style={{
                  left: `${(Math.min(cursor, duration) / duration) * 100}%`,
                }}
              />
            </div>
          </div>
          <fieldset
            className="timeline-shot-controls"
            disabled={disabled || selected.locked}
          >
            <legend>
              Shot {index + 1} · {clips[index].start.toFixed(2)}–
              {clips[index].end.toFixed(2)}s{selected.locked ? " · Locked" : ""}
            </legend>
            <label>
              Camera
              <select
                aria-label="Timeline shot camera"
                value={selected.motion}
                onChange={(e) =>
                  patch({ motion: e.target.value as Scene["motion"] })
                }
              >
                {CAMERA_MOVES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Transition
              <select
                aria-label="Timeline shot transition"
                value={selected.transition ?? "inherit"}
                onChange={(e) =>
                  patch({
                    transition:
                      e.target.value === "inherit"
                        ? null
                        : (e.target.value as Scene["transition"]),
                  })
                }
              >
                <option value="inherit">Project default</option>
                {TRANSITIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button secondary small-button"
              disabled={index === 0 || scenes[index - 1]?.locked}
              onClick={() => move(index - 1)}
            >
              Move shot earlier
            </button>
            <button
              type="button"
              className="button secondary small-button"
              disabled={
                index === scenes.length - 1 || scenes[index + 1]?.locked
              }
              onClick={() => move(index + 1)}
            >
              Move shot later
            </button>
            <button
              type="button"
              className="button secondary small-button"
              disabled={
                cursor - clips[index].start < 0.25 ||
                clips[index].end - cursor < 0.25
              }
              onClick={() =>
                onChange(
                  splitScene(scenes, index, fps, cursor - clips[index].start),
                )
              }
            >
              Split shot at playhead
            </button>
          </fieldset>
          <p className="help">
            Select a shot to change its camera or transition, move it, or split
            it at the playhead. Locked shots stay protected. Narration and
            captions retain their timing when shots move. Browser playback
            approximates the edit; render a preview to hear the complete audio
            mix.
          </p>
          {!disabled && (
            <WaveformTimeline
              projectId={project.id}
              audioUrl={project.narration_url}
              scenes={scenes}
              fps={fps}
              start={project.settings.narration_start}
              cues={project.caption_cues}
              onChange={onChange}
              onSeek={onSeek}
            />
          )}
        </>
      )}
    </section>
  );
}
