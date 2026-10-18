"""Windows bootstrap and browser launcher. Run through Start Studio.cmd.

Uses the Windows Package Manager's normal package/hash verification. No PowerShell
execution policies, TLS checks, or installer signature checks are disabled.
"""

import argparse
import hashlib
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:8000"


def refresh_path():
    """Pick up newly installed packages without restarting the launcher."""
    if os.name != "nt":
        return
    import winreg

    paths = [str(Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/WinGet/Links")]
    paths.extend(os.environ.get("PATH", "").split(os.pathsep))
    for hive, location in [
        (
            winreg.HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        ),
        (winreg.HKEY_CURRENT_USER, "Environment"),
    ]:
        try:
            with winreg.OpenKey(hive, location) as key:
                value, _ = winreg.QueryValueEx(key, "Path")
                paths.extend(os.path.expandvars(value).split(os.pathsep))
        except OSError:
            continue
    os.environ["PATH"] = os.pathsep.join(dict.fromkeys(path for path in paths if path))


def run(command):
    subprocess.run([str(arg) for arg in command], cwd=ROOT, check=True)


def install_package(package, description):
    winget = shutil.which("winget")
    if not winget:
        raise RuntimeError(
            "Install Microsoft's App Installer from the Microsoft Store, then try again."
        )
    print(f"\nInstalling {description} with Windows Package Manager...", flush=True)
    run(
        [
            winget,
            "install",
            "--id",
            package,
            "--exact",
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements",
            "--disable-interactivity",
        ]
    )
    refresh_path()


def find_node():
    executable = shutil.which("node")
    if not executable:
        return None
    result = subprocess.run(
        [executable, "-p", "process.versions.node.split('.')[0]"],
        capture_output=True,
        text=True,
        check=False,
    )
    if (
        result.returncode
        or not result.stdout.strip().isdigit()
        or int(result.stdout.strip()) < 22
    ):
        return None
    return Path(executable).resolve()


def dependency_fingerprint(root=ROOT):
    files = [
        root / "backend/requirements.lock",
        root / "backend/pyproject.toml",
        root / "frontend/package-lock.json",
        root / "frontend/package.json",
        root / "frontend/index.html",
        root / "frontend/tsconfig.json",
        root / "frontend/vite.config.ts",
    ]
    files.extend(sorted((root / "frontend/src").rglob("*")))
    digest = hashlib.sha256()
    for path in files:
        if path.is_file():
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


def prepare():
    refresh_path()
    node = find_node()
    if node is None:
        install_package("OpenJS.NodeJS.LTS", "Node.js")
        node = find_node()
    if node is None:
        raise RuntimeError(
            "Node.js 22+ was not found. Close this window and start the studio again."
        )
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        install_package("Gyan.FFmpeg", "FFmpeg")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError(
            "FFmpeg was not found. Close this window and start the studio again."
        )
    for flag, required in [("-encoders", "libx264"), ("-filters", "subtitles")]:
        result = subprocess.run(
            [shutil.which("ffmpeg"), "-hide_banner", flag],
            capture_output=True,
            text=True,
            check=True,
        )
        if required not in result.stdout:
            raise RuntimeError(
                f"This FFmpeg build lacks {required}. Install the full Gyan.FFmpeg package."
            )
    # Use Node's npm CLI directly; this avoids shell quoting problems with npm.cmd.
    npm = node.parent / "node_modules/npm/bin/npm-cli.js"
    if not npm.is_file():
        raise RuntimeError(
            "Node.js is missing npm. Repair/reinstall Node.js LTS, then try again."
        )
    python = ROOT / ".venv/Scripts/python.exe"
    created = not python.is_file()
    if created:
        run([sys.executable, "-m", "venv", ROOT / ".venv"])
    data = ROOT / ".data"
    data.mkdir(exist_ok=True)
    marker = data / "windows-setup.sha256"
    fingerprint = dependency_fingerprint()
    if (
        created
        or not marker.is_file()
        or marker.read_text().strip() != fingerprint
        or not (ROOT / "frontend/node_modules").is_dir()
        or not (ROOT / "frontend/dist/index.html").is_file()
    ):
        print(
            "\nPreparing the studio. First launch can take several minutes...",
            flush=True,
        )
        run(
            [
                python,
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "-r",
                ROOT / "backend/requirements.lock",
            ]
        )
        run(
            [
                python,
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--no-deps",
                "-e",
                ROOT / "backend",
            ]
        )
        run([node, npm, "--prefix", ROOT / "frontend", "ci", "--no-fund", "--no-audit"])
        run([node, npm, "--prefix", ROOT / "frontend", "run", "build"])
        marker.write_text(fingerprint)
    return python


def wait_until_ready(process=None, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise RuntimeError(
                "The studio server stopped during startup. See the error above."
            )
        try:
            with urllib.request.urlopen(f"{URL}/api/health", timeout=2) as response:
                health = json.load(response)
            with urllib.request.urlopen(URL, timeout=2) as response:
                frontend = response.read().decode("utf-8")
            if (
                health.get("status") == "ok"
                and health.get("ffmpeg_available")
                and "Comic Beatdowns Studio" in frontend
            ):
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise RuntimeError(
        "The studio did not become ready. See the server error in this window."
    )


def check_port():
    with socket.socket() as connection:
        try:
            connection.bind(("127.0.0.1", 8000))
        except OSError as error:
            raise RuntimeError(
                "Port 8000 is busy. Close the other studio window or app and try again."
            ) from error


def serve():
    import uvicorn
    from app.config import Settings

    check_port()
    settings = Settings()
    settings.prepare()
    print(
        "\nYour private studio access token (copy it into the sign-in screen):",
        flush=True,
    )
    print(
        settings.studio_token, flush=True
    )  # Local operator console only; not a URL/log file.
    print(
        "\nKeep this window open while you use the studio. Press Ctrl+C to stop.\n",
        flush=True,
    )

    def open_when_ready():
        try:
            wait_until_ready()
            webbrowser.open(URL)
        except RuntimeError as error:
            print(str(error), flush=True)

    threading.Thread(target=open_when_ready, daemon=True).start()
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, workers=1)


def smoke_check(python):
    """CI mode: no browser and no token output."""
    check_port()
    env = os.environ.copy()
    env["CB_STUDIO_TOKEN"] = secrets.token_urlsafe(32)
    process = subprocess.Popen(
        [
            str(python),
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ],
        cwd=ROOT,
        env=env,
    )
    try:
        wait_until_ready(process)
        subprocess.run(
            [str(python), str(ROOT / "scripts/check_ready.py")],
            cwd=ROOT,
            env=env,
            check=True,
        )
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Install and check startup without opening a browser",
    )
    parser.add_argument("--serve", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if os.name != "nt":
        raise RuntimeError(
            "Use Start Studio.cmd on Windows, or make run on Linux/macOS."
        )
    os.chdir(ROOT)
    if args.serve:
        serve()
    else:
        python = prepare()
        if args.check:
            smoke_check(python)
        else:
            run([python, Path(__file__), "--serve"])


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print(f"\nStudio could not start: {error}", file=sys.stderr)
        sys.exit(1)
