import ast
import subprocess
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

from app import processes


def test_windows_background_launch_has_no_console_and_preserves_options(monkeypatch):
    monkeypatch.setattr(processes, "WINDOWS", True)
    monkeypatch.setattr(subprocess, "CREATE_NO_WINDOW", 0x08000000, raising=False)
    launch = Mock(return_value=subprocess.CompletedProcess(["ffmpeg"], 0, b"PCM", b""))
    monkeypatch.setattr(subprocess, "run", launch)
    result = processes.run(["ffmpeg"], capture_output=True, timeout=7, creationflags=0x20)
    assert result.stdout == b"PCM"
    options = launch.call_args.kwargs
    assert options["creationflags"] == 0x08000020
    assert options["stdin"] == subprocess.DEVNULL
    assert options["capture_output"] is True and options["timeout"] == 7


def test_posix_launch_and_text_input_remain_usable(monkeypatch):
    monkeypatch.setattr(processes, "WINDOWS", False)
    result = processes.run(
        [sys.executable, "-c", "import sys; print(sys.stdin.read().upper())"],
        input="voice",
        text=True,
        capture_output=True,
        timeout=5,
    )
    assert result.returncode == 0 and result.stdout.strip() == "VOICE"


def test_background_tool_errors_and_timeouts_are_not_suppressed():
    result = processes.run([sys.executable, "-c", "raise SystemExit(7)"], capture_output=True)
    assert result.returncode == 7
    with pytest.raises(subprocess.TimeoutExpired):
        processes.run([sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.05)


def test_runtime_media_launches_cannot_bypass_the_console_policy():
    for path in (Path(__file__).parents[1] / "app").glob("*.py"):
        if path.name == "processes.py":
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "subprocess"
                and node.func.attr in {"run", "Popen", "call", "check_call", "check_output"}
            ):
                pytest.fail(f"{path.name}:{node.lineno} bypasses background process policy")


@pytest.mark.skipif(sys.platform != "win32", reason="Requires actual Windows console APIs")
def test_actual_windows_child_has_no_console_window():
    result = processes.run(
        [sys.executable, "-c", "import ctypes; print(ctypes.windll.kernel32.GetConsoleWindow())"],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    assert result.stdout.strip() == "0", "Background child acquired a console window"
