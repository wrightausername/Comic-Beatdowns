import { useEffect, useRef, useState } from "react";
import { Maximize, Pause, Play, RotateCcw, ScanLine } from "lucide-react";
import type { Project, Scene } from "./types";
import { timecode, timelineSeconds } from "./utils";
import { blendFrames, cameraStyle, transitionStyles } from "./effects";

export default function Preview({
  scenes,
  project,
  request,
  onFocus,
  onMoment,
  rememberPosition = true,
}: {
  scenes: Scene[];
  project: Project;
  request?: { index?: number; seconds?: number; nonce: number } | null;
  onFocus?: (id: string, patch: Partial<Scene>) => void;
  onMoment?: (seconds: number) => void;
  rememberPosition?: boolean;
}) {
  const [safeAreas, setSafeAreas] = useState(false),
    [loopCheck, setLoopCheck] = useState(false),
    [aim, setAim] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [audioError, setAudioError] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const duration = timelineSeconds(scenes, project.settings.fps);
  const latestPosition = useRef(0);
  latestPosition.current = cursor;
  const resumeKey = `comic-beatdowns:playhead:${project.id}`;
  useEffect(() => {
    setPlaying(false);
    setLoopCheck(false);
    setCursor((value) =>
      Math.max(0, Math.min(value, duration - 1 / project.settings.fps)),
    );
    audio.current?.pause();
  }, [duration, project.narration_url]);
  useEffect(() => {
    if (!rememberPosition) return;
    try {
      const saved = JSON.parse(localStorage.getItem(resumeKey) || "null");
      if (saved?.audio === project.narration_url)
        setCursor(
          Math.max(
            0,
            Math.min(duration - 1 / project.settings.fps, saved.time || 0),
          ),
        );
    } catch {
      /* Playback remains available. */
    }
  }, [project.id, rememberPosition]);
  useEffect(() => {
    if (!rememberPosition || playing) return;
    try {
      localStorage.setItem(
        resumeKey,
        JSON.stringify({ audio: project.narration_url, time: cursor }),
      );
    } catch {
      /* Browser storage is optional. */
    }
  }, [cursor, playing, rememberPosition, resumeKey, project.narration_url]);
  useEffect(
    () => () => {
      if (rememberPosition) {
        try {
          localStorage.setItem(
            resumeKey,
            JSON.stringify({
              audio: project.narration_url,
              time: latestPosition.current,
            }),
          );
        } catch {
          /* Browser storage is optional. */
        }
      }
    },
    [resumeKey, rememberPosition, project.narration_url],
  );
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
    let started = performance.now(),
      initial = cursor;
    let frame = 0;
    function tick(now: number) {
      let next = initial + (now - started) / 1000;
      if (loopCheck && duration > 6 && next >= 3 && next < duration - 3) {
        next = duration - 3;
        initial = next;
        started = now;
        if (audio.current) {
          audio.current.currentTime = next + project.settings.narration_start;
          void audio.current.play().catch(() => setAudioError(true));
        }
      }
      if (
        next >=
        (project.settings.narration_end ??
          project.narration_duration ??
          duration) -
          project.settings.narration_start
      )
        audio.current?.pause();
      if (next >= duration && loopCheck) {
        initial = 0;
        started = now;
        next = 0;
        if (audio.current) {
          audio.current.currentTime = project.settings.narration_start;
          void audio.current.play().catch(() => setAudioError(true));
        }
      }
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
  }, [playing, duration, loopCheck]);
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
      <div className="preview-tools">
        <button
          aria-pressed={safeAreas}
          onClick={() => setSafeAreas(!safeAreas)}
        >
          Safe areas
        </button>
        <button
          aria-pressed={loopCheck}
          disabled={!scenes.length}
          onClick={() => {
            if (loopCheck) {
              setLoopCheck(false);
              setPlaying(false);
              audio.current?.pause();
              return;
            }
            const start = Math.max(0, duration - 3);
            setCursor(start);
            setPlaying(false);
            setLoopCheck(true);
            if (audio.current) {
              audio.current.currentTime =
                start + project.settings.narration_start;
              void audio.current.play().catch(() => setAudioError(true));
            }
            requestAnimationFrame(() => setPlaying(true));
          }}
        >
          Check Loop
        </button>
        {onFocus && (
          <button
            aria-pressed={aim}
            onClick={() => {
              setAim(!aim);
              setPlaying(false);
              audio.current?.pause();
            }}
          >
            Aim in preview
          </button>
        )}
      </div>
      <div className="phone-frame">
        <div
          className={`preview-screen ${aim ? "aiming" : ""}`}
          onClick={(e) => {
            if (!aim || !current?.id || current.locked) return;
            const rect = e.currentTarget.getBoundingClientRect(),
              ratio = current.panel.width / current.panel.height,
              view = 9 / 16;
            const cropX = Math.min(1, view / ratio),
              cropY = Math.min(1, ratio / view);
            const x =
              (1 - cropX) * current.focus_x +
              ((e.clientX - rect.left) / rect.width) * cropX;
            const y =
              (1 - cropY) * current.focus_y +
              ((e.clientY - rect.top) / rect.height) * cropY;
            onFocus?.(current.id, {
              focus_x:
                cropX === 1
                  ? 0.5
                  : Math.max(0, Math.min(1, (x - cropX / 2) / (1 - cropX))),
              focus_y:
                cropY === 1
                  ? 0.5
                  : Math.max(0, Math.min(1, (y - cropY / 2) / (1 - cropY))),
            });
          }}
          style={{
            background:
              blending && effect === "dip_white" ? "white" : "#03090f",
          }}
        >
          {safeAreas && (
            <div
              className="safe-area-overlay"
              aria-label="Approximate Shorts safe areas"
            >
              <span className="safe-top">Top overlay</span>
              <span className="safe-right">Platform buttons</span>
              <span className="safe-bottom">Title & platform captions</span>
            </div>
          )}
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
                    style={{
                      ...cameraStyle(previous, 1),
                      objectFit:
                        previous.framing === "fit" ? "contain" : "cover",
                    }}
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
                  style={{
                    ...cameraStyle(current, progress),
                    objectFit: current.framing === "fit" ? "contain" : "cover",
                  }}
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
      {onMoment && (
        <button
          className="text-button"
          onClick={() => {
            setPlaying(false);
            audio.current?.pause();
            onMoment(cursor);
          }}
        >
          Note this moment · {cursor.toFixed(2)}s
        </button>
      )}
      {loopCheck && (
        <p className="help">
          Repeating the final 3 seconds into the opening 3 seconds.
        </p>
      )}
      {safeAreas && (
        <p className="help">
          Approximate guides; platform overlays vary. Guides are not exported.
        </p>
      )}
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
