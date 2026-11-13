#!/usr/bin/env bash
# verify-app-bundle.sh — check an App bundle on a disk against its build-time SHA256SUMS.
# Usage: verify-app-bundle.sh <disk-root> <appId>
#
# The bundle SHA256SUMS (apps/<appId>/SHA256SUMS) is self-contained and bundle-relative
# (Engine UpdateApp.ts defaultVerifySums / sumsLookUsable): only the bundle's own files,
# including a bare compose.yaml line, never services/*.tar. Check:
#   cd apps/<appId> && sha256sum --check --strict SHA256SUMS
# Every file in apps/<appId>/ must be listed (except SHA256SUMS itself and Engine markers
# .idea-* at the bundle root).
# The bundle must not contain __pycache__/ or *.pyc/*.pyo (bytecode left by a test run
# against the tree, or a force-added path that escaped the copy filter).
# The disk-root SHA256SUMS lists services/*.tar and apps/** (disk-root-relative). Check:
#   cd <disk-root> && sha256sum --check --strict SHA256SUMS
set -euo pipefail
ROOT=${1:?disk root}; APP_ID=${2:?appId}
ROOT=$(cd "$ROOT" && pwd)
B="apps/$APP_ID"
[ -f "$ROOT/$B/SHA256SUMS" ] || { echo "FAIL: $B/SHA256SUMS missing" >&2; exit 1; }
if sed -E 's/^[0-9a-f]{64} [ *]//' "$ROOT/$B/SHA256SUMS" | grep -E '^(apps/|services/|/)' | grep -q .; then
  echo "FAIL: $B/SHA256SUMS must be bundle-relative (no apps/ or services/ paths)" >&2; exit 1
fi
if ! grep -Eq '^[0-9a-f]{64} [ *]\.?/?compose\.yaml$' "$ROOT/$B/SHA256SUMS"; then
  echo "FAIL: $B/SHA256SUMS does not list compose.yaml (Engine sumsLookUsable)" >&2; exit 1
fi
# Engine-exact: cd into the bundle dir and check SHA256SUMS there.
(cd "$ROOT/$B" && sha256sum --quiet --strict --check SHA256SUMS) \
  || { echo "FAIL: bundle SHA256SUMS check failed" >&2; exit 1; }
bytecode=$(cd "$ROOT/$B" && find . \( -type d -name '__pycache__' -o -name '*.pyc' -o -name '*.pyo' \) -print | sed 's|^\./||')
[ -z "$bytecode" ] || { echo "FAIL: bytecode (__pycache__/*.pyc/*.pyo) must not be in the bundle:" >&2; echo "$bytecode" >&2; exit 1; }
extra=$(LC_ALL=C comm -23 \
  <(cd "$ROOT/$B" && find . \( -type f -o -type l \) ! -path ./SHA256SUMS ! -path './.idea-*' | sed 's|^\./||' | LC_ALL=C sort) \
  <(sed -E 's/^[0-9a-f]{64} [ *]//' "$ROOT/$B/SHA256SUMS" | LC_ALL=C sort))
[ -z "$extra" ] || { echo "FAIL: files not in SHA256SUMS:" >&2; echo "$extra" >&2; exit 1; }
[ -f "$ROOT/SHA256SUMS" ] || { echo "FAIL: disk-root SHA256SUMS missing" >&2; exit 1; }
(cd "$ROOT" && sha256sum --quiet --strict --check SHA256SUMS) \
  || { echo "FAIL: disk-root SHA256SUMS check failed" >&2; exit 1; }
echo "ok: $B"
