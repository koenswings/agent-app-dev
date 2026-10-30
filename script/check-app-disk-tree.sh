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

[ "$fail" = 0 ] || { echo "check-app-disk-tree: FAILED for $ROOT" >&2; exit 1; }
echo "check-app-disk-tree: PASS for $ROOT"
