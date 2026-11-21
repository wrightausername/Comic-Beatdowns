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
import { pagePointToRoute, type CameraWaypoint } from "./cameraRoute";
import {
  drawCrop,
  moveCrop,
  resizeCrop,
  scaleCrop,
  type Region,
} from "./pageReviewGeometry";

type Drag = {
  mode: "move" | "resize" | "draw" | "waypoint";
  pointIndex?: number;
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
  onReviewVideo,
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
  onReviewVideo: () => void;
  onUndo: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [routeMode, setRouteMode] = useState<
    "off" | "start" | "end" | "append"
  >("off");
  const [draftStart, setDraftStart] = useState<CameraWaypoint | null>(null);
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
    !scene.camera_path?.length &&
    !following.camera_path?.length &&
    scene.duration + following.duration <= 30 &&
    (scene.note?.length ?? 0) + (following.note?.length ?? 0) + 3 <= 2000,
  );
  const crop = scene.source_crop ?? null;
  const path = scene.camera_path ?? [];
  const frameCrop = crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const disabled = busy || Boolean(scene.locked);
  const ratio = crop
    ? (scene.panel.width * crop.width) / (scene.panel.height * crop.height)
    : scene.panel.width / scene.panel.height;
  const panAxis = ratio > 9 / 16 ? "horizontal" : "vertical";

  function chooseShot(nextIndex: number) {
    setSelectedId(scenes[nextIndex]?.id ?? null);
    setDrawing(false);
    setRouteMode("off");
    setDraftStart(null);
  }
  function toggleQuickRoute() {
    setDrawing(false);
    setDraftStart(null);
    setRouteMode(routeMode === "off" ? "start" : "off");
  }
  function patch(region: Region | null) {
    onPatch(index, { source_crop: region });
  }
  function changeRoute(points: CameraWaypoint[]) {
    onPatch(index, {
      camera_path: points,
      source_crop: frameCrop,
      motion: "panel_glide",
      framing: "fit",
      easing: "smooth",
      transition: "cut",
      path_move_fraction: scene.path_move_fraction ?? 1,
      path_zoom: scene.path_zoom ?? 1.4,
    });
  }
  function routeClick(event: ReactPointerEvent) {
    if (disabled || routeMode === "off") return;
    event.preventDefault();
    const place = point(event);
    if (!place) return;
    const nextPoint = pagePointToRoute(place.x, place.y, frameCrop);
    if (routeMode === "start") {
      setDraftStart(nextPoint);
      setRouteMode("end");
    } else if (routeMode === "end" && draftStart) {
      changeRoute([draftStart, nextPoint]);
      setDraftStart(null);
      setRouteMode("off");
    } else if (routeMode === "append" && path.length >= 2 && path.length < 8) {
      changeRoute([...path, nextPoint]);
      setRouteMode("off");
    }
  }
  function startWaypoint(pointIndex: number, event: ReactPointerEvent) {
    if (
      disabled ||
      routeMode !== "off" ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = {
      mode: "waypoint",
      pointIndex,
      x: event.clientX,
      y: event.clientY,
      original: crop,
      anchorX: 0,
      anchorY: 0,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function nudgeWaypoint(
    pointIndex: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (disabled || routeMode !== "off") return;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const current = path[pointIndex];
    const amount = event.shiftKey ? 0.05 : 0.01;
    if (!current) return;
    const next = path.map((p, i) =>
      i === pointIndex
        ? {
            x: clamp(p.x + direction[0] * amount),
            y: clamp(p.y + direction[1] * amount),
          }
        : p,
    );
    changeRoute(next);
  }
  function pageRoutePercent(p: CameraWaypoint) {
    return {
      x: (frameCrop.x + p.x * frameCrop.width) * 100,
      y: (frameCrop.y + p.y * frameCrop.height) * 100,
    };
  }
  function point(event: ReactPointerEvent) {
    const bounds = pageRef.current!.getBoundingClientRect();
    if (
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    )
      return null;
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  }
  function startDrag(mode: Drag["mode"], event: ReactPointerEvent) {
    if (disabled || routeMode !== "off" || (mode !== "draw" && !crop)) return;
    event.preventDefault();
    event.stopPropagation();
    const pos = point(event);
    if (!pos) return;
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
    if (
      !rect.width ||
      !rect.height ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    )
      return;
    const dx = (event.clientX - active.x) / rect.width;
    const dy = (event.clientY - active.y) / rect.height;
    if (active.mode === "waypoint") {
      if (active.pointIndex === undefined) return;
      const position = point(event);
      if (!position) return;
      const nextPoint = pagePointToRoute(position.x, position.y, frameCrop);
      const next = path.map((p, i) =>
        i === active.pointIndex ? nextPoint : p,
      );
      if (next.length >= 2) changeRoute(next);
    } else if (active.mode === "draw") {
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
  const mode =
    scene.motion === "panel_glide"
      ? "pan"
      : scene.motion === "hold"
        ? "hold"
        : "other";
  return (
    <section
      id="page-shot-review"
      className="surface page-shot-review"
      aria-label="Quick shot editor"
    >
      <div className="section-heading">
        <div>
          <h3>Review your video, shot by shot</h3>
          <p>
            Verdict already chose the panels. Only fix a shot when something looks
            wrong. Select it, draw the camera move if needed, then preview.
            Changes save automatically.
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
      <div className="page-review-step-label">1 · Pick the shot to check</div>
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
            onClick={() => chooseShot(shotIndex)}
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
              drawing || routeMode !== "off"
                ? "page-review-page drawing"
                : "page-review-page"
            }
            ref={pageRef}
            style={{
              aspectRatio: `${scene.panel.width} / ${scene.panel.height}`,
            }}
            role="group"
            aria-label={`Full source page for shot ${index + 1}`}
            onPointerDown={(event) => {
              if (routeMode !== "off") routeClick(event);
              else if (drawing) startDrag("draw", event);
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
            {crop && !drawing && routeMode === "off" && (
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
            {(path.length >= 2 || draftStart) && (
              <>
                <svg
                  className="page-route-overlay"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {path.length >= 2 && (
                    <polyline
                      points={path
                        .map((p) => {
                          const pos = pageRoutePercent(p);
                          return `${pos.x},${pos.y}`;
                        })
                        .join(" ")}
                      fill="none"
                      stroke="#72edff"
                      strokeWidth={0.65}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
                {path.map((p, i) => {
                  const position = pageRoutePercent(p);
                  return (
                    <button
                      key={i}
                      type="button"
                      className="page-route-point"
                      style={{ left: `${position.x}%`, top: `${position.y}%` }}
                      aria-label={`Move camera point ${i + 1}. Drag or use arrow keys`}
                      title={`Camera position ${i + 1}`}
                      disabled={disabled || routeMode !== "off"}
                      onPointerDown={(event) => startWaypoint(i, event)}
                      onKeyDown={(event) => nudgeWaypoint(i, event)}
                    >
                      {i + 1}
                    </button>
                  );
                })}
                {draftStart && routeMode === "end" && (
                  <span
                    className="page-route-point pending"
                    style={{
                      left: `${pageRoutePercent(draftStart).x}%`,
                      top: `${pageRoutePercent(draftStart).y}%`,
                    }}
                    aria-label="Starting camera point 1"
                  >
                    1
                  </span>
                )}
              </>
            )}
          </div>
          <p className="help page-review-caption">
            {routeMode === "start"
              ? "Click the artwork where the camera should START (point 1)."
              : routeMode === "end"
                ? "Click where the camera should END (point 2)."
                : routeMode === "append"
                  ? "Click where the camera should go NEXT."
                  : drawing
                    ? "Drag on the full page to draw a replacement rectangle."
                    : crop
                      ? "The outlined area is what Verdict reads from this page. Drag to move it, or resize its corner."
                      : "This shot currently uses the entire page. You can draw a crop if needed."}
          </p>
        </div>
        <div className="page-review-actions">
          <div className="page-review-quick">
            <h4>2 · Fix the camera (only if needed)</h4>
            <p className="help">
              Happy with Verdict's choice? Skip this step. To direct the camera
              yourself, click where it starts (1), then where it ends (2).
            </p>
            <button
              type="button"
              className="button primary page-review-primary"
              disabled={disabled}
              aria-pressed={routeMode === "start" || routeMode === "end"}
              onClick={toggleQuickRoute}
            >
              {routeMode === "start" || routeMode === "end"
                ? "Cancel camera path"
                : path.length >= 2
                  ? "Redraw camera path"
                  : "Draw 1 → 2 camera route"}
            </button>
            <button
              type="button"
              className="button secondary small-button"
              disabled={disabled}
              aria-pressed={drawing}
              onClick={() => {
                setRouteMode("off");
                setDraftStart(null);
                setDrawing(!drawing);
              }}
            >
              {drawing ? "Cancel crop" : "Fix the panel crop"}
            </button>
            {routeMode !== "off" && (
              <p className="page-review-instruction" role="status">
                {routeMode === "start"
                  ? "Click point 1 on the comic page."
                  : routeMode === "end"
                    ? "Now click point 2 to finish the move."
                    : "Click where the camera should go next."}
              </p>
            )}
            {path.length >= 2 && (
              <>
                <p className="help">
                  Your route has {path.length} camera points. Drag the numbered
                  dots on the page to adjust them.
                </p>
                <label className="page-route-speed">
                  <span>How fast should it move?</span>
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    aria-label={`Shot ${index + 1} camera travel time`}
                    disabled={disabled}
                    value={scene.path_move_fraction ?? 1}
                    onChange={(event) =>
                      onPatch(index, { path_move_fraction: +event.target.value })
                    }
                  />
                  <strong>
                    {((scene.path_move_fraction ?? 1) * scene.duration).toFixed(1)}s
                  </strong>
                </label>
                <p className="help">
                  Move left for a quick pan, right for a slow pan. The camera
                  holds at the end until this shot finishes.
                </p>
                <div className="page-review-action-row">
                  <button
                    type="button"
                    className="button secondary small-button"
                    disabled={disabled || path.length >= 8}
                    aria-pressed={routeMode === "append"}
                    onClick={() => {
                      setDrawing(false);
                      setDraftStart(null);
                      setRouteMode(routeMode === "append" ? "off" : "append");
                    }}
                  >
                    Add another point
                  </button>
                  <button
                    type="button"
                    className="button secondary small-button"
                    disabled={disabled}
                    onClick={() => {
                      setRouteMode("off");
                      changeRoute([...path].reverse());
                    }}
                  >
                    Reverse route
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={disabled}
                    onClick={() => {
                      setRouteMode("off");
                      onPatch(index, {
                        camera_path: null,
                        motion: "hold",
                        framing: "fit",
                      });
                    }}
                  >
                    Remove route
                  </button>
                </div>
              </>
            )}
            <div className="page-review-step-label">3 · Preview or continue</div>
            <div className="page-review-action-row">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => onPreview(index)}
              >
                <Play size={15} /> Preview this shot
              </button>
              {index < scenes.length - 1 ? (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => chooseShot(index + 1)}
                >
                  Next shot <ArrowRight size={15} />
                </button>
              ) : (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={onReviewVideo}
                >
                  Review full video <ArrowRight size={15} />
                </button>
              )}
            </div>
            {index > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() => chooseShot(index - 1)}
                disabled={busy}
              >
                <ArrowLeft size={14} /> Previous shot
              </button>
            )}
            {scene.locked && (
              <button
                type="button"
                className="button secondary small-button"
                onClick={() => onPatch(index, { locked: false })}
                disabled={busy}
              >
                Unlock this shot to edit it
              </button>
            )}
            <p className="help">
              No change needed? Hit Next shot. Your original comic pages and
              ElevenLabs audio are never rewritten.
            </p>
          </div>
          <details className="page-review-advanced">
            <summary>More controls · timing, crop size, splitting and transitions</summary>
            <div className="page-review-advanced-inner">
          <div className="page-review-action-heading">Fine-tune the picture</div>
          <div className="page-review-action-row">
            <button
              className="button secondary small-button"
              disabled={disabled}
              aria-pressed={drawing}
              onClick={() => {
                setRouteMode("off");
                setDraftStart(null);
                setDrawing(!drawing);
              }}
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
                camera_path: null,
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
                  camera_path: null,
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
                path.length >= 2
                  ? changeRoute([...path].reverse())
                  : onPatch(index, {
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
            Draw a numbered camera route
          </div>
          <div className="page-review-action-row">
            <button
              type="button"
              className="button secondary small-button"
              aria-pressed={routeMode === "start" || routeMode === "end"}
              disabled={disabled}
              onClick={() => {
                setDrawing(false);
                setDraftStart(null);
                setRouteMode(routeMode === "off" ? "start" : "off");
              }}
            >
              {routeMode === "start" || routeMode === "end"
                ? "Cancel route"
                : path.length >= 2
                  ? "Redraw 1 → 2"
                  : "Draw 1 → 2 camera route"}
            </button>
            <button
              type="button"
              className="button secondary small-button"
              disabled={disabled || path.length < 2 || path.length >= 8}
              aria-pressed={routeMode === "append"}
              onClick={() => {
                setDrawing(false);
                setDraftStart(null);
                setRouteMode(routeMode === "append" ? "off" : "append");
              }}
            >
              Add next point
            </button>
            <button
              type="button"
              className="button secondary small-button"
              disabled={disabled || path.length < 2}
              onClick={() => {
                setRouteMode("off");
                changeRoute([...path].reverse());
              }}
            >
              Reverse route
            </button>
          </div>
          {path.length >= 2 && (
            <>
              <div className="page-review-action-row">
                <button
                  type="button"
                  className="button secondary small-button"
                  disabled={disabled || mode === "pan"}
                  onClick={() =>
                    onPatch(index, { motion: "panel_glide", framing: "fit" })
                  }
                >
                  Use numbered route
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={disabled}
                  onClick={() => {
                    setRouteMode("off");
                    onPatch(index, {
                      camera_path: null,
                      motion: "hold",
                      framing: "fit",
                    });
                  }}
                >
                  Clear route
                </button>
              </div>
              <label className="page-route-speed">
                <span>Camera travel speed</span>
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  aria-label={`Shot ${index + 1} camera travel time`}
                  disabled={disabled}
                  value={scene.path_move_fraction ?? 1}
                  onChange={(event) =>
                    onPatch(index, { path_move_fraction: +event.target.value })
                  }
                />
                <strong>
                  {((scene.path_move_fraction ?? 1) * scene.duration).toFixed(
                    1,
                  )}
                  s moving
                </strong>
              </label>
              <p className="help">
                The camera follows 1 → 2
                {path.length > 2 ? ` → … → ${path.length}` : ""} and holds on
                the last point for the rest of this shot. Move the slider left
                for a quicker pan.
              </p>
              <label className="page-route-speed">
                <span>Camera closeness</span>
                <input
                  type="range"
                  min={1}
                  max={2}
                  step={0.1}
                  aria-label={`Shot ${index + 1} camera closeness`}
                  disabled={disabled}
                  value={scene.path_zoom ?? 1.4}
                  onChange={(event) =>
                    onPatch(index, { path_zoom: +event.target.value })
                  }
                />
                <strong>{(scene.path_zoom ?? 1.4).toFixed(1)}×</strong>
              </label>
              <p className="help">
                Drag numbered dots on the artwork to correct where the camera
                looks. Arrow keys make fine adjustments. Your voiceover and page
                file stay intact.
              </p>
            </>
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
              value={scene.transition ?? "inherit"}
              disabled={disabled || index === 0}
              onChange={(event) =>
                onPatch(index, {
                  transition:
                    event.target.value === "inherit"
                      ? null
                      : (event.target.value as
                          "cut" | "crossfade" | "slide_left"),
                })
              }
            >
              <option value="inherit">Use project's default transition</option>
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
          <p className="help">
            All edits are reversible using Undo. Your original page image is
            never changed.
          </p>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
