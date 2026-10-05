#!/usr/bin/env bash
# post-dock-restore-running.sh — Atlas/Axle one-shot after RealFleetOps dock (idea#166/#168)
#
# WHY: infra_dock_fixture defaults to stripping instances/, so Engine will not
# auto-start Kolibri/Nextcloud. Console Open cards need instanceDB status=Running,
# which only happens when Engine startInstance / dock auto-start succeeds.
#
# This script offers two reliable App-owned paths:
#
#   sidecar (default)  Bring up BOTH duration apps outside the dock tree:
#                      Kolibri  → LIVE_KOLIBRI  (:18080, host net)
#                      Nextcloud → LIVE_NEXTCLOUD (:18280)
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
#   bash tests/duration-tests/scripts/post-dock-restore-running.sh --mode dock-compose \
#        --dock-root /home/pi/idea/duration-disks/idea-test-1
#
# Env:
#   LIVE_KOLIBRI     default /home/pi/idea166-kolibri-live
#   LIVE_NEXTCLOUD   default /home/pi/idea166-nextcloud-live
#   LIVE_ROOT        alias for LIVE_KOLIBRI (back-compat)
#   DOCK_ROOT        required for dock-* modes
#   PACK_ROOT        default <repo>/tests/duration-tests/fixtures
#   SKIP_HTTP=1      skip curl health checks
#   SKIP_PROVISION=1 skip Nextcloud occ user seed
#   KOLIBRI_PORT     default 18080 (idea03 may need override if :18080 taken)
#   NEXTCLOUD_PORT   default 18280
set -euo pipefail

MODE="sidecar"
APPS="both"
LIVE_KOLIBRI="${LIVE_ROOT:-${LIVE_KOLIBRI:-/home/pi/idea166-kolibri-live}}"
LIVE_NEXTCLOUD="${LIVE_NEXTCLOUD:-/home/pi/idea166-nextcloud-live}"
DOCK_ROOT="${DOCK_ROOT:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PACK_ROOT="${PACK_ROOT:-$REPO_ROOT/tests/duration-tests/fixtures}"
LIVE_JSON="$PACK_ROOT/kolibri/content/CONTENT.live.json"
NC_LIVE_JSON="$PACK_ROOT/nextcloud/content/CONTENT.live.json"
KOLIBRI_PORT="${KOLIBRI_PORT:-18080}"
NEXTCLOUD_PORT="${NEXTCLOUD_PORT:-18280}"

DISK_KOLIBRI="duration-kolibri-grade5a-001"
INST_KOLIBRI="kolibri-grade5a-001"
DISK_NC="duration-nextcloud-grade5a-001"
INST_NC="nextcloud-grade5a-001"

usage() {
  sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --apps) APPS="$2"; shift 2 ;;
    --live-root|--live-kolibri) LIVE_KOLIBRI="$2"; shift 2 ;;
    --live-nextcloud) LIVE_NEXTCLOUD="$2"; shift 2 ;;
    --dock-root) DOCK_ROOT="$2"; shift 2 ;;
    --pack-root)
      PACK_ROOT="$2"
      LIVE_JSON="$PACK_ROOT/kolibri/content/CONTENT.live.json"
      NC_LIVE_JSON="$PACK_ROOT/nextcloud/content/CONTENT.live.json"
      shift 2
      ;;
    --kolibri-port) KOLIBRI_PORT="$2"; shift 2 ;;
    --nextcloud-port) NEXTCLOUD_PORT="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "unknown arg: $1" >&2; usage 2 ;;
  esac
done

want_kolibri() { [[ "$APPS" == "both" || "$APPS" == "kolibri" ]]; }
want_nextcloud() { [[ "$APPS" == "both" || "$APPS" == "nextcloud" ]]; }

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

write_nextcloud_live_json() {
  local host_label="${1:-unknown}"
  mkdir -p "$(dirname "$NC_LIVE_JSON")"
  cat > "$NC_LIVE_JSON" <<JSON
{
  "pack": "duration-nextcloud-grade5a",
  "version": "1.0",
  "diskId": "$DISK_NC",
  "instanceId": "$INST_NC",
  "liveStatus": "sidecar_provisioned",
  "importedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "importedBy": "Kid (App Dev)",
  "host": "$host_label",
  "nextcloudHttpPort": $NEXTCLOUD_PORT,
  "image": "koenswings/nextcloud:1.0-31.0.1",
  "dbImage": "koenswings/nextcloud-mariadb:1.0-11.7.2-MariaDB-ubu2404",
  "tempDataDir": "$LIVE_NEXTCLOUD/data/nextcloud",
  "admin": { "username": "admin", "passwordHint": "admin" },
  "accounts": [
    { "username": "teacher", "role": "teacher", "passwordHint": "TeacherGrade5A!" },
    { "username": "student01", "role": "learner", "passwordHint": "Student01Grade5A!" },
    { "username": "student02", "role": "learner", "passwordHint": "Student02Grade5A!" },
    { "username": "student03", "role": "learner", "passwordHint": "Student03Grade5A!" }
  ],
  "groups": [{ "name": "Grade 5A" }],
  "urls": {
    "filesHome": "http://<host>:${NEXTCLOUD_PORT}/apps/files/",
    "login": "http://<host>:${NEXTCLOUD_PORT}/login"
  },
  "note": "Sidecar path for App-open when dock strips instances/. Console Running cards still need Axle startInstances / Engine startInstance on docked tree."
}
JSON
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
  local host_label
  host_label="$(hostname -s 2>/dev/null || hostname || echo unknown)"
  write_nextcloud_live_json "$host_label"
}

restore_sidecar() {
  echo "== sidecar mode: Running Kolibri + Nextcloud for App-open after dock =="
  want_kolibri && restore_sidecar_kolibri
  want_nextcloud && restore_sidecar_nextcloud
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
  for pack in kolibri nextcloud; do
    want_kolibri || [[ "$pack" != kolibri ]] || continue
    want_nextcloud || [[ "$pack" != nextcloud ]] || continue
    local src="$PACK_ROOT/$pack/instances"
    if [[ -d "$src" ]]; then
      mkdir -p "$DOCK_ROOT/instances"
      rsync -a --exclude '**/data/**' "$src"/ "$DOCK_ROOT/instances/"
      echo "synced $src → $DOCK_ROOT/instances/ (data/ excluded)"
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
  if [[ "${SKIP_HTTP:-0}" != "1" ]]; then
    want_kolibri && echo "HTTP :${KOLIBRI_PORT} → $(http_ok "http://127.0.0.1:${KOLIBRI_PORT}/" || true)"
    want_nextcloud && echo "HTTP :${NEXTCLOUD_PORT} → $(http_ok "http://127.0.0.1:${NEXTCLOUD_PORT}/" || true)"
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
