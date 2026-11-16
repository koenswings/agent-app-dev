#!/usr/bin/env bash
# warm-nextcloud-learners.sh — initialize the Nextcloud homes of the duration
# learners with one authenticated WebDAV PROPFIND each (Depth: 0), so the walk's
# first learner login does not pay for home/skeleton setup.
#
# WHY (idea#166 cover-all kc4 FAIL@27 open_nextcloud_as_learner): student01's
# very first login worked, but Nextcloud built the home on that request and the
# [data-login-form-submit] click waited > 8 s for navigation. A PROPFIND as the
# user triggers the same one-time setup ahead of the walk.
#
# NOT read-only: Nextcloud creates data/<user>/files (+ skeleton) and updates the
# user's last-login. Run only when asked (or via preflight --warm-learners).
#
# Usage:
#   bash tests/duration-tests/scripts/warm-nextcloud-learners.sh --nc-url http://127.0.0.1:61820
#   bash tests/duration-tests/scripts/warm-nextcloud-learners.sh --nc-container nextcloud-grade5a-001-nextcloud-app-1
#   bash tests/duration-tests/scripts/warm-nextcloud-learners.sh --nc-url URL student01
# Options:
#   --nc-url URL         Nextcloud base URL (default http://127.0.0.1:<published :80
#                        port of --nc-container or the auto-detected docked instance>)
#   --nc-container NAME  only used to find the published port
#   USER...              default student01 student02 student03
# Env:
#   NC_LEARNER_PASS_SUFFIX  default 911! (password = <user>911!, agent-app-dev#19)
#   DOCKER, CURL            command overrides (unit tests)
# Exit: 0 every user answered 207, 1 otherwise, 2 usage error.
set -uo pipefail

DOCKER="${DOCKER:-docker}"
CURL="${CURL:-curl}"
NC_URL=""; NC_C=""
SUFFIX="${NC_LEARNER_PASS_SUFFIX:-911!}"
USERS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --nc-url) NC_URL="${2%/}"; shift 2 ;;
    --nc-container) NC_C="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,/^set -uo pipefail/p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown arg: $1" >&2; exit 2 ;;
    *) USERS+=("$1"); shift ;;
  esac
done
[[ ${#USERS[@]} -gt 0 ]] || USERS=(student01 student02 student03)

if [[ -z "$NC_URL" ]]; then
  if [[ -z "$NC_C" ]]; then
    NC_C="$("$DOCKER" ps --format '{{.Names}}' 2>/dev/null | grep -E '^nextcloud-grade5a-001.*nextcloud-app|^idea166-nextcloud-live-app$' | head -n 1 || true)"
  fi
  p=""
  [[ -n "$NC_C" ]] && p="$("$DOCKER" port "$NC_C" 80/tcp 2>/dev/null | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p' | head -n 1)"
  [[ -n "$p" ]] || { echo "FAIL  warm: no --nc-url and no published port found (container ${NC_C:-none})" >&2; exit 2; }
  NC_URL="http://127.0.0.1:$p"
fi

fails=0
for u in "${USERS[@]}"; do
  start=$(date +%s)
  code="$("$CURL" -s -o /dev/null -m 120 -w '%{http_code}' -u "${u}:${u}${SUFFIX}" \
          -X PROPFIND -H 'Depth: 0' "$NC_URL/remote.php/dav/files/$u/" 2>/dev/null || true)"
  secs=$(( $(date +%s) - start ))
  if [[ "$code" == "207" ]]; then
    printf 'PASS  %-24s %s\n' warm.learner "$u PROPFIND /remote.php/dav/files/$u/ → 207 (${secs}s)"
  else
    printf 'FAIL  %-24s %s\n' warm.learner "$u PROPFIND → ${code:-000} (401 = password is not ${u}<suffix>; 400 = untrusted host, use --nc-url with a trusted name)"
    fails=$((fails + 1))
  fi
done
[[ "$fails" -eq 0 ]] || exit 1
exit 0
