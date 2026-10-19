from pathlib import Path, PurePosixPath
from typing import Protocol


class Storage(Protocol):
    """Replace this adapter for object storage; keys remain database-independent."""

    def path(self, key: str) -> Path: ...
    def write(self, key: str, content: bytes) -> None: ...
    def delete(self, key: str) -> None: ...


class LocalStorage:
    PUBLIC_PREFIXES = {"panels", "narration", "sfx", "exports", "music", "logos"}

    def __init__(self, root: Path):
        self.root = root.resolve()

    def path(self, key: str) -> Path:
        parsed = PurePosixPath(key)
        if parsed.is_absolute() or ".." in parsed.parts or "\\" in key:
            raise ValueError("Invalid storage key")
        target = (self.root / key).resolve()
        if not target.is_relative_to(self.root):
            raise ValueError("Invalid storage key")
        return target

    def public_path(self, key: str) -> Path:
        if key.split("/")[0] not in self.PUBLIC_PREFIXES:
            raise ValueError("This file is private")
        return self.path(key)

    def write(self, key: str, content: bytes) -> None:
        target = self.path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def delete(self, key: str) -> None:
        self.path(key).unlink(missing_ok=True)


def media_url(key: str | None) -> str | None:
    return f"/api/media/{key}" if key else None
