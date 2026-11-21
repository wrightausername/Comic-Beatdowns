import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { Scene } from "./types";
import {
  drawCrop,
  moveCrop,
  resizeCrop,
  scaleCrop,
  type Region,
} from "./pageReviewGeometry";

type Drag = {
  mode: "move" | "resize" | "draw";
  x: number;
  y: number;
  original: Region | null;
  anchorX: number;
  anchorY: number;
};
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Plain-language, visual override of Verdict's automatically proposed shots. */
export default function PageShotReview({
  scenes,
  busy,
  canUndo,
  onPatch,
  onMove,
  onRemove,
  onDuplicate,
  onSplit,
  onJoin,
  onPreview,
  onUndo,
}: {
  scenes: Scene[];
  busy: boolean;
  canUndo: boolean;
  onPatch: (index: number, patch: Partial<Scene>) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onDuplicate: (index: number) => void;
  onSplit: (index: number) => void;
  onJoin: (index: number) => void;
  onPreview: (index: number) => void;
  onUndo: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  if (!scenes.length) return null;
  const found = selectedId ? scenes.findIndex((s) => s.id === selectedId) : -1;
  const index =
    found >= 0
      ? found
      : Math.max(
          0,
          scenes.findIndex((s) => s.source_crop),
        );
  const scene = scenes[index];
  const following = scenes[index + 1];
  const canJoin = Boolean(
    following &&
    scene.source_crop &&
    following.source_crop &&
    scene.panel_id === following.panel_id &&
    !scene.locked &&
    !following.locked &&
    !following.caption?.trim() &&
    !following.sfx_id &&
    !following.sfx_url &&
    !following.sfx_source_id &&
    scene.duration + following.duration <= 30 &&
    (scene.note?.length ?? 0) + (following.note?.length ?? 0) + 3 <= 2000,
  );
  const crop = scene.source_crop ?? null;
  const disabled = busy || Boolean(scene.locked);
  const ratio = crop
    ? (scene.panel.width * crop.width) / (scene.panel.height * crop.height)
    : scene.panel.width / scene.panel.height;
  const panAxis = ratio > 9 / 16 ? "horizontal" : "vertical";

  function patch(region: Region | null) {
    onPatch(index, { source_crop: region });
  }
  function point(event: ReactPointerEvent) {
    const bounds = pageRef.current!.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  }
  function startDrag(mode: Drag["mode"], event: ReactPointerEvent) {
    if (disabled || (mode !== "draw" && !crop)) return;
    event.preventDefault();
    event.stopPropagation();
    const pos = point(event);
    drag.current = {
      mode,
      x: event.clientX,
      y: event.clientY,
      original: crop,
      anchorX: pos.x,
      anchorY: pos.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveDrag(event: ReactPointerEvent) {
    const active = drag.current;
    if (!active || disabled) return;
    const rect = pageRef.current!.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = (event.clientX - active.x) / rect.width;
    const dy = (event.clientY - active.y) / rect.height;
    if (active.mode === "draw") {
      const proposal = drawCrop(
        active.anchorX,
        active.anchorY,
        active.anchorX + dx,
        active.anchorY + dy,
      );
      if (proposal) patch(proposal);
    } else if (active.original) {
      patch(
        active.mode === "move"
          ? moveCrop(active.original, dx, dy)
          : resizeCrop(active.original, dx, dy),
      );
    }
  }
  function finishDrag() {
    if (!drag.current) return;
    drag.current = null;
    setDrawing(false);
  }
  function arrows(
    event: KeyboardEvent<HTMLButtonElement>,
    mode: "move" | "resize",
  ) {
    if (!crop || disabled) return;
    const dir: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (!dir[event.key]) return;
    event.preventDefault();
    const amount = event.shiftKey ? 0.05 : 0.01;
    const [dx, dy] = dir[event.key];
    patch(
      mode === "move"
        ? moveCrop(crop, dx * amount, dy * amount)
        : resizeCrop(crop, dx * amount, dy * amount),
    );
  }
  const mode = scene.motion === "panel_glide" ? "pan" : "hold";
  return (
    <section
      id="page-shot-review"
      className="surface page-shot-review"
      aria-label="Quick shot editor"
    >
      <div className="section-heading">
        <div>
          <h3>Fix Verdict's panel choices</h3>
          <p>
            Tap a shot, drag its crop or resize the corner, and choose how the
            camera moves. Changes autosave. You can undo.
          </p>
        </div>
        <button
          type="button"
          className="button secondary small-button"
          onClick={onUndo}
          disabled={busy || !canUndo}
        >
          <RotateCcw size={14} /> Undo edit
        </button>
      </div>
      <div
        className="page-shot-strip"
        role="group"
        aria-label="Shots in video order"
      >
        {scenes.map((shot, shotIndex) => (
          <button
            key={shot.id ?? shotIndex}
            type="button"
            aria-label={`Review shot ${shotIndex + 1}`}
            aria-pressed={index === shotIndex}
            className={
              index === shotIndex ? "page-shot-chip selected" : "page-shot-chip"
            }
            onClick={() => {
              setSelectedId(shot.id ?? null);
              setDrawing(false);
            }}
          >
            <span
              className="page-shot-chip-thumb"
              style={{
                aspectRatio: `${shot.panel.width} / ${shot.panel.height}`,
              }}
            >
              <img src={shot.panel.thumbnail_url} alt="" draggable={false} />
              {shot.source_crop && (
                <span
                  className="page-shot-chip-region"
                  style={{
                    left: `${shot.source_crop.x * 100}%`,
                    top: `${shot.source_crop.y * 100}%`,
                    width: `${shot.source_crop.width * 100}%`,
                    height: `${shot.source_crop.height * 100}%`,
                  }}
                />
              )}
            </span>
            <strong>Shot {shotIndex + 1}</strong>
            <small>
              {shot.locked
                ? "Locked"
                : shot.source_crop
                  ? "Page crop"
                  : "Whole image"}
            </small>
          </button>
        ))}
      </div>
      <div className="page-review-layout">
        <div>
          <div className="page-review-help">
            <strong>
              Shot {index + 1} of {scenes.length}
            </strong>
            <span>{scene.panel.title || "Comic artwork"}</span>
          </div>
          <div
            className={
              drawing ? "page-review-page drawing" : "page-review-page"
            }
            ref={pageRef}
            style={{
              aspectRatio: `${scene.panel.width} / ${scene.panel.height}`,
            }}
            role="group"
            aria-label={`Full source page for shot ${index + 1}`}
            onPointerDown={(event) => {
              if (drawing) startDrag("draw", event);
            }}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          >
            <img
              src={scene.panel.image_url}
              alt={scene.panel.title}
              draggable={false}
            />
            {crop && !drawing && (
              <div
                className="page-review-region"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.width * 100}%`,
                  height: `${crop.height * 100}%`,
                }}
              >
                <button
                  type="button"
                  className="page-review-move"
                  disabled={disabled || drawing}
                  aria-label="Drag selected crop to move it. Use arrow keys for fine adjustments"
                  onPointerDown={(event) => startDrag("move", event)}
                  onKeyDown={(event) => arrows(event, "move")}
                >
                  <span>DRAG TO MOVE</span>
                </button>
                <button
                  type="button"
                  className="page-review-resize"
                  disabled={disabled || drawing}
                  aria-label="Drag crop corner to resize. Use arrow keys for fine adjustments"
                  onPointerDown={(event) => startDrag("resize", event)}
                  onKeyDown={(event) => arrows(event, "resize")}
                >
                  ↘
                </button>
              </div>
            )}
          </div>
          <p className="help page-review-caption">
            {drawing
              ? "Drag on the full page to draw a replacement rectangle."
              : crop
                ? "The outlined area is what Verdict reads from this page. Drag to move it, or resize its corner."
                : "This shot currently uses the entire page. You can draw a crop if needed."}
          </p>
        </div>
        <div className="page-review-actions">
          <div className="page-review-action-heading">1. Fix the picture</div>
          <div className="page-review-action-row">
            <button
              className="button secondary small-button"
              disabled={disabled}
              aria-pressed={drawing}
              onClick={() => setDrawing(!drawing)}
            >
              {drawing
                ? "Cancel drawing"
                : crop
                  ? "Draw new crop"
                  : "Crop part of page"}
            </button>
            <button
              className="button secondary small-button"
              disabled={disabled || !crop}
              onClick={() => crop && patch(scaleCrop(crop, 1.12))}
            >
              Show more art
            </button>
            <button
              className="button secondary small-button"
              disabled={disabled || !crop}
              onClick={() => crop && patch(scaleCrop(crop, 0.88))}
            >
              Crop tighter
            </button>
          </div>
          <button
            className="text-button"
            disabled={disabled || (!crop && scene.motion === "hold")}
            onClick={() => {
              setDrawing(false);
              onPatch(index, {
                source_crop: null,
                motion: "hold",
                framing: "fit",
                glide_axis: null,
                glide_start: 0,
                glide_end: 1,
              });
            }}
          >
            Use complete page instead
          </button>

          <div className="page-review-action-heading">
            2. Choose camera movement
          </div>
          <div
            className="page-review-action-row"
            role="group"
            aria-label="Shot camera style"
          >
            <button
              className="button secondary small-button"
              aria-pressed={mode === "hold"}
              disabled={disabled}
              onClick={() => onPatch(index, { motion: "hold", framing: "fit" })}
            >
              Hold still
            </button>
            <button
              className="button secondary small-button"
              aria-pressed={mode === "pan"}
              disabled={disabled || !crop}
              onClick={() =>
                onPatch(index, {
                  motion: "panel_glide",
                  glide_axis: panAxis,
                  glide_start: 0,
                  glide_end: 1,
                  framing: "fit",
                  easing: "smooth",
                  transition: "cut",
                })
              }
            >
              Pan across
            </button>
            <button
              className="button secondary small-button"
              disabled={disabled || mode !== "pan"}
              onClick={() =>
                onPatch(index, {
                  glide_start: scene.glide_end ?? 1,
                  glide_end: scene.glide_start ?? 0,
                })
              }
            >
              Reverse pan
            </button>
          </div>
          {mode === "pan" && (
            <p className="help">
              The camera moves{" "}
              {scene.glide_axis === "vertical" ? "vertically" : "horizontally"}{" "}
              through one intact panel.
            </p>
          )}

          <div className="page-review-action-heading">
            3. Fix order and timing
          </div>
          <div className="page-review-action-row">
            <button
              className="button secondary small-button"
              disabled={
                busy || index === 0 || scene.locked || scenes[index - 1]?.locked
              }
              onClick={() => onMove(index, index - 1)}
            >
              <ArrowLeft size={14} /> Earlier
            </button>
            <button
              className="button secondary small-button"
              disabled={
                busy ||
                index === scenes.length - 1 ||
                scene.locked ||
                scenes[index + 1]?.locked
              }
              onClick={() => onMove(index, index + 1)}
            >
              Later <ArrowRight size={14} />
            </button>
            <button
              className="button secondary small-button"
              disabled={
                disabled ||
                scenes.reduce(
                  (total, s) => total + s.duration,
                  scene.duration,
                ) > 180
              }
              onClick={() => onDuplicate(index)}
            >
              <Copy size={14} /> Repeat shot
            </button>
          </div>
          <div className="page-review-action-row">
            <button
              className="button secondary small-button"
              disabled={disabled || scene.duration < 0.5}
              onClick={() => onSplit(index)}
              title="Makes two timed shots of this artwork. Select the new shot and draw its own crop."
            >
              Split shot in two
            </button>
            <button
              className="button secondary small-button"
              disabled={busy || !canJoin}
              onClick={() => onJoin(index)}
              title="Combines this crop and the next crop from the same original page, without shifting narration."
            >
              Join with next shot
            </button>
          </div>
          <p className="help">
            Split keeps both halves on the timeline. Join combines two mistaken
            cuts from one source page and preserves their total time.
          </p>
          <label className="page-review-duration">
            Time on screen (seconds)
            <input
              type="number"
              min={0.25}
              max={30}
              step={0.25}
              disabled={disabled}
              aria-label={`Shot ${index + 1} duration`}
              value={scene.duration}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 0.25 && value <= 30)
                  onPatch(index, { duration: value });
              }}
            />
          </label>
          <p className="help">
            Changing shot length shifts later cuts. The voice recording is never
            altered.
          </p>
          <label className="page-review-duration">
            Transition into this shot
            <select
              aria-label={`Shot ${index + 1} transition`}
              value={scene.transition ?? "cut"}
              disabled={disabled || index === 0}
              onChange={(event) =>
                onPatch(index, {
                  transition: event.target.value as
                    "cut" | "crossfade" | "slide_left",
                })
              }
            >
              <option value="cut">Hard cut (comic reading)</option>
              <option value="crossfade">Gentle dissolve</option>
              <option value="slide_left">Slide to next shot</option>
            </select>
          </label>
          <div className="page-review-action-row">
            <button
              className="button secondary small-button"
              disabled={busy || !scene.id}
              onClick={() => onPreview(index)}
            >
              <Play size={14} /> Preview this shot
            </button>
            <button
              className="text-button danger"
              disabled={disabled}
              onClick={() => onRemove(index)}
            >
              <Trash2 size={14} /> Remove shot
            </button>
          </div>
          {scene.locked && (
            <button
              className="button secondary small-button"
              onClick={() => onPatch(index, { locked: false })}
              disabled={busy}
            >
              Unlock this shot to edit it
            </button>
          )}
          <p className="help">
            All edits are reversible using Undo. Your original page image is
            never changed.
          </p>
        </div>
      </div>
    </section>
  );
}
