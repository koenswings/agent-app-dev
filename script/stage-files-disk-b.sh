#!/usr/bin/env bash
# stage-files-disk-b.sh — stage the idea#139 Disk B tree (App-only, Nextcloud + one
# instance, no FILES.yaml, no files/) for build-app-disk-image.sh.
#
# Usage: stage-files-disk-b.sh --app-dir <app-nextcloud checkout> --tree <new dir> \
#          --disk-id <id> [--ref 1.0] [--instance nextcloud-files-b-001] [--port 18080]
#
# The App goes in with build-app-bundle.sh (tars by docker save repo:tag + SHA256SUMS).
# The instance is made like the Engine's createInstance(): a copy of the App folder
# (minus SHA256SUMS) with x-app.version = folder version and x-app.instanceName, and
# a .env with port and a random internal DB pass (never printed).
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="" TREE="" DID="" REF=1.0 INST=nextcloud-files-b-001 PORT=18080
die() { echo "ERROR: $*" >&2; exit 1; }
while [ $# -gt 0 ]; do case "$1" in
  --app-dir) APP_DIR="$2"; shift 2;; --tree) TREE="$2"; shift 2;; --disk-id) DID="$2"; shift 2;;
  --ref) REF="$2"; shift 2;; --instance) INST="$2"; shift 2;; --port) PORT="$2"; shift 2;;
  *) die "unknown arg: $1";; esac; done
[ -n "$APP_DIR" ] && [ -n "$TREE" ] && [ -n "$DID" ] || die "--app-dir, --tree, --disk-id required"
[ ! -e "$TREE" ] || die "$TREE exists; stage into a new directory"
mkdir -p "$TREE"
printf 'diskId: %s\nname: IDEA Disk\n' "$DID" > "$TREE/META.yaml"
bash "$D/build-app-bundle.sh" --app-dir "$APP_DIR" --disk-root "$TREE" --ref "$REF"
APP=$(ls "$TREE/apps"); [ "$(echo "$APP" | wc -l)" = 1 ] || die "expected one App"
mkdir -p "$TREE/instances/$INST"
(cd "$TREE/apps/$APP" && tar --exclude=./SHA256SUMS -cf - .) | tar -xpf - -C "$TREE/instances/$INST"
awk -v n="$INST" '/^x-app:/{x=1;print;next} x&&/^[^ #]/{x=0} x&&/^  instanceName:/{print "  instanceName: " n; next} {print}' \
  "$TREE/apps/$APP/compose.yaml" > "$TREE/instances/$INST/compose.yaml"
umask 077; printf 'port=%s\npass=%s\n' "$PORT" "$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$TREE/instances/$INST/.env"
bash "$D/check-app-disk-tree.sh" "$TREE"
echo "ok: staged Disk B at $TREE (apps/$APP, instances/$INST)"
