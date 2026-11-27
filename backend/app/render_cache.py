"""Local content-addressed shot cache; includes incoming blend dependencies."""

import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

VISUAL_FIELDS = (
    "duration",
    "motion",
    "motion_strength",
    "easing",
    "focus_x",
    "focus_y",
    "framing",
    "source_crop",
    "glide_axis",
    "glide_start",
    "glide_end",
    "camera_path",
    "path_move_fraction",
    "path_zoom",
    "source_aspect",
    "glide_zoom",
)


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def cache_key(scene, previous, settings, source, previous_tail, size, transition):
    effect, frames = transition(scene, previous, settings)
    data = {
        "version": 1,
        "size": size,
        "fps": settings["fps"],
        "source": digest(source),
        "scene": {k: scene.get(k) for k in VISUAL_FIELDS},
        "transition": [effect, frames],
        "previous_tail": digest(previous_tail) if effect != "cut" and previous_tail else None,
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


class ShotCache:
    def __init__(self, storage):
        self.root = storage.path("work/shot-cache")
        self.root.mkdir(parents=True, exist_ok=True)

    def restore(self, key, output, tail):
        entry = self.root / key
        try:
            manifest = json.loads((entry / "manifest.json").read_text())
            for name in ("video.mp4", "tail.png"):
                if digest(entry / name) != manifest[name]:
                    raise ValueError("Incomplete cached shot")
            shutil.copyfile(entry / "video.mp4", output)
            shutil.copyfile(entry / "tail.png", tail)
            os.utime(entry, None)
            return True
        except (OSError, ValueError, KeyError, TypeError):
            shutil.rmtree(entry, ignore_errors=True)
            return False

    def save(self, key, output, tail):
        entry = self.root / key
        if entry.exists():
            return
        with tempfile.TemporaryDirectory(dir=self.root, prefix="partial-") as temporary:
            pending = Path(temporary) / "entry"
            pending.mkdir()
            shutil.copyfile(output, pending / "video.mp4")
            shutil.copyfile(tail, pending / "tail.png")
            (pending / "manifest.json").write_text(
                json.dumps({name: digest(pending / name) for name in ("video.mp4", "tail.png")})
            )
            os.replace(pending, entry)

    def invalidate(self, key):
        shutil.rmtree(self.root / key, ignore_errors=True)

    def prune(self, maximum=1024 * 1024 * 1024):
        entries = []
        for path in self.root.iterdir():
            if path.is_dir():
                files = list(path.iterdir())
                entries.append(
                    (
                        path.stat().st_mtime,
                        path,
                        sum(p.stat().st_size for p in files if p.is_file()),
                    )
                )
        total = sum(e[2] for e in entries)
        for _, path, size in sorted(entries):
            if total <= maximum and not path.name.startswith("partial-"):
                continue
            shutil.rmtree(path, ignore_errors=True)
            total -= size
