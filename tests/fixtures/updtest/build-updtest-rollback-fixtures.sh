#!/usr/bin/env bash
# build-updtest-rollback-fixtures.sh — package updtest 1.0 (healthy) and 2.0
# (failing health) as App Disk trees for the console #243 rollback proof.
#
# Usage:
#   build-updtest-rollback-fixtures.sh --out <new dir> --image-tar <busybox:1.36.1 docker-save tar>
#
# Tags exist only in a throwaway local git repo under <out>/src (never pushed),
# the same pattern as script/build-update-fixtures.sh (idea#76). A DOCKER shim
# prints the provided arm64 tar for `docker save busybox:1.36.1`, so this does
# not start a container and does not retag daemon images.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$D/../../.." && pwd)"   # agent-app-dev checkout
FX="$D"
OUT="" TAR=""
die() { echo "ERROR: $*" >&2; exit 1; }
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2;;
    --image-tar) TAR="$2"; shift 2;;
    *) die "unknown arg $1";;
  esac
done
[ -n "$OUT" ] && [ -f "${TAR:-}" ] || die "--out and --image-tar required"
[ ! -e "$OUT" ] || die "$OUT exists"
TAR=$(realpath "$TAR")
mkdir -p "$OUT/src" "$OUT/bin" "$OUT/check"

printf '#!/bin/sh\n[ "$1" = save ] && [ "$2" = busybox:1.36.1 ] && exec cat "%s"\necho "shim: unexpected docker $*" >&2; exit 1\n' "$TAR" > "$OUT/bin/docker"
chmod +x "$OUT/bin/docker"

APP="$OUT/src/app-updtest"
git init -q "$APP"
g() { git -C "$APP" -c user.email=kid@idea -c user.name=Kid "$@"; }
g checkout -q -b main
NOW_MS=$(( $(date +%s) * 1000 ))
check_log="$OUT/check/check-compose.txt"
: > "$check_log"

run_check() {
  local label="$1"; shift
  {
    echo "==> $label"
    echo "    $*"
    node "$ROOT/script/check-compose.mjs" "$@"
    echo
  } | tee -a "$check_log"
}

# 1.0 first so 2.0 can use --base-ref 1.0 in the throwaway repo.
cp "$FX/1.0/compose.yaml" "$APP/compose.yaml"
g add compose.yaml
g commit -qm "updtest 1.0"
g tag 1.0
run_check "1.0 --tag --release" --tag 1.0 --release "$APP/compose.yaml"
node "$ROOT/script/check-xapp-update-fields.mjs" "$APP/compose.yaml" | tee -a "$check_log"

cp "$FX/2.0/compose.yaml" "$APP/compose.yaml"
g add compose.yaml
g commit -qm "updtest 2.0"
g tag 2.0
run_check "2.0 --tag --release --base-ref 1.0" --tag 2.0 --release --base-ref 1.0 "$APP/compose.yaml"
node "$ROOT/script/check-xapp-update-fields.mjs" "$APP/compose.yaml" | tee -a "$check_log"

# Also check the in-repo paths (what the branch review sees), including --base.
run_check "repo 1.0 --tag --release" --tag 1.0 --release "$FX/1.0/compose.yaml"
run_check "repo 2.0 --tag --release --base 1.0" --tag 2.0 --release --base "$FX/1.0/compose.yaml" "$FX/2.0/compose.yaml"
node "$ROOT/script/check-xapp-update-fields.mjs" "$FX/1.0/compose.yaml" "$FX/2.0/compose.yaml" | tee -a "$check_log"

write_meta() {
  local dest="$1" did="$2" name="$3"
  printf 'diskId: %s\nisHardwareId: false\ndiskName: %s\ncreated: %s\nlastDocked: %s\n' \
    "$did" "$name" "$NOW_MS" "$NOW_MS" > "$dest/META.yaml"
}

build_one() {
  local v="$1" dest="$2" did="$3" name="$4"
  mkdir -p "$dest"
  write_meta "$dest" "$did" "$name"
  g checkout -q "$v"
  DOCKER="$OUT/bin/docker" bash "$ROOT/script/build-app-bundle.sh" --app-dir "$APP" --disk-root "$dest" --ref "$v"
  bash "$ROOT/script/verify-app-bundle.sh" "$dest" "updtest-$v"
  local ref
  ref=$(sed -n 's/^    image: //p' "$dest/apps/updtest-$v/compose.yaml" | head -1)
  case "$ref" in
    busybox:1.36.1@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662) ;;
    *) die "unexpected image ref '$ref' in $dest";;
  esac
  # Same bytes under the full pinned-ref name for Engines older than #296 (idea#76).
  cp "$dest/services/busybox:1.36.1.tar" "$dest/services/${ref//\//_}.tar"
  cmp -s "$dest/services/busybox:1.36.1.tar" "$dest/services/${ref//\//_}.tar" || die "legacy tar copy differs"
}

build_one 1.0 "$OUT/disk-1.0" "updtest243v10" "Update Test 1.0"
build_one 2.0 "$OUT/disk-2.0" "updtest243v20" "Update Test 2.0"

# Combined dockable tree: both bundles on one disk (what Atlas should copy).
mkdir -p "$OUT/disk-combined/apps" "$OUT/disk-combined/services"
write_meta "$OUT/disk-combined" "updtest243" "Update Test 243"
cp -a "$OUT/disk-1.0/apps/updtest-1.0" "$OUT/disk-combined/apps/"
cp -a "$OUT/disk-2.0/apps/updtest-2.0" "$OUT/disk-combined/apps/"
cp -a "$OUT/disk-1.0/services/." "$OUT/disk-combined/services/"
# Disk-root SHA256SUMS must list both bundles + services (same rule as build-app-bundle.sh).
(
  cd "$OUT/disk-combined"
  {
    find services -type f -name '*.tar' -print
    find apps -type f ! -name SHA256SUMS ! -name '.idea-*' -print
  } | LC_ALL=C sort | xargs -r sha256sum
) > "$OUT/disk-combined/SHA256SUMS"
bash "$ROOT/script/verify-app-bundle.sh" "$OUT/disk-combined" "updtest-1.0"
bash "$ROOT/script/verify-app-bundle.sh" "$OUT/disk-combined" "updtest-2.0"
bash "$ROOT/script/check-app-disk-tree.sh" "$OUT/disk-1.0"
bash "$ROOT/script/check-app-disk-tree.sh" "$OUT/disk-2.0"
bash "$ROOT/script/check-app-disk-tree.sh" "$OUT/disk-combined"

# Packed trees for copy. Use the C locale so sums are stable to list later.
tar -C "$OUT" -cf "$OUT/updtest-1.0-tree.tar" disk-1.0
tar -C "$OUT" -cf "$OUT/updtest-2.0-tree.tar" disk-2.0
tar -C "$OUT" -cf "$OUT/updtest-243-combined-tree.tar" disk-combined

echo "ok: $OUT/disk-{1.0,2.0,combined}"
