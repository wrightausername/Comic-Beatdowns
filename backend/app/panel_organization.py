"""Page-owned, named panel crops. Source images and existing camera edits stay intact."""

import copy
import hashlib
import io
import json
import re
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from PIL import Image
from pydantic import Field

from .api import project_dict, session, touch
from .database import Project
from .importer import natural_key
from .panel_detection import suggest_panels
from .schemas import PanelOrganization, RevisionInput
from .workspace import locked_project, project_scenes, remember

router = APIRouter(prefix="/api", tags=["Panel organization"])
FULL = dict(x=0.0, y=0.0, width=1.0, height=1.0)


def letters(index):
    result = ""
    while True:
        index, remainder = divmod(index, 26)
        result = chr(65 + remainder) + result
        if not index:
            return result
        index -= 1


def crop_ref(page_id, crop):
    data = [page_id, {k: round(float(v), 6) for k, v in crop.items()}]
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:32]


def clean_name(value):
    value = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_-")[:60] or "page"
    if value.upper() in {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }:
        value = "page_" + value
    return value


def source_name(panel, index, prefix=""):
    if prefix:
        return f"{clean_name(prefix)}_{index + 1:02}"
    stem = clean_name(
        Path(getattr(panel, "source_name", panel.title).replace("\\", "/")).stem or panel.title
    )
    if panel.page is not None:
        return f"{stem}_{panel.page:02}"
    match = re.fullmatch(r"(.*?)(\d+)", stem)
    if match:
        return f"{match[1]}{int(match[2]):02}"
    return f"{stem}_{index + 1:02}"


def labels(organization):
    return {
        region["id"]: {
            "label": page["name"] + letters(i),
            "page_id": page["page_id"],
            "crop": region["crop"],
            "order": (p, i),
        }
        for p, page in enumerate(organization.get("pages", []))
        for i, region in enumerate(page["regions"])
    }


def generate_organization(panels, storage, existing=None, prefix="", redetect=False, layouts=()):
    old = {p["page_id"]: p for p in (existing or {}).get("pages", [])}
    layout_map = {p.panel_id: p for p in layouts}
    ordered = list(panels)
    if existing:
        positions = {p["page_id"]: i for i, p in enumerate(existing["pages"])}
        ordered.sort(key=lambda p: positions.get(p.id, len(positions)))
    pages, used, count = [], set(), 0
    for index, panel in enumerate(ordered):
        previous = old.get(panel.id)
        name = source_name(panel, index, prefix) if prefix or not previous else previous["name"]
        root, suffix = name, 2
        while name.casefold() in used:
            name = f"{root}_{suffix:02}"
            suffix += 1
        used.add(name.casefold())
        if previous and not redetect:
            page = {**copy.deepcopy(previous), "name": name}
        else:
            layout = layout_map.get(panel.id)
            with Image.open(storage.path(panel.storage_key)) as image:
                regions = (
                    [r.model_dump(include={"x", "y", "width", "height"}) for r in layout.regions]
                    if layout and all(r.confidence >= 0.7 for r in layout.regions)
                    else suggest_panels(image)
                )
            known = bool(regions)
            reason = (
                "Check suggested boundaries and reading order"
                if known
                else "No reliable gutters: kept the whole page. Draw missing panels or keep it as one."
            )
            if count + len(regions or [FULL]) + len(ordered) - index - 1 > 120:
                regions, known, reason = (
                    [],
                    False,
                    "Panel limit: kept this page whole. Use a smaller page batch to detect more panels.",
                )
            regions = [{k: r[k] for k in FULL} for r in (regions or [FULL])]
            page = dict(
                page_id=panel.id,
                name=name,
                regions=[dict(id=crop_ref(panel.id, r), crop=r) for r in regions],
                review_required=True,
                reason=reason,
            )
        pages.append(page)
        count += len(page["regions"])
    return PanelOrganization(
        pages=pages, user_order=bool((existing or {}).get("user_order"))
    ).model_dump()


def match_label(scene, entries, prefer_reference=True):
    reference = getattr(scene, "source_panel_ref", None)
    if prefer_reference and reference in entries:
        entry = entries[reference]
        if entry["page_id"] == scene.panel_id:
            return reference, entry
    crop = scene.source_crop or FULL
    candidates = [
        (key, item)
        for key, item in entries.items()
        if item["page_id"] == scene.panel_id
        and all(abs(item["crop"][k] - crop[k]) < 0.00001 for k in FULL)
    ]
    return candidates[0] if len(candidates) == 1 else (None, None)


class DetectInput(RevisionInput):
    prefix: str = Field(default="", max_length=48, pattern=r"^[A-Za-z0-9_-]*$")
    redetect: bool = False


class SaveInput(RevisionInput):
    organization: PanelOrganization
    reorder_video: bool = False


def get_project(db, project_id):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    return project


@router.post("/projects/{project_id}/panel-organization/preview")
def detect(project_id: str, data: DetectInput, request: Request, db=Depends(session)):
    from .production import project_panels

    project = get_project(db, project_id)
    if project.revision != data.base_revision:
        raise HTTPException(409, "The project changed. Reload before detecting panels.")
    panels = project_panels(db, project)
    if not panels:
        raise HTTPException(422, "Upload comic pages first")
    if not project.workflow.get("panel_organization"):
        panels.sort(key=lambda p: (natural_key(p.source_name), p.page or 0))
    if len(panels) > 100:
        raise HTTPException(422, "Organize up to 100 source pages at a time")
    try:
        organization = generate_organization(
            panels,
            request.app.state.storage,
            project.workflow.get("panel_organization"),
            data.prefix,
            data.redetect,
        )
    except OSError as error:
        raise HTTPException(
            422, "A source page is missing or unreadable. Recover it in Add files."
        ) from error
    db.expire(project)
    if project.revision != data.base_revision:
        raise HTTPException(409, "The project changed during detection. Your saved edit was kept.")
    return {"base_revision": project.revision, "organization": organization}


@router.put("/projects/{project_id}/panel-organization")
def save(project_id: str, data: SaveInput, db=Depends(session)):
    from .production import project_panels

    project = locked_project(db, project_id, data.base_revision)
    allowed = {p.id for p in project_panels(db, project)}
    organization = data.organization.model_dump()
    if {p["page_id"] for p in organization["pages"]} != allowed:
        raise HTTPException(
            422, "Include every project source page exactly once. Reload after adding files."
        )
    organization["user_order"] = True
    for page in organization["pages"]:
        panel = next(p for p in project_panels(db, project) if p.id == page["page_id"])
        if any(
            round((r["crop"]["x"] + r["crop"]["width"]) * panel.width)
            - round(r["crop"]["x"] * panel.width)
            < 2
            or round((r["crop"]["y"] + r["crop"]["height"]) * panel.height)
            - round(r["crop"]["y"] * panel.height)
            < 2
            for r in page["regions"]
        ):
            raise HTTPException(422, "Each crop must be at least 2 by 2 source pixels")
    entries = labels(organization)
    scenes = project_scenes(db, project_id)
    matches = {s.id: match_label(s, entries) for s in scenes}
    ordered = list(scenes)
    if data.reorder_video:
        if any(not matches[s.id][0] for s in scenes):
            raise HTTPException(
                422,
                "Some saved shots use different crops. Rebuild from the organized panels, or keep their current order.",
            )
        ordered.sort(key=lambda s: entries[matches[s.id][0]]["order"])
        if ordered != scenes and any(s.locked or s.camera_path for s in scenes):
            raise HTTPException(
                409,
                "Reordering would move protected shots. Keep their order or explicitly unlock/clear routes first.",
            )
    remember(db, project)
    for position, scene in enumerate(ordered):
        ref, entry = matches[scene.id]
        if ref:
            scene.source_panel_ref, scene.source_label = ref, entry["label"]
        scene.position = position
    project.workflow = {**project.workflow, "panel_organization": organization}
    touch(project, invalidate_approval=True)
    db.commit()
    return project_dict(project, db, True)


@router.get("/projects/{project_id}/panel-organization/download")
def download(project_id: str, request: Request, page_id: str | None = None, db=Depends(session)):
    project = get_project(db, project_id)
    raw = project.workflow.get("panel_organization")
    if not raw:
        raise HTTPException(422, "Save your organized panels first")
    organization = PanelOrganization.model_validate(raw).model_dump()
    from .production import project_panels

    panels = {p.id: p for p in project_panels(db, project)}
    if page_id is not None:
        organization["pages"] = [p for p in organization["pages"] if p["page_id"] == page_id]
        if not organization["pages"]:
            raise HTTPException(404, "That page is not in this organization")
    stream = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)
    pixels = 0
    try:
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED) as archive:
            for page in organization["pages"]:
                panel = panels.get(page["page_id"])
                if panel is None:
                    raise HTTPException(422, "A source page is no longer available")
                with Image.open(request.app.state.storage.path(panel.storage_key)) as image:
                    for index, region in enumerate(page["regions"]):
                        r = region["crop"]
                        box = (
                            round(r["x"] * image.width),
                            round(r["y"] * image.height),
                            round((r["x"] + r["width"]) * image.width),
                            round((r["y"] + r["height"]) * image.height),
                        )
                        pixels += (box[2] - box[0]) * (box[3] - box[1])
                        if pixels > 64_000_000:
                            raise HTTPException(
                                413,
                                "This crop download is too large. Download a smaller project batch.",
                            )
                        with image.crop(box) as cropped, io.BytesIO() as png:
                            cropped.save(png, "PNG")
                            archive.writestr(
                                f"{page['name']}/{page['name']}{letters(index)}.png", png.getvalue()
                            )
                        if stream.tell() > 64 * 1024 * 1024:
                            raise HTTPException(
                                413,
                                "This crop download exceeds 64 MB. Use a smaller project batch.",
                            )
        stream.seek(0)
    except OSError as error:
        stream.close()
        raise HTTPException(422, "A source page is missing or unreadable") from error
    except Exception:
        stream.close()
        raise

    def chunks():
        try:
            while chunk := stream.read(64 * 1024):
                yield chunk
        finally:
            stream.close()

    return StreamingResponse(
        chunks(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="Organized-panels.zip"'},
    )
