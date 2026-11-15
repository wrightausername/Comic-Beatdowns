import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  Copy,
  Trash2,
  Scissors,
  Lock,
  Unlock,
  Play,
  Pause,
  Undo2,
  Redo2,
  Maximize2,
  Magnet,
} from "lucide-react";
import type { StudioDraft } from "./useStudioDraft";
import {
  moveTimelineShot,
  trimTimelineShot,
  duplicateTimelineShot,
  deleteTimelineShots,
  snapTimelineTime,
} from "./timelineOperations";
import { api } from "./api";
import type { Waveform, Project, Scene, SoundEffect } from "./types";
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
  onProjectChange,
  onTogglePlay,
  playing = false,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: {
  project: Project;
  scenes: Scene[];
  effects: SoundEffect[];
  cursor: number;
  disabled: boolean;
  onChange: (scenes: Scene[]) => void;
  onSeek: (seconds: number) => void;
  onProjectChange?: (patch: Partial<StudioDraft>) => void;
  onTogglePlay?: () => void;
  playing?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [zoom, setZoom] = useState(48);
  const [fit, setFit] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [wave, setWave] = useState<Waveform | null>(null);
  useEffect(() => {
    let alive = true;
    setWave(null);
    if (project.narration_url)
      api<Waveform>(`/projects/${project.id}/waveform`)
        .then((value) => {
          if (alive) setWave(value);
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [project.id, project.narration_url]);
  const [snap, setSnap] = useState(true);
  const [keepLength, setKeepLength] = useState(true);
  const [multi, setMulti] = useState<Set<string>>(new Set());
  const [inspector, setInspector] = useState<"shot" | "caption" | "audio">(
    "shot",
  );
  const [captionIndex, setCaptionIndex] = useState(0);
  useEffect(
    () =>
      setCaptionIndex((i) =>
        Math.min(i, Math.max(0, project.caption_cues.length - 1)),
      ),
    [project.caption_cues.length],
  );
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const draggedIndex = useRef<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const tracks = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scroll.current;
    if (!element || !playing || fit) return;
    const x = cursor * zoom;
    if (
      x > element.scrollLeft + element.clientWidth * 0.85 ||
      x < element.scrollLeft
    )
      element.scrollLeft = Math.max(0, x - element.clientWidth * 0.25);
  }, [cursor, playing, fit, zoom]);
  const [trimmed, setTrimmed] = useState<Scene[] | null>(null);
  const gesture = useRef<{
    index: number;
    edge: "left" | "right" | "sfx";
    x: number;
    pixels: number;
    base: Scene[];
  } | null>(null);
  const previewTrim = useRef<Scene[] | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    gesture.current = null;
    previewTrim.current = null;
    setTrimmed(null);
  }, [scenes]);
  const displayed = trimmed ?? scenes;
  const index = Math.max(
    0,
    scenes.findIndex((s) => s.id === selectedId),
  );
  const selected = scenes[index];
  const fps = project.settings.fps;
  const duration = timelineSeconds(displayed, fps);
  let next = 0;
  const clips = displayed.map((scene, i) => {
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
    setMulti(new Set([scenes[i].id!]));
    setInspector("shot");
    onSeek(clips[i].start);
  }
  function patch(value: Partial<Scene>) {
    onChange(scenes.map((s, i) => (i === index ? { ...s, ...value } : s)));
  }
  function move(to: number) {
    if (!disabled) onChange(moveTimelineShot(scenes, index, to));
  }
  const selection = multi.size
    ? multi
    : new Set(selected ? [selected.id!] : []);
  const allSelectedLocked = scenes
    .filter((s) => selection.has(s.id!))
    .every((s) => s.locked);
  function removeSelected() {
    if (disabled) return;
    const result = deleteTimelineShots(scenes, selection);
    if (result === scenes)
      setMessage(
        "Unlock affected shots first. Removing video would shift a locked shot.",
      );
    else {
      onChange(result);
      setMulti(new Set());
      setMessage(
        "Shots removed. Narration and timed captions stay in place; review the new video length.",
      );
    }
  }
  function duplicate() {
    if (disabled) return;
    const result = duplicateTimelineShot(scenes, index);
    if (result === scenes)
      setMessage(
        "Check locked shots and the 180-second video limit before duplicating.",
      );
    else {
      onChange(result);
      setMessage(
        "Shot duplicated. Narration and timed captions stay in place.",
      );
    }
  }
  const canSplit =
    selected &&
    !selected.locked &&
    cursor - clips[index].start >= 0.25 &&
    clips[index].end - cursor >= 0.25;
  function split() {
    if (!disabled && canSplit)
      onChange(splitScene(scenes, index, fps, cursor - clips[index].start));
  }
  function toggleLocks() {
    if (disabled) return;
    const locked = !scenes
      .filter((s) => selection.has(s.id!))
      .every((s) => s.locked);
    onChange(scenes.map((s) => (selection.has(s.id!) ? { ...s, locked } : s)));
  }
  function keyboard(e: KeyboardEvent<HTMLElement>) {
    if (
      (e.target as HTMLElement).closest(
        "input,select,textarea,button,[role=tab],[role=slider],[contenteditable=true]",
      )
    )
      return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
      } else if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        setMulti(new Set(scenes.map((s) => s.id!)));
      }
      return; // existing workspace Undo/Redo stays global
    }
    if (e.altKey) return;
    if (e.key === " ") {
      e.preventDefault();
      onTogglePlay?.();
    } else if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      split();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
    } else if (e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicate();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(
        Math.max(
          0,
          Math.min(
            duration,
            cursor +
              ((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1)) / fps,
          ),
        ),
      );
    } else if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      setFit(false);
      setZoom((z) => Math.min(240, z * 1.25));
    } else if (e.key === "-") {
      e.preventDefault();
      setFit(false);
      setZoom((z) => Math.max(10, z / 1.25));
    }
  }
  function timelineTime(clientX: number) {
    const rect = tracks.current!.getBoundingClientRect();
    const value = ((clientX - rect.left) / rect.width) * duration;
    const targets = [
      0,
      duration,
      cursor,
      ...clips.flatMap((c) => [c.start, c.end]),
      ...project.caption_cues.flatMap((c) => [
        c.start - project.settings.narration_start,
        c.end - project.settings.narration_start,
      ]),
    ];
    return Math.max(
      0,
      Math.min(
        duration,
        snapTimelineTime(
          value,
          snap ? targets : [],
          (10 / rect.width) * duration,
          fps,
        ),
      ),
    );
  }
  function edgeDisabled(i: number, edge: "left" | "right") {
    const neighbor = scenes[i + (edge === "left" ? -1 : 1)];
    return (
      disabled ||
      scenes[i].locked ||
      (keepLength && (!neighbor || Boolean(neighbor.locked)))
    );
  }
  function beginTrim(
    e: React.PointerEvent<HTMLElement>,
    i: number,
    edge: "left" | "right" | "sfx",
  ) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || scenes[i].locked) return;
    if (
      keepLength &&
      edge !== "sfx" &&
      (!scenes[i + (edge === "left" ? -1 : 1)] ||
        scenes[i + (edge === "left" ? -1 : 1)].locked)
    ) {
      setMessage(
        "This edge needs an unlocked neighboring shot. Turn off Keep total length to change the video length instead.",
      );
      return;
    }
    const rect = tracks.current!.getBoundingClientRect();
    gesture.current = {
      index: i,
      edge,
      x: e.clientX,
      pixels: rect.width / duration,
      base: scenes,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedId(scenes[i].id);
    setMulti(new Set([scenes[i].id!]));
    setInspector("shot");
  }
  function updateGesture(e: React.PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g) return;
    const baseStart = timelineSeconds(g.base.slice(0, g.index), fps);
    const baseEnd = baseStart + g.base[g.index].duration;
    const raw =
      (g.edge === "left"
        ? baseStart
        : g.edge === "sfx"
          ? baseStart + (g.base[g.index].sfx_offset ?? 0)
          : baseEnd) +
      (e.clientX - g.x) / g.pixels;
    const baseCuts: number[] = [];
    let baseTime = 0;
    for (const shot of g.base) {
      baseCuts.push(baseTime);
      baseTime += Math.round(shot.duration * fps) / fps;
    }
    baseCuts.push(
      baseTime,
      cursor,
      ...project.caption_cues.flatMap((c) => [
        c.start - project.settings.narration_start,
        c.end - project.settings.narration_start,
      ]),
    );
    const value = snapTimelineTime(
      raw,
      snap ? baseCuts : [],
      10 / g.pixels,
      fps,
    );
    const delta = Math.round(
      (value - (g.edge === "left" ? baseStart : baseEnd)) * fps,
    );
    const result =
      g.edge === "sfx"
        ? g.base.map((s, i) =>
            i === g.index
              ? {
                  ...s,
                  sfx_offset: Math.max(
                    0,
                    Math.min(s.duration - 1 / fps, value - baseStart),
                  ),
                }
              : s,
          )
        : trimTimelineShot(g.base, g.index, g.edge, delta, fps, keepLength);
    previewTrim.current = result;
    setTrimmed(result);
  }
  function endGesture() {
    const result = previewTrim.current;
    const g = gesture.current;
    gesture.current = null;
    previewTrim.current = null;
    setTrimmed(null);
    if (result && g && g.base === scenes && result !== scenes && !disabled)
      onChange(result);
  }
  function setting(key: keyof Project["settings"], value: number | boolean) {
    onProjectChange?.({ settings: { ...project.settings, [key]: value } });
  }
  function editCaption(patch: Partial<Project["caption_cues"][number]>) {
    const cues = project.caption_cues.map((c, i) =>
      i === captionIndex ? { ...c, ...patch } : c,
    );
    const cue = cues[captionIndex];
    if (
      cue &&
      cue.start >= 0 &&
      cue.end - cue.start >= 0.05 &&
      cue.end <=
        (project.narration_duration ??
          duration + project.settings.narration_start)
    )
      onProjectChange?.({ cues });
  }
  const captionClips = project.caption_cues.length
    ? project.caption_cues.map((c, cueIndex) => ({
        cueIndex,
        start: c.start - project.settings.narration_start,
        end: c.end - project.settings.narration_start,
        text: c.text,
      }))
    : clips
        .filter((c) => c.scene.caption)
        .map((c) => ({
          start: c.start,
          end: c.end,
          text: c.scene.caption,
          cueIndex: -1,
        }));
  return (
    <section
      className="surface video-timeline"
      aria-label="Video edit timeline"
      tabIndex={0}
      onKeyDown={keyboard}
    >
      <div className="section-heading">
        <div>
          <h3>Video timeline</h3>
          <p>
            Drag shots to rearrange. Drag clip edges to adjust cuts. Select a
            clip to edit it.
          </p>
        </div>
        <label>
          Timeline zoom
          <input
            aria-label="Timeline zoom"
            type="range"
            min="10"
            max="240"
            value={zoom}
            onChange={(e) => {
              setFit(false);
              setZoom(+e.target.value);
            }}
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
          <div
            className="nle-toolbar"
            role="toolbar"
            aria-label="Timeline editing tools"
          >
            <button
              className="button secondary small-button"
              onClick={onTogglePlay}
              disabled={!onTogglePlay}
              aria-label={playing ? "Pause timeline" : "Play timeline"}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}{" "}
              {playing ? "Pause" : "Play"}
            </button>
            <button
              className="button secondary small-button"
              onClick={onUndo}
              disabled={disabled || !canUndo}
              title="Undo · Ctrl+Z"
            >
              <Undo2 size={15} /> Undo
            </button>
            <button
              className="button secondary small-button"
              onClick={onRedo}
              disabled={disabled || !canRedo}
              title="Redo · Ctrl+Shift+Z"
            >
              <Redo2 size={15} /> Redo
            </button>
            <button
              className="button secondary small-button"
              onClick={split}
              disabled={disabled || !canSplit}
              title="Split selected shot · S"
            >
              <Scissors size={15} /> Split
            </button>
            <button
              className="button secondary small-button"
              onClick={duplicate}
              disabled={disabled || selected.locked}
              title="Duplicate selected shot · D"
            >
              <Copy size={15} /> Duplicate
            </button>
            <button
              className="button secondary small-button"
              onClick={removeSelected}
              disabled={disabled}
              title="Ripple delete · Delete"
            >
              <Trash2 size={15} /> Delete
            </button>
            <button
              className="button secondary small-button"
              onClick={toggleLocks}
              disabled={disabled}
            >
              {allSelectedLocked ? <Unlock size={15} /> : <Lock size={15} />}{" "}
              {allSelectedLocked ? "Unlock" : "Lock"}
            </button>
            <button
              className="button secondary small-button"
              onClick={() => {
                setFit(true);
                if (scroll.current) scroll.current.scrollLeft = 0;
              }}
              aria-pressed={fit}
            >
              <Maximize2 size={15} /> Fit entire video
            </button>
            <button
              className="button secondary small-button"
              onClick={() => setSnap((v) => !v)}
              aria-pressed={snap}
            >
              <Magnet size={15} /> Snap {snap ? "on" : "off"}
            </button>
            <label className="check-label">
              <input
                type="checkbox"
                checked={keepLength}
                onChange={(e) => setKeepLength(e.target.checked)}
              />{" "}
              Keep total length when trimming
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={showEmpty}
                onChange={(e) => setShowEmpty(e.target.checked)}
              />{" "}
              Show empty tracks
            </label>
            <span>{selection.size} selected</span>
          </div>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
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
            ref={scroll}
            className="video-timeline-scroll"
            tabIndex={0}
            aria-label="Scrollable video tracks"
          >
            <div
              ref={tracks}
              className="video-tracks"
              style={{
                width: fit ? "100%" : Math.max(700, duration * zoom),
                minWidth: fit ? 0 : 700,
              }}
              onPointerMove={updateGesture}
              onPointerUp={endGesture}
              onPointerCancel={() => {
                gesture.current = null;
                previewTrim.current = null;
                setTrimmed(null);
              }}
            >
              <div
                className="video-ruler"
                onPointerDown={(e) => {
                  onSeek(timelineTime(e.clientX));
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.buttons === 1) onSeek(timelineTime(e.clientX));
                }}
              >
                {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => (
                  <span key={i} style={{ left: `${(i / duration) * 100}%` }}>
                    {i %
                      Math.max(
                        1,
                        Math.ceil(
                          duration /
                            (fit ? 10 : Math.max(1, (duration * zoom) / 65)),
                        ),
                      ) ===
                    0
                      ? timecode(i)
                      : ""}
                  </span>
                ))}
              </div>
              <div
                className="video-track video-panel-track"
                aria-label="Video panels track"
              >
                <span className="track-name">VIDEO</span>
                {clips.map((c) => (
                  <div
                    key={c.scene.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Timeline shot ${c.index + 1}: ${c.scene.panel.title}`}
                    aria-pressed={selection.has(c.scene.id!)}
                    className={`video-clip ${dragTarget === c.index ? "clip-drop-target" : ""}`}
                    style={position(c.start, c.end)}
                    onDoubleClick={() => {
                      setFit(false);
                      setZoom(80);
                      requestAnimationFrame(() =>
                        scroll.current?.scrollTo({
                          left: Math.max(0, c.start * 80 - 60),
                          behavior: "smooth",
                        }),
                      );
                    }}
                    draggable={!disabled && !c.scene.locked && !gesture.current}
                    onDragStart={(e) => {
                      if (gesture.current || c.scene.locked) {
                        e.preventDefault();
                        return;
                      }
                      draggedIndex.current = c.index;
                      e.dataTransfer.setData("text/plain", String(c.index));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragTarget(c.index);
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDragEnd={() => {
                      draggedIndex.current = null;
                      setDragTarget(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = draggedIndex.current;
                      if (from !== null && !disabled) {
                        const result = moveTimelineShot(scenes, from, c.index);
                        if (result === scenes)
                          setMessage(
                            "Locked shots cannot be moved or crossed.",
                          );
                        else {
                          setSelectedId(scenes[from].id);
                          onChange(result);
                        }
                      }
                      draggedIndex.current = null;
                      setDragTarget(null);
                    }}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        const lo = Math.min(index, c.index),
                          hi = Math.max(index, c.index);
                        setMulti(
                          new Set(scenes.slice(lo, hi + 1).map((s) => s.id!)),
                        );
                      } else if (e.ctrlKey || e.metaKey) {
                        const next = new Set(selection);
                        if (next.has(c.scene.id!)) next.delete(c.scene.id!);
                        else next.add(c.scene.id!);
                        setMulti(next);
                      } else choose(c.index);
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter") {
                        e.preventDefault();
                        choose(c.index);
                      }
                    }}
                  >
                    <img
                      src={c.scene.panel.thumbnail_url}
                      alt=""
                      draggable={false}
                    />
                    <span>
                      {c.index + 1} · {c.scene.panel.title}
                      {c.scene.locked ? " · Locked" : ""}
                    </span>
                    <small>{(c.end - c.start).toFixed(2)}s</small>
                    {(["left", "right"] as const).map((edge) => (
                      <span
                        key={edge}
                        role="slider"
                        tabIndex={edgeDisabled(c.index, edge) ? -1 : 0}
                        aria-disabled={edgeDisabled(c.index, edge)}
                        title={
                          keepLength
                            ? "Adjust this cut with its neighboring shot. Turn off Keep total length for ripple trimming."
                            : "Trim this shot and shift following unlocked shots."
                        }
                        aria-label={`Trim ${edge} edge of shot ${c.index + 1}`}
                        aria-valuenow={edge === "left" ? c.start : c.end}
                        aria-valuemin={0}
                        aria-valuemax={duration}
                        className={`clip-trim clip-trim-${edge}`}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => beginTrim(e, c.index, edge)}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!edgeDisabled(c.index, edge))
                              onChange(
                                trimTimelineShot(
                                  scenes,
                                  c.index,
                                  edge,
                                  (e.key === "ArrowRight" ? 1 : -1) *
                                    (e.shiftKey ? 10 : 1),
                                  fps,
                                  keepLength,
                                ),
                              );
                          }
                        }}
                      />
                    ))}
                  </div>
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
              <div
                className="video-track"
                aria-label="Captions track"
                hidden={!showEmpty && !captionClips.length}
              >
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
                        onClick={() => {
                          onSeek(Math.max(0, c.start));
                          if (c.cueIndex >= 0) {
                            setCaptionIndex(c.cueIndex);
                            setInspector("caption");
                          } else {
                            const shot = clips.find(
                              (cut) => cut.start === c.start,
                            );
                            if (shot) choose(shot.index);
                          }
                        }}
                      >
                        {c.text}
                      </button>
                    ))}
              </div>
              <div
                className="video-track"
                aria-label="Narration track"
                hidden={!showEmpty && !project.narration_url}
              >
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
                    onClick={() => {
                      onSeek(0);
                      setInspector("audio");
                    }}
                  >
                    {wave && (
                      <svg
                        className="clip-waveform"
                        viewBox="0 0 500 40"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        {Array.from({ length: 180 }, (_, i) => {
                          const selectedLength = Math.max(
                            0,
                            Math.min(
                              project.settings.narration_end ??
                                project.narration_duration ??
                                0,
                              project.narration_duration ?? 0,
                            ) - project.settings.narration_start,
                          );
                          const time =
                            project.settings.narration_start +
                            (i / 180) * selectedLength;
                          const peak =
                            wave.peaks[
                              Math.min(
                                wave.peaks.length - 1,
                                Math.floor(
                                  (time / wave.duration) * wave.peaks.length,
                                ),
                              )
                            ] ?? 0;
                          const h = Math.max(1, peak * 36);
                          return (
                            <rect
                              key={i}
                              x={(i * 500) / 180}
                              y={20 - h / 2}
                              width="1.6"
                              height={h}
                              fill="currentColor"
                            />
                          );
                        })}
                      </svg>
                    )}
                    <span className="audio-clip-label">
                      ElevenLabs / imported recording · source{" "}
                    </span>{" "}
                    {timecode(project.settings.narration_start)}
                  </button>
                )}
              </div>
              <div
                className="video-track"
                aria-label="Sound effects track"
                hidden={
                  !showEmpty && !scenes.some((s) => s.sfx_id || s.sfx_url)
                }
              >
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
                          onPointerDown={(e) => beginTrim(e, c.index, "sfx")}
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
              <div
                className="video-track"
                aria-label="Music track"
                hidden={!showEmpty && !project.music_url}
              >
                <span className="track-name">MUSIC</span>
                {project.music_url && (
                  <button
                    className="timeline-block music-block"
                    style={position(0, duration)}
                    onClick={() => {
                      onSeek(0);
                      setInspector("audio");
                    }}
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
          <div
            className="nle-inspector-tabs"
            role="tablist"
            aria-label="Timeline inspector"
          >
            {(["shot", "caption", "audio"] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={inspector === tab}
                className="button secondary small-button"
                onClick={() => setInspector(tab)}
              >
                {tab === "shot"
                  ? "Shot controls"
                  : tab === "caption"
                    ? "Caption editor"
                    : "Audio mixer"}
              </button>
            ))}
          </div>
          <fieldset
            hidden={inspector !== "shot"}
            className="timeline-shot-controls"
            disabled={disabled || selected.locked}
          >
            <legend>
              Shot {index + 1} · {clips[index].start.toFixed(2)}–
              {clips[index].end.toFixed(2)}s{selected.locked ? " · Locked" : ""}
            </legend>
            <label>
              Shot length (seconds)
              <input
                aria-label="Timeline shot duration"
                disabled={edgeDisabled(index, "right")}
                type="number"
                min="0.25"
                max="30"
                step={1 / fps}
                value={Number(selected.duration.toFixed(3))}
                onChange={(e) => {
                  const value = e.target.valueAsNumber;
                  if (Number.isFinite(value) && value >= 0.25 && value <= 30)
                    onChange(
                      trimTimelineShot(
                        scenes,
                        index,
                        "right",
                        Math.round((value - selected.duration) * fps),
                        fps,
                        keepLength,
                      ),
                    );
                }}
              />
            </label>
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
            <label>
              Motion strength
              <input
                aria-label="Timeline motion strength"
                type="range"
                min="2"
                max="30"
                value={Math.round((selected.motion_strength ?? 0.1) * 100)}
                onChange={(e) =>
                  patch({ motion_strength: +e.target.value / 100 })
                }
              />
            </label>
            <label>
              Framing
              <select
                aria-label="Timeline shot framing"
                value={selected.framing ?? "fill"}
                onChange={(e) =>
                  patch({ framing: e.target.value as Scene["framing"] })
                }
              >
                <option value="fill">Fill the video</option>
                <option value="fit">Show the full panel</option>
              </select>
            </label>
            <label>
              Shot caption
              <input
                aria-label="Timeline shot caption"
                maxLength={300}
                value={selected.caption ?? ""}
                onChange={(e) => patch({ caption: e.target.value })}
              />
            </label>
            <label>
              Sound effect
              <select
                aria-label="Timeline shot sound effect"
                value={selected.sfx_id ?? ""}
                onChange={(e) =>
                  patch(
                    e.target.value
                      ? {
                          sfx_id: e.target.value,
                          sfx_url:
                            effects.find((s) => s.id === e.target.value)?.url ??
                            null,
                          clear_sfx: false,
                          sfx_offset: 0,
                        }
                      : {
                          sfx_id: null,
                          sfx_url: null,
                          clear_sfx: true,
                          sfx_offset: 0,
                        },
                  )
                }
              >
                <option value="">No sound effect</option>
                {effects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Effect offset (seconds)
              <input
                aria-label="Timeline sound offset"
                type="number"
                min="0"
                max={Math.max(0, selected.duration - 1 / fps)}
                step={1 / fps}
                value={selected.sfx_offset ?? 0}
                onChange={(e) => {
                  const value = e.target.valueAsNumber;
                  if (value >= 0 && value < selected.duration)
                    patch({ sfx_offset: value });
                }}
              />
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
          {inspector === "caption" && (
            <fieldset
              className="timeline-shot-controls"
              disabled={disabled || !onProjectChange}
            >
              <legend>Timed captions</legend>
              {project.caption_cues.length ? (
                <>
                  <label>
                    Caption
                    <select
                      aria-label="Selected timeline caption"
                      value={captionIndex}
                      onChange={(e) => {
                        setCaptionIndex(+e.target.value);
                        onSeek(
                          Math.max(
                            0,
                            project.caption_cues[+e.target.value].start -
                              project.settings.narration_start,
                          ),
                        );
                      }}
                    >
                      {project.caption_cues.map((c, i) => (
                        <option key={i} value={i}>
                          {i + 1}. {c.text.slice(0, 45)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Words
                    <textarea
                      aria-label="Timeline caption words"
                      value={project.caption_cues[captionIndex]?.text ?? ""}
                      onChange={(e) => editCaption({ text: e.target.value })}
                    />
                  </label>
                  <label>
                    Start in video (s)
                    <input
                      aria-label="Timeline caption start"
                      type="number"
                      step={1 / fps}
                      value={Number(
                        (
                          (project.caption_cues[captionIndex]?.start ?? 0) -
                          project.settings.narration_start
                        ).toFixed(3),
                      )}
                      onChange={(e) =>
                        editCaption({
                          start:
                            e.target.valueAsNumber +
                            project.settings.narration_start,
                        })
                      }
                    />
                  </label>
                  <label>
                    End in video (s)
                    <input
                      aria-label="Timeline caption end"
                      type="number"
                      step={1 / fps}
                      value={Number(
                        (
                          (project.caption_cues[captionIndex]?.end ?? 0) -
                          project.settings.narration_start
                        ).toFixed(3),
                      )}
                      onChange={(e) =>
                        editCaption({
                          end:
                            e.target.valueAsNumber +
                            project.settings.narration_start,
                        })
                      }
                    />
                  </label>
                </>
              ) : (
                <p>
                  No timed captions yet. Edit a shot’s caption in Shot controls,
                  or import/generate captions in the full editor.
                </p>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={project.settings.captions}
                  onChange={(e) => setting("captions", e.target.checked)}
                />{" "}
                Show captions in video
              </label>
            </fieldset>
          )}
          {inspector === "audio" && (
            <fieldset
              className="timeline-shot-controls"
              disabled={disabled || !onProjectChange}
            >
              <legend>Audio mixer · live preview and export</legend>
              {(
                [
                  ["voice_volume", "Narration", 2],
                  ["sfx_volume", "Sound effects", 1],
                  ["music_volume", "Music", 1],
                ] as const
              ).map(([key, label, max]) => (
                <label key={key}>
                  {label} · {Math.round(project.settings[key] * 100)}%
                  <input
                    aria-label={`Timeline ${label.toLowerCase()} volume`}
                    type="range"
                    min="0"
                    max={max}
                    step="0.01"
                    value={project.settings[key]}
                    onChange={(e) => setting(key, +e.target.value)}
                  />
                  <button
                    className="text-button"
                    onClick={() =>
                      setting(
                        key,
                        project.settings[key]
                          ? 0
                          : key === "voice_volume"
                            ? 1
                            : key === "music_volume"
                              ? 0.12
                              : 0.35,
                      )
                    }
                  >
                    {project.settings[key] ? "Mute" : "Restore"}{" "}
                    {label.toLowerCase()}
                  </button>
                </label>
              ))}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={project.settings.duck_audio}
                  onChange={(e) => setting("duck_audio", e.target.checked)}
                />{" "}
                Lower music under narration
              </label>
              {project.narration_url && (
                <>
                  <label>
                    Narration source in (s)
                    <input
                      aria-label="Timeline narration in"
                      type="number"
                      min="0"
                      max={project.narration_duration ?? 180}
                      step={1 / fps}
                      value={project.settings.narration_start}
                      onChange={(e) => {
                        const value = e.target.valueAsNumber;
                        if (
                          value >= 0 &&
                          value <=
                            (project.settings.narration_end ??
                              project.narration_duration ??
                              0) -
                              0.25
                        )
                          setting("narration_start", value);
                      }}
                    />
                  </label>
                  <label>
                    Narration source out (s)
                    <input
                      aria-label="Timeline narration out"
                      type="number"
                      max={project.narration_duration ?? 180}
                      step={1 / fps}
                      value={
                        project.settings.narration_end ??
                        project.narration_duration ??
                        0
                      }
                      onChange={(e) => {
                        const value = e.target.valueAsNumber;
                        if (
                          value >= project.settings.narration_start + 0.25 &&
                          value <= (project.narration_duration ?? 0)
                        )
                          setting("narration_end", value);
                      }}
                    />
                  </label>
                </>
              )}
              <p>
                Changing narration in/out changes the source excerpt. Review
                cuts and captions afterwards. Browser ducking is approximate;
                narration boosts above 100% apply to rendered previews and
                exports.
              </p>
            </fieldset>
          )}
          <p className="help">
            Shift-click selects a range for locking/deleting; Ctrl/Cmd-click
            toggles selection. Double-click a shot to zoom in. Space
            plays/pauses, S splits, D duplicates, Delete removes, arrows step
            frames, +/- zoom. Select a shot to change its camera or transition,
            move it, or split it at the playhead. Locked shots stay protected.
            Narration and captions retain their timing when shots move. Browser
            playback approximates the mix; render a preview to check final sound
            and ducking.
          </p>
          {!disabled && (
            <details className="nle-waveform-details">
              <summary>
                Precise narration cuts · speech and pause snapping
              </summary>
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
            </details>
          )}
        </>
      )}
    </section>
  );
}
