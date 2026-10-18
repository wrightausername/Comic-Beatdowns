import io
import re
import warnings
import zipfile
from pathlib import Path, PurePosixPath
from threading import Lock

import pypdfium2 as pdfium
from PIL import Image, ImageOps, UnidentifiedImageError

from .database import Panel, uid
from .schemas import PanelMetadata

Image.MAX_IMAGE_PIXELS = 32_000_000
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
IMPORT_LOCK = Lock()  # PDFium is not thread safe. Serialize imports off the event loop.


def import_to_library(content, filename, metadata, storage, panels, max_panels):
    with IMPORT_LOCK:
        for image, page in import_pages(content, filename, max_panels - len(panels)):
            try:
                if len(panels) >= max_panels:
                    raise ValueError("An import may contain at most 100 panels")
                panels.append(save_panel(image, metadata, filename, page, storage))
            finally:
                image.close()


def natural_key(name):
    return [int(s) if s.isdigit() else s.lower() for s in re.split(r"(\d+)", name)]


def read_image(content: bytes) -> Image.Image:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as source:
                source.load()
                image = ImageOps.exif_transpose(source)
                if image.mode in ("RGBA", "LA") or "transparency" in image.info:
                    background = Image.new("RGB", image.size, "white")
                    rgba = image.convert("RGBA")
                    background.paste(rgba, mask=rgba.getchannel("A"))
                    image = background
                else:
                    image = image.convert("RGB")
                image.thumbnail((4096, 4096), Image.Resampling.LANCZOS)
                return image.copy()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as e:
        raise ValueError("Invalid image or image exceeds the 32-megapixel safety limit") from e


def import_pages(content: bytes, filename: str, max_pages: int):
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        try:
            with pdfium.PdfDocument(content) as doc:
                if not 0 < len(doc) <= max_pages:
                    raise ValueError(f"PDF must contain 1–{max_pages} pages")
                for i in range(len(doc)):
                    page = doc[i]
                    try:
                        scale = min(2, 3000 / max(page.get_size()))
                        bitmap = page.render(scale=scale)
                        try:
                            yield bitmap.to_pil().convert("RGB").copy(), i + 1
                        finally:
                            bitmap.close()
                    finally:
                        page.close()
        except pdfium.PdfiumError as e:
            raise ValueError(
                "Cannot read this PDF; encrypted or damaged PDFs are unsupported"
            ) from e
    elif suffix == ".cbz":
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                entries = archive.infolist()
                if len(entries) > 1000:
                    raise ValueError("Archive has too many entries")
                images = []
                expanded_size = 0
                for entry in entries:
                    name = PurePosixPath(entry.filename)
                    if name.is_absolute() or ".." in name.parts or "\\" in entry.filename:
                        raise ValueError("Archive contains an unsafe path")
                    if entry.flag_bits & 1:
                        raise ValueError("Encrypted archives are unsupported")
                    expanded_size += entry.file_size
                    if entry.file_size > 32 * 1024 * 1024 or expanded_size > 256 * 1024 * 1024:
                        raise ValueError("Expanded archive is too large")
                    if entry.file_size / max(entry.compress_size, 1) > 250:
                        raise ValueError("Archive compression ratio exceeds the safety limit")
                    if name.suffix.lower() in IMAGE_SUFFIXES and not entry.is_dir():
                        images.append(entry)
                if not 0 < len(images) <= max_pages:
                    raise ValueError(f"CBZ must contain 1–{max_pages} images")
                for i, entry in enumerate(sorted(images, key=lambda e: natural_key(e.filename))):
                    yield read_image(archive.read(entry)), i + 1
        except (zipfile.BadZipFile, RuntimeError) as e:
            raise ValueError("Cannot read this CBZ archive") from e
    elif suffix in IMAGE_SUFFIXES:
        yield read_image(content), None
    else:
        raise ValueError("Choose an image, PDF, or CBZ file")


def save_panel(image, metadata: PanelMetadata, filename, page, storage, parent_id=None):
    panel_id = uid()
    key = f"panels/{panel_id}.jpg"
    thumb_key = f"panels/{panel_id}-thumb.jpg"
    output = io.BytesIO()
    image.convert("RGB").save(output, format="JPEG", quality=94)
    storage.write(key, output.getvalue())
    thumbnail = image.copy()
    thumbnail.thumbnail((480, 480), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    thumbnail.convert("RGB").save(output, format="JPEG", quality=85)
    storage.write(thumb_key, output.getvalue())
    values = metadata.model_dump()
    values["title"] = metadata.title.strip() or Path(filename).stem
    values["page"] = metadata.page if page is None else (metadata.page or 1) + page - 1
    return Panel(
        id=panel_id,
        **values,
        storage_key=key,
        thumbnail_key=thumb_key,
        width=image.width,
        height=image.height,
        source_name=Path(filename).name,
        parent_id=parent_id,
    )
