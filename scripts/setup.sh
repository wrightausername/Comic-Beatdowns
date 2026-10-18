#!/usr/bin/env bash
set -euo pipefail
studio_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$studio_root"

python3 -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ is required"'
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) throw Error("Node 22+ is required")'
for binary in ffmpeg ffprobe; do
  if ! command -v "$binary" >/dev/null; then
    echo "Missing $binary. Install FFmpeg (including libx264 and libass) before setup. See README."
    exit 1
  fi
done
if ! ffmpeg -hide_banner -encoders 2>/dev/null | grep 'libx264' >/dev/null; then
  echo 'FFmpeg must include the libx264 encoder.'
  exit 1
fi
if ! ffmpeg -hide_banner -filters 2>/dev/null | grep ' subtitles ' >/dev/null; then
  echo 'FFmpeg must include the subtitles filter (libass).'
  exit 1
fi
python3 -m venv .venv
export PIP_CACHE_DIR="${PIP_CACHE_DIR:-/tmp/comic-beatdowns-pip-cache}"
.venv/bin/python -m pip install -r backend/requirements.lock
.venv/bin/python -m pip install --no-deps -e backend
npm --prefix frontend ci --cache "${CB_NPM_CACHE:-/tmp/comic-beatdowns-npm-cache}" --no-fund --no-audit
npm --prefix frontend run build
.venv/bin/python -c 'from app.config import Settings; Settings().prepare()'
echo 'Studio installed. Run make run. Use make token locally to view the private sign-in token.'
