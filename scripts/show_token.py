"""Explicit local operator command; never used by setup or tests."""

from app.config import Settings

settings = Settings()
settings.prepare()
print(settings.studio_token)
