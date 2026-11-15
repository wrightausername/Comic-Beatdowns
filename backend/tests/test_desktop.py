"""Desktop packaging and private one-time login contracts."""

from fastapi.testclient import TestClient

from app.config import Settings
from app.desktop import create_desktop_app


def test_desktop_bootstrap_is_private_and_single_use(settings):
    ticket = "desktop-one-time-test-ticket-with-lots-of-entropy"
    with TestClient(create_desktop_app(ticket, settings)) as client:
        assert client.get("/api/auth/session").json() == {"authenticated": False}
        assert client.get("/__desktop/bootstrap/incorrect").status_code == 404
        result = client.get("/__desktop/bootstrap/" + ticket, follow_redirects=False)
        assert result.status_code == 303
        assert result.headers["location"] == "/"
        assert "cb_studio_session=" in result.headers["set-cookie"]
        assert "httponly" in result.headers["set-cookie"].lower()
        assert client.get("/api/auth/session").json() == {"authenticated": True}
        assert client.get("/__desktop/bootstrap/" + ticket).status_code == 404


def test_frozen_settings_use_bundled_assets(monkeypatch, tmp_path):
    from app import config

    monkeypatch.setattr(config.sys, "frozen", True, raising=False)
    monkeypatch.setattr(config, "ROOT", tmp_path)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "user-data"))
    monkeypatch.delenv("CB_DATA_DIR", raising=False)
    monkeypatch.delenv("CB_FFMPEG", raising=False)
    monkeypatch.delenv("CB_FFPROBE", raising=False)
    tools = tmp_path / "media-tools"
    tools.mkdir()
    (tools / "ffmpeg.exe").touch()
    (tools / "ffprobe.exe").touch()
    settings = Settings()
    assert settings.data_dir == tmp_path / "user-data" / "ComicBeatdownsStudio"
    assert settings.ffmpeg == str(tools / "ffmpeg.exe")
    assert settings.ffprobe == str(tools / "ffprobe.exe")


def test_desktop_starts_without_console_streams(monkeypatch, settings):
    import sys
    from app import desktop

    create_app = desktop.create_desktop_app
    monkeypatch.setattr(desktop, "create_desktop_app", lambda ticket: create_app(ticket, settings))
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)
    server, thread, listener, base_url, health = desktop.serve_desktop("private-test-ticket")
    try:
        assert base_url.startswith("http://127.0.0.1:")
        assert health["status"] == "ok"
    finally:
        server.should_exit = True
        thread.join(timeout=8)
        listener.close()
    assert not thread.is_alive()
