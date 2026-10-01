#!/usr/bin/env bash
# post-dock-restore-running.sh — Atlas/Axle one-shot after RealFleetOps dock (idea#166/#168)
#
# WHY: infra_dock_fixture is dock-only and strips instances/, so Engine will not
# auto-start Kolibri/Nextcloud from the private dock root. Overnight Engine will
# NOT restore Running-after-dock. This script brings back a Running Kolibri for
# Phase 3 App-open Intents via the known idea01 sidecar live path (CONTENT.live.json).
#
# Does NOT merge, does NOT claim Pis, does NOT touch /disks or idea03 sdb1 / idea02.
# Prefer claimed idea01 only when Atlas owns the walk.
#
# Usage (on idea01, from agent-app-dev checkout):
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh --mode sidecar
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh --mode sidecar --live-root /home/pi/idea166-kolibri-live
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh --mode dock-instances \
#        --dock-root /home/pi/idea/duration-disks/idea-test-1
#
# Modes:
#   sidecar (default)     Ensure Running Kolibri at LIVE_ROOT (:18080). Reuses
#                         existing provisioned data + CONTENT.live.json pins.
#                         Engine App-open should target this Running instance.
#   dock-instances        Copy fixtures/*/instances/ into DOCK_ROOT (compose only).
#                         Does NOT start containers via Engine (stripped by design).
#                         Optional morning prep; prefer sidecar overnight.
#
# Env overrides:
#   LIVE_ROOT   default /home/pi/idea166-kolibri-live
#   DOCK_ROOT   required for dock-instances
#   PACK_ROOT   default <repo>/tests/duration-tests/fixtures
#   SKIP_HTTP=1 skip curl health check
set -euo pipefail

MODE="sidecar"
LIVE_ROOT="${LIVE_ROOT:-/home/pi/idea166-kolibri-live}"
DOCK_ROOT="${DOCK_ROOT:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PACK_ROOT="${PACK_ROOT:-$REPO_ROOT/tests/duration-tests/fixtures}"
LIVE_JSON="$PACK_ROOT/kolibri/content/CONTENT.live.json"

usage() {
  sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --live-root) LIVE_ROOT="$2"; shift 2 ;;
    --dock-root) DOCK_ROOT="$2"; shift 2 ;;
    --pack-root) PACK_ROOT="$2"; LIVE_JSON="$PACK_ROOT/kolibri/content/CONTENT.live.json"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "unknown arg: $1" >&2; usage 2 ;;
  esac
done

print_pins() {
  if [[ -f "$LIVE_JSON" ]]; then
    echo "CONTENT.live.json pins (stable contentIds; auth IDs mutable on re-provision):"
    python3 - <<PY
import json
s=json.load(open("$LIVE_JSON"))
ir=s.get("intentResolution", {})
print("  host/port     ", s.get("host"), s.get("kolibriHttpPort"))
print("  tempDataDir   ", s.get("tempDataDir"))
print("  open_video    ", ir.get("open_video", {}).get("contentId"))
print("  open_exercise ", ir.get("open_exercise", {}).get("contentId"))
print("  channelId     ", s.get("channel", {}).get("channelId"))
print("  facility/class/lesson liveStatus:",
      s.get("facility", {}).get("liveStatus"),
      s.get("class", {}).get("liveStatus"),
      s.get("lesson", {}).get("liveStatus"))
PY
  else
    echo "WARN: missing $LIVE_JSON (sync App#10 fixtures to this host)" >&2
  fi
}

restore_sidecar() {
  echo "== sidecar mode: Running Kolibri for App-open after dock =="
  echo "LIVE_ROOT=$LIVE_ROOT"
  if [[ ! -d "$LIVE_ROOT" ]]; then
    echo "ERROR: LIVE_ROOT missing. Expected provisioned tree from Kid live import." >&2
    echo "  Create/reuse /home/pi/idea166-kolibri-live with compose.yaml + data/kolibri" >&2
    echo "  (see fixtures/kolibri/content/CONTENT.live.json tempDataDir)." >&2
    echo "  Storage-only helper: fixtures/kolibri/content/seed/apply-live.sh" >&2
    exit 1
  fi
  if [[ ! -f "$LIVE_ROOT/compose.yaml" ]]; then
    echo "ERROR: $LIVE_ROOT/compose.yaml missing" >&2
    exit 1
  fi
  if [[ ! -d "$LIVE_ROOT/data/kolibri" ]]; then
    echo "ERROR: $LIVE_ROOT/data/kolibri missing — run apply-live + provision first" >&2
    exit 1
  fi

  # Ensure compose is up (idempotent). Image must already be on host (ARM64).
  if command -v docker >/dev/null 2>&1; then
    (cd "$LIVE_ROOT" && docker compose up -d)
  else
    echo "WARN: docker not on PATH — start manually: cd $LIVE_ROOT && docker compose up -d" >&2
  fi

  if [[ "${SKIP_HTTP:-0}" != "1" ]]; then
    code=""
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/ 2>/dev/null || true)"
      [[ "$code" =~ ^(200|302|301)$ ]] && break
      sleep 2
    done
    echo "HTTP :18080 → ${code:-unreachable}"
    if [[ ! "$code" =~ ^(200|302|301)$ ]]; then
      echo "WARN: Kolibri not answering yet — wait and re-check; data pins still valid" >&2
    fi
  fi

  print_pins
  echo
  echo "Atlas / Axle next:"
  echo "  • Engine App-open Intents (open_kolibri / open_video / open_exercise) should"
  echo "    target this Running sidecar on idea01 :18080 — NOT the docked private root"
  echo "    (dock strips instances/ by design; Engine overnight will not restore Running)."
  echo "  • Pins: $LIVE_JSON"
  echo "  • Nextcloud Running restore: NOT in this overnight path (compose-only via"
  echo "    --mode dock-instances if needed; no idea01 Nextcloud live sidecar yet)."
}

restore_dock_instances() {
  echo "== dock-instances mode: copy instances/ into dock root (no Engine start) =="
  if [[ -z "$DOCK_ROOT" ]]; then
    echo "ERROR: set --dock-root /path/to/private/idea-test-N" >&2
    exit 2
  fi
  if [[ ! -d "$DOCK_ROOT" ]]; then
    echo "ERROR: DOCK_ROOT not a directory: $DOCK_ROOT" >&2
    exit 1
  fi
  for pack in kolibri nextcloud; do
    src="$PACK_ROOT/$pack/instances"
    if [[ -d "$src" ]]; then
      mkdir -p "$DOCK_ROOT/instances"
      # copy instances tree; do not clobber existing large data dirs if present
      rsync -a --exclude '**/data/**' "$src"/ "$DOCK_ROOT/instances/"
      echo "synced $src → $DOCK_ROOT/instances/ (data/ excluded)"
    else
      echo "skip missing $src"
    fi
  done
  # If sidecar data exists, optionally link Kolibri data for manual compose under dock
  if [[ -d "$LIVE_ROOT/data/kolibri" ]]; then
    dest="$DOCK_ROOT/instances/kolibri-grade5a-001/data"
    mkdir -p "$dest"
    if [[ ! -e "$dest/kolibri" ]]; then
      ln -s "$LIVE_ROOT/data/kolibri" "$dest/kolibri"
      echo "linked $LIVE_ROOT/data/kolibri → $dest/kolibri"
    else
      echo "keep existing $dest/kolibri"
    fi
  fi
  echo
  echo "NOTE: Engine still will not auto-start these instances after dock (strips by"
  echo "design). Prefer --mode sidecar for Phase 3 App-open overnight."
  print_pins
}

case "$MODE" in
  sidecar) restore_sidecar ;;
  dock-instances) restore_dock_instances ;;
  *) echo "unknown --mode $MODE (sidecar|dock-instances)" >&2; exit 2 ;;
esac
