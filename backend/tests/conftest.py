import io
import wave

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.config import Settings
from app.main import create_app

TOKEN = "test-only-studio-token-not-a-real-secret"


@pytest.fixture
def settings(tmp_path):
    return Settings(data_dir=tmp_path, studio_token=TOKEN)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        client.headers["Authorization"] = f"Bearer {TOKEN}"
        yield client


@pytest.fixture
def image_bytes():
    image = Image.new("RGB", (480, 720), "#103343")
    draw = ImageDraw.Draw(image)
    draw.rectangle((50, 60, 420, 600), outline="#66dddd", width=10)
    draw.text((80, 300), "ORIGINAL TEST PANEL", fill="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def wav_bytes(duration=1.5):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\0\0" * round(16000 * duration))
    return buffer.getvalue()


def add_panel(client, image_bytes, title="Placeholder panel"):
    response = client.post(
        "/api/panels/import",
        files=[("files", ("original.png", image_bytes, "image/png"))],
        data={
            "metadata": '{"title": "'
            + title
            + '", "series": "Test Originals", "issue": "7", "characters": "Azure, Slate", "fight": "A fictional test skirmish"}'
        },
    )
    assert response.status_code == 201, response.text
    return response.json()[0]


def add_project(client):
    response = client.post(
        "/api/projects", json={"title": "The test beatdown", "idea": "Roast the bad decision"}
    )
    assert response.status_code == 201, response.text
    return response.json()
