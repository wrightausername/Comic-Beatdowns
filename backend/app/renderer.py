import json
import logging
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageOps
from sqlalchemy import select

from .database import Project, RenderJob, now

logger = logging.getLogger(__name__)


def run(command: list[str], *, cwd=None, timeout=600) -> str:
    try:
        result = subprocess.run(
            command, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False
        )
    except FileNotFoundError as e:
        raise ValueError("FFmpeg/FFprobe is not installed. See README setup instructions.") from e
    except subprocess.TimeoutExpired as e:
        raise ValueError("Media processing exceeded its time limit") from e
    if result.returncode:
        logger.error("Media command failed: %s", result.stderr[-4000:])
        raise ValueError("FFmpeg could not process this media. Check the server log for details.")
    return result.stdout


def probe(path: Path, settings) -> dict:
    output = run(
        [
            settings.ffprobe,
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name,width,height",
            "-of",
            "json",
            str(path),
        ],
        timeout=20,
    )
    try:
        result = json.loads(output)
        duration = float(result["format"]["duration"])
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError
        result["duration"] = duration
        return result
    except (KeyError, ValueError, TypeError) as e:
        raise ValueError("Media must have a valid, finite duration") from e


def normalize_audio(raw: Path, output: Path, settings, max_duration=180) -> float:
    result = probe(raw, settings)
    if not any(s["codec_type"] == "audio" for s in result["streams"]):
        raise ValueError("The upload contains no audio stream")
    if result["duration"] > max_duration:
        raise ValueError(f"Audio must be at most {max_duration} seconds")
    output.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            settings.ffmpeg,
            "-y",
            "-nostdin",
            "-v",
            "error",
            "-threads",
            "2",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            str(raw),
            "-map",
            "0:a:0",
            "-vn",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            "-t",
            str(max_duration),
            str(output),
        ],
        timeout=60,
    )
    return probe(output, settings)["duration"]


def scene_frames(duration: float, fps: int) -> int:
    return max(1, math.floor(duration * fps + 0.5))


def prepare_scene_image(source: Path, target: Path):
    # Fit before FFmpeg scaling so extreme source aspect ratios cannot allocate
    # an enormous intermediate frame. Pillow crops before resizing.
    with Image.open(source) as image:
        frame = ImageOps.fit(image, (1080, 1920), method=Image.Resampling.LANCZOS)
        frame.convert("RGB").save(target, "PNG")


def timeline_duration(scenes: list[dict], fps: int) -> float:
    return sum(scene_frames(s["duration"], fps) for s in scenes) / fps


def scene_filter(scene, fps, transition):
    frames = scene_frames(scene["duration"], fps)
    ratio = f"on/{max(1, frames - 1)}"
    motion = scene["motion"]
    zoom = {
        "zoom_in": f"1+0.10*{ratio}",
        "zoom_out": f"1.10-0.10*{ratio}",
        "pan_left": "1.10",
        "pan_right": "1.10",
        "hold": "1",
    }[motion]
    x = "iw/2-iw/zoom/2"
    if motion == "pan_left":
        x = f"(iw-iw/zoom)*(1-{ratio})"
    if motion == "pan_right":
        x = f"(iw-iw/zoom)*{ratio}"
    filters = (
        "scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,setsar=1,"
        f"zoompan=z='{zoom}':x='{x}':y='ih/2-ih/zoom/2':d={frames}:s=1080x1920:fps={fps},"
        "format=yuv420p"
    )
    duration = frames / fps
    if transition == "fade":
        fade = min(0.15, duration / 4)
        filters += f",fade=t=in:st=0:d={fade},fade=t=out:st={duration - fade}:d={fade}"
    return filters


def ass_time(seconds):
    centiseconds = round(seconds * 100)
    return f"{centiseconds // 360000}:{centiseconds // 6000 % 60:02}:{centiseconds // 100 % 60:02}.{centiseconds % 100:02}"


def ass_text(text):
    # Prevent ASS override commands and line-break escapes in user text.
    return (
        text.replace("\\", "\\\\")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("\r", "")
        .replace("\n", "\\N")
    )


def write_captions(scenes, fps, path):
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,62,&H00FFFFFF,&H00FFFFFF,&H0015100A,&H90000000,-1,0,0,0,100,100,0,0,1,4,1,2,90,90,320,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    cursor = 0
    for scene in scenes:
        end = cursor + scene_frames(scene["duration"], fps) / fps
        if scene["caption"].strip():
            events.append(
                f"Dialogue: 0,{ass_time(cursor)},{ass_time(end)},Default,,0,0,0,,{ass_text(scene['caption'])}\n"
            )
        cursor = end
    path.write_text(header + "".join(events), encoding="utf-8")


class RenderService:
    """One bounded worker, persistent job snapshots, explicit interrupted-job recovery.

    For multi-host deployment, replace the executor with a durable task queue.
    Run exactly one ASGI worker in this SQLite/local-storage MVP.
    """

    def __init__(self, settings, storage, sessions, executor):
        self.settings, self.storage = settings, storage
        self.sessions, self.executor = sessions, executor

    def recover(self):
        with self.sessions() as db:
            for job in db.scalars(
                select(RenderJob).where(RenderJob.status.in_(["queued", "running"]))
            ):
                job.status, job.error, job.finished_at = (
                    "failed",
                    "Render interrupted by a server restart. Render again.",
                    now(),
                )
            for project in db.scalars(select(Project).where(Project.status == "rendering")):
                project.status = "ready" if project.script_approved else "scripting"
            db.commit()

    def enqueue(self, job_id):
        self.executor.submit(self.render, job_id)

    def progress(self, job_id, value):
        with self.sessions() as db:
            job = db.get(RenderJob, job_id)
            job.status, job.progress = "running", value
            db.commit()

    def render(self, job_id):
        output_key = f"exports/{job_id}.mp4"
        output = self.storage.path(output_key)
        try:
            with self.sessions() as db:
                job = db.get(RenderJob, job_id)
                snapshot = job.snapshot
            self.progress(job_id, 1)
            self.storage.path("work").mkdir(parents=True, exist_ok=True)
            output.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=self.storage.path("work")) as directory:
                work = Path(directory)
                scenes, settings = snapshot["scenes"], snapshot["settings"]
                fps = settings["fps"]
                for i, scene in enumerate(scenes):
                    image_path = work / f"panel-{i}.png"
                    prepare_scene_image(self.storage.path(scene["storage_key"]), image_path)
                    run(
                        [
                            self.settings.ffmpeg,
                            "-y",
                            "-nostdin",
                            "-v",
                            "error",
                            "-filter_threads",
                            "1",
                            "-i",
                            str(image_path),
                            "-vf",
                            scene_filter(scene, fps, settings["transition"]),
                            "-frames:v",
                            str(scene_frames(scene["duration"], fps)),
                            "-an",
                            "-c:v",
                            "libx264",
                            "-preset",
                            "veryfast",
                            "-crf",
                            "20",
                            "-threads",
                            "2",
                            str(work / f"scene-{i}.mp4"),
                        ]
                    )
                    self.progress(job_id, 5 + round(70 * (i + 1) / len(scenes)))
                (work / "segments.txt").write_text(
                    "".join(f"file 'scene-{i}.mp4'\n" for i in range(len(scenes)))
                )
                write_captions(scenes, fps, work / "captions.ass")
                total = timeline_duration(scenes, fps)
                command = [
                    self.settings.ffmpeg,
                    "-y",
                    "-nostdin",
                    "-v",
                    "error",
                    "-filter_complex_threads",
                    "1",
                    "-f",
                    "concat",
                    "-safe",
                    "1",
                    "-i",
                    "segments.txt",
                    "-i",
                    str(self.storage.path(snapshot["narration_key"])),
                ]
                audio_filters = [
                    f"[1:a]aresample=48000,apad,atrim=duration={total},asetpts=PTS-STARTPTS[voice]"
                ]
                tracks = ["[voice]"]
                cursor, input_index = 0, 2
                for scene in scenes:
                    if scene.get("sfx_key"):
                        command += ["-i", str(self.storage.path(scene["sfx_key"]))]
                        audio_filters.append(
                            f"[{input_index}:a]atrim=duration={scene_frames(scene['duration'], fps) / fps},"
                            f"asetpts=PTS-STARTPTS,volume=0.35,adelay={round(cursor * 1000)}:all=1[sfx{input_index}]"
                        )
                        tracks.append(f"[sfx{input_index}]")
                        input_index += 1
                    cursor += scene_frames(scene["duration"], fps) / fps
                audio_filters.append(
                    "".join(tracks)
                    + f"amix=inputs={len(tracks)}:duration=first:normalize=0,alimiter=limit=0.95[audio]"
                )
                command += [
                    "-filter_complex",
                    ";".join(audio_filters),
                    "-map",
                    "0:v:0",
                    "-map",
                    "[audio]",
                ]
                if settings["captions"] and any(s["caption"].strip() for s in scenes):
                    command += [
                        "-vf",
                        "subtitles=captions.ass",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-crf",
                        "20",
                    ]
                else:
                    command += ["-c:v", "copy"]
                command += [
                    "-threads",
                    "2",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-t",
                    str(total),
                    "-movflags",
                    "+faststart",
                    str(output),
                ]
                self.progress(job_id, 80)
                run(command, cwd=work)
                media = probe(output, self.settings)
                video = next((s for s in media["streams"] if s["codec_type"] == "video"), {})
                if video.get("width") != 1080 or video.get("height") != 1920:
                    raise ValueError("Export validation failed: incorrect output dimensions")
            with self.sessions() as db:
                job = db.get(RenderJob, job_id)
                job.status, job.progress, job.output_key, job.finished_at = (
                    "completed",
                    100,
                    output_key,
                    now(),
                )
                project = db.get(Project, job.project_id)
                if project.revision == job.project_revision:
                    project.status = "exported"
                db.commit()
        except Exception as e:
            logger.exception("Render job %s failed", job_id)
            output.unlink(missing_ok=True)
            with self.sessions() as db:
                job = db.get(RenderJob, job_id)
                job.status, job.error, job.finished_at = "failed", str(e)[:1500], now()
                project = db.get(Project, job.project_id)
                if project.revision == job.project_revision:
                    project.status = "ready"
                db.commit()


def tools_available(settings):
    return bool(shutil.which(settings.ffmpeg) and shutil.which(settings.ffprobe))
