#!/usr/bin/env bash
# Replays Atlas's full r56 (2026-10-09) hand provisioning of nextcloud-grade5a-001
# onto the kit WD layout, idempotently. Reference: duration-evidence/
# path-a-stage2-20261009/prep-r56/READY.md + path-a-stage2/reset-r86t/nc-reset.txt.
# Passwords follow the <account>911! convention (2026-10-15), not the r56 ones.
# Run on idea03 as pi, under a fleet-state claim, on a FRESHLY RESET instance
# (nc-reset-path-a.sh from the a5542f2 seed), then run the preflight.
# NOT read-only: creates users, mounts, shares and sets config. Never run it
# against a live walk.
# Usage: bash tests/duration-tests/scripts/nc-provision-r56-replay.sh [NC_URL]
#        (default http://idea03:61820; NC_DROP_HELPER overrides the drop-zone helper path)
set -euo pipefail
NC_URL="${1:-http://idea03:61820}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
C=$(docker ps --format '{{.Names}}' | grep -E '^nextcloud-grade5a-001.*nextcloud-app' | head -1)
[ -n "$C" ] || { echo "FATAL: nextcloud-grade5a-001 app container not running" >&2; exit 1; }
occ() { docker exec -u www-data "$C" php occ "$@"; }
M=$(docker exec "$C" sh -c 'ls -d /mnt/idea-files/grade-5a-files* 2>/dev/null' | head -1)
[ -n "$M" ] || { echo "FATAL: no /mnt/idea-files/grade-5a-files* in $C" >&2; exit 1; }
echo "container=$C files=$M url=$NC_URL"

# 1. Apps (r56: files_external on; Text for Collab; wizard off)
occ app:disable password_policy || true
for a in files_external files_sharing text viewer; do occ app:enable "$a"; done
occ app:disable firstrunwizard || true
occ config:app:set text open_read_only_enabled --value=0

# 2. Users + group Grade 5A (r56: teacher + student01-03)
for u in student01 student02 student03; do
  occ user:info "$u" >/dev/null 2>&1 || docker exec -u www-data -e OC_PASS="${u}911!" "$C" php occ user:add --password-from-env --display-name="$u" "$u"
done
for u in teacher student01 student02 student03; do
  docker exec -u www-data -e OC_PASS="${u}911!" "$C" php occ user:resetpassword --password-from-env "$u"
done
occ group:add "Grade 5A" 2>/dev/null || true
for u in teacher student01 student02 student03; do occ group:adduser "Grade 5A" "$u" || true; done
for u in admin teacher student01 student02 student03; do occ user:setting "$u" firstrunwizard show 31.0.0 || true; done

# 3. Folders + ownership on the files disk (chown only; never touch/copy files: Text 409)
docker exec -u root "$C" sh -c '
  set -e
  for d in "Class Materials" "Collab" "Drop Zone/inbox"; do mkdir -p "$1/$d"; done
  chown -R 33:33 "$1/Collab" "$1/Drop Zone"
  test -f "$1/Collab/Grade5A-collab-notes.md" || echo "WARN: Collab/Grade5A-collab-notes.md missing on disk" >&2
' sh "$M"

# 4. Root Local mounts exactly as r56: /Class Materials, /Collab, /Drop Zone,
#    applicable Grade 5A, enable_sharing, filesystem_check_changes. Keep the kit's
#    "Grade 5A Files" mount too (steps 1-29 passed with it); also scope it to Grade 5A + sharing.
mount_id() { # $1 = mount point, prints id or nothing
  occ files_external:list --output=json | python3 -c '
import json,sys
mp=sys.argv[1]
for m in json.load(sys.stdin):
    if m.get("mount_point")==mp: print(m.get("mount_id")); break' "$1"
}
for pair in "/Class Materials:Class Materials" "/Collab:Collab" "/Drop Zone:Drop Zone"; do
  mp="${pair%%:*}" sub="${pair#*:}"
  id=$(mount_id "$mp")
  if [ -z "$id" ]; then
    occ files_external:create "$mp" local null::null -c datadir="$M/$sub" >/dev/null
    id=$(mount_id "$mp")
  fi
  [ -n "$id" ] || { echo "FATAL: could not create mount $mp" >&2; exit 1; }
  occ files_external:option "$id" enable_sharing true
  occ files_external:option "$id" filesystem_check_changes 1
  occ files_external:applicable --add-group="Grade 5A" "$id" >/dev/null
  echo "mount $mp id=$id -> $M/$sub"
done
gid=$(mount_id "/Grade 5A Files")
if [ -n "$gid" ]; then
  occ files_external:option "$gid" enable_sharing true
  occ files_external:applicable --add-group="Grade 5A" "$gid" >/dev/null
fi

# 5. overwrite.cli.url as r56 (trusted_domains unchanged)
occ config:system:set overwrite.cli.url --value="$NC_URL"

# 6. Scan + warm learner homes (first login ~11 s otherwise: kc4 step 27)
occ files:scan --all >/dev/null
for u in student01 student02 student03; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -u "$u:${u}911!" -X PROPFIND -H 'Depth: 0' "$NC_URL/remote.php/dav/files/$u/")
  echo "warm $u $code"; [ "$code" = 207 ] || { echo "FATAL: warm-up $u got $code" >&2; exit 1; }
done

# 7. Drop Zone file request (r56: link share, owner teacher, perms 4, token grade5adropzone,
#    on /Drop Zone/inbox). Skip if the token already resolves.
if [ "$(curl -s -o /dev/null -w '%{http_code}' "$NC_URL/s/grade5adropzone")" != 200 ]; then
  occ config:app:set core shareapi_allow_links --value=yes
  occ config:app:set core shareapi_allow_public_upload --value=yes
  occ config:app:set core shareapi_allow_custom_tokens --value=yes
  NC_DROP_PASS='teacher911!' python3 "${NC_DROP_HELPER:-$SCRIPT_DIR/nc-drop-zone-request.py}" "$NC_URL" grade5adropzone "/Drop Zone/inbox" "/Drop Zone"
  occ config:app:delete core shareapi_allow_custom_tokens   # r56 turned it off again
fi

# 8. Verify like r56: learner sees the 3 root folders + collab doc perms
for p in "Class%20Materials" "Collab" "Drop%20Zone"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -u 'student01:student01911!' -X PROPFIND -H 'Depth: 0' "$NC_URL/remote.php/dav/files/student01/$p/")
  echo "student01 /$p $code"; [ "$code" = 207 ] || { echo "FATAL: student01 cannot see /$p" >&2; exit 1; }
done
curl -s -u 'student01:student01911!' -X PROPFIND -H 'Depth: 0' \
  --data '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:permissions/></d:prop></d:propfind>' \
  "$NC_URL/remote.php/dav/files/student01/Collab/Grade5A-collab-notes.md" | grep -o '<oc:permissions>[^<]*' || echo "WARN: collab doc perms not read"
echo "r56 replay DONE: now run preflight-fixture-check.sh --apps nextcloud,kiwix --nc-container $C --nc-url $NC_URL"
