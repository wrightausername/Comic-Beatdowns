"""Authenticated local readiness checks; never print access tokens or headers."""

import httpx
from app.config import Settings

settings = Settings()
settings.prepare()
with httpx.Client(base_url="http://127.0.0.1:8000", timeout=10) as client:
    health = client.get("/api/health")
    health.raise_for_status()
    assert health.json()["ffmpeg_available"], "FFmpeg/FFprobe is missing"
    frontend = client.get("/")
    frontend.raise_for_status()
    assert "Comic Beatdowns Studio" in frontend.text, (
        "Build the frontend with make setup"
    )
    projects = client.get(
        "/api/projects", headers={"Authorization": f"Bearer {settings.studio_token}"}
    )
    projects.raise_for_status()
    assert isinstance(projects.json(), list)
    assert client.get("/api/panels").status_code == 401, (
        "API authentication must be enabled"
    )
print(
    "Studio ready: frontend, authenticated database API, private media boundary, and FFmpeg tools."
)
