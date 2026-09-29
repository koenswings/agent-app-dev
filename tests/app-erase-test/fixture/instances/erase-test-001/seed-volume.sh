#!/bin/sh
# Seed named volume with a little data so erase summary reports volume size.
set -eu
mkdir -p /data
if [ ! -f /data/seed.txt ]; then
  echo "idea#138 erase-test seed $(date -u +%Y-%m-%dT%H:%M:%SZ)" > /data/seed.txt
  # ~64 KiB so volume data size is non-trivial in the erase summary
  dd if=/dev/zero of=/data/seed.bin bs=1024 count=64 2>/dev/null || true
fi
exec nginx -g 'daemon off;'
