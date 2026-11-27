"""Bounded offline reference-video measurements, not semantic/plugin recognition."""

import array
import math
import statistics
import subprocess
import sys
from collections import Counter

from PIL import Image, ImageChops, ImageStat

from .processes import run as run_process
from .renderer import probe

SAMPLE_FPS = 10
SIZE = (96, 54)
LIMITS = (
    "Local visual measurements suggest cuts, short dips/flashes, gradual blends and camera-motion cues. "
    "Motion inside the footage can resemble camera motion; inspect the suggestions. "
    "Text animation, masks, object isolation, sound design, grading and third-party effects are not identified or copied. "
    "Only timing and supported editable effects are transferred; reference artwork, voices and music stay out of your video."
)


def audio_accents(path, settings, start, duration, has_audio):
    if not has_audio:
        return {"available": False, "accents": [], "reason": "The reference has no audio stream"}
    try:
        result = run_process(
            [
                settings.ffmpeg,
                "-nostdin",
                "-v",
                "error",
                "-threads",
                "2",
                "-format_whitelist",
                "mov,matroska,webm",
                "-protocol_whitelist",
                "file,pipe",
                "-ss",
                str(start),
                "-i",
                str(path),
                "-t",
                str(duration),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "s16le",
                "-",
            ],
            capture_output=True,
            timeout=40,
        )
        if result.returncode:
            raise ValueError
        samples = array.array("h", result.stdout)
        if sys.byteorder != "little":
            samples.byteswap()
        rms = [
            math.sqrt(sum(v * v for v in samples[i : i + 640]) / max(1, len(samples[i : i + 640])))
            / 32768
            for i in range(0, len(samples), 640)
        ]
        accents = []
        for i in range(1, len(rms) - 1):
            baseline = statistics.median(rms[max(0, i - 12) : i] or [0])
            if (
                rms[i] > max(0.03, baseline * 2.5)
                and rms[i] >= max(rms[i - 1], rms[i + 1])
                and (not accents or i * 0.04 - accents[-1] >= 0.25)
            ):
                accents.append(round(i * 0.04, 3))
        return {
            "available": True,
            "accents": accents[:240],
            "reason": "Measured audio transients; speech and music can both produce these accents. Audio is not copied.",
        }
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {
            "available": False,
            "accents": [],
            "reason": "Audio-transient analysis was unavailable",
        }


def difference(a, b):
    return sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / (3 * 255)


def alignment(a, b):
    # Compare a safe central area so offset wrapping cannot imitate a good match.
    box = (8, 6, SIZE[0] - 8, SIZE[1] - 6)
    target = b.crop(box)
    baseline = difference(a.crop(box), target)
    best = (baseline, 0, 0)
    for x, y in ((-6, 0), (-3, 0), (3, 0), (6, 0), (0, -4), (0, -2), (0, 2), (0, 4)):
        score = difference(ImageChops.offset(a, x, y).crop(box), target)
        if score < best[0]:
            best = (score, x, y)
    return baseline, best


def motion_cue(a, b):
    baseline, (score, x, y) = alignment(a, b)
    if baseline > 0.015 and score < baseline * 0.72:
        return ("pan_left" if x > 0 else "pan_right") if x else ("pan_up" if y > 0 else "pan_down")
    best_zoom = (baseline, "hold")
    for scale, motion in ((1.08, "zoom_in"), (1.16, "zoom_in"), (0.92, "zoom_out")):
        width, height = round(SIZE[0] * scale), round(SIZE[1] * scale)
        resized = a.resize((width, height))
        resized = resized.crop(
            (
                (width - SIZE[0]) // 2,
                (height - SIZE[1]) // 2,
                (width + SIZE[0]) // 2,
                (height + SIZE[1]) // 2,
            )
        )
        # Exclude padded edges for zoom-out candidates.
        score = difference(resized.crop((10, 8, 86, 46)), b.crop((10, 8, 86, 46)))
        if score < best_zoom[0]:
            best_zoom = score, motion
    return best_zoom[1] if baseline > 0.015 and best_zoom[0] < baseline * 0.65 else "hold"


def segment_motion(frames, first, last):
    if last <= first:
        return "hold"
    global_cue = motion_cue(frames[first], frames[last])
    step = min(3, last - first)
    points = sorted({first, (first + last - step) // 2, last - step})
    votes = Counter(motion_cue(frames[i], frames[i + step]) for i in points)
    motion, count = votes.most_common(1)[0]
    return motion if motion != "hold" and count >= 2 else global_cue


def representative_indices(beats, limit=240):
    if limit < 2:
        raise ValueError("A reference summary needs at least its opening and ending beats")
    if len(beats) <= limit:
        return list(range(len(beats)))
    # Preserve the full arc plus distinctive long holds and effect moments.
    selected = {0, len(beats) - 1}
    selected.update(
        sorted(range(len(beats)), key=lambda i: -beats[i]["seconds"])[: min(24, limit // 4)]
    )
    effects = [i for i, beat in enumerate(beats) if beat["transition"] not in {"cut", "crossfade"}]
    effect_slots = min(32, len(effects), max(0, limit - len(selected)))
    if effect_slots:
        selected.update(
            effects[round(i * (len(effects) - 1) / max(1, effect_slots - 1))]
            for i in range(effect_slots)
        )
    remaining = [i for i in range(len(beats)) if i not in selected]
    slots = limit - len(selected)
    selected.update(
        remaining[round(i * (len(remaining) - 1) / max(1, slots - 1))] for i in range(slots)
    )
    return sorted(selected)


def analyze_reference(path, settings, start=0, end=None):
    metadata = probe(path, settings, formats="mov,matroska,webm")
    video = next((s for s in metadata["streams"] if s["codec_type"] == "video"), None)
    if video is None:
        raise ValueError("Choose a video file with a video stream")
    if (
        not video.get("width")
        or not video.get("height")
        or video["width"] * video["height"] > 34_000_000
    ):
        raise ValueError("Reference video dimensions are unsupported; use a clip up to 8K")
    duration = metadata["duration"]
    end = min(duration, start + 60) if end is None else end
    if (
        not all(math.isfinite(n) for n in (start, end))
        or not 0 <= start < end <= duration + 0.05
        or not 0.5 <= end - start <= 180
    ):
        raise ValueError("Select 0.5–180 seconds within the reference video")
    end = min(end, duration)
    result = run_process(
        [
            settings.ffmpeg,
            "-format_whitelist",
            "mov,matroska,webm",
            "-nostdin",
            "-v",
            "error",
            "-threads",
            "2",
            "-filter_threads",
            "1",
            "-protocol_whitelist",
            "file,pipe",
            "-ss",
            str(start),
            "-i",
            str(path),
            "-t",
            str(end - start),
            "-map",
            "0:v:0",
            "-an",
            "-sn",
            "-dn",
            "-vf",
            f"fps={SAMPLE_FPS},scale={SIZE[0]}:{SIZE[1]},format=rgb24",
            "-frames:v",
            str(180 * SAMPLE_FPS),
            "-threads",
            "2",
            "-f",
            "rawvideo",
            "-",
        ],
        capture_output=True,
        timeout=75,
    )
    if result.returncode:
        raise ValueError("This reference could not be decoded. Try an MP4, MOV or WebM clip.")
    frame_bytes = SIZE[0] * SIZE[1] * 3
    frames = [
        Image.frombytes("RGB", SIZE, result.stdout[i : i + frame_bytes])
        for i in range(0, len(result.stdout) - frame_bytes + 1, frame_bytes)
    ]
    if len(frames) < 3:
        raise ValueError("The selected range contains too few video frames to analyze")
    if abs(len(frames) / SAMPLE_FPS - (end - start)) > 0.25:
        raise ValueError(
            "The selected range could not be fully decoded. Choose a shorter range within the visible video."
        )
    luminance, spreads = [], []
    for frame in frames:
        stats = ImageStat.Stat(frame.convert("L"))
        luminance.append(stats.mean[0] / 255)
        spreads.append(stats.stddev[0] / 255)
    events = []
    i = 1
    # Short solid light/dark dips are effect cues, not statements about artistic intent.
    while i < len(frames) - 1:
        white, black = luminance[i] > 0.94, luminance[i] < 0.035
        if spreads[i] < 0.035 and (white or black):
            j = i + 1
            while (
                j < len(frames)
                and spreads[j] < 0.035
                and (luminance[j] > 0.94 if white else luminance[j] < 0.035)
            ):
                j += 1
            if (
                j < len(frames)
                and (j - i) / SAMPLE_FPS <= 0.8
                and abs(luminance[i - 1] - luminance[i]) > 0.12
                and abs(luminance[j] - luminance[i]) > 0.12
            ):
                events.append(
                    {
                        "time": round((i + j) / (2 * SAMPLE_FPS), 3),
                        "transition": "dip_white" if white else "fade",
                        "duration": round(max(0.08, (j - i) / SAMPLE_FPS), 3),
                        "evidence": "Brief nearly uniform white frames"
                        if white
                        else "Brief nearly uniform dark frames",
                        "approximate": True,
                    }
                )
            i = j
        else:
            i += 1
    deltas = [0, *[difference(a, b) for a, b in zip(frames, frames[1:])]]
    hard_events = []
    for i in range(1, len(frames)):
        stamp = i / SAMPLE_FPS
        if any(abs(e["time"] - stamp) < max(0.35, e["duration"]) for e in events):
            continue
        score = deltas[i]
        neighbors = deltas[max(1, i - 4) : i] + deltas[i + 1 : i + 5]
        background_change = statistics.median(neighbors or [0])
        if score > 0.18 or score > max(0.05, background_change * 3.5):
            _, (residual, _, _) = alignment(frames[i - 1], frames[i])
            if residual > 0.14 or residual > max(0.04, background_change * 2.5):
                hard_events.append(
                    {
                        "time": stamp,
                        "transition": "cut",
                        "duration": 0.12,
                        "evidence": "Abrupt visual change remains after coarse motion compensation",
                        "approximate": True,
                    }
                )
    # A three-frame blend is only a candidate: moving artwork can produce a similar signal.
    for i in range(2, len(frames) - 2):
        stamp = i / SAMPLE_FPS
        if any(abs(e["time"] - stamp) < 0.45 for e in events):
            continue
        left, middle, right = frames[i - 2], frames[i], frames[i + 2]
        spread = difference(left, right)
        if (
            spread > 0.2
            and difference(left, middle) > 0.06
            and difference(middle, right) > 0.06
            and difference(Image.blend(left, right, 0.5), middle) < 0.025
        ):
            _, (residual, _, _) = alignment(left, right)
            if residual > 0.16:
                events.append(
                    {
                        "time": stamp,
                        "transition": "crossfade",
                        "duration": 0.4,
                        "evidence": "Gradual visual blend candidate; verify against the reference",
                        "approximate": True,
                    }
                )
    # Keep a gradual-blend candidate intact instead of calling each blend frame a cut.
    detected_effects = tuple(events)
    events.extend(
        event
        for event in hard_events
        if not any(
            abs(event["time"] - candidate["time"]) < max(0.35, candidate["duration"])
            for candidate in detected_effects
        )
    )
    events.sort(key=lambda e: e["time"])
    filtered = []
    for event in events:
        if (
            event["time"] >= 0.25
            and (not filtered or event["time"] - filtered[-1]["time"] >= 0.3)
            and end - start - event["time"] >= 0.25
        ):
            filtered.append(event)
    boundaries = [0, *[e["time"] for e in filtered], end - start]
    beats = []
    for i, (left, right) in enumerate(zip(boundaries, boundaries[1:])):
        first = min(len(frames) - 1, round((left + min(0.2, (right - left) / 4)) * SAMPLE_FPS))
        last = min(len(frames) - 1, round((right - min(0.2, (right - left) / 4)) * SAMPLE_FPS))
        motion = segment_motion(frames, first, last)
        beats.append(
            {
                "seconds": round(min(30, max(0.25, right - left)), 3),
                "transition": filtered[i - 1]["transition"] if i else "cut",
                "motion": motion,
                "source_start": round(start + left, 3),
                "transition_duration": filtered[i - 1]["duration"] if i else None,
                "transition_reviewed": not i or filtered[i - 1]["transition"] == "cut",
                "motion_reviewed": motion == "hold",
                "evidence": (
                    filtered[i - 1]["evidence"] if i else "Opening frame of the selected reference"
                )
                + (
                    "; coarse motion estimate needs review"
                    if motion != "hold"
                    else "; no reliable camera movement measured"
                ),
            }
        )
    # More than 240 beats is not representable in the Studio's existing timeline.
    sampled_indices = representative_indices(beats)
    summary = ""
    if len(sampled_indices) < len(beats):
        summary = f"Summarized {len(beats)} measured intervals into {len(sampled_indices)} representative beats spanning the full reference, including long holds and effect cues."
    beats = [beats[i] for i in sampled_indices]
    display_events = [filtered[i - 1] for i in sampled_indices if i > 0]
    measured_lengths = [right - left for left, right in zip(boundaries, boundaries[1:])]
    analysis = {
        "version": 3,
        "start": start,
        "end": end,
        "source_width": video["width"],
        "source_height": video["height"],
        "sample_fps": SAMPLE_FPS,
        "events": [{**e, "source_time": round(start + e["time"], 3)} for e in display_events],
        "original_event_count": len(filtered),
        "median_shot_seconds": round(statistics.median(measured_lengths), 3),
        "limits": LIMITS,
        "audio": audio_accents(
            path,
            settings,
            start,
            end - start,
            any(s["codec_type"] == "audio" for s in metadata["streams"]),
        ),
        "sections": [
            {
                "name": name,
                "start": round(start + (end - start) * left, 3),
                "end": round(start + (end - start) * right, 3),
                "reason": "Position in the reference excerpt, not an inferred story beat",
            }
            for name, left, right in [("Opening", 0, 0.2), ("Middle", 0.2, 0.8), ("Ending", 0.8, 1)]
        ],
    }
    recipe = {
        "beats": beats,
        "summary": summary,
        "transition_duration": round(
            statistics.median(
                [e["duration"] for e in filtered if e["transition"] != "cut"] or [0.18]
            ),
            3,
        ),
        "motion_strength": 0.12,
    }
    return metadata, analysis, recipe
