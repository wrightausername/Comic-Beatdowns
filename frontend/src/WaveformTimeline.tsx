import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Scene, Waveform } from "./types";
import { errorMessage, timelineSeconds } from "./utils";

export default function WaveformTimeline({
  projectId,
  audioUrl,
  scenes,
  fps,
  start,
  onChange,
  onSeek,
}: {
  projectId: string;
  audioUrl: string | null;
  scenes: Scene[];
  fps: number;
  start: number;
  onChange: (scenes: Scene[]) => void;
  onSeek: (seconds: number) => void;
}) {
  const [wave, setWave] = useState<Waveform | null>(null),
    [error, setError] = useState("");
  const [moving, setMoving] = useState<{
    index: number;
    scenes: Scene[];
  } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const displayed = moving?.scenes ?? scenes;
  const duration = timelineSeconds(scenes, fps);
  useEffect(() => {
    let alive = true;
    setWave(null);
    setError("");
    if (audioUrl)
      api<Waveform>(`/projects/${projectId}/waveform`)
        .then((value) => {
          if (alive) setWave(value);
        })
        .catch((e) => {
          if (alive) setError(errorMessage(e));
        });
    return () => {
      alive = false;
    };
  }, [projectId, audioUrl]);
  let cursor = 0;
  const boundaries = displayed.slice(0, -1).map((scene) => {
    cursor += Math.round(scene.duration * fps) / fps;
    return cursor;
  });
  if (!audioUrl || !scenes.length) return null;
  function move(clientX: number) {
    if (!moving || !svg.current || !duration) return;
    const rect = svg.current.getBoundingClientRect();
    const position = Math.round(
      ((clientX - rect.left) / rect.width) * duration * fps,
    );
    const before = moving.scenes
      .slice(0, moving.index)
      .reduce((sum, scene) => sum + Math.round(scene.duration * fps), 0);
    const left = Math.round(moving.scenes[moving.index].duration * fps),
      right = Math.round(moving.scenes[moving.index + 1].duration * fps);
    const minimum = Math.ceil(0.25 * fps),
      maximum = 30 * fps;
    const nextLeft = Math.max(
      minimum,
      left + right - maximum,
      Math.min(maximum, left + right - minimum, position - before),
    );
    setMoving({
      ...moving,
      scenes: moving.scenes.map((scene, i) =>
        i === moving.index
          ? { ...scene, duration: nextLeft / fps }
          : i === moving.index + 1
            ? { ...scene, duration: (left + right - nextLeft) / fps }
            : scene,
      ),
    });
  }
  return (
    <div className="waveform-section">
      <div className="section-heading">
        <h4>Narration timing</h4>
        <small>Click to seek · drag cuts or use arrow keys</small>
      </div>
      {error && <p className="inline-error">{error}</p>}
      <svg
        ref={svg}
        className="waveform-svg"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        role="group"
        aria-label="Narration waveform and scene cuts"
        onPointerDown={(e) => {
          if ((e.target as SVGElement).dataset.cut !== undefined) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek(
            Math.max(
              0,
              Math.min(
                duration,
                ((e.clientX - rect.left) / rect.width) * duration,
              ),
            ),
          );
        }}
        onPointerMove={(e) => move(e.clientX)}
        onPointerUp={() => {
          if (moving) {
            onChange(moving.scenes);
            setMoving(null);
          }
        }}
        onPointerCancel={() => setMoving(null)}
      >
        <rect width="1000" height="100" fill="#09131e" />
        {Array.from({ length: 500 }, (_, i) => {
          const time = start + (i / 500) * duration;
          const amplitude =
            wave && time < wave.duration
              ? (wave.peaks[
                  Math.min(
                    wave.peaks.length - 1,
                    Math.floor((time / wave.duration) * wave.peaks.length),
                  )
                ] ?? 0)
              : 0;
          const height = Math.max(1, amplitude * 84);
          return (
            <rect
              key={i}
              x={i * 2}
              y={50 - height / 2}
              width="1.5"
              height={height}
              fill="#3d9da7"
            />
          );
        })}
        {boundaries.map((time, index) => (
          <g
            key={displayed[index].id}
            data-cut={index}
            tabIndex={0}
            role="slider"
            aria-label={`Cut after scene ${index + 1}`}
            aria-valuenow={+time.toFixed(2)}
            aria-valuemin={0}
            aria-valuemax={duration}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              setMoving({ index, scenes });
            }}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
              e.preventDefault();
              const delta =
                ((e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 5 : 1)) /
                fps;
              const a = scenes[index].duration + delta,
                b = scenes[index + 1].duration - delta;
              if (Math.min(a, b) >= 0.25 && Math.max(a, b) <= 30)
                onChange(
                  scenes.map((scene, i) =>
                    i === index
                      ? { ...scene, duration: a }
                      : i === index + 1
                        ? { ...scene, duration: b }
                        : scene,
                  ),
                );
            }}
          >
            <rect
              data-cut={index}
              x={(time / duration) * 1000 - 7}
              y="0"
              width="14"
              height="100"
              fill="transparent"
            />
            <line
              data-cut={index}
              x1={(time / duration) * 1000}
              x2={(time / duration) * 1000}
              y1="3"
              y2="97"
              stroke="#5df5e8"
              strokeWidth="2"
            />
            <circle
              data-cut={index}
              cx={(time / duration) * 1000}
              cy="8"
              r="5"
              fill="#5df5e8"
            />
          </g>
        ))}
      </svg>
      <div className="waveform-ruler">
        <span>0:00</span>
        <span>{duration.toFixed(2)} seconds</span>
      </div>
      <p className="help">
        Moving a cut changes the two neighboring scenes and keeps the total
        duration intact.
      </p>
    </div>
  );
}
