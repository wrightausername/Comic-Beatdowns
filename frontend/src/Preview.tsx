import { useEffect, useRef, useState } from "react";
import { Maximize, Pause, Play, RotateCcw, ScanLine } from "lucide-react";
import type { Project, Scene } from "./types";
import { timecode, timelineSeconds } from "./utils";

export default function Preview({
  scenes,
  project,
}: {
  scenes: Scene[];
  project: Project;
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
    if (!playing) return;
    const started = performance.now(),
      initial = cursor;
    let frame = 0;
    function tick(now: number) {
      const next = initial + (now - started) / 1000;
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
  const progress = current
    ? Math.max(0, Math.min(1, (cursor - offset) / current.duration))
    : 0;
  const zoom =
    current?.motion === "zoom_in"
      ? 1 + 0.1 * progress
      : current?.motion === "zoom_out"
        ? 1.1 - 0.1 * progress
        : current?.motion.startsWith("pan")
          ? 1.1
          : 1;
  const pan =
    current?.motion === "pan_left"
      ? 5 - 10 * progress
      : current?.motion === "pan_right"
        ? -5 + 10 * progress
        : 0;
  const elapsed = cursor - offset;
  const fade =
    current && project.settings.transition === "fade"
      ? Math.min(1, elapsed / 0.15, (current.duration - elapsed) / 0.15)
      : 1;
  async function toggle() {
    if (playing) {
      setPlaying(false);
      audio.current?.pause();
      return;
    }
    if (audio.current && cursor < (project.narration_duration ?? 0)) {
      audio.current.currentTime = cursor;
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
        <div className="preview-screen">
          {current ? (
            <>
              <img
                src={current.panel.image_url}
                alt={current.panel.title}
                style={{
                  opacity: fade,
                  transform: `scale(${zoom}) translateX(${pan}%)`,
                }}
              />
              {project.settings.captions && (
                <div className="preview-caption">{current.caption}</div>
              )}
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
        Motion + narration preview. Export to review the final captions, fades,
        and sound mix.
      </p>
      <div className="spec-line">
        <span>1080 × 1920</span>
        <span>{project.settings.fps} FPS</span>
        <span>H.264 / MP4</span>
      </div>
    </section>
  );
}
