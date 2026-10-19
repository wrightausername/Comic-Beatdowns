"""Offline audio analysis and English caption recognition. No network requests."""

import array
import math
import re
import subprocess
import sys


def pcm_audio(path, settings):
    result = subprocess.run(
        [
            settings.ffmpeg,
            "-nostdin",
            "-v",
            "error",
            "-threads",
            "2",
            "-i",
            str(path),
            "-t",
            "180",
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
        timeout=60,
    )
    if result.returncode:
        raise ValueError("This narration could not be decoded")
    samples = array.array("h", result.stdout)
    if sys.byteorder != "little":
        samples.byteswap()
    return result.stdout, samples


def analyze_audio(path, settings):
    _, samples = pcm_audio(path, settings)
    duration = len(samples) / 16000
    peaks, pauses, silence_start = [], [], None
    # Twenty-millisecond windows retain the pauses used to place cuts.
    for start in range(0, len(samples), 320):
        part = samples[start : start + 320]
        rms = math.sqrt(sum(value * value for value in part) / max(1, len(part))) / 32768
        if rms < 0.009:
            if silence_start is None:
                silence_start = start / 16000
        elif silence_start is not None:
            if start / 16000 - silence_start >= 0.12:
                pauses.append([round(silence_start, 3), round(start / 16000, 3)])
            silence_start = None
    if silence_start is not None and duration - silence_start >= 0.12:
        pauses.append([round(silence_start, 3), round(duration, 3)])
    stride = max(1, math.ceil(len(samples) / 1000))
    for start in range(0, len(samples), stride):
        peaks.append(
            max((abs(value) for value in samples[start : start + stride]), default=0) / 32768
        )
    return {"duration": duration, "peaks": peaks, "pauses": pauses}


def transcribe(path, settings, script=""):
    from pocketsphinx import Decoder

    pcm, samples = pcm_audio(path, settings)
    decoder = Decoder(samprate=16000, loglevel="ERROR")
    if not samples or max(abs(value) for value in samples) < 160:
        return []
    spellings = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", re.sub(r"\[[^\]]*\]", " ", script))
    if script:
        missing = sorted({word for word in spellings if not decoder.lookup_word(word.lower())})
        if not spellings or missing:
            raise ValueError(
                "The offline dictionary cannot align these script words: "
                + ", ".join(missing[:10])
                + ". Turn off script wording or import an SRT."
            )
        decoder.set_align_text(" ".join(word.lower() for word in spellings))
    decoder.start_utt()
    # Streaming avoids submitting a huge decoder buffer in one call.
    if script:
        decoder.process_raw(pcm, False, True)
    else:
        for start in range(0, len(pcm), 32000):
            decoder.process_raw(pcm[start : start + 32000], False, False)
    decoder.end_utt()
    words = []
    for segment in decoder.seg() or []:
        if segment.word.startswith(("<", "[")):
            continue
        word = re.sub(r"\(\d+\)$", "", segment.word)
        if script and len(words) < len(spellings):
            word = spellings[len(words)]
        end = min(len(samples) / 16000, (segment.end_frame + 1) / 100)
        if end > segment.start_frame / 100:
            words.append((word, segment.start_frame / 100, end))
    cues = []
    chunk = []
    for word in words:
        if chunk and (word[1] - chunk[-1][2] > 0.3 or len(chunk) >= 4):
            cues.append(
                {"start": chunk[0][1], "end": chunk[-1][2], "text": " ".join(w[0] for w in chunk)}
            )
            chunk = []
        chunk.append(word)
    if chunk:
        cues.append(
            {"start": chunk[0][1], "end": chunk[-1][2], "text": " ".join(w[0] for w in chunk)}
        )
    return cues


def srt_text(cues):
    def stamp(seconds):
        ms = round(seconds * 1000)
        return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"

    return (
        "\n\n".join(
            f"{i + 1}\n{stamp(cue['start'])} --> {stamp(cue['end'])}\n{cue['text']}"
            for i, cue in enumerate(cues)
        )
        + "\n"
    )


def parse_srt(text):
    cues = []
    for block in re.split(r"\n\s*\n", text.replace("\r", "").strip()):
        lines = block.splitlines()
        timing = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if timing is None:
            raise ValueError("Use an SRT file with caption timestamps")
        match = re.fullmatch(
            r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})",
            lines[timing].strip(),
        )
        if not match:
            raise ValueError("SRT timestamps must use HH:MM:SS,mmm")
        values = [int(n) for n in match.groups()]
        start = values[0] * 3600 + values[1] * 60 + values[2] + values[3] / 1000
        end = values[4] * 3600 + values[5] * 60 + values[6] + values[7] / 1000
        cues.append({"start": start, "end": end, "text": "\n".join(lines[timing + 1 :])})
    return cues
