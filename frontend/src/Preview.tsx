import { useEffect, useRef, useState } from "react";
import { Maximize, Pause, Play, RotateCcw, ScanLine } from "lucide-react";
import type { Project, Scene } from "./types";
import { timecode, timelineSeconds } from "./utils";
import { blendFrames, cameraStyle, transitionStyles } from "./effects";

export default function Preview({
  scenes,
  project,
  request,
}: {
  scenes: Scene[];
  project: Project;
  request?: { index?: number; seconds?: number; nonce: number } | null;
}) {
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [audioError, setAudioError] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const duration = timelineSeconds(scenes, project.settings.fps);
  useEffect(() => {
    setPlaying(false);
    setCursor(0);
    audio.current?.pause();
  }, [duration, project.narration_url]);
  useEffect(() => {
    if (!request) return;
    const seconds =
      request.seconds ??
      timelineSeconds(
        scenes.slice(0, request.index ?? 0),
        project.settings.fps,
      );
    setCursor(seconds);
    setPlaying(false);
    audio.current?.pause();
    // A request targets the currently edited scene without resetting playback on other edits.
  }, [request]);
  useEffect(() => {
    if (!playing) return;
    const started = performance.now(),
      initial = cursor;
    let frame = 0;
    function tick(now: number) {
      const next = initial + (now - started) / 1000;
      if (
        next >=
        (project.settings.narration_end ??
          project.narration_duration ??
          duration) -
          project.settings.narration_start
      )
        audio.current?.pause();
      if (next >= duration) {
        setCursor(0);
        setPlaying(false);
        audio.current?.pause();
        return;
      }
      setCursor(next);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Cursor changes every animation frame; capture its value only when playback starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);
  useEffect(
    () => () => {
      audio.current?.pause();
    },
    [],
  );
  let offset = 0;
  const current = scenes.find((scene) => {
    const length =
      Math.round(scene.duration * project.settings.fps) / project.settings.fps;
    if (cursor < offset + length) return true;
    offset += length;
    return false;
  });
  const index = current ? scenes.indexOf(current) : -1;
  const previous = index > 0 ? scenes[index - 1] : undefined;
  const elapsed = cursor - offset;
  const progress = current
    ? Math.min(
        1,
        elapsed /
          Math.max(
            1 / project.settings.fps,
            Math.round(current.duration * project.settings.fps) /
              project.settings.fps -
              1 / project.settings.fps,
          ),
      )
    : 0;
  const effect = current?.transition ?? project.settings.transition;
  const frames = current ? blendFrames(current, previous, project.settings) : 0;
  const blending = Boolean(
    previous && frames && elapsed * project.settings.fps < frames,
  );
  const layers = transitionStyles(
    effect,
    frames ? (elapsed * project.settings.fps) / frames : 1,
  );
  async function toggle() {
    if (playing) {
      setPlaying(false);
      audio.current?.pause();
      return;
    }
    if (
      audio.current &&
      cursor + project.settings.narration_start <
        (project.settings.narration_end ?? project.narration_duration ?? 0)
    ) {
      audio.current.currentTime = cursor + project.settings.narration_start;
      try {
        await audio.current.play();
        setAudioError(false);
      } catch {
        setAudioError(true);
      }
    }
    setPlaying(true);
  }
  return (
    <section className="preview-section">
      <div className="section-heading">
        <h3>
          <ScanLine size={15} /> Stage preview
        </h3>
        <span className="mini-tag">9:16</span>
      </div>
      <div className="phone-frame">
        <div
          className="preview-screen"
          style={{
            background:
              blending && effect === "dip_white" ? "white" : "#03090f",
          }}
        >
          {current ? (
            <>
              {blending && previous && (
                <div
                  className="preview-layer"
                  style={layers.previous}
                  aria-hidden="true"
                >
                  <img
                    src={previous.panel.image_url}
                    alt=""
                    style={cameraStyle(previous, 1)}
                  />
                </div>
              )}
              <div
                className="preview-layer"
                style={blending ? layers.current : undefined}
              >
                <img
                  src={current.panel.image_url}
                  alt={current.panel.title}
                  style={cameraStyle(current, progress)}
                />
              </div>
              {project.logo_url && (
                <img
                  className={`preview-brand-logo ${project.settings.logo_position}`}
                  src={project.logo_url}
                  alt="Brand logo"
                  style={{
                    width: `${(project.settings.logo_width / 1080) * 100}%`,
                    maxHeight: `${(project.settings.logo_width / 1920) * 100}%`,
                  }}
                />
              )}
              {project.settings.captions &&
                (() => {
                  const cue = project.caption_cues?.find(
                    (cue) =>
                      cue.start <= cursor + project.settings.narration_start &&
                      cue.end > cursor + project.settings.narration_start,
                  );
                  const text = project.caption_cues?.length
                    ? (cue?.text ?? "")
                    : current.caption;
                  const words = text.split(" ");
                  return text ? (
                    <div
                      className={`preview-caption ${project.settings.caption_position} ${project.settings.caption_style}`}
                      style={{
                        color: project.settings.caption_color,
                        fontSize: `${(project.settings.caption_font_size / 62) * 0.8}em`,
                      }}
                    >
                      {project.settings.caption_style === "punchy" ? (
                        <>
                          {words.slice(0, -1).join(" ")}{" "}
                          <span
                            style={{ color: project.settings.caption_accent }}
                          >
                            {words.at(-1)}
                          </span>
                        </>
                      ) : (
                        text
                      )}
                    </div>
                  ) : null;
                })()}
            </>
          ) : (
            <div className="preview-placeholder">
              <Maximize size={32} />
              <span>
                Your next beatdown
                <br />
                starts with a panel.
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="preview-controls">
        <button
          className="icon-button"
          aria-label={playing ? "Pause preview" : "Play preview"}
          disabled={!scenes.length}
          onClick={() => void toggle()}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <input
          aria-label="Preview position"
          type="range"
          min="0"
          max={duration || 1}
          step="0.05"
          value={cursor}
          onChange={(e) => {
            setCursor(Number(e.target.value));
            setPlaying(false);
            audio.current?.pause();
          }}
        />
        <span>{timecode(cursor)}</span>
        <button
          className="icon-button"
          aria-label="Restart preview"
          onClick={() => {
            setCursor(0);
            setPlaying(false);
            audio.current?.pause();
          }}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      {project.narration_url && (
        <audio ref={audio} src={project.narration_url} preload="metadata" />
      )}
      {audioError && (
        <p className="inline-error">
          Narration could not play in this browser.
        </p>
      )}
      <p className="help center">
        Motion, framing & transition preview. Export to review the final caption
        layout and sound mix.
      </p>
      <div className="spec-line">
        <span>1080 × 1920</span>
        <span>{project.settings.fps} FPS</span>
        <span>H.264 / MP4</span>
      </div>
    </section>
  );
}
