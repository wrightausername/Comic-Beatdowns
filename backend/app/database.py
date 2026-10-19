from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    event,
    inspect,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def uid() -> str:
    return uuid4().hex


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class Panel(Base):
    __tablename__ = "panels"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    title: Mapped[str] = mapped_column(String)
    series: Mapped[str] = mapped_column(String, default="")
    issue: Mapped[str] = mapped_column(String, default="")
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    characters: Mapped[str] = mapped_column(String, default="")
    fight: Mapped[str] = mapped_column(Text, default="")
    source_name: Mapped[str] = mapped_column(String, default="")
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("panels.id"), nullable=True)
    storage_key: Mapped[str] = mapped_column(String)
    thumbnail_key: Mapped[str] = mapped_column(String)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    title: Mapped[str] = mapped_column(String)
    idea: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="idea")
    script: Mapped[str] = mapped_column(Text, default="")
    script_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    narration_key: Mapped[str | None] = mapped_column(String, nullable=True)
    narration_duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    caption_cues: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    edit_history: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    music_key: Mapped[str | None] = mapped_column(String, nullable=True)
    music_duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    logo_key: Mapped[str | None] = mapped_column(String, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now)


class Scene(Base):
    __tablename__ = "scenes"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    panel_id: Mapped[str] = mapped_column(ForeignKey("panels.id"))
    position: Mapped[int] = mapped_column(Integer)
    duration: Mapped[float] = mapped_column(Float, default=5)
    motion: Mapped[str] = mapped_column(String, default="zoom_in")
    motion_strength: Mapped[float] = mapped_column(Float, default=0.1, server_default="0.1")
    easing: Mapped[str] = mapped_column(String, default="smooth", server_default="linear")
    focus_x: Mapped[float] = mapped_column(Float, default=0.5, server_default="0.5")
    focus_y: Mapped[float] = mapped_column(Float, default=0.5, server_default="0.5")
    transition: Mapped[str | None] = mapped_column(String, nullable=True)
    transition_duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    caption: Mapped[str] = mapped_column(String, default="")
    sfx_key: Mapped[str | None] = mapped_column(String, nullable=True)


class RenderJob(Base):
    __tablename__ = "render_jobs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    project_revision: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String, default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    snapshot: Mapped[dict] = mapped_column(JSON)
    output_key: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)


class Template(Base):
    __tablename__ = "templates"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String)
    settings: Mapped[dict] = mapped_column(JSON)
    logo_key: Mapped[str | None] = mapped_column(String, nullable=True)
    music_key: Mapped[str | None] = mapped_column(String, nullable=True)
    music_duration: Mapped[float | None] = mapped_column(Float, nullable=True)


def connect(data_dir):
    engine = create_engine(
        f"sqlite:///{data_dir / 'studio.sqlite3'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    @event.listens_for(engine, "connect")
    def pragmas(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=30000")

    Base.metadata.create_all(engine)
    migrate_scene_options(engine)
    with engine.begin() as connection:
        existing = {c["name"] for c in inspect(connection).get_columns("projects")}
        for name, definition in {
            "caption_cues": "JSON NOT NULL DEFAULT '[]'",
            "edit_history": "JSON NOT NULL DEFAULT '{}'",
            "music_key": "VARCHAR",
            "music_duration": "FLOAT",
            "logo_key": "VARCHAR",
        }.items():
            if name not in existing:
                connection.exec_driver_sql(f'ALTER TABLE projects ADD COLUMN "{name}" {definition}')
        existing = {c["name"] for c in inspect(connection).get_columns("templates")}
        for name, definition in {
            "logo_key": "VARCHAR",
            "music_key": "VARCHAR",
            "music_duration": "FLOAT",
        }.items():
            if name not in existing:
                connection.exec_driver_sql(
                    f'ALTER TABLE templates ADD COLUMN "{name}" {definition}'
                )
    return engine, sessionmaker(engine, expire_on_commit=False)


def migrate_scene_options(engine):
    """Add optional controls in place; keep existing panels, order, audio, and scripts."""
    additions = {
        "motion_strength": "FLOAT NOT NULL DEFAULT 0.1",
        "easing": "VARCHAR NOT NULL DEFAULT 'linear'",
        "focus_x": "FLOAT NOT NULL DEFAULT 0.5",
        "focus_y": "FLOAT NOT NULL DEFAULT 0.5",
        "transition": "VARCHAR",
        "transition_duration": "FLOAT",
    }
    with engine.begin() as connection:
        existing = {c["name"] for c in inspect(connection).get_columns("scenes")}
        for name, definition in additions.items():
            if name not in existing:
                connection.exec_driver_sql(f'ALTER TABLE scenes ADD COLUMN "{name}" {definition}')
