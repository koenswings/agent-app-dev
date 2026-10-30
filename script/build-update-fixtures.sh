#!/usr/bin/env bash
# build-update-fixtures.sh — idea#76 updateApp fixtures: three releases of the tiny "updtest" App
# (1.0 base, 1.1 minor, 2.0 major with updatesFrom [1]) as App Disk trees (+ optional loop .img).
#
# Usage: build-update-fixtures.sh --out <new dir> --image-tar <busybox:1.36.1 docker-save tar> [--img]
#
# Fixtures need real release tags for build-app-bundle.sh, but the release tags of a real App
# repo are Steve's. So each version is committed and tagged in a THROWAWAY local git repo under
# <out>/src (never pushed), the same way tests/unit/update-from-previous.test.mjs does it.
# The image tar is saved on an arm64 Pi (docker save busybox:1.36.1) and passed in; a DOCKER
# shim copies it, so this runs on the box without a docker daemon.
# Trees: <out>/disk-<v>/ with META.yaml + apps/updtest-<v>/ + services/busybox:1.36.1.tar.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; FX="$D/../tests/fixtures/update-app"
OUT="" TAR="" IMG=0
die() { echo "ERROR: $*" >&2; exit 1; }
while [ $# -gt 0 ]; do case "$1" in --out) OUT="$2"; shift 2;; --image-tar) TAR="$2"; shift 2;; --img) IMG=1; shift;; *) die "unknown arg $1";; esac; done
[ -n "$OUT" ] && [ -f "$TAR" ] || die "--out and --image-tar required"
[ ! -e "$OUT" ] || die "$OUT exists"
mkdir -p "$OUT/src" "$OUT/bin"
TAR=$(realpath "$TAR")
printf '#!/bin/sh\n[ "$1" = save ] && [ "$2" = busybox:1.36.1 ] && exec cat "%s"\necho "shim: unexpected docker $*" >&2; exit 1\n' "$TAR" > "$OUT/bin/docker"; chmod +x "$OUT/bin/docker"
APP="$OUT/src/app-updtest"; git init -q "$APP"
g() { git -C "$APP" -c user.email=kid@idea -c user.name=Kid "$@"; }
NOW_MS=$(( $(date +%s) * 1000 ))
for spec in "1.0|[]|Base release." "1.1|[]|Minor: no data change." "2.0|[1]|Major test bump: needs a fresh backup; no real migration."; do
  IFS='|' read -r v uf note <<<"$spec"
  sed -e "s/@VERSION@/$v/g" -e "s/@UPDATES_FROM@/$uf/" -e "s/@NOTE@/$note/" "$FX/compose.yaml.tmpl" > "$APP/compose.yaml"
  g add compose.yaml; g commit -qm "updtest $v"; g tag "$v"
  node "$D/check-compose.mjs" --tag "$v" "$APP/compose.yaml" >/dev/null
  node "$D/check-xapp-update-fields.mjs" "$APP/compose.yaml" >/dev/null
  T="$OUT/disk-$v"; did="updtest$(echo "$v" | tr -d .)i76"; mkdir -p "$T"
  printf 'diskId: %s\nisHardwareId: false\ndiskName: Update Test %s\ncreated: %s\nlastDocked: %s\n' "$did" "$v" "$NOW_MS" "$NOW_MS" > "$T/META.yaml"
  DOCKER="$OUT/bin/docker" bash "$D/build-app-bundle.sh" --app-dir "$APP" --disk-root "$T" --ref "$v"
  bash "$D/verify-app-bundle.sh" "$T" "updtest-$v"
  if [ "$IMG" = 1 ]; then
    bash "$D/build-app-disk-image.sh" --tree "$T" --out "$OUT/updtest-$v.img" --uuid "$(cat /proc/sys/kernel/random/uuid)" --disk-id "$did" --size-mib 64 --label "UPDTEST $v" --hw-refuse-json /dev/null 2>&1 | tail -2 || true
  fi
done
echo "ok: $OUT/disk-{1.0,1.1,2.0}"
