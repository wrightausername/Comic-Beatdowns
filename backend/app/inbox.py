"""Opt-in, project-scoped Windows/Linux inbox. Never traverses arbitrary folders."""

import hashlib
import logging
from threading import Event, Thread

from sqlalchemy import select, text

from .database import InboxFile, Project
from .production import classify_file, ingest_file

logger = logging.getLogger(__name__)


class InboxWatcher:
    def __init__(self, config, storage, sessions):
        self.config, self.storage, self.sessions = config, storage, sessions
        self.stop_event = Event()
        self.observed = {}
        self.thread = Thread(target=self.loop, name="verdict-inbox", daemon=True)

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=65)

    def loop(self):
        while not self.stop_event.wait(3):
            try:
                self.scan()
            except Exception:
                logger.exception("Inbox scan failed")

    def scan(self):
        with self.sessions() as db:
            ids = list(db.scalars(select(Project.id).where(Project.watch_enabled.is_(True))))
        for project_id in ids:
            folder = self.storage.path(f"inbox/{project_id}")
            folder.mkdir(parents=True, exist_ok=True)
            # Flat, bounded scans. A file must be unchanged across two passes.
            for index, path in enumerate(folder.iterdir()):
                if self.stop_event.is_set() or index >= 200:
                    break
                if path.is_symlink() or not path.is_file() or path.name.startswith("."):
                    continue
                signature = (path.stat().st_size, path.stat().st_mtime_ns)
                key = (project_id, path.name)
                previous = self.observed.get(key)
                self.observed[key] = signature
                if previous != signature:
                    continue
                if signature[0] > self.config.max_upload_bytes:
                    raw, digest = None, f"oversize:{signature}"
                else:
                    raw = path.read_bytes()
                    if (path.stat().st_size, path.stat().st_mtime_ns) != signature:
                        continue
                    digest = hashlib.sha256(raw).hexdigest()
                with self.sessions() as db:
                    db.execute(text("BEGIN IMMEDIATE"))
                    project = db.get(Project, project_id)
                    if not project.watch_enabled:
                        continue
                    if db.scalar(
                        select(InboxFile.id).where(
                            InboxFile.project_id == project_id, InboxFile.digest == digest
                        )
                    ):
                        continue
                    try:
                        if raw is None:
                            raise ValueError("File exceeds 64 MB")
                        kind = classify_file(path.name)
                        message = ingest_file(
                            db,
                            project,
                            raw,
                            path.name,
                            kind,
                            self.storage,
                            self.config,
                            commit=False,
                        )
                        status = "imported"
                    except Exception as error:
                        db.rollback()
                        status, message = "failed", str(error)[:500]
                    db.add(
                        InboxFile(
                            project_id=project_id,
                            filename=path.name,
                            digest=digest,
                            status=status,
                            message=message,
                        )
                    )
                    db.commit()
