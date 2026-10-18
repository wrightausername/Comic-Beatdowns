import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("CB_DATA_DIR", ROOT / ".data")))
    studio_token: str = field(default_factory=lambda: os.getenv("CB_STUDIO_TOKEN", ""))
    cookie_secure: bool = field(
        default_factory=lambda: os.getenv("CB_COOKIE_SECURE", "false").lower() == "true"
    )
    ffmpeg: str = field(default_factory=lambda: os.getenv("CB_FFMPEG", "ffmpeg"))
    ffprobe: str = field(default_factory=lambda: os.getenv("CB_FFPROBE", "ffprobe"))
    ai_base_url: str = field(default_factory=lambda: os.getenv("CB_AI_BASE_URL", ""))
    ai_key: str = field(default_factory=lambda: os.getenv("CB_AI_API_KEY", ""))
    ai_model: str = field(default_factory=lambda: os.getenv("CB_AI_MODEL", ""))
    max_upload_bytes: int = 64 * 1024 * 1024
    max_panels_per_import: int = 100

    def prepare(self) -> None:
        self.data_dir = self.data_dir.resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not self.studio_token:
            token_path = self.data_dir / ".studio-token"
            try:
                with open(
                    token_path, "x", opener=lambda path, flags: os.open(path, flags, 0o600)
                ) as f:
                    f.write(secrets.token_urlsafe(32))
            except FileExistsError:
                pass
            self.studio_token = token_path.read_text().strip()
        if len(self.studio_token) < 16:
            raise ValueError("CB_STUDIO_TOKEN must have at least 16 characters")
