#!/usr/bin/env bash
# prove-client-address.sh — idea#413 line 5 follow-up: which client address
# does Nextcloud / Kiwix see through Docker's published port?
#
# On a claimed pool Pi, as pi:
#   bash /home/pi/kid-i413-hook-proof/prove-client-address.sh
#
# Hard limits: no rm -rf, no pkill -f or pgrep -f, no dd/mkfs/wipe,
# no archive-and-clear. Deployed Engine tree is read-only. Never print
# credentials. Never touch /disks/sdb1, /disks, or protected serials.
set -euo pipefail

HERE=$(CDPATH="" cd -- "$(dirname -- "$0")" && pwd)
SEND="$HERE/send-engine-command.mjs"
PROBE="$HERE/client_address_probe.py"
ZIM="$HERE/fixtures/duration_wikipedia_en_grade5a_stub_2026-10.zim"
ZIM_BOOK="duration_wikipedia_en_grade5a_stub_2026-10"
XFF_PROBE="203.0.113.50"

ENGINE_ROOT="${ENGINE_ROOT:-/home/pi/idea/agents/agent-engine-dev}"
ENGINE_API="${ENGINE_API:-http://127.0.0.1:8080}"
QUARANTINE_ROOT="${QUARANTINE_ROOT:-/home/pi/kid-quarantine}"
EXPECTED_ENGINE_SHA="${EXPECTED_ENGINE_SHA:-aec3930cd9fe4abb5a74f0c4facb933eb42adcfe}"

PROTECTED_SERIALS='AA202000000000004820 AA000000000000005638 3813430-532011020 20070Q450002'
PROTECTED_UUIDS='3E50-902A'
PROTECTED_PATHS='/disks/sdb1 /disks'

DEST="${DEST:-}"
RUN_DIR=""
TS=""
SYSTEM_DISK_ID=""
SYSTEM_DISK_DEV=""
DID_INSTALL=0
DID_TEARDOWN=0
NEXTCLOUD_ID="" NEXTCLOUD_PORT="" NEXTCLOUD_DIR=""
KIWIX_ID="" KIWIX_PORT="" KIWIX_DIR=""
SETTINGS_PATH="/var/lib/idea/usage/settings.json"
SETTINGS_BACKUP=""

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "==> $*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="${2:-}"; [ -n "$DEST" ] || die "--dest needs a value"; shift 2 ;;
    --engine-root) ENGINE_ROOT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) die "unexpected argument: $1" ;;
  esac
done

[ -x "$SEND" ] || die "send-engine-command.mjs is not executable"
[ -f "$PROBE" ] || die "missing $PROBE"
[ -f "$ZIM" ] || die "missing stub ZIM: $ZIM"

temp_c() {
  if [ -r /sys/class/thermal/thermal_zone0/temp ]; then
    awk '{ printf "%.1f", $1/1000 }' /sys/class/thermal/thermal_zone0/temp
    return
  fi
  echo ""
}

pause_if_hot() {
  local t label="${1:-}"
  t=$(temp_c)
  [ -n "$t" ] || return 0
  log "SoC temp ${t} C${label:+ ($label)}"
  awk -v t="$t" 'BEGIN { exit !(t > 75) }' || return 0
  log "SoC ${t} C is above 75 C; pausing until it is below 65 C"
  while true; do
    sleep 15
    t=$(temp_c)
    [ -n "$t" ] || continue
    log "SoC temp ${t} C (waiting to drop below 65 C)"
    awk -v t="$t" 'BEGIN { exit !(t < 65) }' && break
  done
  log "SoC temp ${t} C; resuming"
}

take_snapshot() {
  local dir="$1" label="$2"
  mkdir -p "$dir"
  {
    echo "# snapshot $label $(date '+%Y-%m-%d %H:%M:%S %z')"
    echo "# hostname=$(hostname 2>/dev/null || true)"
  } > "$dir/meta.txt"
  docker ps -a > "$dir/docker-ps.txt" 2>&1 || true
  docker images > "$dir/docker-images.txt" 2>&1 || true
  pm2 ls > "$dir/pm2-ls.txt" 2>&1 || true
  lsblk > "$dir/lsblk.txt" 2>&1 || true
  PATH="/usr/sbin:/sbin:$PATH" losetup -a > "$dir/losetup.txt" 2>&1 || true
  (temp_c; echo) > "$dir/tempC.txt" 2>&1 || true
  if [ -f "$SETTINGS_PATH" ]; then
    cp -a "$SETTINGS_PATH" "$dir/settings.json" || true
    stat "$SETTINGS_PATH" > "$dir/settings.stat" 2>&1 || true
  fi
  log "snapshot $label written under $dir"
}

diff_snapshots() {
  local before="$1" after="$2" out="$3"
  mkdir -p "$out"
  local f
  for f in docker-ps.txt docker-images.txt pm2-ls.txt lsblk.txt losetup.txt settings.json; do
    if [ -f "$before/$f" ] || [ -f "$after/$f" ]; then
      diff -u "$before/$f" "$after/$f" > "$out/$f.diff" || true
    fi
  done
  log "snapshot diffs written under $out"
}

find_fleet_state() {
  if [ -n "${FLEET_STATE:-}" ]; then
    [ -f "$FLEET_STATE" ] || die "FLEET_STATE is not a file: $FLEET_STATE"
    echo "$FLEET_STATE"
    return
  fi
  local p
  for p in /home/pi/idea/agents/idea/fleet-state.json /home/pi/idea/fleet-state.json; do
    [ -f "$p" ] && { echo "$p"; return; }
  done
  die "fleet-state.json not found (set FLEET_STATE)"
}

check_host_and_claim() {
  local host state claim
  host=$(hostname -s 2>/dev/null || hostname)
  case "$host" in
    idea03|idea04) ;;
    *) die "refusing to run on hostname '$host' (only idea03 or idea04)" ;;
  esac
  state=$(find_fleet_state)
  command -v jq >/dev/null 2>&1 || die "jq is required to read the fleet claim"
  claim=$(jq -r --arg h "$host" '.[$h].claim // empty' "$state")
  case "$claim" in
    Kid|Kid*) ;;
    *) die "refusing to run: fleet claim for $host is '${claim:-<null>}', not Kid (state $state)" ;;
  esac
  log "hostname $host, fleet claim '$claim' (Kid) from $state"
}

assert_no_forbidden_target() {
  local target="$1"
  case "$target" in
    /disks|/disks/*) die "refusing to use $target (never touch /disks or /disks/sdb1)" ;;
  esac
}

check_protected_disks() {
  local line serial uuid
  if command -v lsblk >/dev/null 2>&1; then
    while IFS= read -r line; do
      for serial in $PROTECTED_SERIALS; do
        case "$line" in *"$serial"*) log "note: protected serial $serial is visible in lsblk (will not be targeted)" ;; esac
      done
      for uuid in $PROTECTED_UUIDS; do
        case "$line" in *"$uuid"*) log "note: protected UUID $uuid is visible in lsblk (will not be targeted)" ;; esac
      done
    done < <(lsblk -o NAME,SERIAL,UUID,LABEL,MOUNTPOINT 2>/dev/null || true)
  fi
}

engine_cmd() { ENGINE_ROOT="$ENGINE_ROOT" ENGINE_API="$ENGINE_API" node "$SEND" "$@"; }
inspect_store() { engine_cmd inspect; }
send_engine() {
  local cmd="$1" out="${RUN_DIR:-/tmp}/engine-send-latest.json"
  log "Engine command: $cmd"
  mkdir -p "$(dirname "$out")"
  engine_cmd send "$cmd" > "$out"
}

pick_system_disk() {
  inspect_store > "$RUN_DIR/store-inspect-before.json"
  python3 - "$RUN_DIR/store-inspect-before.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
local = data.get("localSystem") or []
if not local:
    sys.exit(2)
if len(local) != 1:
    prefer = [d for d in local if str(d.get("device") or "").startswith(("sda", "mmcblk"))]
    if len(prefer) == 1:
        local = prefer
    else:
        sys.stderr.write("ERROR: expected one local System Disk, got: %s\n" % json.dumps(local))
        sys.exit(1)
d = local[0]
dev = str(d.get("device") or "")
if dev == "sdb" or dev.startswith("sdb"):
    sys.stderr.write("ERROR: refusing System Disk device %s\n" % dev)
    sys.exit(1)
print("%s\t%s" % (d["id"], dev))
PY
}

ensure_system_disk() {
  local pick rc=0
  pick=$(pick_system_disk) || rc=$?
  [ "$rc" = 0 ] || die "failed to resolve the System Disk (rc=$rc); this script does not flip systemDiskSkip"
  SYSTEM_DISK_ID=${pick%%$'\t'*}
  SYSTEM_DISK_DEV=${pick#*$'\t'}
  log "System Disk already registered id=$SYSTEM_DISK_ID device=$SYSTEM_DISK_DEV"
  case "$SYSTEM_DISK_DEV" in
    sdb|sdb*) die "refusing to install on $SYSTEM_DISK_DEV" ;;
  esac
  [ -d /apps ] && [ -d /instances ] || die "/apps and /instances must exist on the System Disk"
}

wait_for_instance() {
  local name="$1" timeout="${2:-720}" start now rc line
  start=$(date +%s)
  while true; do
    inspect_store > "$RUN_DIR/store-inspect-latest.json"
    rc=0
    line=$(python3 - "$RUN_DIR/store-inspect-latest.json" "$name" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
name = sys.argv[2]
found = [i for i in (data.get("localInstances") or []) if i.get("name") == name]
if not found:
    sys.exit(2)
running = [i for i in found if i.get("status") == "Running" and i.get("port")]
pick = running[-1] if running else found[-1]
port = pick.get("port") or 0
status = pick.get("status") or ""
print("%s\t%s\t%s" % (pick.get("id") or "", port, status))
if status == "Running" and port:
    sys.exit(0)
sys.exit(3)
PY
) || rc=$?
    if [ "$rc" = 0 ]; then
      printf '%s\n' "$line"
      return 0
    fi
    now=$(date +%s)
    if [ $((now - start)) -ge "$timeout" ]; then
      die "timed out after ${timeout}s waiting for instance '$name' to become Running with a port"
    fi
    if [ "$rc" = 3 ]; then
      log "instance '$name' is present but not yet Running with a port; waiting"
    else
      log "waiting for Engine to register instance '$name'"
    fi
    pause_if_hot "waiting for install"
    sleep 5
  done
}

instance_dir() {
  local id="$1"
  case "$id" in
    [a-zA-Z0-9]*[a-zA-Z0-9-]) ;;
    *) die "refusing instance id that is not a simple token" ;;
  esac
  [ -d "/instances/$id" ] || die "instance directory /instances/$id not found"
  echo "/instances/$id"
}

place_kiwix_zim() {
  local dir="$1"
  local dest="$dir/data/${ZIM_BOOK}.zim"
  assert_no_forbidden_target "$dir"
  mkdir -p "$dir/data" "$dir/logs" 2>/dev/null || sudo mkdir -p "$dir/data" "$dir/logs"
  if [ ! -f "$dest" ]; then
    cp -a "$ZIM" "$dest" 2>/dev/null || { sudo cp -a "$ZIM" "$dest"; sudo chmod 644 "$dest" || true; }
    log "copied stub ZIM to $dest"
  fi
  ( cd "$dir" && { docker compose restart || docker compose up -d; } )
  log "restarted Kiwix compose project so the stub ZIM is served"
}

docker_rm_exited() {
  local id="$1" c
  for c in $(docker ps -a --filter "status=exited" --format '{{.Names}}' 2>/dev/null || true); do
    case "$c" in
      "$id"|"$id"-*) docker rm "$c" || true ;;
    esac
  done
}

quarantine_new_apps() {
  local dest="$1" name base
  [ -d /apps ] || return 0
  mkdir -p "$dest"
  for name in /apps/*; do
    [ -e "$name" ] || continue
    base=$(basename "$name")
    if [ -f "$RUN_DIR/apps-before.txt" ] && grep -Fxq "$base" "$RUN_DIR/apps-before.txt"; then
      continue
    fi
    assert_no_forbidden_target "$name"
    log "moving new app bundle $name -> $dest/$base (quarantine, not delete)"
    mv "$name" "$dest/$base"
  done
}

teardown() {
  if [ "$DID_TEARDOWN" = 1 ]; then
    return 0
  fi
  DID_TEARDOWN=1
  pause_if_hot "before teardown"
  local id
  for id in "$NEXTCLOUD_ID" "$KIWIX_ID"; do
    [ -n "$id" ] || continue
    if [ -n "$SYSTEM_DISK_ID" ]; then
      send_engine "stopInstance $id $SYSTEM_DISK_ID" || log "WARN: stopInstance $id failed"
      sleep 3
      send_engine "removeInstance $id" || log "WARN: removeInstance $id failed"
      sleep 3
      docker_rm_exited "$id"
    fi
  done
  mkdir -p "$RUN_DIR/quarantine-instances" "$RUN_DIR/quarantine-apps"
  for id in "$NEXTCLOUD_ID" "$KIWIX_ID"; do
    [ -n "$id" ] || continue
    if [ -e "/instances/$id" ]; then
      assert_no_forbidden_target "/instances/$id"
      log "moving /instances/$id -> $RUN_DIR/quarantine-instances/$id"
      mv "/instances/$id" "$RUN_DIR/quarantine-instances/$id"
    fi
  done
  quarantine_new_apps "$RUN_DIR/quarantine-apps"
  log "teardown finished"
}

verify_settings_on() {
  python3 - "$SETTINGS_PATH" <<'PY'
import os, stat, sys
path = sys.argv[1]
raw = open(path, "r", encoding="utf-8").read()
if raw != '{"usageMonitoring":"on"}\n':
    sys.stderr.write("ERROR: settings.json is not exactly ON plus a newline\n")
    sys.exit(1)
st = os.stat(path)
if stat.S_IMODE(st.st_mode) != 0o640:
    sys.exit(1)
import pwd, grp
if pwd.getpwuid(st.st_uid).pw_name != "pi" or grp.getgrgid(st.st_gid).gr_name != "pi":
    sys.exit(1)
print('PASS settings.json is exactly {"usageMonitoring":"on"}\\n, pi:pi 0640')
PY
}

do_curl() {
  # Usage: do_curl OUTFILE URL UA [XFF]
  local out="$1" url="$2" ua="$3" xff="${4:-}"
  local args=(-sS -m 20 -D "$out.hdr" -o "$out.body" -w '%{http_code}' -A "$ua")
  if [ -n "$xff" ]; then
    args+=(-H "X-Forwarded-For: $xff")
  fi
  local code
  code=$(curl "${args[@]}" "$url" || echo "000")
  echo "$code" > "$out.code"
  printf '%s' "$code"
}

on_exit() {
  local rc=$?
  if [ "$DID_TEARDOWN" != 1 ] && [ "$DID_INSTALL" = 1 ]; then
    teardown || true
  fi
  if [ -n "$SETTINGS_BACKUP" ] && [ -f "$SETTINGS_BACKUP" ]; then
    if ! cmp -s "$SETTINGS_BACKUP" "$SETTINGS_PATH" 2>/dev/null; then
      cp -a "$SETTINGS_BACKUP" "$SETTINGS_PATH" 2>/dev/null || true
      chown pi:pi "$SETTINGS_PATH" 2>/dev/null || true
      chmod 0640 "$SETTINGS_PATH" 2>/dev/null || true
    fi
    verify_settings_on || true
  fi
  exit "$rc"
}

trap on_exit EXIT

TS=$(date +%Y%m%dT%H%M%S)
if [ -n "$DEST" ]; then
  RUN_DIR="$DEST"
else
  RUN_DIR="$QUARANTINE_ROOT/i413-addr-$TS"
fi
mkdir -p "$RUN_DIR/before" "$RUN_DIR/after" "$RUN_DIR/diffs" "$RUN_DIR/logs" "$RUN_DIR/probes"
log "run directory $RUN_DIR"

check_host_and_claim
check_protected_disks
take_snapshot "$RUN_DIR/before" "before"
ls -1 /apps > "$RUN_DIR/apps-before.txt" 2>/dev/null || true
cp -a "$SETTINGS_PATH" "$RUN_DIR/settings.json.before"
SETTINGS_BACKUP="$RUN_DIR/settings.json.before"
verify_settings_on
ensure_system_disk
echo "$SYSTEM_DISK_ID" > "$RUN_DIR/system-disk-id.txt"
echo "$SYSTEM_DISK_DEV" > "$RUN_DIR/system-disk-dev.txt"

DID_INSTALL=1
pause_if_hot "before installApp i413-AddrNC"
send_engine "installApp nextcloud@main $SYSTEM_DISK_ID --fresh --name i413-AddrNC"
line=$(wait_for_instance "i413-AddrNC" 1200)
NEXTCLOUD_ID=${line%%$'\t'*}
NEXTCLOUD_PORT=${line#*$'\t'}; NEXTCLOUD_PORT=${NEXTCLOUD_PORT%%$'\t'*}
NEXTCLOUD_DIR=$(instance_dir "$NEXTCLOUD_ID")
log "installed i413-AddrNC id=$NEXTCLOUD_ID port=$NEXTCLOUD_PORT dir=$NEXTCLOUD_DIR"

pause_if_hot "before installApp i413-AddrKiwix"
send_engine "installApp kiwix@main $SYSTEM_DISK_ID --fresh --name i413-AddrKiwix"
kiwix_wait_start=$(date +%s)
while true; do
  inspect_store > "$RUN_DIR/store-inspect-latest.json"
  line=$(python3 - "$RUN_DIR/store-inspect-latest.json" "i413-AddrKiwix" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
found = [i for i in (data.get("localInstances") or []) if i.get("name") == sys.argv[2]]
if not found:
    sys.exit(2)
pick = found[-1]
print("%s\t%s\t%s" % (pick.get("id") or "", pick.get("port") or 0, pick.get("status") or ""))
PY
) && break
  if [ $(( $(date +%s) - kiwix_wait_start )) -ge 420 ]; then
    die "timed out waiting for Engine to register instance i413-AddrKiwix"
  fi
  log "waiting for Engine to register instance i413-AddrKiwix"
  sleep 4
done
KIWIX_ID=${line%%$'\t'*}
for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  [ -d "/instances/$KIWIX_ID" ] && break
  sleep 2
done
KIWIX_DIR=$(instance_dir "$KIWIX_ID")
place_kiwix_zim "$KIWIX_DIR"
line=$(wait_for_instance "i413-AddrKiwix" 90) || true
kiwix_st=${line##*$'\t'}
if [ -z "$line" ] || [ "$kiwix_st" != "Running" ]; then
  log "Kiwix store is not Running yet; sending startInstance to re-evaluate"
  send_engine "startInstance $KIWIX_ID $SYSTEM_DISK_ID"
  line=$(wait_for_instance "i413-AddrKiwix" 180)
fi
KIWIX_ID=${line%%$'\t'*}
KIWIX_PORT=${line#*$'\t'}; KIWIX_PORT=${KIWIX_PORT%%$'\t'*}
KIWIX_DIR=$(instance_dir "$KIWIX_ID")
log "installed i413-AddrKiwix id=$KIWIX_ID port=$KIWIX_PORT dir=$KIWIX_DIR"

echo "$NEXTCLOUD_ID" > "$RUN_DIR/nextcloud-id.txt"
echo "$NEXTCLOUD_PORT" > "$RUN_DIR/nextcloud-port.txt"
echo "$NEXTCLOUD_DIR" > "$RUN_DIR/nextcloud-dir.txt"
echo "$KIWIX_ID" > "$RUN_DIR/kiwix-id.txt"
echo "$KIWIX_PORT" > "$RUN_DIR/kiwix-port.txt"
echo "$KIWIX_DIR" > "$RUN_DIR/kiwix-dir.txt"

python3 "$PROBE" host-info --out "$RUN_DIR/host-info.json"
python3 "$PROBE" docker-proxy-info --out "$RUN_DIR/docker-proxy.json"
python3 "$PROBE" prepare-nextcloud --dir "$NEXTCLOUD_DIR" --out "$RUN_DIR/nextcloud-prepare.json"
python3 "$PROBE" prepare-kiwix --dir "$KIWIX_DIR" --out "$RUN_DIR/kiwix-prepare.json"
python3 "$PROBE" inspect-net --dir "$NEXTCLOUD_DIR" --service nextcloud-app --out "$RUN_DIR/nextcloud-net.json"
python3 "$PROBE" inspect-net --dir "$KIWIX_DIR" --service proxy --out "$RUN_DIR/kiwix-net.json"

LAN_IP=$(python3 -c 'import json; print((json.load(open("'"$RUN_DIR"'/host-info.json")).get("lan_ips") or [""])[0])')
TS_IP=$(python3 -c 'import json; print((json.load(open("'"$RUN_DIR"'/host-info.json")).get("tailscale_ips") or ["100.126.117.80"])[0])')
[ -n "$LAN_IP" ] || die "could not determine idea03 LAN IP"
log "LAN IP $LAN_IP  Tailscale IP $TS_IP  NC :$NEXTCLOUD_PORT  Kiwix :$KIWIX_PORT"

# Wait until Nextcloud probe PHP answers on the LAN published port.
nc_ready=0
for _i in $(seq 1 60); do
  code=$(curl -sS -m 8 -o /dev/null -w '%{http_code}' -A 'i413-addr-warmup' \
    "http://${LAN_IP}:${NEXTCLOUD_PORT}/i413-addr-probe.php" || echo 000)
  if [ "$code" = "200" ]; then
    nc_ready=1
    break
  fi
  log "waiting for Nextcloud probe PHP on LAN (HTTP $code)"
  sleep 4
done
[ "$nc_ready" = 1 ] || die "Nextcloud probe PHP never returned HTTP 200 on the LAN published port"

DAY=$(date +%F)
REQS="$RUN_DIR/probes"
python3 - <<PY
import json
from pathlib import Path
# requests.json is filled after curls, but we record planned rows now
Path("$REQS").mkdir(exist_ok=True)
print("probes dir ready")
PY

# --- local LAN and Tailscale hairpin requests from idea03 ---
declare -a REQ_IDS=()
record_nc() {
  local id="$1" via="$2" host="$3" src="$4" xff="$5"
  local ua="i413-addr-${id}"
  local url="http://${host}:${NEXTCLOUD_PORT}/i413-addr-probe.php"
  local stem="$REQS/$id"
  local code
  echo "$src" > "$stem.source"
  echo "$via" > "$stem.via"
  echo "$url" > "$stem.url"
  echo "$xff" > "$stem.xff"
  echo "$ua" > "$stem.ua"
  if [ -n "$xff" ]; then
    code=$(do_curl "$stem" "$url" "$ua" "$xff")
  else
    code=$(do_curl "$stem" "$url" "$ua")
  fi
  log "NC $id via=$via src=$src xff=${xff:-none} HTTP $code"
  python3 "$PROBE" collect-nextcloud --dir "$NEXTCLOUD_DIR" --ua "$ua" --out "$stem.nclog.json"
  REQ_IDS+=("$id")
}

record_kx() {
  local id="$1" via="$2" host="$3" src="$4" xff="$5"
  local marker="/i413-addr/${id}"
  local ua="i413-addr-${id}"
  local url="http://${host}:${KIWIX_PORT}${marker}"
  local stem="$REQS/$id"
  echo "$src" > "$stem.source"
  echo "$via" > "$stem.via"
  echo "$url" > "$stem.url"
  echo "$xff" > "$stem.xff"
  echo "$ua" > "$stem.ua"
  echo "$marker" > "$stem.marker"
  if [ -n "$xff" ]; then
    code=$(do_curl "$stem" "$url" "$ua" "$xff")
  else
    code=$(do_curl "$stem" "$url" "$ua")
  fi
  log "Kiwix $id via=$via src=$src xff=${xff:-none} HTTP $code"
  python3 "$PROBE" collect-kiwix --dir "$KIWIX_DIR" --marker "$marker" --day "$DAY" --out "$stem.kxlog.json"
  REQ_IDS+=("$id")
}

# Source IP of a self-request to LAN / Tailscale, from the routing table.
LAN_SRC=$(ip -4 route get "$LAN_IP" | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')
TS_SRC=$(ip -4 route get "$TS_IP" | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')
[ -n "$LAN_SRC" ] || LAN_SRC="$LAN_IP"
[ -n "$TS_SRC" ] || TS_SRC="$TS_IP"

record_nc nc-lan-noxff   lan       "$LAN_IP" "$LAN_SRC" ""
record_nc nc-lan-xff     lan       "$LAN_IP" "$LAN_SRC" "$XFF_PROBE"
record_nc nc-ts-noxff    tailscale "$TS_IP"  "$TS_SRC"  ""
record_nc nc-ts-xff      tailscale "$TS_IP"  "$TS_SRC"  "$XFF_PROBE"
record_kx kx-lan-noxff   lan       "$LAN_IP" "$LAN_SRC" ""
record_kx kx-lan-xff     lan       "$LAN_IP" "$LAN_SRC" "$XFF_PROBE"
record_kx kx-ts-noxff    tailscale "$TS_IP"  "$TS_SRC"  ""
record_kx kx-ts-xff      tailscale "$TS_IP"  "$TS_SRC"  "$XFF_PROBE"

# Ports file so an external (box) client can send Tailscale-IP requests.
{
  echo "NEXTCLOUD_PORT=$NEXTCLOUD_PORT"
  echo "KIWIX_PORT=$KIWIX_PORT"
  echo "LAN_IP=$LAN_IP"
  echo "TS_IP=$TS_IP"
  echo "DAY=$DAY"
} > "$RUN_DIR/ports.env"
echo ready > "$RUN_DIR/ready.flag"

# Wait up to 3 minutes for optional off-host Tailscale probes (written by the box).
log "waiting up to 180s for optional box Tailscale probes in $RUN_DIR/probes/box-*"
for _i in $(seq 1 36); do
  if [ -f "$RUN_DIR/probes/box-done.flag" ]; then
    log "box Tailscale probes arrived"
    break
  fi
  sleep 5
done

# Build requests.json from whatever probe files we have (local + optional box).
python3 - "$RUN_DIR" "$NEXTCLOUD_DIR" "$KIWIX_DIR" <<'PY'
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
probes = root / "probes"
reqs = []
for stem in sorted(probes.glob("*.ua")):
    ident = stem.name[:-3]  # strip .ua? wait, Path.stem of 'foo.ua' is 'foo'
ident = None
for uafile in sorted(probes.glob("*.ua")):
    ident = uafile.name[:-3] if uafile.name.endswith(".ua") else uafile.stem
    base = probes / ident
    def read(suffix, default=""):
        p = Path(str(base) + suffix)
        return p.read_text(encoding="utf-8").strip() if p.exists() else default
    php = {}
    body = Path(str(base) + ".body")
    if body.exists():
        try:
            php = json.loads(body.read_text(encoding="utf-8"))
        except Exception:
            php = {"_unparsed": True}
    logged = {}
    for extra in (".nclog.json", ".kxlog.json"):
        p = Path(str(base) + extra)
        if p.exists():
            try:
                logged = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                logged = {}
    app = "nextcloud" if ident.startswith("nc-") or ident.startswith("box-nc") else "kiwix"
    reqs.append({
        "id": ident,
        "app": app,
        "via": read(".via"),
        "target": read(".url"),
        "source_ip": read(".source"),
        "xff_sent": read(".xff") or None,
        "ua": read(".ua"),
        "http_status": read(".code"),
        "php": php if app == "nextcloud" else {},
        "logged": logged,
    })
(root / "requests.json").write_text(json.dumps(reqs, indent=2) + "\n", encoding="utf-8")
print("recorded", len(reqs), "requests")
PY

python3 "$PROBE" analyze --dir "$RUN_DIR" | tee "$RUN_DIR/analysis.stdout.json"

verify_settings_on
teardown
take_snapshot "$RUN_DIR/after" "after"
diff_snapshots "$RUN_DIR/before" "$RUN_DIR/after" "$RUN_DIR/diffs"
verify_settings_on
log "CLIENT-ADDRESS PROBE DONE  $RUN_DIR"
echo "$RUN_DIR"
