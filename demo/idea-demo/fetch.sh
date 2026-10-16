#!/usr/bin/env bash
# Build the IDEA-DEMO disk tree from publisher sources. Needs python3 + ffmpeg.
# Usage: demo/idea-demo/fetch.sh OUT_DIR   (then copy OUT_DIR onto a FAT32 disk labelled IDEA-DEMO)
set -euo pipefail
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
exec python3 "$(dirname "$0")/fetch.py" "$@"
