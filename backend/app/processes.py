"""Run background media tools without creating console windows on Windows."""

import subprocess
import sys

WINDOWS = sys.platform == "win32"


def run(command, **kwargs):
    # PyInstaller's windowed parent has no console to inherit. Without this flag
    # every FFmpeg/FFprobe call can create its own short-lived console window.
    if WINDOWS:
        kwargs["creationflags"] = kwargs.get("creationflags", 0) | subprocess.CREATE_NO_WINDOW
    if "input" not in kwargs:
        kwargs.setdefault("stdin", subprocess.DEVNULL)
    return subprocess.run(command, **kwargs)
