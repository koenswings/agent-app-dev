#!/usr/bin/env bash
# validate-app-disk-image.sh — automated acceptance for idea#138 Disk A/B images
#
# Usage:
#   validate-app-disk-image.sh --img <file.img> --expect-uuid <uuid> \
#       --expect-disk-id <id> --role <a|b> [--sha256 <hex>] [--label "IDEA Disk"]
set -euo pipefail

SFDISK=${SFDISK:-/usr/sbin/sfdisk}
LOSETUP=${LOSETUP:-/usr/sbin/losetup}
BLKID=${BLKID:-/usr/sbin/blkid}

IMG=""
EXPECT_UUID=""
EXPECT_DISK_ID=""
ROLE=""
EXPECT_SHA=""
LABEL="IDEA Disk"
HW_JSON="${HW_ROUNDTRIP_DISKS_JSON:-/home/pi/idea/agents/agent-engine-dev/script/hw-roundtrip-disks.json}"

die() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "PASS: $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --img) IMG="$2"; shift 2 ;;
    --expect-uuid) EXPECT_UUID="$2"; shift 2 ;;
    --expect-disk-id) EXPECT_DISK_ID="$2"; shift 2 ;;
    --role) ROLE="$2"; shift 2 ;;
    --sha256) EXPECT_SHA="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[ -f "$IMG" ] || die "image not found: $IMG"
[ -n "$EXPECT_UUID" ] || die "--expect-uuid required"
[ -n "$EXPECT_DISK_ID" ] || die "--expect-disk-id required"
[ "$ROLE" = a ] || [ "$ROLE" = b ] || die "--role must be a or b"
[[ "$IMG" != /dev/* ]] || die "refusing to validate a block device path"

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO=sudo

if [ -f "$HW_JSON" ]; then
  if grep -qF "$EXPECT_UUID" "$HW_JSON"; then
    die "expect-uuid collides with refused idea03 IDs"
  fi
  ok "expect-uuid not in idea03 refuse list"
elif [ -e /home/pi/idea/agents/agent-engine-dev ]; then
  die "hw-roundtrip-disks.json missing — refuse closed"
fi

ACTUAL_SHA=$(sha256sum "$IMG" | awk '{print $1}')
ok "sha256=$ACTUAL_SHA"
if [ -n "$EXPECT_SHA" ]; then
  [ "$ACTUAL_SHA" = "$EXPECT_SHA" ] || die "SHA mismatch: got $ACTUAL_SHA want $EXPECT_SHA"
  ok "SHA-256 matches expected"
fi

PART_INFO=$("$SFDISK" -d "$IMG" 2>/dev/null || true)
echo "$PART_INFO" | grep -qi 'label: gpt' || die "not GPT"
PART_COUNT=$(echo "$PART_INFO" | grep -cE '^[^#].*start=' || true)
[ "$PART_COUNT" = 1 ] || die "expected exactly 1 partition, got $PART_COUNT"
ok "GPT with exactly one partition"

WORKDIR=$(mktemp -d /tmp/validate-app-disk-XXXXXX)
LOOP=""
MNT=""
cleanup() {
  set +e
  if [ -n "$MNT" ] && mountpoint -q "$MNT" 2>/dev/null; then
    $SUDO umount "$MNT" 2>/dev/null || $SUDO umount -l "$MNT" 2>/dev/null
  fi
  [ -n "$LOOP" ] && $SUDO "$LOSETUP" -d "$LOOP" 2>/dev/null
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

LOOP=$($SUDO "$LOSETUP" -f --show -P "$IMG")
PART=""
for _ in $(seq 1 20); do
  if [ -b "${LOOP}p1" ]; then PART="${LOOP}p1"; break; fi
  if [ -b "${LOOP}1" ]; then PART="${LOOP}1"; break; fi
  sleep 0.2
done
[ -n "$PART" ] || die "no partition node"
case "$PART" in /dev/loop*) ;; *) die "not a loop device: $PART" ;; esac

BLKID_OUT=$($SUDO "$BLKID" -o export "$PART")
echo "$BLKID_OUT"
TYPE_VAL=$($SUDO "$BLKID" -s TYPE -o value "$PART")
UUID_VAL=$($SUDO "$BLKID" -s UUID -o value "$PART")
LABEL_VAL=$($SUDO "$BLKID" -s LABEL -o value "$PART")
[ "$TYPE_VAL" = "ext4" ] || die "not ext4 (got $TYPE_VAL)"
[ "$UUID_VAL" = "$EXPECT_UUID" ] || die "UUID mismatch (got $UUID_VAL)"
[ "$LABEL_VAL" = "$LABEL" ] || die "label mismatch (got '$LABEL_VAL' want '$LABEL')"
ok "ext4 UUID=$EXPECT_UUID LABEL=$LABEL"

MNT="$WORKDIR/mnt"
mkdir -p "$MNT"
$SUDO mount -t ext4 -o ro "$PART" "$MNT"

[ -f "$MNT/META.yaml" ] || die "META.yaml missing at fs root"
META=$($SUDO cat "$MNT/META.yaml")
echo "$META"
echo "$META" | grep -q "diskId: ${EXPECT_DISK_ID}" || die "META diskId mismatch"
ok "META.yaml diskId=$EXPECT_DISK_ID"

if [ "$ROLE" = a ]; then
  COMPOSE="$MNT/apps/erase-test-1.0/compose.yaml"
  [ -f "$COMPOSE" ] || die "Disk A app compose missing"
  C=$($SUDO cat "$COMPOSE")
  echo "$C" | grep -q 'erase-seed-data' || die "named volume missing"
  echo "$C" | grep -q 'healthcheck' || die "healthcheck missing"
  echo "$C" | grep -qE '\$\{port\}:80|"\$\{port\}:80"' || die "port mapping missing"
  ENVF="$MNT/instances/erase-test-001/.env"
  [ -f "$ENVF" ] || die "instance .env missing"
  PORT=$(grep -E '^port=' "$ENVF" | cut -d= -f2)
  [ "$PORT" -ge 3000 ] || die "port $PORT < 3000"
  ok "Disk A: named volume + healthcheck + port=$PORT"
elif [ "$ROLE" = b ]; then
  COMPOSE="$MNT/apps/nextcloud-1.0/compose.yaml"
  [ -f "$COMPOSE" ] || die "Disk B app compose missing"
  C=$($SUDO cat "$COMPOSE")
  echo "$C" | grep -q 'filesMount' || die "filesMount missing"
  [ -f "$MNT/apps/nextcloud-1.0/idea-files-entrypoint.sh" ] || die "idea-files-entrypoint.sh missing"
  [ -f "$MNT/apps/nextcloud-1.0/docker-entrypoint-hooks.d/before-starting/10-idea-files.sh" ] || die "idea-files hook missing"
  [ ! -f "$MNT/FILES.yaml" ] || die "Disk B must be App-only (no FILES.yaml) for Add Files test"
  ok "Disk B: filesMount + wrapper + hook; App-only (no FILES.yaml)"
fi

$SUDO umount "$MNT"
MNT=""
$SUDO "$LOSETUP" -d "$LOOP"
LOOP=""
trap - EXIT
rm -rf "$WORKDIR"

echo "ALL CHECKS PASSED for $IMG (role=$ROLE)"
echo "SHA256 $ACTUAL_SHA"
