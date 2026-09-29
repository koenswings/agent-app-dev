#!/usr/bin/env bash
# build-app-disk-image.sh — pack an App Disk fixture tree into a GPT+ext4 .img
# for Atlas to dd onto spare sticks (idea#138 / #139).
#
# Usage:
#   build-app-disk-image.sh --tree <dir> --out <file.img> --uuid <fs-uuid> \
#       [--disk-id <id>] [--size-mib 512] [--label "IDEA Disk"] \
#       [--hw-refuse-json <path>]
#
# Safety: only operates on a regular file via losetup. Refuses any /dev/* target.
# Fail-closed on missing hw-roundtrip-disks.json when on a fleet Pi.
set -euo pipefail

SFDISK=${SFDISK:-/usr/sbin/sfdisk}
MKFS=${MKFS:-/usr/sbin/mkfs.ext4}
LOSETUP=${LOSETUP:-/usr/sbin/losetup}
BLKID=${BLKID:-/usr/sbin/blkid}

TREE=""
OUT=""
UUID=""
DISK_ID=""
SIZE_MIB=512
LABEL="IDEA Disk"
HW_JSON="${HW_ROUNDTRIP_DISKS_JSON:-/home/pi/idea/agents/agent-engine-dev/script/hw-roundtrip-disks.json}"

die() { echo "ERROR: $*" >&2; exit 1; }
usage() { sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tree) TREE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --uuid) UUID="$2"; shift 2 ;;
    --disk-id) DISK_ID="$2"; shift 2 ;;
    --size-mib) SIZE_MIB="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --hw-refuse-json) HW_JSON="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) die "unknown arg: $1" ;;
  esac
done

[ -n "$TREE" ] && [ -d "$TREE" ] || die "--tree must be an existing directory"
[ -n "$OUT" ] || die "--out required"
[ -n "$UUID" ] || die "--uuid required (unique filesystem UUID)"
[[ "$OUT" != /dev/* ]] || die "refusing block device target: $OUT (images only; Atlas does dd)"
case "$OUT" in
  *.img) ;;
  *) die "--out must end in .img" ;;
esac
[ -f "$TREE/META.yaml" ] || die "META.yaml missing in tree"
if [ -n "$DISK_ID" ]; then
  grep -q "diskId: ${DISK_ID}" "$TREE/META.yaml" || die "META.yaml diskId does not match --disk-id $DISK_ID"
fi

if [ -e /home/pi/idea/agents/agent-engine-dev ] || [ -n "${HW_ROUNDTRIP_DISKS_JSON:-}" ]; then
  [ -f "$HW_JSON" ] || die "hw-roundtrip-disks.json missing at $HW_JSON — refuse closed"
fi
if [ -f "$HW_JSON" ]; then
  if grep -qF "$UUID" "$HW_JSON"; then
    die "filesystem UUID $UUID collides with refused idea03 IDs in $HW_JSON"
  fi
fi

[ -x "$SFDISK" ] || die "sfdisk not found at $SFDISK"
[ -x "$MKFS" ] || die "mkfs.ext4 not found at $MKFS"
[ -x "$LOSETUP" ] || die "losetup not found at $LOSETUP"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO=sudo
fi

WORKDIR=$(mktemp -d /tmp/build-app-disk-XXXXXX)
LOOP=""
MNT=""
cleanup() {
  set +e
  if [ -n "$MNT" ] && mountpoint -q "$MNT" 2>/dev/null; then
    $SUDO umount "$MNT" 2>/dev/null || $SUDO umount -l "$MNT" 2>/dev/null
  fi
  if [ -n "$LOOP" ]; then
    $SUDO "$LOSETUP" -d "$LOOP" 2>/dev/null
  fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "==> Creating sparse image ${SIZE_MIB} MiB at $OUT"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
truncate -s "${SIZE_MIB}M" "$OUT"

echo "==> GPT + one Linux partition"
printf 'label: gpt\n,+\n' | $SUDO "$SFDISK" "$OUT" >/dev/null

echo "==> losetup -P"
LOOP=$($SUDO "$LOSETUP" -f --show -P "$OUT")
PART=""
for _ in $(seq 1 20); do
  if [ -b "${LOOP}p1" ]; then PART="${LOOP}p1"; break; fi
  if [ -b "${LOOP}1" ]; then PART="${LOOP}1"; break; fi
  sleep 0.2
done
[ -n "$PART" ] || die "partition node did not appear for $LOOP"
echo "    loop=$LOOP part=$PART"

case "$PART" in
  /dev/loop*) ;;
  *) die "expected loop partition, got $PART" ;;
esac

echo "==> mkfs.ext4 UUID=$UUID label=$LABEL root_owner=1000:1000"
$SUDO "$MKFS" -F -U "$UUID" -L "$LABEL" -E root_owner=1000:1000 "$PART" >/dev/null

MNT="$WORKDIR/mnt"
mkdir -p "$MNT"
$SUDO mount -t ext4 "$PART" "$MNT"

echo "==> Copying App Disk tree"
$SUDO cp -a "$TREE"/. "$MNT"/
$SUDO chown -R 1000:1000 "$MNT"
if [ -d "$MNT/lost+found" ]; then
  $SUDO chown 1000:1000 "$MNT/lost+found" || true
fi

sync
$SUDO umount "$MNT"
MNT=""
$SUDO "$LOSETUP" -d "$LOOP"
LOOP=""

echo "==> Built $OUT"
ls -lh "$OUT"
VERIFY_LOOP=$($SUDO "$LOSETUP" -f --show -P "$OUT")
VERIFY_PART=""
for _ in $(seq 1 20); do
  if [ -b "${VERIFY_LOOP}p1" ]; then VERIFY_PART="${VERIFY_LOOP}p1"; break; fi
  if [ -b "${VERIFY_LOOP}1" ]; then VERIFY_PART="${VERIFY_LOOP}1"; break; fi
  sleep 0.2
done
$SUDO "$BLKID" "$VERIFY_PART" || true
$SUDO "$LOSETUP" -d "$VERIFY_LOOP"
echo "ok: $OUT"
