"""Windows desktop shell for the existing FastAPI + React production studio.

Run from the packaged executable. API remains loopback-only, and each window
gets a single-use, high-entropy bootstrap link instead of displaying a token.
"""

import argparse
import hmac
import json
import logging
import os
import secrets
import socket
import threading
import time
import traceback
import urllib.request
from pathlib import Path

import uvicorn
from fastapi import HTTPException
from fastapi.responses import RedirectResponse

from app.auth import COOKIE, SESSION_AGE, session_cookie
from app.config import ROOT, Settings
from app.main import create_app

LOG = logging.getLogger(__name__)


def create_desktop_app(ticket: str, settings: Settings | None = None):
    app = create_app(settings)
    claimed = False
    claim_lock = threading.Lock()

    @app.get("/__desktop/bootstrap/{provided}", include_in_schema=False)
    def bootstrap(provided: str):
        nonlocal claimed
        with claim_lock:
            if claimed or not hmac.compare_digest(provided, ticket):
                raise HTTPException(status_code=404, detail="Not found")
            claimed = True
        response = RedirectResponse("/", status_code=303)
        response.set_cookie(
            COOKIE,
            session_cookie(app.state.settings.studio_token),
            max_age=SESSION_AGE,
            httponly=True,
            secure=False,  # This is an isolated HTTP loopback window.
            samesite="strict",
            path="/",
        )
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    # The SPA's /{path:path} fallback was registered by create_app first;
    # place this narrow bootstrap route before it or it would never match.
    app.router.routes.insert(0, app.router.routes.pop())
    return app


def serve_desktop(ticket: str):
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    port = listener.getsockname()[1]
    app = create_desktop_app(ticket)
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            workers=1,
            # A windowed PyInstaller process has no stdout/stderr. Uvicorn
            # console formatters assume stderr.isatty() exists.
            log_config=None,
            access_log=False,
            log_level="warning",
        )
    )
    thread = threading.Thread(
        target=server.run,
        kwargs={"sockets": [listener]},
        daemon=True,
        name="comic-beatdowns-api",
    )
    thread.start()
    base_url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(240):
            if not thread.is_alive():
                raise RuntimeError("Studio backend stopped during startup")
            try:
                with urllib.request.urlopen(base_url + "/api/health", timeout=1) as r:
                    result = json.load(r)
                if result.get("status") == "ok":
                    return server, thread, listener, base_url, result
            except (OSError, ValueError):
                pass
            time.sleep(0.125)
        raise RuntimeError("Studio backend did not start")
    except BaseException:
        server.should_exit = True
        thread.join(timeout=5)
        listener.close()
        raise


def run_desktop(*, check: bool = False, ui_check: bool = False):
    if os.name != "nt":
        raise RuntimeError("The desktop executable must be built and run on Windows")
    if not (ROOT / "frontend" / "dist" / "index.html").is_file():
        raise RuntimeError("Bundled React frontend is missing")
    ticket = secrets.token_urlsafe(40)
    server, thread, listener, base_url, health = serve_desktop(ticket)
    try:
        if not health.get("ffmpeg_available"):
            raise RuntimeError("Bundled FFmpeg/FFprobe is missing or incomplete")
        if check:
            with urllib.request.urlopen(base_url + "/", timeout=5) as response:
                content = response.read(100_000)
            if b"Comic Beatdowns Studio" not in content:
                raise RuntimeError("Bundled studio frontend failed to load")
            return
        import webview

        # Video downloads work inside the native Edge/WebView2 window.
        webview.settings["ALLOW_DOWNLOADS"] = True
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
        webview.settings["ALLOW_FILE_URLS"] = False
        window = webview.create_window(
            "Comic Beatdowns Studio",
            url=base_url + "/__desktop/bootstrap/" + ticket,
            width=1440,
            height=920,
            min_size=(980, 650),
            background_color="#0b1117",
        )
        failures = []

        def verify_window():
            try:
                if not window.events.loaded.wait(timeout=45):
                    raise RuntimeError("Native window did not load within 45 seconds")
                for _ in range(100):
                    result = window.evaluate_js(
                        "JSON.stringify({rendered: document.querySelector('#root')?.children.length > 0, "
                        "signedIn: !document.body.innerText.includes('Unlock your studio')})"
                    )
                    state = json.loads(result)
                    if state.get("rendered") and state.get("signedIn"):
                        break
                    time.sleep(0.2)
                else:
                    raise RuntimeError("Native window did not render the signed-in Studio")
                auth_result = []
                auth_ready = threading.Event()

                def authenticated(value):
                    auth_result.append(value)
                    auth_ready.set()

                window.evaluate_js(
                    "fetch('/api/auth/session').then(r => r.json()).then(r => r.authenticated)",
                    callback=authenticated,
                )
                if not auth_ready.wait(timeout=15) or auth_result != [True]:
                    raise RuntimeError("Native window did not receive its private session")
            except Exception as error:
                failures.append(error)
            finally:
                window.destroy()

        webview.start(verify_window if ui_check else None, gui="edgechromium", debug=False)
        if failures:
            raise RuntimeError("Native window smoke test failed") from failures[0]
    finally:
        server.should_exit = True
        thread.join(timeout=8)
        listener.close()


def main():
    parser = argparse.ArgumentParser(description="Comic Beatdowns Studio desktop")
    parser.add_argument("--check", action="store_true", help="Smoke-test packaged assets")
    parser.add_argument("--ui-check", action="store_true", help="Test the native signed-in window")
    args = parser.parse_args()
    try:
        run_desktop(check=args.check, ui_check=args.ui_check)
    except Exception:
        # A windowed PyInstaller app has no console: preserve a local diagnostic.
        log_dir = Path(os.getenv("LOCALAPPDATA") or Path.home()) / "ComicBeatdownsStudio"
        log_dir.mkdir(parents=True, exist_ok=True)
        (log_dir / "desktop-error.log").write_text(traceback.format_exc(), encoding="utf-8")
        if not (args.check or args.ui_check):
            try:
                from ctypes import windll

                windll.user32.MessageBoxW(
                    None,
                    "Comic Beatdowns Studio could not start. See desktop-error.log in your local ComicBeatdownsStudio folder.",
                    "Comic Beatdowns Studio",
                    0x10,
                )
            except Exception:
                pass
        raise SystemExit(1)


if __name__ == "__main__":
    main()
