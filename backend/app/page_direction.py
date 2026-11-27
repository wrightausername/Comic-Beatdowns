"""Non-destructive first-pass direction for creator-supplied full comic pages.

Page geometry is evidence, not character understanding. Every virtual scene retains
its original Panel ID; source_crop references normalized coordinates on that page.
Don't replace user-edited or locked shots. The renderer is responsible for cropping.
"""

from types import SimpleNamespace

from PIL import Image

from .camera_path import path_zoom
from .database import uid
from .panel_detection import suggest_panels

MAX_VIRTUAL_SHOTS = 120


def page_sources(scenes, panels, storage, layouts=(), organization=None):
    """Expand untouched, one-shot-per-page material into virtual panel shots.

    Return source scenes and a review report. On reruns, authored/locked edits and
    previously generated virtual shots are left intact.
    """
    if scenes and (
        len(scenes) != len(panels)
        or any(
            getattr(s, "locked", False)
            or getattr(s, "source_panel_ref", None)
            or getattr(s, "source_crop", None)
            or getattr(s, "camera_path", None)
            for s in scenes
        )
        or [s.panel_id for s in scenes] != [p.id for p in panels]
    ):
        return scenes, {"expanded": False, "reason": "Existing edited shots preserved", "pages": []}

    originals = scenes or [
        SimpleNamespace(
            id=uid(),
            panel_id=panel.id,
            duration=5,
            motion="hold",
            motion_strength=0.1,
            easing="smooth",
            focus_x=0.5,
            focus_y=0.5,
            transition="cut",
            transition_duration=None,
            caption="",
            locked=False,
            note="",
            beat="custom",
            sfx_key=None,
            sfx_id=None,
            sfx_offset=0,
            framing="fit",
            source_crop=None,
        )
        for panel in panels
    ]
    output, review = [], []
    layout_map = {layout.panel_id: layout for layout in layouts}
    organized = {p["page_id"]: p for p in (organization or {}).get("pages", [])}
    for source, panel in zip(originals, panels):
        layout = layout_map.get(panel.id)
        page = organized.get(panel.id)
        with Image.open(storage.path(panel.storage_key)) as image:
            candidates = (
                [r["crop"] for r in page["regions"]]
                if page
                else [r.model_dump() for r in layout.regions]
                if layout and all(r.confidence >= 0.7 for r in layout.regions)
                else suggest_panels(image)
            )
        if len(output) + len(candidates or [None]) > MAX_VIRTUAL_SHOTS:
            return scenes, {
                "expanded": False,
                "reason": "Too many detected panels. Review the pages before generating.",
                "pages": review,
            }
        if not candidates:
            output.append(source)
            review.append(
                {
                    "page_id": panel.id,
                    "panel_count": 1,
                    "review_required": True,
                    "reason": "No reliable straight gutters: kept complete page intact",
                }
            )
            continue
        for index, rect in enumerate(candidates):
            values = dict(vars(source))
            # Original recording, caption, script and manually uploaded assets
            # are never edited by this proposal.
            if page:
                from .panel_organization import letters

                values.update(
                    source_panel_ref=page["regions"][index]["id"],
                    source_label=page["name"] + letters(index),
                )
            full = all(
                abs(rect[k] - v) < 0.000001
                for k, v in {"x": 0, "y": 0, "width": 1, "height": 1}.items()
            )
            values.update(
                id=source.id if index == 0 else uid(),
                source_crop=None if full else {k: rect[k] for k in ("x", "y", "width", "height")},
                motion="hold",
                focus_x=0.5,
                focus_y=0.5,
                framing="fit",
                transition="cut",
                note=f"Page {panel.page or '?'} · detected panel {index + 1}/{len(candidates)}. Review boundaries.",
            )
            # Wide/tall single panels should remain one artwork unit. Pan across
            # the *same* source panel; never invent extra source panel boundaries.
            aspect = (panel.width * rect["width"]) / (panel.height * rect["height"])
            if aspect >= 1.35:
                values["motion"] = "panel_glide"
                values["glide_axis"] = "horizontal"
            elif aspect <= 0.42:
                values["motion"] = "panel_glide"
                values["glide_axis"] = "vertical"
            output.append(SimpleNamespace(**values))
        review.append(
            {
                "page_id": panel.id,
                "panel_count": len(candidates),
                "review_required": page["review_required"] if page else True,
                "reason": page["reason"]
                if page
                else "Vision-suggested panel boundaries; verify reading order and dialogue"
                if layout and all(r.confidence >= 0.7 for r in layout.regions)
                else "Straight pale gutters detected; verify irregular panels and reading order",
                "regions": candidates,
            }
        )
    return output, {
        "expanded": len(output) > len(originals),
        "reason": "Conservative page geometry; review unusual layouts",
        "pages": review,
    }


def glide_zoom(scene, panel_width, panel_height, target_ratio=9 / 16):
    """Fit the full cropped panel to the target then pan without image stretching."""
    crop = scene.get("source_crop")
    if not crop or scene.get("motion") != "panel_glide":
        return 1.0
    aspect = panel_width * crop["width"] / (panel_height * crop["height"])
    if scene.get("camera_path"):
        return path_zoom(aspect, scene.get("path_zoom", 1.4))
    return round(min(8.0, max(1.0, aspect / target_ratio, target_ratio / aspect)), 6)
