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
# 3. Every apps/<appId>/ has a build-time SHA256SUMS (agent-app-dev#23). A real
#    checksum file must be bundle-relative and list a bare compose.yaml (Engine
#    sumsLookUsable). If a disk-root SHA256SUMS is present, `sha256sum --check
#    --strict` must pass from the disk root (services/*.tar plus apps/**).
# 4. Every apps/<name>-<version>/compose.yaml has x-app.name/x-app.version matching its
#    folder, and every instances/*/compose.yaml x-app <name>-<version> is an existing
#    apps/ folder. The Engine sets instanceOf from the instance compose, so a mismatch
#    (idea#139: instance 1.0-smoke vs apps/nextcloud-1.0) makes it skip filesMounts.
# 5. META.yaml has every field the Engine's DiskMeta requires: diskId, diskName,
#    created and lastDocked, with created/lastDocked as epoch milliseconds. Without
#    created the dock fails: "Cannot assign undefined value at /diskDB/<id>/created".
# 6. No __pycache__/ directory or *.pyc/*.pyo file under apps/ or instances/.
#    A test run against a built bundle can leave these; they must not ship.
set -euo pipefail
ROOT="${1:-}"
[ -n "$ROOT" ] && [ -d "$ROOT" ] || { echo "usage: $0 <disk-root>" >&2; exit 2; }
fail=0
bad() { echo "FAIL: $*" >&2; fail=1; }

if [ ! -f "$ROOT/META.yaml" ]; then
  bad "META.yaml missing at the disk root"
else
  metav() { awk -v k="$1" '$1==k":"{v=$0; sub(/^[^:]*:[ \t]*/,"",v); gsub(/^["\047]|["\047][ \t]*$/,"",v); print v; exit}' "$ROOT/META.yaml"; }
  for k in diskId diskName; do
    if [ -n "$(metav "$k")" ]; then echo "PASS: META.yaml $k"; else bad "META.yaml has no $k (the Engine requires it)"; fi
  done
  for k in created lastDocked; do
    v=$(metav "$k")
    if [[ "$v" =~ ^[0-9]{12,14}$ ]]; then echo "PASS: META.yaml $k = $v"
    elif [ -z "$v" ]; then bad "META.yaml has no $k (the Engine requires it; epoch ms)"
    else bad "META.yaml $k is '$v'; must be epoch milliseconds"; fi
  done
fi

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
    save="${img%%@*}"; tar="services/${save//\//_}.tar"   # Engine#296 serviceImageTarName(): repo:tag
    if [ -s "$ROOT/$tar" ]; then echo "PASS: ${c#"$ROOT"/}: $img -> $tar"
    else bad "${c#"$ROOT"/}: image $img has no tar at $tar"; fi
  done < <(awk '/^services:/{s=1;next} s&&/^[^ #]/{s=0} s&&/^    image:/{print $2}' "$c" | tr -d "\"'" | sort -u)
done
for a in "$ROOT"/apps/*/; do
  if [ ! -s "$a/SHA256SUMS" ]; then
    bad "${a#"$ROOT"/} has no SHA256SUMS (build it with build-app-bundle.sh)"
    continue
  fi
  # Stub fixtures (e.g. a lone 'x') are only required to be non-empty.
  if grep -Eq '^[0-9a-f]{64} [ *]' "$a/SHA256SUMS"; then
    if ! grep -Eq '^[0-9a-f]{64} [ *]\.?/?compose\.yaml$' "$a/SHA256SUMS"; then
      bad "${a#"$ROOT"/}SHA256SUMS does not list a bare compose.yaml (Engine sumsLookUsable)"
    fi
    if sed -E 's/^[0-9a-f]{64} [ *]//' "$a/SHA256SUMS" | grep -E '^(apps/|services/|/)' | grep -q .; then
      bad "${a#"$ROOT"/}SHA256SUMS must be bundle-relative (no apps/ or services/ paths)"
    fi
  fi
done
if [ -s "$ROOT/SHA256SUMS" ] && grep -Eq '^[0-9a-f]{64} [ *]' "$ROOT/SHA256SUMS"; then
  if (cd "$ROOT" && sha256sum --quiet --strict --check SHA256SUMS >/dev/null); then
    echo "PASS: disk-root SHA256SUMS"
  else
    bad "disk-root SHA256SUMS check failed"
  fi
fi

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

# CPython bytecode must not ship on an App Disk (copy filter + post-build test runs).
scan=()
[ -d "$ROOT/apps" ] && scan+=("$ROOT/apps")
[ -d "$ROOT/instances" ] && scan+=("$ROOT/instances")
if [ ${#scan[@]} -gt 0 ]; then
  while IFS= read -r -d '' p; do
    bad "bytecode ships in the tree: ${p#"$ROOT"/}"
  done < <(find "${scan[@]}" \( -type d -name '__pycache__' -o -name '*.pyc' -o -name '*.pyo' \) -print0)
fi

[ "$fail" = 0 ] || { echo "check-app-disk-tree: FAILED for $ROOT" >&2; exit 1; }
echo "check-app-disk-tree: PASS for $ROOT"
