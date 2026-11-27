import { useEffect, useRef, useState } from "react";
import { api, json } from "./api";
import { newId } from "./editing";
import { errorMessage } from "./utils";
import type { OrganizedPage, Panel, PanelOrganization, Project } from "./types";

export function panelLetters(index: number): string {
  let result = "";
  do {
    result = String.fromCharCode(65 + (index % 26)) + result;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return result;
}
const whole = { x: 0, y: 0, width: 1, height: 1 };
type Point = { x: number; y: number };
export default function PanelOrganizer({
  autoOpen = false,
  project,
  panels,
  busy,
  dirty,
  perform,
  accept,
  onChanged,
  onBuilt,
}: {
  autoOpen?: boolean;
  project: Project;
  panels: Panel[];
  busy: boolean;
  dirty: boolean;
  perform: (action: () => Promise<void>) => Promise<void>;
  accept: (project: Project) => void;
  onChanged: () => void;
  onBuilt: () => void;
}) {
  const [organization, setOrganization] = useState<PanelOrganization | null>(
    project.workflow?.panel_organization ?? null,
  );
  const [baseRevision, setBaseRevision] = useState(project.revision);
  const [changed, setChanged] = useState(false);
  const changedRef = useRef(changed);
  changedRef.current = changed;
  const [open, setOpen] = useState(false),
    [pageIndex, setPageIndex] = useState(0),
    [regionIndex, setRegionIndex] = useState(0);
  const [prefix, setPrefix] = useState("");
  const [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [draw, setDraw] = useState<"add" | "replace" | null>(null);
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  useEffect(() => {
    if (!changedRef.current) {
      setOrganization(project.workflow?.panel_organization ?? null);
      setBaseRevision(project.revision);
    }
  }, [project.revision, project.workflow?.panel_organization]);
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);
  const pages = organization?.pages ?? [];
  const page = pages[pageIndex];
  const source = panels.find((p) => p.id === page?.page_id);
  const available =
    !!project.workflow?.panel_ids?.length || !!project.scene_count;
  const ready = !busy && !working;
  const stale = changed && baseRevision !== project.revision;
  const protectedShots = project.scenes?.some(
    (s) => s.locked || s.camera_path?.length,
  );
  async function run(action: () => Promise<void>) {
    if (!ready) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await perform(async () => {
        try {
          await action();
        } catch (e) {
          setError(errorMessage(e));
        }
      });
    } finally {
      setWorking(false);
    }
  }
  async function detect(redetect = false) {
    if (
      redetect &&
      !window.confirm(
        "Detect the panels again? Your current saved layout stays in Undo when you save a replacement. Existing video shots stay intact.",
      )
    )
      return;
    const current = await api<Project>(`/projects/${project.id}`);
    const result = await api<{
      base_revision: number;
      organization: PanelOrganization;
    }>(
      `/projects/${project.id}/panel-organization/preview`,
      json({ base_revision: current.revision, redetect }),
    );
    setOrganization(result.organization);
    setBaseRevision(result.base_revision);
    setChanged(true);
    setPageIndex(0);
    setRegionIndex(0);
    setOpen(true);
    setDraw(null);
  }
  function edit(next: PanelOrganization) {
    setOrganization(next);
    setChanged(true);
    setNotice("");
  }
  function editPage(change: Partial<OrganizedPage>) {
    if (organization)
      edit({
        ...organization,
        pages: pages.map((p, i) => (i === pageIndex ? { ...p, ...change } : p)),
      });
  }
  async function save(reorder = false): Promise<Project> {
    const result = await api<Project>(
      `/projects/${project.id}/panel-organization`,
      {
        method: "PUT",
        body: JSON.stringify({
          base_revision: baseRevision,
          organization,
          reorder_video: reorder,
        }),
      },
    );
    accept(result);
    setOrganization(result.workflow?.panel_organization ?? null);
    setBaseRevision(result.revision);
    setChanged(false);
    onChanged();
    setNotice(
      reorder
        ? "Panel order applied to your video. Undo restores the previous order."
        : "Named panels saved. Existing video crops and timing are kept; a new draft uses this layout.",
    );
    return result;
  }
  async function build() {
    if (
      project.scene_count &&
      !window.confirm(
        "Build a fresh draft from these organized panels? Your unlocked shot edits stay in Undo; source pages, narration and timed captions are kept.",
      )
    )
      return;
    const saved = changed
      ? await save()
      : await api<Project>(`/projects/${project.id}`);
    const next = await api<Project>(
      `/projects/${project.id}/autopilot`,
      json(
        {
          base_revision: saved.revision,
          enabled: true,
          mode: saved.autopilot?.mode ?? "basic",
          pace: saved.autopilot?.pace ?? saved.settings.edit_pace,
          delivery: "draft",
          rebuild_pages: !!saved.scene_count,
          reorder_pages: false,
        },
        "PUT",
      ),
    );
    accept(next);
    setBaseRevision(next.revision);
    await api(
      `/projects/${project.id}/director`,
      json({ base_revision: next.revision }),
    );
    onChanged();
    onBuilt();
  }
  function moveRegion(direction: number) {
    if (!page) return;
    const regions = [...page.regions];
    [regions[regionIndex], regions[regionIndex + direction]] = [
      regions[regionIndex + direction],
      regions[regionIndex],
    ];
    editPage({ regions });
    setRegionIndex(regionIndex + direction);
  }
  function movePage(direction: number) {
    if (!organization) return;
    const next = [...pages];
    [next[pageIndex], next[pageIndex + direction]] = [
      next[pageIndex + direction],
      next[pageIndex],
    ];
    edit({ ...organization, pages: next });
    setPageIndex(pageIndex + direction);
  }
  function point(e: React.PointerEvent<HTMLDivElement>): Point {
    const box = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
    };
  }
  function finish(e: React.PointerEvent<HTMLDivElement>) {
    const current = dragRef.current;
    if (!current || !page || !source || !draw) return;
    const to = point(e);
    const crop = {
      x: Math.min(current.from.x, to.x),
      y: Math.min(current.from.y, to.y),
      width: Math.abs(current.from.x - to.x),
      height: Math.abs(current.from.y - to.y),
    };
    dragRef.current = null;
    setDrag(null);
    if (crop.width * source.width < 2 || crop.height * source.height < 2) {
      setError("Draw a larger box around the panel.");
      return;
    }
    const regions = [...page.regions];
    if (draw === "add") {
      regions.push({ id: newId(), crop });
      setRegionIndex(regions.length - 1);
    } else regions[regionIndex] = { ...regions[regionIndex], crop };
    editPage({ regions });
    setDraw(null);
  }
  const dragCrop = drag
    ? {
        x: Math.min(drag.from.x, drag.to.x),
        y: Math.min(drag.from.y, drag.to.y),
        width: Math.abs(drag.from.x - drag.to.x),
        height: Math.abs(drag.from.y - drag.to.y),
      }
    : null;
  if (!available) return null;
  return (
    <section
      className="surface panel-organizer"
      id="studio-panel-organizer"
      aria-label="Panel organizer"
    >
      <div className="section-heading">
        <div>
          <h3>Crop & organize panels</h3>
          <p>
            Keep every page together: <strong>ww_01A → ww_01B → ww_01C</strong>.
            The same names follow your video shots.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={!ready}
          onClick={() =>
            organization ? setOpen(!open) : void run(() => detect())
          }
        >
          {organization
            ? open
              ? "Close panel organizer"
              : "Review organized panels"
            : "Auto-crop & organize panels"}
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {open && organization && (
        <>
          <p className="help">
            {pages.length} pages ·{" "}
            {pages.reduce((sum, p) => sum + p.regions.length, 0)} named panels.
            Clear gutters are detected locally. Uncertain pages stay whole for
            your review. Original images stay intact.
          </p>
          {stale && (
            <p className="notice">
              The project changed since this layout preview. Reload the saved
              layout before saving; your unsaved crop choices are still shown.
            </p>
          )}
          <div
            className="organizer-page-tabs"
            role="group"
            aria-label="Comic pages in reading order"
          >
            {pages.map((p, i) => (
              <button
                key={p.page_id}
                className={i === pageIndex ? "button" : "button secondary"}
                aria-pressed={i === pageIndex}
                onClick={() => {
                  setPageIndex(i);
                  setRegionIndex(0);
                  setDraw(null);
                }}
              >
                {p.name} · {p.regions.length} panels
                {p.review_required ? " · check" : ""}
              </button>
            ))}
          </div>
          {page && source && (
            <>
              <div className="organizer-page-controls">
                <label>
                  Page name
                  <input
                    aria-label="Organized page name"
                    value={page.name}
                    maxLength={72}
                    onChange={(e) => editPage({ name: e.target.value })}
                  />
                </label>
                <button
                  className="text-button"
                  disabled={!ready || pageIndex === 0}
                  onClick={() => movePage(-1)}
                >
                  Move page earlier
                </button>
                <button
                  className="text-button"
                  disabled={!ready || pageIndex === pages.length - 1}
                  onClick={() => movePage(1)}
                >
                  Move page later
                </button>
              </div>
              <div className="organizer-page-layout">
                <div>
                  <div
                    className={
                      draw ? "organizer-source drawing" : "organizer-source"
                    }
                    style={{ aspectRatio: `${source.width}/${source.height}` }}
                    role="group"
                    aria-label="Original page with organized panel crops"
                    onPointerDown={(e) => {
                      if (!draw || !ready) return;
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const p = point(e);
                      const next = { from: p, to: p };
                      dragRef.current = next;
                      setDrag(next);
                    }}
                    onPointerMove={(e) => {
                      if (!dragRef.current) return;
                      const next = { ...dragRef.current, to: point(e) };
                      dragRef.current = next;
                      setDrag(next);
                    }}
                    onPointerUp={finish}
                    onPointerCancel={() => {
                      dragRef.current = null;
                      setDrag(null);
                    }}
                  >
                    <img
                      src={source.image_url}
                      alt={`Original ${source.title}`}
                      draggable={false}
                    />
                    {page.regions.map((r, i) => (
                      <button
                        key={r.id}
                        type="button"
                        className={
                          i === regionIndex
                            ? "organizer-box selected"
                            : "organizer-box"
                        }
                        aria-label={`Select crop ${page.name}${panelLetters(i)}`}
                        aria-pressed={i === regionIndex}
                        style={{
                          left: `${r.crop.x * 100}%`,
                          top: `${r.crop.y * 100}%`,
                          width: `${r.crop.width * 100}%`,
                          height: `${r.crop.height * 100}%`,
                        }}
                        onClick={() => {
                          if (!draw) setRegionIndex(i);
                        }}
                      >
                        <span>{panelLetters(i)}</span>
                      </button>
                    ))}
                    {dragCrop && (
                      <span
                        className="organizer-box drag"
                        style={{
                          left: `${dragCrop.x * 100}%`,
                          top: `${dragCrop.y * 100}%`,
                          width: `${dragCrop.width * 100}%`,
                          height: `${dragCrop.height * 100}%`,
                        }}
                      />
                    )}
                  </div>
                  {draw && (
                    <p className="notice">
                      Drag a box around{" "}
                      {draw === "add"
                        ? "the missing panel"
                        : `${page.name}${panelLetters(regionIndex)}`}
                      .{" "}
                      <button
                        className="text-button"
                        onClick={() => setDraw(null)}
                      >
                        Cancel drawing
                      </button>
                    </p>
                  )}
                  <p className="help">{page.reason}</p>
                </div>
                <div>
                  <h4>Panels in reading order</h4>
                  <div className="organized-crop-grid">
                    {page.regions.map((r, i) => (
                      <button
                        key={r.id}
                        className={
                          i === regionIndex
                            ? "organized-crop selected"
                            : "organized-crop"
                        }
                        aria-label={`Organized panel ${page.name}${panelLetters(i)}`}
                        aria-pressed={i === regionIndex}
                        onClick={() => setRegionIndex(i)}
                      >
                        <svg
                          preserveAspectRatio="none"
                          viewBox={`${r.crop.x} ${r.crop.y} ${r.crop.width} ${r.crop.height}`}
                          style={{
                            aspectRatio: `${source.width * r.crop.width}/${source.height * r.crop.height}`,
                          }}
                          aria-hidden="true"
                        >
                          <image
                            href={source.thumbnail_url}
                            width="1"
                            height="1"
                            preserveAspectRatio="none"
                          />
                        </svg>
                        <strong>
                          {page.name}
                          {panelLetters(i)}
                        </strong>
                      </button>
                    ))}
                  </div>
                  <p className="help">
                    Selected:{" "}
                    <strong>
                      {page.name}
                      {panelLetters(regionIndex)}
                    </strong>
                    . Moving panels updates A, B, C; shot references remain
                    linked to the same panel.
                  </p>
                  <div className="workflow-actions">
                    <button
                      className="button secondary small-button"
                      disabled={!ready || regionIndex === 0}
                      onClick={() => moveRegion(-1)}
                    >
                      Panel earlier
                    </button>
                    <button
                      className="button secondary small-button"
                      disabled={
                        !ready || regionIndex >= page.regions.length - 1
                      }
                      onClick={() => moveRegion(1)}
                    >
                      Panel later
                    </button>
                  </div>
                  <details>
                    <summary>Fix a crop or panel boundary</summary>
                    <div className="workflow-actions">
                      <button
                        className="text-button"
                        disabled={!ready}
                        onClick={() => setDraw("replace")}
                      >
                        Redraw selected crop
                      </button>
                      <button
                        className="text-button"
                        disabled={
                          !ready ||
                          page.regions.length >= 24 ||
                          pages.reduce((sum, p) => sum + p.regions.length, 0) >=
                            120
                        }
                        onClick={() => setDraw("add")}
                      >
                        Draw a missing panel
                      </button>
                      <button
                        className="text-button"
                        disabled={!ready || page.regions.length <= 1}
                        onClick={() => {
                          editPage({
                            regions: page.regions.filter(
                              (_, i) => i !== regionIndex,
                            ),
                          });
                          setRegionIndex(Math.max(0, regionIndex - 1));
                        }}
                      >
                        Remove selected crop
                      </button>
                      <button
                        className="text-button"
                        disabled={
                          !ready || regionIndex >= page.regions.length - 1
                        }
                        onClick={() => {
                          const a = page.regions[regionIndex],
                            b = page.regions[regionIndex + 1];
                          const x = Math.min(a.crop.x, b.crop.x),
                            y = Math.min(a.crop.y, b.crop.y);
                          const crop = {
                            x,
                            y,
                            width:
                              Math.max(
                                a.crop.x + a.crop.width,
                                b.crop.x + b.crop.width,
                              ) - x,
                            height:
                              Math.max(
                                a.crop.y + a.crop.height,
                                b.crop.y + b.crop.height,
                              ) - y,
                          };
                          editPage({
                            regions: page.regions.flatMap((r, i) =>
                              i === regionIndex
                                ? [{ ...r, crop }]
                                : i === regionIndex + 1
                                  ? []
                                  : [r],
                            ),
                          });
                        }}
                      >
                        Merge with next crop
                      </button>
                      <button
                        className="text-button"
                        disabled={!ready}
                        onClick={() => {
                          editPage({
                            regions: [{ id: page.regions[0].id, crop: whole }],
                            review_required: false,
                            reason: "Creator kept the page as one panel",
                          });
                          setRegionIndex(0);
                        }}
                      >
                        Keep page as one panel
                      </button>
                    </div>
                  </details>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={!page.review_required}
                      onChange={(e) =>
                        editPage({ review_required: !e.target.checked })
                      }
                    />
                    This page's crops and order look right
                  </label>
                </div>
              </div>
            </>
          )}
          <details>
            <summary>Naming and page order</summary>
            <div className="organizer-page-controls">
              <label>
                Naming prefix
                <input
                  aria-label="Panel naming prefix"
                  value={prefix}
                  maxLength={48}
                  placeholder="Optional, e.g. ww"
                  onChange={(e) =>
                    setPrefix(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))
                  }
                />
              </label>
              <button
                className="button secondary small-button"
                disabled={!ready || !prefix}
                onClick={() =>
                  edit({
                    ...organization,
                    pages: pages.map((p, i) => ({
                      ...p,
                      name: `${prefix}_${String(i + 1).padStart(2, "0")}`,
                    })),
                  })
                }
              >
                Apply prefix to page names
              </button>
              <button
                className="text-button"
                disabled={!ready}
                onClick={() => {
                  edit({
                    ...organization,
                    pages: [...pages].sort((a, b) =>
                      a.name.localeCompare(b.name, undefined, {
                        numeric: true,
                        sensitivity: "base",
                      }),
                    ),
                  });
                  setPageIndex(0);
                  setRegionIndex(0);
                }}
              >
                Sort page names
              </button>
              <button
                className="text-button"
                disabled={!ready}
                onClick={() => void run(() => detect(true))}
              >
                Re-detect page crops
              </button>
            </div>
            <p className="help">
              Names change inside this project; original filenames are
              preserved. Duplicate page names are rejected.
            </p>
          </details>
          <div className="workflow-actions organizer-save-actions">
            <button
              className="button secondary"
              disabled={!ready || !changed || stale || dirty}
              onClick={() =>
                void run(async () => {
                  await save();
                })
              }
            >
              Save named panels
            </button>
            <button
              className="button"
              disabled={
                !ready ||
                stale ||
                dirty ||
                !project.narration_url ||
                !!protectedShots
              }
              onClick={() => void run(build)}
            >
              Build video from these panels
            </button>
            {!!project.scene_count && (
              <button
                className="text-button"
                disabled={!ready || stale || dirty || !!protectedShots}
                onClick={() => {
                  if (
                    window.confirm(
                      "Put existing shots in this panel order? Timing stays with each shot, narration and timed captions stay in place, and Undo restores the previous cut.",
                    )
                  )
                    void run(async () => {
                      await save(true);
                    });
                }}
              >
                Use panel order in existing video
              </button>
            )}
            {!changed && (
              <a
                className="button secondary"
                href={`/api/projects/${project.id}/panel-organization/download`}
              >
                Download named crops · ZIP
              </a>
            )}
            {!changed && page && (
              <a
                className="text-button"
                href={`/api/projects/${project.id}/panel-organization/download?page_id=${page.page_id}`}
              >
                Download this page’s crops
              </a>
            )}
            {stale && (
              <button
                className="text-button"
                disabled={!ready}
                onClick={() => {
                  if (
                    window.confirm(
                      "Reload the saved layout? Unsaved crop changes will be discarded.",
                    )
                  ) {
                    setChanged(false);
                    setOrganization(
                      project.workflow?.panel_organization ?? null,
                    );
                    setBaseRevision(project.revision);
                    setPageIndex(0);
                    setRegionIndex(0);
                  }
                }}
              >
                Reload saved layout
              </button>
            )}
          </div>
          {!project.narration_url && (
            <p className="help">
              You can save and download crops now. Add narration to build the
              video.
            </p>
          )}
          {protectedShots && (
            <p className="help">
              Saved crops can be organized; locked shots and custom camera
              routes block replacing or reordering the existing video.
            </p>
          )}
          {project.autopilot?.mode === "vision" && (
            <p className="help">
              Building uses your selected vision provider and sends resized
              pages/narration text. Provider charges may apply. Cropping and
              naming here run locally.
            </p>
          )}
        </>
      )}
    </section>
  );
}
