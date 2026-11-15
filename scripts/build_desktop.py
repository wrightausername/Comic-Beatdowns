"""Build the self-contained Windows desktop executable with PyInstaller.

Run on a Windows machine after building frontend/dist and installing PyInstaller
and pywebview. FFmpeg and FFprobe are verified, then included in the bundle.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def verified_ffmpeg():
    candidates = []
    chocolatey = Path(os.getenv("ChocolateyInstall", r"C:\ProgramData\chocolatey"))
    for root in (chocolatey / "lib" / "ffmpeg", chocolatey / "lib" / "ffmpeg-full"):
        if root.is_dir():
            candidates.extend(sorted(root.rglob("ffmpeg.exe")))
    on_path = shutil.which("ffmpeg")
    if on_path:
        candidates.append(Path(on_path))
    for ffmpeg in candidates:
        ffprobe = ffmpeg.with_name("ffprobe.exe")
        if not ffprobe.is_file():
            continue
        try:
            encoders = subprocess.run(
                [str(ffmpeg), "-hide_banner", "-encoders"],
                capture_output=True,
                text=True,
                check=True,
                timeout=20,
            ).stdout
            filters = subprocess.run(
                [str(ffmpeg), "-hide_banner", "-filters"],
                capture_output=True,
                text=True,
                check=True,
                timeout=20,
            ).stdout
            subprocess.run(
                [str(ffprobe), "-version"], capture_output=True, check=True, timeout=15
            )
            if "libx264" in encoders and "subtitles" in filters:
                return ffmpeg.resolve(), ffprobe.resolve()
        except (OSError, subprocess.SubprocessError):
            continue
    raise RuntimeError("FFmpeg with libx264, subtitles, and FFprobe is required")


def main():
    if os.name != "nt":
        raise RuntimeError("Windows executables must be built on Windows")
    if not (ROOT / "frontend" / "dist" / "index.html").is_file():
        raise RuntimeError("Run npm --prefix frontend run build first")
    ffmpeg, ffprobe = verified_ffmpeg()
    separator = os.pathsep
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--windowed",
        "--name",
        "Comic Beatdowns Studio",
        "--paths",
        str(ROOT / "backend"),
        "--distpath",
        str(ROOT / "desktop-dist"),
        "--workpath",
        str(ROOT / "desktop-build"),
        "--specpath",
        str(ROOT / "desktop-build"),
        "--collect-all",
        "webview",
        "--collect-all",
        "pypdfium2",
        "--collect-all",
        "pocketsphinx",
        "--collect-submodules",
        "app",
        "--hidden-import",
        "clr",
        "--add-data",
        str(ROOT / "frontend" / "dist") + separator + "frontend/dist",
        "--add-binary",
        str(ffmpeg) + separator + "media-tools",
        "--add-binary",
        str(ffprobe) + separator + "media-tools",
        str(ROOT / "backend" / "app" / "desktop.py"),
    ]
    subprocess.run(command, cwd=ROOT, check=True)
    exe = ROOT / "desktop-dist" / "Comic Beatdowns Studio.exe"
    if not exe.is_file():
        raise RuntimeError(
            "PyInstaller completed without creating the desktop executable"
        )
    print("Created", exe)


if __name__ == "__main__":
    main()
