#!/usr/bin/env bash
# Apply Grade 5A duration seed assets onto a Running Kolibri data dir (idea#166).
#
# Does NOT claim Pis / does NOT dock. Safe to run only on a free Engine you own
# (prefer idea04 when idle). Never touch idea01/idea03 while Atlas holds
# walk-2026-10-01-dock.
#
# Usage:
#   KOLIBRI_DATA=/path/to/instances/kolibri-grade5a-001/data/kolibri \
#     ./apply-live.sh
#
# Steps:
#   1. Copies content/storage tree into $KOLIBRI_DATA/content/storage
#   2. Prints next steps for channel import + facility provision
#   3. Does not rewrite CONTENT.seeded.json (re-run build_content_seeded.py
#      or a live dump script after import to fill facility/class/lesson live IDs)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORAGE_SRC="$ROOT/storage"
SEEDED="$ROOT/CONTENT.seeded.json"

if [[ -z "${KOLIBRI_DATA:-}" ]]; then
  echo "Set KOLIBRI_DATA to the instance Kolibri home (…/data/kolibri)" >&2
  exit 2
fi
if [[ ! -f "$SEEDED" ]]; then
  echo "missing $SEEDED — run build_content_seeded.py first" >&2
  exit 1
fi
if [[ ! -d "$STORAGE_SRC" ]]; then
  echo "missing $STORAGE_SRC" >&2
  exit 1
fi

dest="$KOLIBRI_DATA/content/storage"
mkdir -p "$dest"
# copy only files; keep existing channel DBs intact
cp -an "$STORAGE_SRC"/. "$dest"/
echo "Copied storage blobs → $dest"
echo
echo "Next (manual / manage on the Running container):"
echo "  1. Import channel duration-kolibri-grade5a (Studio upload from seed/build,"
echo "     or kolibri manage importchannel from a peer export)."
echo "  2. Provision facility 'Duration Tests Facility', coach teacher,"
echo "     class Grade 5A, learners learner01..03."
echo "  3. Lesson 'Grade 5A Duration Lesson' with video+exercise resources."
echo "  4. Optionally rewrite facility/class/lesson live IDs in CONTENT.seeded.json."
echo "Pinned content IDs (from CONTENT.seeded.json):"
python3 - <<PY
import json
s=json.load(open("$SEEDED"))
ir=s["intentResolution"]
print("  open_video   ", ir["open_video"]["contentId"])
print("  open_exercise", ir["open_exercise"]["contentId"])
print("  channelId    ", ir["open_video"]["channelId"])
print("  video md5    ", ir["open_video"]["md5"])
PY
