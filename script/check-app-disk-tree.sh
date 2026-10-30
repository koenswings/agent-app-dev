#!/usr/bin/env bash
# check-app-disk-tree.sh — fail-closed checks for an App Disk staging tree or a
# mounted built image (idea#139 step 9).
#
# Usage: check-app-disk-tree.sh <disk-root>
#
# 1. No placeholder (.gitkeep, .keep, .gitignore, .placeholder, .empty) under
#    files/. On an App-only disk (no FILES.yaml) files/ must not exist at all,
#    because a stray files/ makes the Engine refuse Add Files.
# 2. Every service image named in apps/*/compose.yaml and instances/*/compose.yaml
#    has its tar at services/<image with '/' -> '_'>.tar, the Engine's
#    serviceImageTarPath(). Offline Pis have no image cache.
# 3. Every apps/<appId>/ has a build-time SHA256SUMS (agent-app-dev#23).
# 4. Every apps/<name>-<version>/compose.yaml has x-app.name/x-app.version matching its
#    folder, and every instances/*/compose.yaml x-app <name>-<version> is an existing
#    apps/ folder. The Engine sets instanceOf from the instance compose, so a mismatch
#    (idea#139: instance 1.0-smoke vs apps/nextcloud-1.0) makes it skip filesMounts.
set -euo pipefail
ROOT="${1:-}"
[ -n "$ROOT" ] && [ -d "$ROOT" ] || { echo "usage: $0 <disk-root>" >&2; exit 2; }
fail=0
bad() { echo "FAIL: $*" >&2; fail=1; }

if [ -e "$ROOT/files" ]; then
  while IFS= read -r -d '' p; do
    bad "placeholder ships under files/: ${p#"$ROOT"/}"
  done < <(find "$ROOT/files" -type f \( -name .gitkeep -o -name .keep -o -name .gitignore -o -name .placeholder -o -name .empty \) -print0)
  if [ ! -f "$ROOT/FILES.yaml" ]; then
    bad "files/ exists on an App-only disk (no FILES.yaml); it blocks Add Files"
  fi
fi

shopt -s nullglob
for c in "$ROOT"/apps/*/compose.yaml "$ROOT"/instances/*/compose.yaml; do
  while IFS= read -r img; do
    [ -n "$img" ] || continue
    tar="services/${img//\//_}.tar"
    if [ -s "$ROOT/$tar" ]; then echo "PASS: ${c#"$ROOT"/}: $img -> $tar"
    else bad "${c#"$ROOT"/}: image $img has no tar at $tar"; fi
  done < <(awk '/^services:/{s=1;next} s&&/^[^ #]/{s=0} s&&/^    image:/{print $2}' "$c" | tr -d "\"'" | sort -u)
done
for a in "$ROOT"/apps/*/; do
  [ -s "$a/SHA256SUMS" ] || bad "${a#"$ROOT"/} has no SHA256SUMS (build it with build-app-bundle.sh)"
done

xapp() { awk -v k="$2" '/^x-app:/{x=1;next} x&&/^[^ #]/{x=0} x&&$1==k":"{v=$2; gsub(/["\047]/,"",v); print v; exit}' "$1"; }
for c in "$ROOT"/apps/*/compose.yaml; do
  d=$(basename "$(dirname "$c")"); id="$(xapp "$c" name)-$(xapp "$c" version)"
  if [ "$id" = "$d" ]; then echo "PASS: apps/$d x-app.name-version = $id"
  else bad "apps/$d/compose.yaml x-app is $id; folder must be apps/$id"; fi
done
for c in "$ROOT"/instances/*/compose.yaml; do
  i=$(basename "$(dirname "$c")"); id="$(xapp "$c" name)-$(xapp "$c" version)"
  if [ -d "$ROOT/apps/$id" ]; then echo "PASS: instances/$i instanceOf $id exists"
  else bad "instances/$i/compose.yaml x-app is $id but apps/$id does not exist"; fi
done

[ "$fail" = 0 ] || { echo "check-app-disk-tree: FAILED for $ROOT" >&2; exit 1; }
echo "check-app-disk-tree: PASS for $ROOT"
