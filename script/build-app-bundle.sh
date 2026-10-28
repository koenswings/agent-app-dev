#!/usr/bin/env bash
# build-app-bundle.sh — write one App bundle onto an App Disk tree, with its
# image tars and a build-time SHA256SUMS (agent-app-dev#23, idea#351 updateApp).
#
# Usage:
#   build-app-bundle.sh --app-dir <App repo checkout> --disk-root <dir> --ref <git ref>
#
# Writes, relative to --disk-root:
#   apps/<appId>/...          every git-tracked file of the App checkout, file modes kept
#   services/<image>.tar      one `docker save` per compose service image, named like the
#                             Engine's serviceImageTarPath(): every '/' becomes '_', tag kept
#   apps/<appId>/SHA256SUMS   sha256 of every bundle file and every image tar, paths
#                             relative to the disk root (check with: cd <root> && sha256sum -c)
#
# <appId> = <x-app.name>-<versionDirName(ref)>, the same folder name the Engine uses.
# SHA256SUMS never lists itself or Engine markers (bundle-root names starting with ".idea-").
# An existing tar is reused, never overwritten: image+tag names are immutable releases, so
# images must carry an explicit tag other than "latest".
# Env: DOCKER (default docker), for tests.
set -euo pipefail
DOCKER=${DOCKER:-docker}
APP_DIR="" ROOT="" REF=""
die() { echo "ERROR: $*" >&2; exit 1; }
while [ $# -gt 0 ]; do
  case "$1" in
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --disk-root) ROOT="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done
[ -n "$APP_DIR" ] && [ -f "$APP_DIR/compose.yaml" ] || die "--app-dir must be an App checkout with compose.yaml"
[ -n "$ROOT" ] && [ -d "$ROOT" ] || die "--disk-root must be an existing directory"
[ -n "$REF" ] || die "--ref required (the App git tag/branch/commit)"
git -C "$APP_DIR" rev-parse --git-dir >/dev/null 2>&1 || die "--app-dir is not a git checkout"
ROOT=$(cd "$ROOT" && pwd)

# Same rule as agent-engine-dev src/data/Instance.ts versionDirName()
VER=$(printf '%s' "$REF" | sed -E 's/[^A-Za-z0-9._+-]+/-/g; s/-+/-/g; s/^[-.]+//; s/-+$//')
[ -n "$VER" ] || VER=ref
NAME=$(awk '/^x-app:/{x=1;next} x&&/^[^ #]/{x=0} x&&/^  name:/{print $2; exit}' "$APP_DIR/compose.yaml")
[ -n "$NAME" ] || die "x-app.name missing in compose.yaml"
APP_ID="$NAME-$VER"
[[ "$APP_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || die "appId '$APP_ID' would be refused by receive-app"
BUNDLE="apps/$APP_ID"
[ ! -e "$ROOT/$BUNDLE" ] || die "$ROOT/$BUNDLE already exists; a bundle is written once"

# Service images: top-level `image:` lines under services (compose 2-space style)
mapfile -t IMAGES < <(awk '/^services:/{s=1;next} s&&/^[^ #]/{s=0} s&&/^    image:/{print $2}' "$APP_DIR/compose.yaml" | tr -d "\"'" | sort -u)
[ ${#IMAGES[@]} -gt 0 ] || die "no service images in compose.yaml"
for img in "${IMAGES[@]}"; do
  last=${img##*/}
  [[ "$last" == *:* ]] || die "image '$img' has no tag; tars are named by image+tag"
  [[ "${last##*:}" != latest ]] || die "image '$img' uses :latest; use a release tag"
done

mkdir -p "$ROOT/apps" "$ROOT/services"
TMP="$ROOT/apps/.build-$APP_ID.$$"
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP"
# git-tracked files only (no .git), modes kept (Nextcloud hooks stay executable)
(cd "$APP_DIR" && git ls-files -z | tar --null -T - -cf -) | tar -xpf - -C "$TMP"
[ ! -e "$TMP/SHA256SUMS" ] || die "App repo has its own SHA256SUMS at the root; that name is reserved"
if ls -A "$TMP" | grep -q '^\.idea-'; then die "App repo has a .idea-* file at the root; reserved for Engine markers"; fi

TARS=()
for img in "${IMAGES[@]}"; do
  tar_rel="services/${img//\//_}.tar"
  TARS+=("$tar_rel")
  if [ -e "$ROOT/$tar_rel" ]; then
    echo "==> $tar_rel exists, reused"
  else
    echo "==> docker save $img -> $tar_rel"
    "$DOCKER" save "$img" > "$ROOT/$tar_rel.partial" || { rm -f "$ROOT/$tar_rel.partial"; die "docker save $img failed"; }
    mv "$ROOT/$tar_rel.partial" "$ROOT/$tar_rel"
  fi
done

mv "$TMP" "$ROOT/$BUNDLE"
trap - EXIT
(
  cd "$ROOT"
  { find "$BUNDLE" \( -type f -o -type l \) ! -path "$BUNDLE/SHA256SUMS" ! -path "$BUNDLE/.idea-*"; printf '%s\n' "${TARS[@]}"; } \
    | LC_ALL=C sort -u | while IFS= read -r f; do sha256sum -- "$f"; done
) > "$ROOT/apps/.sums-$APP_ID.$$"
mv "$ROOT/apps/.sums-$APP_ID.$$" "$ROOT/$BUNDLE/SHA256SUMS"
echo "ok: $ROOT/$BUNDLE ($(wc -l < "$ROOT/$BUNDLE/SHA256SUMS") files in SHA256SUMS)"
