from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from threading import Lock
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from .api import router
from .auth import authenticated
from .automation import ensure_builtin_effects
from .config import ROOT, Settings
from .database import Template, connect
from .inbox import InboxWatcher
from .limits import BodyLimitMiddleware
from .production import router as production_router
from .renderer import RenderService
from .schemas import VideoSettings
from .storage import LocalStorage


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        config.prepare()
        engine, sessions = connect(config.data_dir)
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="verdict-render")
        app.state.settings, app.state.sessions = config, sessions
        app.state.storage = LocalStorage(config.data_dir)
        app.state.login_attempts = {}
        app.state.render_lock = Lock()
        app.state.caption_lock = Lock()
        app.state.renderer = RenderService(config, app.state.storage, sessions, executor)
        app.state.renderer.recover()
        with sessions() as db:
            ensure_builtin_effects(db, app.state.storage)
            if db.scalar(select(Template.id).limit(1)) is None:
                db.add(Template(name="Verdict · Impact", settings=VideoSettings().model_dump()))
                db.add(
                    Template(
                        name="Clean cuts",
                        settings=VideoSettings(
                            transition="cut", default_motion="hold"
                        ).model_dump(),
                    )
                )
                db.commit()
        watcher = InboxWatcher(config, app.state.storage, sessions)
        app.state.inbox = watcher
        watcher.start()
        yield
        watcher.stop()
        executor.shutdown(wait=True, cancel_futures=False)
        engine.dispose()

    app = FastAPI(
        title="Comic Beatdowns Studio",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )

    @app.middleware("http")
    async def private_studio(request: Request, call_next):
        # Same-origin deployment, no permissive CORS. Vite proxies /api in development.
        if request.method not in {"GET", "HEAD", "OPTIONS"} and request.headers.get("origin"):
            origin = urlsplit(request.headers["origin"])
            allowed = {request.headers.get("host", ""), "localhost:5173", "127.0.0.1:5173"}
            if origin.netloc not in allowed or origin.scheme not in {"http", "https"}:
                return JSONResponse(
                    {"detail": "Cross-origin writes are not allowed"}, status_code=403
                )
        public = {"/api/health", "/api/auth/session", "/api/auth/login", "/api/auth/logout"}
        if request.url.path.startswith("/api/") and request.url.path not in public:
            if not authenticated(request):
                return JSONResponse({"detail": "Sign in to your private studio"}, status_code=401)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/media/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    app.add_middleware(BodyLimitMiddleware, max_bytes=config.max_upload_bytes + 1024 * 1024)
    app.include_router(router)
    app.include_router(production_router)
    dist = ROOT / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def frontend(path: str):
            if path.startswith("api/"):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
