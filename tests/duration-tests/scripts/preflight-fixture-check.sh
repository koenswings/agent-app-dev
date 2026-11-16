#!/usr/bin/env bash
# preflight-fixture-check.sh — READ-ONLY fixture preflight for duration walks
# (cover-all / Markov) on the docked Grade 5A Apps. Fails loudly (exit 1) when
# a fixture the walk needs is missing, BEFORE a 3-hour walk dies on it.
#
# WHY (idea#166 cover-all-6821ae1-kc3, 2026-11-16, FAIL@22 share_to_class:
# 'group "Grade 5A" not offered by sharee search'): the rebuilt WD Nextcloud
# seed (duration-nextcloud-grade5a-001.a5542f2.tar) came from the pre-r56 seed
# 2b83e1da…, which has only the admin "teacher": no Grade 5A group, no
# student01..03, no Drop Zone file request. Those were added by hand at r56 prep
# (2026-10-09) on the old idea03 disk and never made it into the seed on idea01.
# Nothing checked for them, so the walk found out at step 22.
#
# Strictly read-only: occ status/list/info/get, app:list, test -d/-w, a SQLite
# read (mode=ro, query_only) inside the Kolibri container, and HTTP GETs. It
# never runs occ set/add/enable, never writes a file, never restarts anything.
# (The optional teacher OCS GET is an authenticated read; Nextcloud itself may
# bump teacher's last-login timestamp. Use --no-auth to skip it.)
#
# Run on the Pi that hosts the Apps (Nextcloud + Kiwix on idea03's WD, Kolibri
# on idea01 in the kit layout), from an agent-app-dev checkout:
#   bash tests/duration-tests/scripts/preflight-fixture-check.sh            # auto-detect
#   bash tests/duration-tests/scripts/preflight-fixture-check.sh --apps nextcloud,kiwix
#   bash tests/duration-tests/scripts/preflight-fixture-check.sh \
#        --nc-container nextcloud-grade5a-001-nextcloud-app-1
#
# Options:
#   --apps LIST            auto (default) | all | comma list of nextcloud,kolibri,kiwix.
#                          auto = check every duration App container found on this
#                          host, FAIL if none. A listed App with no container = FAIL.
#   --nc-container NAME    default: first of nextcloud-grade5a-001*nextcloud-app*,
#                          idea166-nextcloud-live-app
#   --kolibri-container N  default: first of kolibri-grade5a-001*, idea166-kolibri-live
#   --kiwix-container NAME default: first of kiwix-ideaa-001*, idea166-kiwix-live
#   --nc-url URL           default http://127.0.0.1:<published :80 port>
#   --kolibri-url URL      default http://127.0.0.1:<KOLIBRI_HTTP_PORT or 18080>
#   --kiwix-url URL        default http://127.0.0.1:<published :8080 port>
#   --no-http              skip HTTP checks (the Drop Zone link check then WARNs)
#   --no-auth              skip the teacher OCS read of the file request share
#   --strict-applicable    every live /mnt/idea-files mount must list group Grade 5A
#                          explicitly (default: "All users" is also accepted)
#   --warm-learners        NOT read-only: first run warm-nextcloud-learners.sh (one
#                          WebDAV PROPFIND per learner → 207) so each learner home is
#                          initialized, then run the read-only checks
#   -h | --help
# Env:
#   DOCKER, CURL           command overrides (unit tests use fakes)
#   NC_TEACHER_USER / NC_TEACHER_PASS   default teacher / teacher911! (agent-app-dev#19)
#   DROP_ZONE_TOKEN        default grade5adropzone
#   KOLIBRI_VIDEO_NODE / KOLIBRI_EXERCISE_NODE   Console intents pins (open_video /
#                          open_exercise, e2e/intents/fixtures.ts)
# Exit: 0 all PASS (WARNs allowed), 1 any FAIL, 2 usage error.
set -uo pipefail

DOCKER="${DOCKER:-docker}"
CURL="${CURL:-curl}"
APPS="auto"
NC_C=""; KOL_C=""; KIWIX_C=""
NC_URL=""; KOL_URL=""; KIWIX_URL=""
DO_HTTP=1; DO_AUTH=1; STRICT_APPLICABLE=0; WARM_LEARNERS=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

NC_GROUP="Grade 5A"
NC_USERS=(teacher student01 student02 student03)
NC_TEACHER_USER="${NC_TEACHER_USER:-teacher}"
NC_TEACHER_PASS="${NC_TEACHER_PASS:-teacher911!}"
DROP_ZONE_TOKEN="${DROP_ZONE_TOKEN:-grade5adropzone}"
NC_COLLAB_DOC="Collab/Grade5A-collab-notes.md"
NC_REQUIRED_APPS=(files_external files_sharing text viewer)
NC_LEARNERS=(student01 student02 student03)

KOL_CLASS="Grade 5A"
KOL_LESSON="Grade 5A Duration Lesson"
KOL_COACH="teacher"
KOL_LEARNERS=(learner01 learner02 learner03)
KOLIBRI_VIDEO_NODE="${KOLIBRI_VIDEO_NODE:-4a1a1b923f6d59eba94c3f91f0011dd5}"
KOLIBRI_EXERCISE_NODE="${KOLIBRI_EXERCISE_NODE:-94a47ec7f30d5cd193f8ad08c42b6c2a}"

KIWIX_BOOK="duration_wikipedia_en_grade5a_stub_2026-10"

usage() {
  sed -n '2,/^set -uo pipefail/p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apps) APPS="${2:-}"; shift 2 ;;
    --nc-container) NC_C="${2:-}"; shift 2 ;;
    --kolibri-container) KOL_C="${2:-}"; shift 2 ;;
    --kiwix-container) KIWIX_C="${2:-}"; shift 2 ;;
    --nc-url) NC_URL="${2%/}"; shift 2 ;;
    --kolibri-url) KOL_URL="${2%/}"; shift 2 ;;
    --kiwix-url) KIWIX_URL="${2%/}"; shift 2 ;;
    --no-http) DO_HTTP=0; shift ;;
    --no-auth) DO_AUTH=0; shift ;;
    --strict-applicable) STRICT_APPLICABLE=1; shift ;;
    --warm-learners) WARM_LEARNERS=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown arg: $1" >&2; usage 2 ;;
  esac
done

N_PASS=0; N_FAIL=0; N_WARN=0
FAILS=()
pass() { N_PASS=$((N_PASS + 1)); printf 'PASS  %-24s %s\n' "$1" "$2"; }
fail() { N_FAIL=$((N_FAIL + 1)); FAILS+=("$1: $2"); printf 'FAIL  %-24s %s\n' "$1" "$2"; }
warn() { N_WARN=$((N_WARN + 1)); printf 'WARN  %-24s %s\n' "$1" "$2"; }

# json_get FILTER — tiny jq stand-in: reads JSON on stdin, evals a Python
# expression on `j`, prints the result (lists one per line, bools as true/false).
json_py() {
  python3 -c '
import json, sys
expr = sys.argv[1]
try:
    j = json.loads(sys.stdin.read() or "null")
except Exception:
    sys.exit(3)
r = eval(expr, {"j": j, "args": sys.argv[2:]})
if isinstance(r, bool):
    print("true" if r else "false")
elif isinstance(r, (list, tuple)):
    for x in r:
        print(x)
elif r is not None:
    print(r)
' "$@"
}

want() {
  case "$APPS" in
    auto|all) return 0 ;;
  esac
  [[ ",$APPS," == *",$1,"* ]]
}
explicit() { [[ "$APPS" != "auto" ]]; }

running_names() { "$DOCKER" ps --format '{{.Names}}' 2>/dev/null || true; }
detect() { # $1 = ERE list (first match wins, in order)
  local names re n
  names="$(running_names)"
  for re in "$@"; do
    n="$(printf '%s\n' "$names" | grep -E "$re" | head -n 1 || true)"
    [[ -n "$n" ]] && { printf '%s' "$n"; return 0; }
  done
  return 1
}
is_running() { running_names | grep -qx "$1"; }
published_port() { # $1 container, $2 container port → host port
  "$DOCKER" port "$1" "$2/tcp" 2>/dev/null | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p' | head -n 1
}
http_code() { # $1 url [extra curl args…]
  local url="$1"; shift
  "$CURL" -s -o /dev/null -m 20 -w '%{http_code}' "$@" "$url" 2>/dev/null || true
}
http_body() { local url="$1"; shift; "$CURL" -s -m 20 "$@" "$url" 2>/dev/null || true; }

occ() { "$DOCKER" exec -u www-data "$NC_C" php occ "$@" 2>/dev/null; }
nc_test() { "$DOCKER" exec -u www-data "$NC_C" test "$@" >/dev/null 2>&1; }

# ---------------------------------------------------------------- Nextcloud
check_nextcloud() {
  echo "== Nextcloud ($NC_C) =="
  local st
  st="$(occ status --output=json || true)"
  if [[ "$(printf '%s' "$st" | json_py 'bool((j or {}).get("installed"))' 2>/dev/null)" == "true" ]]; then
    pass nc.status "installed, version $(printf '%s' "$st" | json_py '(j or {}).get("versionstring")' 2>/dev/null)"
  else
    fail nc.status "occ status not installed/unreachable — nothing else can be checked"
    return
  fi

  # Users (walk logs in as teacher + student01; share_to_class needs the group).
  local users u info
  users="$(occ user:list --output=json || echo '{}')"
  for u in "${NC_USERS[@]}"; do
    if [[ "$(printf '%s' "$users" | json_py 'args[0] in (j or {})' "$u")" != "true" ]]; then
      fail nc.user "$u missing (create: occ user:add + group:adduser \"$NC_GROUP\" $u, password ${u}911!)"
      continue
    fi
    info="$(occ user:info "$u" --output=json || echo '{}')"
    if [[ "$(printf '%s' "$info" | json_py '(j or {}).get("enabled", True) is not False')" == "true" ]]; then
      pass nc.user "$u exists, enabled"
    else
      fail nc.user "$u is disabled (occ user:enable $u)"
    fi
  done

  # Learner homes initialized (kc4 FAIL@27: student01's FIRST login built the
  # home on the login request, the submit click waited > 8 s for navigation).
  # Initialized = data/<user>/files exists; last_seen is reported for context.
  local datadir last
  datadir="$(occ config:system:get datadirectory | tr -d '[:space:]')"
  datadir="${datadir:-/var/www/html/data}"
  for u in "${NC_LEARNERS[@]}"; do
    printf '%s' "$users" | json_py 'args[0] in (j or {})' "$u" | grep -qx true || continue
    last="$(occ user:info "$u" --output=json | json_py '(j or {}).get("last_seen") or (j or {}).get("lastLogin") or ""' 2>/dev/null || true)"
    if nc_test -d "$datadir/$u/files"; then
      pass nc.learner_home "$u home initialized ($datadir/$u/files; last_seen ${last:-?})"
    else
      fail nc.learner_home "$u never logged in / home not initialized (no $datadir/$u/files; last_seen ${last:-never}) — first walk login will be slow (open_nextcloud_as_learner step 27): run warm-nextcloud-learners.sh (WebDAV PROPFIND warm-up) or preflight --warm-learners"
    fi
  done

  # Group Grade 5A with all four members.
  local groups missing
  groups="$(occ group:list --output=json || echo '{}')"
  if [[ "$(printf '%s' "$groups" | json_py 'args[0] in (j or {})' "$NC_GROUP")" != "true" ]]; then
    fail nc.group "group \"$NC_GROUP\" missing — share_to_class (walk steps 22/73) cannot find it in sharee search (groups: $(printf '%s' "$groups" | json_py '", ".join(sorted((j or {}).keys()))'))"
  else
    missing="$(printf '%s' "$groups" | json_py '[u for u in args[1:] if u not in ((j or {}).get(args[0]) or [])]' "$NC_GROUP" "${NC_USERS[@]}")"
    if [[ -z "$missing" ]]; then
      pass nc.group "\"$NC_GROUP\" = ${NC_USERS[*]}"
    else
      fail nc.group "\"$NC_GROUP\" lacks members: $(echo "$missing" | tr '\n' ' ')"
    fi
  fi

  # Apps: firstrunwizard off (overlay blocks Files clicks), sharing/Text on.
  local apps a
  apps="$(occ app:list --output=json || echo '{}')"
  if [[ "$(printf '%s' "$apps" | json_py '"firstrunwizard" in ((j or {}).get("enabled") or {})')" == "true" ]]; then
    fail nc.firstrunwizard "firstrunwizard is ENABLED — its overlay blocks the walk's Files clicks (occ app:disable firstrunwizard)"
  else
    pass nc.firstrunwizard "disabled"
  fi
  for a in "${NC_REQUIRED_APPS[@]}"; do
    if [[ "$(printf '%s' "$apps" | json_py 'args[0] in ((j or {}).get("enabled") or {})' "$a")" == "true" ]]; then
      pass nc.app "$a enabled"
    else
      fail nc.app "$a not enabled (occ app:enable $a)"
    fi
  done

  # Core sharing switches (unset = Nextcloud default "yes").
  local k v
  for k in shareapi_enabled shareapi_allow_group_sharing shareapi_allow_links shareapi_allow_public_upload; do
    v="$(occ config:app:get core "$k" || true)"
    v="$(printf '%s' "$v" | tr -d '[:space:]')"
    if [[ "$v" == "no" ]]; then
      fail nc.shareapi "core $k=no (occ config:app:set core $k --value=yes)"
    else
      pass nc.shareapi "core $k=${v:-<default yes>}"
    fi
  done

  # Files Disk mounts: every live /mnt/idea-files storage shares, and Grade 5A sees it.
  local mounts lines id mp dd es groups_ users_ live=0 base=""
  mounts="$(occ files_external:list --output=json || echo '[]')"
  lines="$(printf '%s' "$mounts" | json_py '[
    "%s|%s|%s|%s|%s|%s" % (
      m.get("mount_id") or m.get("id"),
      m.get("mount_point", ""),
      (m.get("configuration") or {}).get("datadir", ""),
      str((m.get("options") or {}).get("enable_sharing")).lower(),
      ",".join(m.get("applicable_groups") or []),
      ",".join(m.get("applicable_users") or []))
    for m in (j if isinstance(j, list) else [])
    if str((m.get("configuration") or {}).get("datadir", "")).startswith("/mnt/idea-files/")]' 2>/dev/null || true)"
  local CM_PATH="" DZ_PATH="" CO_PATH="" DZ_NC=""
  while IFS='|' read -r id mp dd es groups_ users_; do
    [[ -n "$id" ]] || continue
    if ! nc_test -d "$dd"; then
      warn nc.mount "id=$id $mp → $dd: folder absent (undocked Files Disk) — not checked"
      continue
    fi
    live=$((live + 1))
    if [[ "$es" == "true" || "$es" == "1" ]]; then
      pass nc.mount.sharing "id=$id $mp enable_sharing=true"
    else
      fail nc.mount.sharing "id=$id $mp enable_sharing=${es:-unset} — share_to_class + file request impossible (occ files_external:option $id enable_sharing true)"
    fi
    if [[ ",$groups_," == *",$NC_GROUP,"* ]]; then
      pass nc.mount.applicable "id=$id $mp applicable to group $NC_GROUP"
    elif [[ -z "$groups_" && -z "$users_" && "$STRICT_APPLICABLE" != "1" ]]; then
      pass nc.mount.applicable "id=$id $mp applicable to All users (includes $NC_GROUP)"
    else
      fail nc.mount.applicable "id=$id $mp not applicable to \"$NC_GROUP\" (groups=[${groups_}] users=[${users_}]; occ files_external:applicable --add-group=\"$NC_GROUP\" $id)"
    fi
    # Locate the walk folders: docked layout (one "Grade 5A Files" mount holding
    # all three) or sidecar layout (one mount per folder).
    base="$(basename "$dd")"
    if nc_test -d "$dd/Class Materials"; then
      CM_PATH="$dd/Class Materials"; DZ_PATH="$dd/Drop Zone"; CO_PATH="$dd/Collab"; DZ_NC="$mp/Drop Zone"
    elif [[ "$base" == "Class Materials" ]]; then CM_PATH="$dd"
    elif [[ "$base" == "Drop Zone" ]]; then DZ_PATH="$dd"; DZ_NC="$mp"
    elif [[ "$base" == "Collab" ]]; then CO_PATH="$dd"
    fi
  done <<< "$lines"
  if [[ "$live" -eq 0 ]]; then
    fail nc.mount "no live /mnt/idea-files external storage (Files Disk not mounted, or 10-idea-files.sh hook never ran)"
  fi

  # Walk folders + writability for www-data (Drop Zone upload, Text keep_editing).
  if [[ -n "$CM_PATH" ]]; then pass nc.folder "Class Materials at $CM_PATH"
  else fail nc.folder "Class Materials folder not found on any live mount (share_to_class target)"; fi
  if [[ -n "$DZ_PATH" ]] && nc_test -d "$DZ_PATH/inbox"; then
    if nc_test -w "$DZ_PATH/inbox"; then pass nc.folder "Drop Zone/inbox writable by www-data"
    else fail nc.folder "$DZ_PATH/inbox not writable by www-data (uploads at after_upload fail; chown 33:33)"; fi
  else
    fail nc.folder "Drop Zone/inbox missing (file request target; mkdir + chown 33:33 + occ files:scan)"
  fi
  if [[ -n "$CO_PATH" ]] && nc_test -f "$CO_PATH/${NC_COLLAB_DOC#Collab/}"; then
    if nc_test -w "$CO_PATH/${NC_COLLAB_DOC#Collab/}"; then pass nc.collab "$NC_COLLAB_DOC writable by www-data"
    else fail nc.collab "$NC_COLLAB_DOC not writable by www-data — Text opens read-only, keep_editing (step 82) fails (chown -R 33:33 Collab, then occ files:scan; never touch/re-copy the file)"; fi
  else
    fail nc.collab "$NC_COLLAB_DOC missing (open_collab_doc steps 30/81)"
  fi

  # HTTP + Drop Zone file request link.
  if [[ "$DO_HTTP" != "1" ]]; then
    warn nc.http "--no-http: status.php and /s/$DROP_ZONE_TOKEN not checked"
    return
  fi
  if [[ -z "$NC_URL" ]]; then
    local p; p="$(published_port "$NC_C" 80)"
    NC_URL="http://127.0.0.1:${p:-18280}"
  fi
  local body
  body="$(http_body "$NC_URL/status.php")"
  if [[ "$(printf '%s' "$body" | json_py 'bool((j or {}).get("installed"))' 2>/dev/null)" == "true" ]]; then
    pass nc.http "$NC_URL/status.php installed:true"
  else
    fail nc.http "$NC_URL/status.php not installed/unreachable (body: ${body:0:120})"
  fi
  local found=0
  if [[ "$DO_AUTH" == "1" ]]; then
    local shares code
    shares="$(http_body "$NC_URL/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json" \
      -u "${NC_TEACHER_USER}:${NC_TEACHER_PASS}" -H 'OCS-APIRequest: true')"
    code="$(printf '%s' "$shares" | json_py '((j or {}).get("ocs") or {}).get("meta", {}).get("statuscode")' 2>/dev/null || true)"
    if [[ "$code" == "200" ]]; then
      local s
      s="$(printf '%s' "$shares" | json_py '[
        "%s|%s|%s" % (d.get("share_type"), d.get("permissions"), d.get("path"))
        for d in ((j.get("ocs") or {}).get("data") or []) if d.get("token") == args[0]]' "$DROP_ZONE_TOKEN")"
      if [[ -z "$s" ]]; then
        fail nc.file_request "no share with token $DROP_ZONE_TOKEN (open_file_drop steps 28/78; create with nc-drop-zone-request.py, path \"${DZ_NC:-/Drop Zone}/inbox\")"
      else
        found=1
        IFS='|' read -r stype perms spath <<< "$(echo "$s" | head -n 1)"
        if [[ "$stype" == "3" && "$perms" == "4" && "$spath" == *"Drop Zone/inbox" ]]; then
          pass nc.file_request "/s/$DROP_ZONE_TOKEN link, upload-only (4) on $spath"
        else
          fail nc.file_request "/s/$DROP_ZONE_TOKEN wrong: share_type=$stype permissions=$perms path=$spath (want 3 / 4 / …Drop Zone/inbox)"
        fi
      fi
    else
      warn nc.file_request "teacher OCS read refused (statuscode ${code:-none}) — teacher password is not ${NC_TEACHER_USER}911!? Falling back to the public link check"
    fi
  fi
  if [[ "$found" != "1" ]]; then
    local c; c="$(http_code "$NC_URL/s/$DROP_ZONE_TOKEN")"
    if [[ "$c" == "200" ]]; then
      pass nc.file_request "$NC_URL/s/$DROP_ZONE_TOKEN → 200 (public page; permissions not verified)"
    elif [[ "$DO_AUTH" != "1" || -z "${code:-}" || "$code" != "200" ]]; then
      fail nc.file_request "$NC_URL/s/$DROP_ZONE_TOKEN → ${c:-000} (link missing; open_file_drop steps 28/78 will fail${c:+; 400 = untrusted host, retry with --nc-url http://<trusted-name>:<port>})"
    fi
  fi
}

# ------------------------------------------------------------------ Kolibri
# Read-only SQLite query inside the Kolibri container (python2/3 compatible).
KOLIBRI_PY='
from __future__ import print_function
import json, os, sqlite3, sys
home = os.environ.get("KOLIBRI_HOME") or "/root/.kolibri"
db = os.path.join(home, "db.sqlite3")
cls_name, lesson_title, coach, vid, exe = sys.argv[1:6]
learners = sys.argv[6:]
out = {"db": db}
if not os.path.exists(db):
    out["error"] = "no db"
    print(json.dumps(out)); sys.exit(0)
try:
    con = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
except TypeError:
    con = sqlite3.connect(db)
con.execute("PRAGMA query_only=ON")
q = lambda s, a=(): con.execute(s, a).fetchall()
out["facilities"] = [r[0] for r in q("select name from kolibriauth_facility")]
cls = q("select id, parent_id from kolibriauth_collection where kind=? and name=?", ("classroom", cls_name))
out["class"] = bool(cls)
users = dict((r[1], r[0]) for r in q("select id, username from kolibriauth_facilityuser"))
out["users"] = sorted(u for u in [coach] + learners if u in users)
if cls:
    cid, fid = cls[0]
    mem = set(r[0] for r in q("select u.username from kolibriauth_membership m join kolibriauth_facilityuser u on u.id=m.user_id where m.collection_id=?", (cid,)))
    out["members"] = sorted(u for u in learners if u in mem)
    roles = q("select r.kind, r.collection_id from kolibriauth_role r join kolibriauth_facilityuser u on u.id=r.user_id where u.username=?", (coach,))
    out["coach"] = any((c == cid and "coach" in k) or (c == fid and k in ("admin", "coach")) for k, c in roles)
    out["lesson"] = [bool(r[0]) for r in q("select is_active from lessons_lesson where collection_id=? and title=?", (cid, lesson_title))]
nodes = {}
for n in (vid, exe):
    r = q("select kind, available from content_contentnode where id=?", (n.replace("-", ""),))
    nodes[n] = {"kind": r[0][0], "available": bool(r[0][1])} if r else None
out["nodes"] = nodes
print(json.dumps(out))
'

check_kolibri() {
  echo "== Kolibri ($KOL_C) =="
  local js
  js="$("$DOCKER" exec "$KOL_C" python -c "$KOLIBRI_PY" "$KOL_CLASS" "$KOL_LESSON" "$KOL_COACH" \
        "$KOLIBRI_VIDEO_NODE" "$KOLIBRI_EXERCISE_NODE" "${KOL_LEARNERS[@]}" 2>/dev/null || true)"
  if [[ -z "$js" ]] || [[ -n "$(printf '%s' "$js" | json_py '(j or {}).get("error")' 2>/dev/null)" ]] || \
     ! printf '%s' "$js" | json_py 'j' >/dev/null 2>&1; then
    fail kol.db "cannot read Kolibri db.sqlite3 in $KOL_C (${js:0:160})"
    return
  fi
  local f
  f="$(printf '%s' "$js" | json_py '", ".join(j.get("facilities") or [])')"
  if [[ -n "$f" ]]; then pass kol.facility "$f"; else fail kol.facility "no facility (Kolibri not provisioned)"; fi
  if [[ "$(printf '%s' "$js" | json_py 'bool(j.get("class"))')" == "true" ]]; then
    pass kol.class "classroom \"$KOL_CLASS\""
  else
    fail kol.class "classroom \"$KOL_CLASS\" missing (create_class only asserts; enroll/build/read_reports need it)"
  fi
  local missing
  missing="$(printf '%s' "$js" | json_py '[u for u in args if u not in (j.get("users") or [])]' "$KOL_COACH" "${KOL_LEARNERS[@]}")"
  if [[ -z "$missing" ]]; then pass kol.users "$KOL_COACH ${KOL_LEARNERS[*]} exist"
  else fail kol.users "missing facility users: $(echo "$missing" | tr '\n' ' ')"; fi
  if [[ "$(printf '%s' "$js" | json_py 'bool(j.get("class"))')" == "true" ]]; then
    missing="$(printf '%s' "$js" | json_py '[u for u in args if u not in (j.get("members") or [])]' "${KOL_LEARNERS[@]}")"
    if [[ -z "$missing" ]]; then pass kol.enrolled "${KOL_LEARNERS[*]} in \"$KOL_CLASS\""
    else fail kol.enrolled "not enrolled in \"$KOL_CLASS\": $(echo "$missing" | tr '\n' ' ')"; fi
    if [[ "$(printf '%s' "$js" | json_py 'bool(j.get("coach"))')" == "true" ]]; then
      pass kol.coach "$KOL_COACH coaches \"$KOL_CLASS\""
    else
      fail kol.coach "$KOL_COACH has no coach/admin role on \"$KOL_CLASS\" or its facility"
    fi
    case "$(printf '%s' "$js" | json_py '"active" if any(j.get("lesson") or []) else ("inactive" if j.get("lesson") else "none")')" in
      active) pass kol.lesson "\"$KOL_LESSON\" active" ;;
      inactive) fail kol.lesson "\"$KOL_LESSON\" exists but is not active (learner Learn view will not show it)" ;;
      *) fail kol.lesson "\"$KOL_LESSON\" missing (build_lesson / read_reports)" ;;
    esac
  fi
  local n
  for n in "$KOLIBRI_VIDEO_NODE:video:open_video" "$KOLIBRI_EXERCISE_NODE:exercise:open_exercise"; do
    IFS=: read -r id kind intent <<< "$n"
    case "$(printf '%s' "$js" | json_py '(lambda x: "none" if not x else ("ok" if x["available"] else "unavailable"))((j.get("nodes") or {}).get(args[0]))' "$id")" in
      ok) pass kol.content "$intent node $id available" ;;
      unavailable) fail kol.content "$intent node $id present but NOT available (content files not imported)" ;;
      *) fail kol.content "$intent node $id ($kind) not in content DB (channel not imported)" ;;
    esac
  done
  if [[ "$DO_HTTP" == "1" ]]; then
    if [[ -z "$KOL_URL" ]]; then
      local p; p="$("$DOCKER" exec "$KOL_C" printenv KOLIBRI_HTTP_PORT 2>/dev/null | tr -d '[:space:]')"
      KOL_URL="http://127.0.0.1:${p:-18080}"
    fi
    local c; c="$(http_code "$KOL_URL/")"
    if [[ "$c" =~ ^(200|301|302)$ ]]; then pass kol.http "$KOL_URL/ → $c"
    else fail kol.http "$KOL_URL/ → ${c:-000}"; fi
  fi
}

# -------------------------------------------------------------------- Kiwix
check_kiwix() {
  echo "== Kiwix ($KIWIX_C) =="
  if "$DOCKER" exec "$KIWIX_C" ls /data 2>/dev/null | grep -qx "${KIWIX_BOOK}.zim"; then
    pass kiwix.zim "/data/${KIWIX_BOOK}.zim present"
  else
    fail kiwix.zim "/data/${KIWIX_BOOK}.zim missing in $KIWIX_C"
  fi
  [[ "$DO_HTTP" == "1" ]] || { warn kiwix.http "--no-http: browse URL not checked"; return; }
  if [[ -z "$KIWIX_URL" ]]; then
    local p; p="$(published_port "$KIWIX_C" 8080)"
    KIWIX_URL="http://127.0.0.1:${p:-18380}"
  fi
  local c
  c="$(http_code "$KIWIX_URL/")"
  if [[ "$c" == "200" ]]; then pass kiwix.http "$KIWIX_URL/ → 200"; else fail kiwix.http "$KIWIX_URL/ → ${c:-000}"; fi
  c="$(http_code "$KIWIX_URL/content/$KIWIX_BOOK/Main_Page" -L)"
  if [[ "$c" == "200" ]]; then pass kiwix.http "Main_Page → 200 (open_wikipedia_*)"
  else fail kiwix.http "$KIWIX_URL/content/$KIWIX_BOOK/Main_Page → ${c:-000} (open_wikipedia_* steps 34/67)"; fi
  local body
  body="$(http_body "$KIWIX_URL/search?books.name=$KIWIX_BOOK&pattern=fraction")"
  if printf '%s' "$body" | grep -q 'Fraction'; then
    if printf '%s' "$body" | sed 's/<[^>]*>//g' | tr -s '[:space:]' ' ' | grep -Eq 'Results 1-4 of 4'; then
      pass kiwix.search "\"fraction\" → Results 1-4 of 4"
    else
      warn kiwix.search "\"fraction\" finds Fraction but not \"Results 1-4 of 4\" (intent expects that text)"
    fi
  else
    fail kiwix.search "search \"fraction\" finds no Fraction article (search_browse_wikipedia step 35)"
  fi
}

# --------------------------------------------------------------------- main
case "$APPS" in
  auto|all) ;;
  *) IFS=, read -r -a _a <<< "$APPS"
     for x in "${_a[@]}"; do
       case "$x" in nextcloud|kolibri|kiwix) ;; *) echo "bad --apps entry: $x" >&2; exit 2 ;; esac
     done ;;
esac
command -v python3 >/dev/null 2>&1 || { echo "FAIL  python3 required on the host" >&2; exit 1; }

if [[ "$WARM_LEARNERS" == "1" ]] && want nextcloud; then
  [[ -n "$NC_C" ]] || NC_C="$(detect '^nextcloud-grade5a-001.*nextcloud-app' '^idea166-nextcloud-live-app$' || true)"
  echo "== warm-up (NOT read-only, --warm-learners): WebDAV PROPFIND per learner =="
  warm_args=()
  [[ -n "$NC_URL" ]] && warm_args+=(--nc-url "$NC_URL")
  [[ -n "$NC_C" ]] && warm_args+=(--nc-container "$NC_C")
  DOCKER="$DOCKER" CURL="$CURL" bash "$SCRIPT_DIR/warm-nextcloud-learners.sh" "${warm_args[@]}" "${NC_LEARNERS[@]}" || \
    echo "WARN  warm-up did not answer 207 for every learner (see above); checks follow"
  echo
fi

echo "preflight-fixture-check $(date -u +%Y-%m-%dT%H:%M:%SZ) host=$(hostname -s 2>/dev/null || echo ?) apps=$APPS (read-only)"
checked=0
if want nextcloud; then
  [[ -n "$NC_C" ]] || NC_C="$(detect '^nextcloud-grade5a-001.*nextcloud-app' '^idea166-nextcloud-live-app$' || true)"
  if [[ -n "$NC_C" ]] && is_running "$NC_C"; then check_nextcloud; checked=$((checked + 1))
  elif explicit || [[ -n "$NC_C" ]]; then fail nc.container "Nextcloud container ${NC_C:-nextcloud-grade5a-001-*} not running on this host"
  fi
fi
if want kolibri; then
  [[ -n "$KOL_C" ]] || KOL_C="$(detect '^kolibri-grade5a-001' '^idea166-kolibri-live$' || true)"
  if [[ -n "$KOL_C" ]] && is_running "$KOL_C"; then check_kolibri; checked=$((checked + 1))
  elif explicit || [[ -n "$KOL_C" ]]; then fail kol.container "Kolibri container ${KOL_C:-kolibri-grade5a-001-*} not running on this host"
  fi
fi
if want kiwix; then
  [[ -n "$KIWIX_C" ]] || KIWIX_C="$(detect '^kiwix-ideaa-001' '^idea166-kiwix-live$' || true)"
  if [[ -n "$KIWIX_C" ]] && is_running "$KIWIX_C"; then check_kiwix; checked=$((checked + 1))
  elif explicit || [[ -n "$KIWIX_C" ]]; then fail kiwix.container "Kiwix container ${KIWIX_C:-kiwix-ideaa-001-*} not running on this host"
  fi
fi
if [[ "$checked" -eq 0 && "$N_FAIL" -eq 0 ]]; then
  fail preflight "no duration App container found on this host (apps=$APPS)"
fi

echo
echo "summary: pass=$N_PASS warn=$N_WARN fail=$N_FAIL"
if [[ "$N_FAIL" -gt 0 ]]; then
  echo "################################################################"
  echo "## PREFLIGHT FAIL — DO NOT LAUNCH THE WALK. Missing fixtures:"
  for f in "${FAILS[@]}"; do echo "##   - $f"; done
  echo "################################################################"
  exit 1
fi
echo "PREFLIGHT PASS"
exit 0
