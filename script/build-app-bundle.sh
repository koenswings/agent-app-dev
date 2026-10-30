#!/usr/bin/env bash
# build-app-bundle.sh — write one App bundle onto an App Disk tree, with its
# image tars and a build-time SHA256SUMS (agent-app-dev#23, idea#351 updateApp).
#
# Usage:
#   build-app-bundle.sh --app-dir <App repo checkout> --disk-root <dir> --ref <release tag>
#
# idea#76: --ref must be a git tag of the App repo matching <major>.<minor>[-<upstream>]
# (e.g. 1.1-0.19.5) and must point at the checked-out HEAD. Commit SHAs, dates and other refs
# are refused: the Engine reads the first number of the version to order updates.
# Dev override: ALLOW_UNTAGGED=1 builds HEAD as version 0.0-dev+<sha12>, which never wins
# an update compare. Never put a dev bundle on a disk that leaves the bench.
# The x-app.version line and every service's x-app-version label are stamped with the
# version, then checked with script/check-compose.mjs --tag.
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

HERE=$(cd "$(dirname "$0")" && pwd)
ID_RE='^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
if [ "${ALLOW_UNTAGGED:-}" = 1 ]; then
  VER="0.0-dev+$(git -C "$APP_DIR" rev-parse --short=12 HEAD)"
  ID_RE='^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$'   # local installs only; receive-app/Fetch refuse "+"
  echo "WARNING: ALLOW_UNTAGGED=1, dev bundle $VER (not a release)" >&2
else
  [[ "$REF" =~ ^[0-9]+\.[0-9]+(-[A-Za-z0-9._]+)?$ ]] \
    || die "--ref '$REF' is not a release tag <major>.<minor>[-<upstream>]; SHA and date refs are refused (dev override: ALLOW_UNTAGGED=1)"
  tc=$(git -C "$APP_DIR" rev-parse -q --verify "refs/tags/$REF^{commit}" 2>/dev/null) || die "--ref '$REF' is not a git tag in $APP_DIR"
  [ "$tc" = "$(git -C "$APP_DIR" rev-parse HEAD)" ] || die "tag $REF is not the checked-out HEAD; check out the tag first"
  VER="$REF"
fi
NAME=$(awk '/^x-app:/{x=1;next} x&&/^[^ #]/{x=0} x&&/^  name:/{print $2; exit}' "$APP_DIR/compose.yaml")
[ -n "$NAME" ] || die "x-app.name missing in compose.yaml"
APP_ID="$NAME-$VER"
[[ "$APP_ID" =~ $ID_RE ]] || die "appId '$APP_ID' would be refused by receive-app"
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

# idea#139: the bundled compose's x-app.version is the folder version, so the App folder,
# its compose and any instance made from it agree (check-app-disk-tree.sh rule 4).
awk -v v="$VER" '/^x-app:/{x=1;print;next} x&&/^[^ #]/{x=0} x&&/^  version:/{print "  version: \"" v "\""; next} {print}' "$TMP/compose.yaml" > "$TMP/.compose.$$" && cat "$TMP/.compose.$$" > "$TMP/compose.yaml" && rm "$TMP/.compose.$$"
grep -qF "  version: \"$VER\"" "$TMP/compose.yaml" || die "compose.yaml x-app has no version line to set"
sed -i -E "s/^( +)x-app-version:.*$/\\1x-app-version: \"$VER\"/" "$TMP/compose.yaml"   # map-form labels
node "$HERE/check-compose.mjs" --tag "$VER" "$TMP/compose.yaml" >/dev/null || die "check-compose failed on the bundled compose (every service needs an x-app-version label)"

TARS=()
for img in "${IMAGES[@]}"; do
  # Engine#296/#322 serviceImageTarName(): a pinned repo:tag@sha256 ref is saved by repo:tag
  save="${img%%@*}"
  tar_rel="services/${save//\//_}.tar"
  TARS+=("$tar_rel")
  if [ -e "$ROOT/$tar_rel" ]; then
    echo "==> $tar_rel exists, reused"
  else
    echo "==> docker save $save -> $tar_rel"
    "$DOCKER" save "$save" > "$ROOT/$tar_rel.partial" || { rm -f "$ROOT/$tar_rel.partial"; die "docker save $img failed"; }
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
