#!/usr/bin/env bash
# verify-app-bundle.sh — check an App bundle on a disk against its build-time SHA256SUMS.
# Usage: verify-app-bundle.sh <disk-root> <appId>
# Exit 0 only if every listed file matches AND every file in apps/<appId>/ is listed
# (except SHA256SUMS itself and Engine markers .idea-* at the bundle root).
set -euo pipefail
ROOT=${1:?disk root}; APP_ID=${2:?appId}
cd "$ROOT"
B="apps/$APP_ID"
[ -f "$B/SHA256SUMS" ] || { echo "FAIL: $B/SHA256SUMS missing" >&2; exit 1; }
# appIds can contain '+' or '.' (e.g. usage-dashboard-0.0-dev+7ba3d76c5211), which
# are operators in grep -E, so the bundle prefix is matched as a fixed string.
B_RE=$(printf '%s' "$B" | sed -E 's/[][^$*.+?(){}|\\]/\\&/g')
if sed -E 's/^[0-9a-f]{64} [ *]//' "$B/SHA256SUMS" | grep -Ev "^($B_RE/|services/[^/]+\.tar$)" | grep -q .; then
  echo "FAIL: SHA256SUMS lists a path outside $B/ and services/*.tar" >&2; exit 1
fi
sha256sum --quiet --strict -c "$B/SHA256SUMS"
extra=$(LC_ALL=C comm -23 <(find "$B" \( -type f -o -type l \) ! -path "$B/SHA256SUMS" ! -path "$B/.idea-*" | LC_ALL=C sort) \
                 <(sed -E 's/^[0-9a-f]{64} [ *]//' "$B/SHA256SUMS" | LC_ALL=C sort))
[ -z "$extra" ] || { echo "FAIL: files not in SHA256SUMS:" >&2; echo "$extra" >&2; exit 1; }
echo "ok: $B"
