#!/usr/bin/env bash
# post-dock-restore-running.sh — Atlas/Axle one-shot after RealFleetOps dock (idea#166/#168)
#
# WHY: infra_dock_fixture defaults to stripping instances/, so Engine will not
# auto-start Kolibri/Nextcloud. Console Open cards need instanceDB status=Running,
# which only happens when Engine startInstance / dock auto-start succeeds.
#
# This script offers two reliable App-owned paths:
#
#   sidecar (default)  Bring up duration apps outside the dock tree:
#                      Kolibri  → LIVE_KOLIBRI  (:18080, host net)
#                      Nextcloud → LIVE_NEXTCLOUD (:18280) + Text collab perms
#                      Kiwix    → LIVE_KIWIX (:18380, only with --apps kiwix|all)
#                      HTTP-reachable for App-open Intents. Does NOT by itself
#                      flip Console cards to Running (Engine must startInstance
#                      on docked instances — see --mode dock-compose + Axle flag).
#
#   dock-compose       Restore fixtures/*/instances/ into DOCK_ROOT, link sidecar
#                      data when present, docker compose up each instance.
#                      Use AFTER dock when Axle kept instances/ (startInstances)
#                      OR after manual instances restore + Engine startInstance.
#                      Prefer pairing with Axle RealFleetOps startInstances=true.
#
#   dock-instances     Copy compose only (legacy); no compose up.
#
# Does NOT merge, does NOT touch /disks, idea03 sdb1 Intenso, or idea02.
#
# Usage (on claimed idea01 or idea03, from agent-app-dev checkout):
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh --mode sidecar
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh --apps both
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh --apps kolibri
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh --apps nextcloud
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh --apps kiwix
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh --apps all
#   (both = kolibri+nextcloud, unchanged default; all = kolibri+nextcloud+kiwix)
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh --mode dock-compose \
#        --dock-root /home/pi/idea/duration-disks/idea-test-1
#
# Env:
#   LIVE_KOLIBRI     default /home/pi/idea166-kolibri-live
#   LIVE_NEXTCLOUD   default /home/pi/idea166-nextcloud-live
#   LIVE_KIWIX       default /home/pi/idea166-kiwix-live
#   LIVE_ROOT        alias for LIVE_KOLIBRI (back-compat)
#   DOCK_ROOT        required for dock-* modes
#   PACK_ROOT        default <repo>/tests/duration-tests/fixtures
#   SKIP_HTTP=1      skip curl health checks
#   SKIP_PROVISION=1 skip Nextcloud occ user seed + collab/share/file-request provisioning
#   DROP_ZONE_TOKEN  default grade5adropzone (custom public link token for Drop Zone/inbox;
#                    [A-Za-z0-9] only — NC 31.0.1 public uploads break on "-")
#   KOLIBRI_PORT     default 18080 (idea03 may need override if :18080 taken)
#   NEXTCLOUD_PORT   default 18280
#   KIWIX_PORT       default 18380 (image ghcr.io/kiwix/kiwix-serve:3.8.2, pre-pull)
set -euo pipefail

MODE="sidecar"
APPS="both"
LIVE_KOLIBRI="${LIVE_ROOT:-${LIVE_KOLIBRI:-/home/pi/idea166-kolibri-live}}"
LIVE_NEXTCLOUD="${LIVE_NEXTCLOUD:-/home/pi/idea166-nextcloud-live}"
LIVE_KIWIX="${LIVE_KIWIX:-/home/pi/idea166-kiwix-live}"
DOCK_ROOT="${DOCK_ROOT:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PACK_ROOT="${PACK_ROOT:-$REPO_ROOT/tests/duration-tests/fixtures}"
LIVE_JSON="$PACK_ROOT/kolibri/content/CONTENT.live.json"
NC_LIVE_JSON="$PACK_ROOT/nextcloud/content/CONTENT.live.json"
KIWIX_LIVE_JSON="$PACK_ROOT/kiwix/content/CONTENT.live.json"
KOLIBRI_PORT="${KOLIBRI_PORT:-18080}"
NEXTCLOUD_PORT="${NEXTCLOUD_PORT:-18280}"
KIWIX_PORT="${KIWIX_PORT:-18380}"

DISK_KOLIBRI="duration-kolibri-grade5a-001"
INST_KOLIBRI="kolibri-grade5a-001"
DISK_NC="duration-nextcloud-grade5a-001"
INST_NC="nextcloud-grade5a-001"
DISK_KIWIX="duration-kiwix-ideaa-001"
INST_KIWIX="kiwix-ideaa-001"
KIWIX_IMAGE="ghcr.io/kiwix/kiwix-serve:3.8.2"
KIWIX_BOOK="duration_wikipedia_en_grade5a_stub_2026-10"

usage() {
  sed -n '2,/^set -euo pipefail/p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --apps) APPS="$2"; shift 2 ;;
    --live-root|--live-kolibri) LIVE_KOLIBRI="$2"; shift 2 ;;
    --live-nextcloud) LIVE_NEXTCLOUD="$2"; shift 2 ;;
    --live-kiwix) LIVE_KIWIX="$2"; shift 2 ;;
    --dock-root) DOCK_ROOT="$2"; shift 2 ;;
    --pack-root)
      PACK_ROOT="$2"
      LIVE_JSON="$PACK_ROOT/kolibri/content/CONTENT.live.json"
      NC_LIVE_JSON="$PACK_ROOT/nextcloud/content/CONTENT.live.json"
      KIWIX_LIVE_JSON="$PACK_ROOT/kiwix/content/CONTENT.live.json"
      shift 2
      ;;
    --kolibri-port) KOLIBRI_PORT="$2"; shift 2 ;;
    --nextcloud-port) NEXTCLOUD_PORT="$2"; shift 2 ;;
    --kiwix-port) KIWIX_PORT="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "unknown arg: $1" >&2; usage 2 ;;
  esac
done

want_kolibri() { [[ "$APPS" == "both" || "$APPS" == "all" || "$APPS" == "kolibri" ]]; }
want_nextcloud() { [[ "$APPS" == "both" || "$APPS" == "all" || "$APPS" == "nextcloud" ]]; }
want_kiwix() { [[ "$APPS" == "all" || "$APPS" == "kiwix" ]]; }

http_ok() {
  local url="$1" code=""
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
    [[ "$code" =~ ^(200|302|301|401)$ ]] && { echo "$code"; return 0; }
    sleep 3
  done
  echo "${code:-unreachable}"
  return 1
}

print_pins() {
  echo
  echo "=== Duration diskIds / instanceIds (Console should target these) ==="
  echo "  Kolibri   diskId=$DISK_KOLIBRI  instanceId=$INST_KOLIBRI  → http://<host>:${KOLIBRI_PORT}/"
  echo "  Nextcloud diskId=$DISK_NC  instanceId=$INST_NC  → http://<host>:${NEXTCLOUD_PORT}/apps/files/"
  echo "  Kiwix     diskId=$DISK_KIWIX  instanceId=$INST_KIWIX  → http://<host>:${KIWIX_PORT}/viewer#${KIWIX_BOOK}/Main_Page"
  if [[ -f "$LIVE_JSON" ]]; then
    echo
    echo "CONTENT.live.json Kolibri pins (stable contentIds; auth IDs mutable):"
    python3 - <<PY
import json
s=json.load(open("$LIVE_JSON"))
ir=s.get("intentResolution", {})
print("  host/port     ", s.get("host"), s.get("kolibriHttpPort"))
print("  tempDataDir   ", s.get("tempDataDir"))
print("  open_video    ", ir.get("open_video", {}).get("contentId"))
print("  open_exercise ", ir.get("open_exercise", {}).get("contentId"))
print("  channelId     ", s.get("channel", {}).get("channelId"))
print("  facility/class/lesson liveStatus:",
      s.get("facility", {}).get("liveStatus"),
      s.get("class", {}).get("liveStatus"),
      s.get("lesson", {}).get("liveStatus"))
PY
  else
    echo "WARN: missing $LIVE_JSON (sync App#10 fixtures to this host)" >&2
  fi
  if [[ -f "$NC_LIVE_JSON" ]]; then
    echo
    echo "CONTENT.live.json Nextcloud pins:"
    python3 - <<PY
import json
s=json.load(open("$NC_LIVE_JSON"))
print("  host/port     ", s.get("host"), s.get("nextcloudHttpPort"))
print("  tempDataDir   ", s.get("tempDataDir"))
print("  admin         ", s.get("admin", {}).get("username"))
print("  accounts      ", [a.get("username") for a in s.get("accounts", [])])
print("  liveStatus    ", s.get("liveStatus"))
c=s.get("collab", {})
print("  collab        ", c.get("editor"), c.get("sidecarPath"), "writable:", c.get("writable"))
PY
  fi
  if want_kiwix && [[ -f "$KIWIX_LIVE_JSON" ]]; then
    echo
    echo "CONTENT.live.json Kiwix pins:"
    python3 - <<PY
import json
s=json.load(open("$KIWIX_LIVE_JSON"))
print("  host/port     ", s.get("host"), s.get("kiwixHttpPort"))
print("  bookName      ", s.get("bookName"))
print("  liveStatus    ", s.get("liveStatus"))
PY
  fi
}

print_axle_atlas_recipe() {
  cat <<EOF

=== Recipe for Console Running + Open clickable (Atlas / Axle / Pixel) ===

Console AppCard Open is enabled only when Engine instanceDB.status == Running
for that instanceId. Sidecar HTTP alone is NOT enough for the card.

Path A — preferred for Console cards (Engine auto-start on dock):
  1. Axle: RealFleetOps startInstances=true (CLI flag --start-instances TBD;
     constructor opt already exists; cli.ts does NOT wire it yet).
  2. Atlas claim pool idea01/idea03; never idea02; never idea03 Intenso sdb1.
  3. Dock duration diskIds with instances/ kept → Engine disk-docked auto-start.
  4. Kid: ensure images present + data linked:
       bash tests/duration-tests/scripts/post-dock-restore-running.sh --mode sidecar
       # optional: --mode dock-compose --dock-root …/idea-test-N  (compose up under dock)
  5. Pixel: open-instance-\${instanceId} / instance-\${instanceId} testids.

Path B — sidecar HTTP for App-open Intents when dock still strips instances/:
  bash tests/duration-tests/scripts/post-dock-restore-running.sh --mode sidecar
  Axle/Pixel: point open_kolibri_* / open_video / open_exercise at :${KOLIBRI_PORT}
              point open_nextcloud_* at :${NEXTCLOUD_PORT}
  Console overview cards stay unavailable until Path A (or manual startInstance).

Path C — dock-compose after instances restored into private dock root:
  bash …/post-dock-restore-running.sh --mode dock-compose \\
    --dock-root /home/pi/idea/duration-disks/idea-test-1
  Then Engine startInstance (Console Start or Axle) so status flips Running
  (if containers already up, Engine just updates status).

idea03 note: Intenso nextcloud-files-b may already bind :18080. If so, either
  leave Kolibri sidecar on idea01 only, or:
  KOLIBRI_PORT=18081 bash …/post-dock-restore-running.sh --apps kolibri
EOF
}

ensure_kolibri_sidecar_tree() {
  local root="$1"
  mkdir -p "$root/data/docker" "$root/data/kolibri"
  if [[ ! -f "$root/compose.yaml" ]]; then
    cat > "$root/compose.yaml" <<YAML
services:
  kolibri:
    image: koenswings/kolibri:1.0-0.15.5-dev
    container_name: idea166-kolibri-live
    init: true
    restart: "no"
    pull_policy: never
    volumes:
      - ./data/docker:/docker/mnt
      - ./data/kolibri:/root/.kolibri
    network_mode: "host"
    environment:
      - KOLIBRI_RUN_MODE=docker
      - KOLIBRI_HTTP_PORT=${KOLIBRI_PORT}
      - KOLIBRI_LISTEN_PORT=${KOLIBRI_PORT}
YAML
    echo "wrote $root/compose.yaml (port ${KOLIBRI_PORT})"
  fi
}

ensure_nextcloud_sidecar_tree() {
  local root="$1"
  local pack_inst="$PACK_ROOT/nextcloud/instances/$INST_NC"
  local pack_files="$PACK_ROOT/nextcloud/files"
  mkdir -p "$root/data/nextcloud" "$root/data/db" "$root/files" \
           "$root/docker-entrypoint-hooks.d/before-starting"

  # Copy entrypoint + hook from fixture pack (required by compose)
  if [[ -d "$pack_inst" ]]; then
    cp -a "$pack_inst/idea-files-entrypoint.sh" "$root/" 2>/dev/null || true
    cp -a "$pack_inst/docker-entrypoint-hooks.d/before-starting/10-idea-files.sh" \
          "$root/docker-entrypoint-hooks.d/before-starting/" 2>/dev/null || true
    chmod +x "$root/idea-files-entrypoint.sh" 2>/dev/null || true
  fi
  if [[ -d "$pack_files" ]]; then
    rsync -a "$pack_files"/ "$root/files/" 2>/dev/null || cp -a "$pack_files"/. "$root/files/" || true
  fi

  cat > "$root/.env" <<ENV
port=${NEXTCLOUD_PORT}
pass=testpassword
ENV

  cat > "$root/compose.yaml" <<YAML
# idea166 Nextcloud live sidecar (duration-tests). Port ${NEXTCLOUD_PORT}.
# Auto-install admin via env; Kid seeds teacher/student* via occ after healthy.
services:
  nextcloud-app:
    image: koenswings/nextcloud:1.0-31.0.1
    container_name: idea166-nextcloud-live-app
    restart: "no"
    pull_policy: never
    entrypoint: ["/idea-files-entrypoint.sh"]
    command: ["apache2-foreground"]
    volumes:
      - ./data/nextcloud:/var/www/html
      - ./idea-files-entrypoint.sh:/idea-files-entrypoint.sh:ro
      - ./docker-entrypoint-hooks.d/before-starting/10-idea-files.sh:/docker-entrypoint-hooks.d/before-starting/10-idea-files.sh:ro
      - ./files:/mnt/idea-files:rw
    ports:
      - "${NEXTCLOUD_PORT}:80"
    environment:
      - MYSQL_PASSWORD=\${pass}
      - MYSQL_DATABASE=nextcloud
      - MYSQL_USER=nextcloud
      - MYSQL_HOST=nextcloud-db
      - MYSQL_ROOT_PASSWORD=\${pass}
      - NEXTCLOUD_ADMIN_USER=admin
      - NEXTCLOUD_ADMIN_PASSWORD=admin
      - NEXTCLOUD_TRUSTED_DOMAINS=localhost 127.0.0.1 idea01 idea03
      - PHP_UPLOAD_LIMIT=10G
      - PHP_MEMORY_LIMIT=512M
    depends_on:
      - nextcloud-db
    networks:
      - backend
  nextcloud-db:
    image: koenswings/nextcloud-mariadb:1.0-11.7.2-MariaDB-ubu2404
    container_name: idea166-nextcloud-live-db
    restart: "no"
    pull_policy: never
    command: --transaction-isolation=READ-COMMITTED --binlog-format=ROW
      --innodb-file-per-table=1 --skip-innodb-read-only-compressed
    volumes:
      - ./data/db:/var/lib/mysql
    environment:
      - MYSQL_ROOT_PASSWORD=\${pass}
      - MYSQL_PASSWORD=\${pass}
      - MYSQL_DATABASE=nextcloud
      - MYSQL_USER=nextcloud
    networks:
      - backend
networks:
  backend: null
YAML
  echo "wrote $root/compose.yaml (port ${NEXTCLOUD_PORT})"
}

seed_nextcloud_users() {
  local root="$1"
  [[ "${SKIP_PROVISION:-0}" == "1" ]] && { echo "SKIP_PROVISION=1 — skip occ users"; return 0; }
  local cname="idea166-nextcloud-live-app"
  if ! docker ps --format '{{.Names}}' | grep -qx "$cname"; then
    echo "WARN: $cname not running — skip occ user seed" >&2
    return 0
  fi
  # Wait until occ responds
  local ok=0
  for _ in $(seq 1 40); do
    if docker exec -u www-data "$cname" php occ status >/dev/null 2>&1; then
      ok=1; break
    fi
    sleep 5
  done
  if [[ "$ok" != "1" ]]; then
    echo "WARN: occ not ready after wait — HTTP may still be up (install in progress)" >&2
    return 0
  fi
  # The image env is only applied on first install. Repair this on every run so
  # an older data dir cannot retain the unsafe wildcard trusted domain.
  local -a trusted_domains=(localhost 127.0.0.1 idea01 idea03)
  local i
  for i in "${!trusted_domains[@]}"; do
    docker exec -u www-data "$cname" php occ config:system:set trusted_domains "$i" \
      --value="${trusted_domains[$i]}" >/dev/null 2>&1 || \
      echo "WARN: trusted_domains[$i] repair failed" >&2
  done
  # Remove stale entries (including a previously seeded '*'). Unknown indexes are
  # harmless and ignored; the bounded range avoids parsing occ's human output.
  for i in $(seq 20 -1 4); do
    docker exec -u www-data "$cname" php occ config:system:delete trusted_domains "$i" \
      >/dev/null 2>&1 || true
  done
  echo "Nextcloud trusted_domains repaired (localhost, 127.0.0.1, idea01, idea03)"

  # NC31 password_policy rejects short/common passwords — disable for duration sidecar
  docker exec -u www-data "$cname" php occ app:disable password_policy >/dev/null 2>&1 || true
  # Create duration accounts (idempotent), then refresh passwords on every run.
  for pair in "teacher:TeacherGrade5A!" "student01:Student01Grade5A!" "student02:Student02Grade5A!" "student03:Student03Grade5A!"; do
    local user="${pair%%:*}" pass="${pair##*:}"
    if docker exec -u www-data "$cname" php occ user:info "$user" >/dev/null 2>&1; then
      echo "occ user exists: $user"
    else
      docker exec -u www-data -e OC_PASS="$pass" "$cname" \
        php occ user:add --password-from-env --display-name="$user" "$user" \
        >/dev/null 2>&1 || echo "WARN: user:add $user failed" >&2
      echo "occ user:add $user"
    fi
    docker exec -u www-data -e OC_PASS="$pass" "$cname" \
      php occ user:resetpassword --password-from-env "$user" \
      >/dev/null 2>&1 || echo "WARN: password refresh $user failed" >&2
  done
  docker exec -u www-data "$cname" php occ group:add "Grade 5A" >/dev/null 2>&1 || true
  for u in teacher student01 student02 student03; do
    docker exec -u www-data "$cname" php occ group:adduser "Grade 5A" "$u" >/dev/null 2>&1 || true
  done
  echo "Nextcloud duration users/groups seeded (teacher / student01..03 / Grade 5A)"
}

NC_COLLAB_OK=0
provision_nextcloud_collab() {
  # Prefer A keep_editing / open_collab_doc / share_to_class prerequisites.
  # Sets NC_COLLAB_OK=1 only when chown + mount options succeeded.
  local ok=1
  [[ "${SKIP_PROVISION:-0}" == "1" ]] && { echo "SKIP_PROVISION=1 — skip collab/share provisioning"; return 0; }
  local cname="idea166-nextcloud-live-app"
  if ! docker ps --format '{{.Names}}' | grep -qx "$cname"; then
    echo "WARN: $cname not running — skip collab provisioning" >&2
    return 0
  fi
  # 1. Nextcloud Text (shipped with NC31) is the Prefer A collaborative editor
  #    for Collab/Grade5A-collab-notes.md: live sessions + avatars, no Collabora.
  local app
  for app in viewer text files_sharing; do
    docker exec -u www-data "$cname" php occ app:enable "$app" >/dev/null 2>&1 || \
      echo "WARN: occ app:enable $app failed" >&2
  done
  docker exec -u www-data "$cname" php occ config:app:set text open_read_only_enabled --value=0 \
    >/dev/null 2>&1 || true
  # 2. The entrypoint wrapper chowns only top-level /mnt/idea-files/* dirs; the
  #    preload files keep the host uid (pi) + 0644, so www-data cannot write them
  #    and Text opens the collab doc read-only. Hand Collab + Drop Zone to uid 33.
  docker exec -u root "$cname" sh -c '
    for d in "/mnt/idea-files/Collab" "/mnt/idea-files/Drop Zone"; do
      [ -d "$d" ] || continue
      chown -R 33:33 "$d"
      find "$d" -type f -exec touch {} +
    done' || { echo "WARN: chown Collab/Drop Zone failed" >&2; ok=0; }
  # 3. Hook-created Local storages: enable_sharing defaults to false in Nextcloud,
  #    which blocks share_to_class. Also scope the mounts to group Grade 5A.
  local list ids id
  list="$(docker exec -u www-data "$cname" php occ files_external:list --output=json 2>/dev/null || echo '[]')"
  ids="$(printf '%s' "$list" | python3 -c '
import json, sys
try:
    j = json.load(sys.stdin)
except Exception:
    j = []
for m in (j if isinstance(j, list) else []):
    dd = (m.get("configuration") or {}).get("datadir", "")
    if dd.startswith("/mnt/idea-files/"):
        print(m.get("mount_id") or m.get("id"))
')"
  for id in $ids; do
    docker exec -u www-data "$cname" php occ files_external:option "$id" enable_sharing true >/dev/null 2>&1 || \
      docker exec -u www-data "$cname" php occ files_external:option "$id" set enable_sharing true >/dev/null 2>&1 || \
      { echo "WARN: enable_sharing on mount $id failed" >&2; ok=0; }
    docker exec -u www-data "$cname" php occ files_external:applicable --add-group="Grade 5A" "$id" >/dev/null 2>&1 || \
      { echo "WARN: applicable Grade 5A on mount $id failed" >&2; ok=0; }
  done
  [[ -n "$ids" ]] || { echo "WARN: no /mnt/idea-files storages found (hook not run yet?) — rerun after first start" >&2; ok=0; }
  # 4. Rescan so cached file permissions pick up the chown.
  docker exec -u www-data "$cname" php occ files:scan teacher >/dev/null 2>&1 || \
    echo "WARN: occ files:scan teacher failed" >&2
  NC_COLLAB_OK="$ok"
  echo "Nextcloud collab provisioned (ok=$ok): Text editor, Collab/Drop Zone writable, sharing on, mounts → Grade 5A"
}

NC_DROP_JSON=""
DROP_ZONE_TOKEN="${DROP_ZONE_TOKEN:-grade5adropzone}"
DROP_ZONE_MOUNT="/Drop Zone"
DROP_ZONE_PATH="/Drop Zone/inbox"
create_drop_zone_request() {
  # Prefer A open_file_drop / after_upload / leave_file_drop: teacher-owned
  # public "File request" (upload-only link, permissions=4) on the SUBFOLDER
  # "Drop Zone/inbox" inside the Local external mount "/Drop Zone".
  # OCS logic lives in nc-drop-zone-request.py (unit-tested against a fake OCS):
  # deletes any link share on the mount root (old /s/grade5a-drop-zone, perms 31),
  # reuses/creates the inbox link, forces permissions 4, sets the custom token.
  # Token must be [A-Za-z0-9] only: NC 31.0.1 public DAV cuts tokens at '-'
  # (publicremote.php \w+), so /s/grade5a-drop-zone could never upload (HTTP 500).
  [[ "${SKIP_PROVISION:-0}" == "1" ]] && return 0
  local cname="idea166-nextcloud-live-app"
  docker ps --format '{{.Names}}' | grep -qx "$cname" || return 0
  local k
  for k in shareapi_allow_links shareapi_allow_public_upload shareapi_allow_custom_tokens; do
    docker exec -u www-data "$cname" php occ config:app:set core "$k" --value=yes >/dev/null 2>&1 || \
      echo "WARN: occ config:app:set core $k failed" >&2
  done
  # inbox dir inside the mount, owned by www-data (uid 33), then rescan so OCS sees it.
  docker exec -u root "$cname" sh -c '
    d="/mnt/idea-files/Drop Zone/inbox"
    mkdir -p "$d" && chown 33:33 "$d" && chmod 0775 "$d"' || \
    { echo "WARN: mkdir/chown /mnt/idea-files/Drop Zone/inbox failed" >&2; return 0; }
  docker exec -u www-data "$cname" php occ files:scan --path="/teacher/files${DROP_ZONE_MOUNT}" >/dev/null 2>&1 || \
    echo "WARN: occ files:scan Drop Zone failed" >&2
  NC_DROP_JSON="$(mktemp)"
  if ! python3 "$SCRIPT_DIR/nc-drop-zone-request.py" "http://127.0.0.1:${NEXTCLOUD_PORT}" \
      "$DROP_ZONE_TOKEN" "$DROP_ZONE_PATH" "$DROP_ZONE_MOUNT" > "$NC_DROP_JSON"; then
    echo "WARN: Drop Zone file request failed: $(cat "$NC_DROP_JSON")" >&2
    return 0
  fi
  echo "Drop Zone file request (${DROP_ZONE_PATH}): /s/$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["token"])' "$NC_DROP_JSON")"
}

write_nextcloud_live_json() {
  # Merge into the committed CONTENT.live.json: keeps per-host entries and the
  # Prefer A folders/collab/shares keys Pixel reads.
  local host_label="${1:-unknown}"
  mkdir -p "$(dirname "$NC_LIVE_JSON")"
  python3 - "$NC_LIVE_JSON" "$host_label" "$NEXTCLOUD_PORT" "$LIVE_NEXTCLOUD" "$DISK_NC" "$INST_NC" "$NC_COLLAB_OK" "$NC_DROP_JSON" <<'PY'
import json, os, subprocess, sys
from datetime import datetime, timezone
path, host, port, live, disk, inst, collab_ok, drop_path = sys.argv[1:9]
collab_ok = collab_ok == "1"
port = int(port)
try:
    s = json.load(open(path))
except Exception:
    s = {}
s.update({
    "pack": "duration-nextcloud-grade5a",
    "version": "1.1",
    "diskId": disk,
    "instanceId": inst,
    "liveStatus": "sidecar_provisioned",
    "importedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "importedBy": "Kid (App Dev)",
    "host": host,
    "nextcloudHttpPort": port,
    "image": "koenswings/nextcloud:1.0-31.0.1",
    "dbImage": "koenswings/nextcloud-mariadb:1.0-11.7.2-MariaDB-ubu2404",
    "tempDataDir": f"{live}/data/nextcloud",
    "admin": {"username": "admin", "passwordHint": "admin"},
    "accounts": [
        {"username": "teacher", "role": "teacher", "passwordHint": "TeacherGrade5A!"},
        {"username": "student01", "role": "learner", "passwordHint": "Student01Grade5A!"},
        {"username": "student02", "role": "learner", "passwordHint": "Student02Grade5A!"},
        {"username": "student03", "role": "learner", "passwordHint": "Student03Grade5A!"},
    ],
    "groups": [{"name": "Grade 5A", "members": ["teacher", "student01", "student02", "student03"]}],
    "urls": {
        "filesHome": f"http://<host>:{port}/apps/files/",
        "login": f"http://<host>:{port}/login",
        "collabDir": f"http://<host>:{port}/apps/files/files?dir=/Collab",
    },
    "collabProvisioned": collab_ok,
})
if collab_ok:
    s.setdefault("collab", {})["writable"] = True
    s["intentStatus"] = {
        **s.get("intentStatus", {}),
        "open_collab_doc": "ready (Nextcloud Text)",
        "keep_editing": "ready (Nextcloud Text, Prefer A) — Collabora is Prefer B, not shipped",
        "close_doc": "ready",
        "share_to_class": "ready (enable_sharing on mounts)",
    }
    s.pop("collabApplyNote", None)
ts = None
try:
    out = subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=5).stdout.split()
    ts = out[0] if out else None
except Exception:
    pass
hosts = s.setdefault("hosts", {})
hosts[host] = {"nextcloudHttpPort": port, **({"url": f"http://{ts}:{port}/"} if ts else {})}
drop = None
if drop_path and os.path.exists(drop_path):
    try:
        drop = json.load(open(drop_path))
    except Exception:
        drop = None
if drop and drop.get("ok"):
    tok = drop["token"]
    fr = s.setdefault("fileRequest", {})
    fr.update({
        "status": "created",
        "logicalId": "folder-drop-grade5a",
        "folder": "Drop Zone/inbox",
        "path": drop.get("path", "/Drop Zone/inbox"),
        "mountRoot": drop.get("mountRoot", "/Drop Zone"),
        "sharedBy": "teacher",
        "shareType": 3,
        "permissions": drop.get("permissions", 4),
        "token": tok,
        "customToken": drop.get("customToken", False),
        "uploadSafeToken": drop.get("uploadSafeToken", True),
        "url": f"http://<host>:{port}/s/{tok}",
    })
    hosts[host]["fileRequestToken"] = tok
    hosts[host]["fileRequestShareId"] = drop.get("id")
    if ts:
        hosts[host]["fileRequestUrl"] = f"http://{ts}:{port}/s/{tok}"
    s.setdefault("urls", {})["fileRequest"] = f"http://<host>:{port}/s/{tok}"
    s.setdefault("intentStatus", {}).update({
        "open_file_drop": "ready (fileRequest.url)",
        "after_upload": "ready (fileRequest.url)",
        "leave_file_drop": "ready",
    })
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(s, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.replace(tmp, path)
PY
  echo "wrote $NC_LIVE_JSON"
}

port_in_use() {
  local port="$1"
  # busy if something other than our sidecar answers
  ss -ltn "( sport = :$port )" 2>/dev/null | grep -q ":$port" || return 1
  return 0
}

restore_sidecar_kolibri() {
  echo "== sidecar Kolibri: $LIVE_KOLIBRI :${KOLIBRI_PORT} =="
  if port_in_use "$KOLIBRI_PORT"; then
    local who
    who="$(docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E ":${KOLIBRI_PORT}->|:${KOLIBRI_PORT}\b" || true)"
    if echo "$who" | grep -qv 'idea166-kolibri-live' && [[ -n "$who" ]]; then
      echo "WARN: :${KOLIBRI_PORT} already bound by: $who" >&2
      echo "  On idea03 Intenso nextcloud-files-b often owns :18080." >&2
      echo "  Re-run with --kolibri-port 18081 or --apps nextcloud on this host." >&2
      if [[ "$KOLIBRI_PORT" == "18080" ]]; then
        echo "  Skipping Kolibri sidecar on this host (port conflict)." >&2
        return 0
      fi
    fi
  fi
  ensure_kolibri_sidecar_tree "$LIVE_KOLIBRI"
  if [[ ! -d "$LIVE_KOLIBRI/data/kolibri" ]]; then
    echo "ERROR: $LIVE_KOLIBRI/data/kolibri missing" >&2
    exit 1
  fi
  # Refresh port env in existing compose if present
  if grep -q KOLIBRI_HTTP_PORT "$LIVE_KOLIBRI/compose.yaml" 2>/dev/null; then
    sed -i "s/KOLIBRI_HTTP_PORT=.*/KOLIBRI_HTTP_PORT=${KOLIBRI_PORT}/" "$LIVE_KOLIBRI/compose.yaml" || true
    sed -i "s/KOLIBRI_LISTEN_PORT=.*/KOLIBRI_LISTEN_PORT=${KOLIBRI_PORT}/" "$LIVE_KOLIBRI/compose.yaml" || true
  fi
  (cd "$LIVE_KOLIBRI" && docker compose up -d)
  if [[ "${SKIP_HTTP:-0}" != "1" ]]; then
    local code
    code="$(http_ok "http://127.0.0.1:${KOLIBRI_PORT}/" || true)"
    echo "HTTP :${KOLIBRI_PORT} → $code"
  fi
}

restore_sidecar_nextcloud() {
  echo "== sidecar Nextcloud: $LIVE_NEXTCLOUD :${NEXTCLOUD_PORT} =="
  ensure_nextcloud_sidecar_tree "$LIVE_NEXTCLOUD"
  if [[ ! -x "$LIVE_NEXTCLOUD/idea-files-entrypoint.sh" ]]; then
    # minimal entrypoint if pack missing
    cat > "$LIVE_NEXTCLOUD/idea-files-entrypoint.sh" <<'SH'
#!/bin/sh
set -eu
exec /entrypoint.sh "$@"
SH
    chmod +x "$LIVE_NEXTCLOUD/idea-files-entrypoint.sh"
    mkdir -p "$LIVE_NEXTCLOUD/docker-entrypoint-hooks.d/before-starting"
    echo '#!/bin/sh' > "$LIVE_NEXTCLOUD/docker-entrypoint-hooks.d/before-starting/10-idea-files.sh"
    chmod +x "$LIVE_NEXTCLOUD/docker-entrypoint-hooks.d/before-starting/10-idea-files.sh"
  fi
  (cd "$LIVE_NEXTCLOUD" && docker compose up -d)
  if [[ "${SKIP_HTTP:-0}" != "1" ]]; then
    local code
    code="$(http_ok "http://127.0.0.1:${NEXTCLOUD_PORT}/" || true)"
    echo "HTTP :${NEXTCLOUD_PORT} → $code"
  fi
  seed_nextcloud_users "$LIVE_NEXTCLOUD"
  provision_nextcloud_collab
  create_drop_zone_request
  local host_label
  host_label="$(hostname -s 2>/dev/null || hostname || echo unknown)"
  write_nextcloud_live_json "$host_label"
}

ensure_kiwix_sidecar_tree() {
  local root="$1"
  local pack_data="$PACK_ROOT/kiwix/instances/$INST_KIWIX/data"
  mkdir -p "$root/data"
  if [[ -f "$pack_data/${KIWIX_BOOK}.zim" ]]; then
    cp -a "$pack_data/${KIWIX_BOOK}.zim" "$root/data/"
  else
    echo "ERROR: missing $pack_data/${KIWIX_BOOK}.zim (sync agent-app-dev)" >&2
    exit 1
  fi
  cat > "$root/compose.yaml" <<YAML
# idea166 Kiwix live sidecar (duration-tests). Port ${KIWIX_PORT}.
services:
  kiwix:
    image: ${KIWIX_IMAGE}
    container_name: idea166-kiwix-live
    restart: "no"
    pull_policy: never
    command: ["${KIWIX_BOOK}.zim"]
    volumes:
      - ./data:/data:ro
    ports:
      - "${KIWIX_PORT}:8080"
YAML
  echo "wrote $root/compose.yaml (port ${KIWIX_PORT})"
}

write_kiwix_live_json() {
  local host_label="${1:-unknown}"
  python3 - "$KIWIX_LIVE_JSON" "$host_label" "$KIWIX_PORT" <<'PY'
import json, os, subprocess, sys
from datetime import datetime, timezone
path, host, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
s = json.load(open(path))
s["liveStatus"] = "sidecar_running"
s["host"] = host
s["kiwixHttpPort"] = port
s["appliedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
ts = None
try:
    out = subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=5).stdout.split()
    ts = out[0] if out else None
except Exception:
    pass
s.setdefault("hosts", {})[host] = {"kiwixHttpPort": port, **({"url": f"http://{ts}:{port}/"} if ts else {})}
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(s, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.replace(tmp, path)
PY
  echo "wrote $KIWIX_LIVE_JSON"
}

restore_sidecar_kiwix() {
  echo "== sidecar Kiwix: $LIVE_KIWIX :${KIWIX_PORT} =="
  if ! docker image inspect "$KIWIX_IMAGE" >/dev/null 2>&1; then
    echo "ERROR: image $KIWIX_IMAGE not present (pull_policy never). Atlas: docker pull $KIWIX_IMAGE" >&2
    exit 1
  fi
  if port_in_use "$KIWIX_PORT" && ! docker ps --format '{{.Names}}' | grep -qx idea166-kiwix-live; then
    echo "ERROR: :${KIWIX_PORT} already bound by something else — use --kiwix-port" >&2
    exit 1
  fi
  ensure_kiwix_sidecar_tree "$LIVE_KIWIX"
  (cd "$LIVE_KIWIX" && docker compose up -d)
  if [[ "${SKIP_HTTP:-0}" != "1" ]]; then
    echo "HTTP :${KIWIX_PORT}/ → $(http_ok "http://127.0.0.1:${KIWIX_PORT}/" || true)"
    echo "HTTP :${KIWIX_PORT}/content/${KIWIX_BOOK}/Fraction → $(http_ok "http://127.0.0.1:${KIWIX_PORT}/content/${KIWIX_BOOK}/Fraction" || true)"
  fi
  local host_label
  host_label="$(hostname -s 2>/dev/null || hostname || echo unknown)"
  write_kiwix_live_json "$host_label"
}

restore_sidecar() {
  echo "== sidecar mode: Running duration apps ($APPS) for App-open after dock =="
  want_kolibri && restore_sidecar_kolibri
  want_nextcloud && restore_sidecar_nextcloud
  want_kiwix && restore_sidecar_kiwix
  print_pins
  print_axle_atlas_recipe
}

sync_instances_into_dock() {
  if [[ -z "$DOCK_ROOT" ]]; then
    echo "ERROR: set --dock-root /path/to/private/idea-test-N" >&2
    exit 2
  fi
  if [[ ! -d "$DOCK_ROOT" ]]; then
    echo "ERROR: DOCK_ROOT not a directory: $DOCK_ROOT" >&2
    exit 1
  fi
  # Refuse Intenso / system roots
  case "$DOCK_ROOT" in
    /disks|/*/sdb*|*sdb1*)
      echo "ERROR: refuse DOCK_ROOT=$DOCK_ROOT (never /disks or sdb)" >&2
      exit 1
      ;;
  esac
  for pack in kolibri nextcloud kiwix; do
    want_kolibri || [[ "$pack" != kolibri ]] || continue
    want_nextcloud || [[ "$pack" != nextcloud ]] || continue
    want_kiwix || [[ "$pack" != kiwix ]] || continue
    local src="$PACK_ROOT/$pack/instances"
    if [[ -d "$src" ]]; then
      mkdir -p "$DOCK_ROOT/instances"
      if [[ "$pack" == kiwix ]]; then
        # Kiwix data/ is just the 62 KB stub ZIM — ship it with the instance.
        rsync -a "$src"/ "$DOCK_ROOT/instances/"
        echo "synced $src → $DOCK_ROOT/instances/ (with stub ZIM)"
      else
        rsync -a --exclude '**/data/**' "$src"/ "$DOCK_ROOT/instances/"
        echo "synced $src → $DOCK_ROOT/instances/ (data/ excluded)"
      fi
    else
      echo "skip missing $src"
    fi
  done
  # Link sidecar data into dock instances when available
  if want_kolibri && [[ -d "$LIVE_KOLIBRI/data/kolibri" ]]; then
    local dest="$DOCK_ROOT/instances/$INST_KOLIBRI/data"
    mkdir -p "$dest"
    if [[ ! -e "$dest/kolibri" ]]; then
      ln -s "$LIVE_KOLIBRI/data/kolibri" "$dest/kolibri"
      echo "linked $LIVE_KOLIBRI/data/kolibri → $dest/kolibri"
    fi
    mkdir -p "$dest/docker"
  fi
  if want_nextcloud && [[ -d "$LIVE_NEXTCLOUD/data/nextcloud" ]]; then
    local dest="$DOCK_ROOT/instances/$INST_NC/data"
    mkdir -p "$dest"
    if [[ ! -e "$dest/nextcloud" ]]; then
      ln -s "$LIVE_NEXTCLOUD/data/nextcloud" "$dest/nextcloud"
      echo "linked $LIVE_NEXTCLOUD/data/nextcloud → $dest/nextcloud"
    fi
    if [[ ! -e "$dest/db" && -d "$LIVE_NEXTCLOUD/data/db" ]]; then
      ln -s "$LIVE_NEXTCLOUD/data/db" "$dest/db"
      echo "linked $LIVE_NEXTCLOUD/data/db → $dest/db"
    fi
  fi
}

restore_dock_instances() {
  echo "== dock-instances mode: copy instances/ into dock root (no compose up) =="
  sync_instances_into_dock
  print_pins
  echo
  echo "NOTE: Engine still will not auto-start unless dock kept instances/ (startInstances)."
  echo "Prefer --mode dock-compose after Path A, or --mode sidecar for HTTP App-open."
}

restore_dock_compose() {
  echo "== dock-compose mode: restore instances/ + compose up under dock =="
  sync_instances_into_dock
  if want_kolibri && [[ -d "$DOCK_ROOT/instances/$INST_KOLIBRI" ]]; then
    # Ensure port env for host-network Kolibri
    local envf="$DOCK_ROOT/instances/$INST_KOLIBRI/.env"
    if [[ -f "$envf" ]]; then
      grep -q '^port=' "$envf" && sed -i "s/^port=.*/port=${KOLIBRI_PORT}/" "$envf" || echo "port=${KOLIBRI_PORT}" >> "$envf"
    else
      echo "port=${KOLIBRI_PORT}" > "$envf"
    fi
    # Inject KOLIBRI ports into compose if missing
    local cf="$DOCK_ROOT/instances/$INST_KOLIBRI/compose.yaml"
    if [[ -f "$cf" ]] && ! grep -q KOLIBRI_HTTP_PORT "$cf"; then
      # append env under kolibri service environment list (best-effort)
      sed -i "/KOLIBRI_RUN_MODE=docker/a\\      - KOLIBRI_HTTP_PORT=${KOLIBRI_PORT}\\n      - KOLIBRI_LISTEN_PORT=${KOLIBRI_PORT}" "$cf" || true
    fi
    (cd "$DOCK_ROOT/instances/$INST_KOLIBRI" && docker compose up -d) || \
      echo "WARN: kolibri compose up failed (port conflict or missing data?)" >&2
  fi
  if want_nextcloud && [[ -d "$DOCK_ROOT/instances/$INST_NC" ]]; then
    (cd "$DOCK_ROOT/instances/$INST_NC" && docker compose up -d) || \
      echo "WARN: nextcloud compose up failed" >&2
  fi
  if want_kiwix && [[ -d "$DOCK_ROOT/instances/$INST_KIWIX" ]]; then
    (cd "$DOCK_ROOT/instances/$INST_KIWIX" && docker compose up -d) || \
      echo "WARN: kiwix compose up failed (image $KIWIX_IMAGE pulled? port ${KIWIX_PORT} free?)" >&2
  fi
  if [[ "${SKIP_HTTP:-0}" != "1" ]]; then
    want_kolibri && echo "HTTP :${KOLIBRI_PORT} → $(http_ok "http://127.0.0.1:${KOLIBRI_PORT}/" || true)"
    want_nextcloud && echo "HTTP :${NEXTCLOUD_PORT} → $(http_ok "http://127.0.0.1:${NEXTCLOUD_PORT}/" || true)"
    want_kiwix && echo "HTTP :${KIWIX_PORT} → $(http_ok "http://127.0.0.1:${KIWIX_PORT}/" || true)"
  fi
  print_pins
  print_axle_atlas_recipe
  echo
  echo "After compose up: Axle/Console must startInstance (or re-dock with startInstances)"
  echo "so instanceDB.status becomes Running and Open is clickable."
}

case "$MODE" in
  sidecar) restore_sidecar ;;
  dock-instances) restore_dock_instances ;;
  dock-compose) restore_dock_compose ;;
  *) echo "unknown --mode $MODE (sidecar|dock-compose|dock-instances)" >&2; exit 2 ;;
esac
