#!/usr/bin/env bash
# Build Disk A + Disk B throwaway images for idea#138.
# Reads build-ids.env (BUILD_ID, DISK_*_ID, FS_UUID_*, IMG_SIZE_MIB, LABEL).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IDS="${1:-}"
TREE_A="${2:-}"
TREE_B="${3:-}"
OUT_DIR="${4:-}"
[ -n "$IDS" ] && [ -f "$IDS" ] || { echo "usage: $0 <build-ids.env> <tree-a> <tree-b> <out-dir>" >&2; exit 2; }
[ -d "$TREE_A" ] && [ -d "$TREE_B" ] || { echo "trees missing" >&2; exit 2; }
mkdir -p "$OUT_DIR"

# Load env (LABEL may contain spaces)
while IFS= read -r line; do
  key=${line%%=*}
  val=${line#*=}
  printf -v "$key" '%s' "$val"
  export "$key"
done < "$IDS"

NAME_A="files-disk-a-erase-${BUILD_ID}.img"
NAME_B="files-disk-b-nextcloud-${BUILD_ID}.img"

"$ROOT/script/build-app-disk-image.sh" \
  --tree "$TREE_A" --out "$OUT_DIR/$NAME_A" \
  --uuid "$FS_UUID_A" --disk-id "$DISK_A_ID" \
  --size-mib "$IMG_SIZE_MIB" --label "$LABEL"

"$ROOT/script/build-app-disk-image.sh" \
  --tree "$TREE_B" --out "$OUT_DIR/$NAME_B" \
  --uuid "$FS_UUID_B" --disk-id "$DISK_B_ID" \
  --size-mib "$IMG_SIZE_MIB" --label "$LABEL"

(
  cd "$OUT_DIR"
  sha256sum "$NAME_A" "$NAME_B" > SHA256SUMS
  cat SHA256SUMS
)

echo "Built:"
ls -lh "$OUT_DIR/$NAME_A" "$OUT_DIR/$NAME_B"
