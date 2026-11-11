#!/usr/bin/env bash
# prove-hooks.sh — end-to-end idea#413 usage-hook proof (Kolibri, Nextcloud, Kiwix).
#
# Run later over ssh on a claimed pool Pi, as pi:
#   bash script/i413-hook-proof/prove-hooks.sh
#
# Dry-run (any host; no SSH, no Engine, no hostname/claim check):
#   bash script/i413-hook-proof/prove-hooks.sh --dry-run
#
# Refuses to run unless hostname is idea03 or idea04 and fleet-state claim is Kid
# (skipped in --dry-run only).
#
# Hard limits: no rm -rf, no pkill -f or pgrep -f, no dd, mkfs or wipe,
# no archive-and-clear. The deployed Engine tree is read-only. Never print
# credentials. Never touch /disks/sdb1, /disks, or the protected disks
# (serials AA202000000000004820, AA000000000000005638, 3813430-532011020,
# 20070Q450002; UUID 3E50-902A).
#
# Engine at aec3930 (includes #311/#312/#313/#314). Usage runner and helper
# v7 are unchanged from e91467d. installApp onto the System Disk still needs
# systemDiskSkip: false; if the store has no System Disk, this script uses an
# outside IDEA_CONFIG_FILE copy (only that flag flipped) and restores pm2
# from pm2.config.cjs at the end.
set -euo pipefail

HERE=$(CDPATH="" cd -- "$(dirname -- "$0")" && pwd)
SEED="$HERE/seed_and_check.py"
TRIGGER="$HERE/trigger-day-hooks.mjs"
SEND="$HERE/send-engine-command.mjs"
ZIM="$HERE/fixtures/duration_wikipedia_en_grade5a_stub_2026-10.zim"
ZIM_BOOK="duration_wikipedia_en_grade5a_stub_2026-10"

DRY_RUN=0
KEEP=0
DEST=""
ENGINE_ROOT="${ENGINE_ROOT:-/home/pi/idea/agents/agent-engine-dev}"
ENGINE_API="${ENGINE_API:-http://127.0.0.1:8080}"
QUARANTINE_ROOT="${QUARANTINE_ROOT:-/home/pi/kid-quarantine}"
EXPECTED_ENGINE_SHA="${EXPECTED_ENGINE_SHA:-aec3930cd9fe4abb5a74f0c4facb933eb42adcfe}"

PROTECTED_SERIALS='AA202000000000004820 AA000000000000005638 3813430-532011020 20070Q450002'
PROTECTED_UUIDS='3E50-902A'
PROTECTED_PATHS='/disks/sdb1 /disks'

KHAN_CHANNEL="c9d7f950ab6b5a1199e3d6c10d7f0103"
KHAN_LEAVES="ef35763056fe5113946710a750e4e75c,43d4efc489e150b19a3b7a7460e30fd9,cbb99d491f405719b44f1e6d12380c3f,0ed1af8fbbe758bbb743168938dc8a38,1d4c27c6d3bd59e0bd87fdb59eb68a2b,23e0467261d65705bd6de61adb6dbbec"

SYSTEM_DISK_ID=""
SYSTEM_DISK_DEV=""
DID_CONFIG=0
DID_TEARDOWN=0
DID_INSTALL=0
OUTSIDE_CONFIG=""
SETTINGS_BACKUP=""
SETTINGS_PATH="/var/lib/idea/usage/settings.json"
RUN_DIR=""
TS=""
HOST=""
DAY=""
ENGINE_SHA=""
RESTORED_PM2=0

# instance records: id, name, app, port, dir
KOLIBRI_ID="" KOLIBRI_PORT="" KOLIBRI_DIR=""
NEXTCLOUD_ID="" NEXTCLOUD_PORT="" NEXTCLOUD_DIR=""
KIWIX_ID="" KIWIX_PORT="" KIWIX_DIR=""
LEFTOVER_AFTER_REMOVE=""
OFF_PROOF_OK=""
ON_RESTORE_OK=""
CONFIG_NOTE=""

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "==> $*" >&2; }

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
}

# --- args -----------------------------------------------------------------

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --keep) KEEP=1; shift ;;
    --dest) DEST="${2:-}"; [ -n "$DEST" ] || die "--dest needs a value"; shift 2 ;;
    --engine-root) ENGINE_ROOT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) die "unexpected argument: $1" ;;
  esac
done

[ -x "$SEND" ] || die "send-engine-command.mjs is not executable"
[ -x "$SEED" ] || die "seed_and_check.py is not executable"
[ -x "$TRIGGER" ] || die "trigger-day-hooks.mjs is not executable"
[ -f "$ZIM" ] || die "missing stub ZIM: $ZIM"

# --- temperature ----------------------------------------------------------

temp_c() {
  if [ -r /sys/class/thermal/thermal_zone0/temp ]; then
    awk '{ printf "%.1f", $1/1000 }' /sys/class/thermal/thermal_zone0/temp
    return
  fi
  if command -v vcgencmd >/dev/null 2>&1; then
    vcgencmd measure_temp 2>/dev/null | tr -dc '0-9.'
    return
  fi
  echo ""
}

pause_if_hot() {
  [ "$DRY_RUN" = 1 ] && return 0
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

# --- snapshots ------------------------------------------------------------

take_snapshot() {
  local dir="$1" label="$2"
  mkdir -p "$dir"
  {
    echo "# snapshot $label $(date '+%Y-%m-%d %H:%M:%S %z')"
    echo "# hostname=$(hostname 2>/dev/null || true)"
    echo "# engine_sha=${ENGINE_SHA:-unknown}"
  } > "$dir/meta.txt"
  docker ps -a > "$dir/docker-ps.txt" 2>&1 || true
  docker images > "$dir/docker-images.txt" 2>&1 || true
  pm2 ls > "$dir/pm2-ls.txt" 2>&1 || true
  lsblk > "$dir/lsblk.txt" 2>&1 || true
  losetup -a > "$dir/losetup.txt" 2>&1 || true
  (temp_c; echo) > "$dir/tempC.txt" 2>&1 || true
  if [ -f "$SETTINGS_PATH" ]; then
    cp -a "$SETTINGS_PATH" "$dir/settings.json" || true
    stat "$SETTINGS_PATH" > "$dir/settings.stat" 2>&1 || true
  else
    echo "(missing)" > "$dir/settings.json"
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

# --- guards ---------------------------------------------------------------

find_fleet_state() {
  if [ -n "${FLEET_STATE:-}" ]; then
    [ -f "$FLEET_STATE" ] || die "FLEET_STATE is not a file: $FLEET_STATE"
    echo "$FLEET_STATE"
    return
  fi
  if [ -n "${STATE_FILE:-}" ]; then
    [ -f "$STATE_FILE" ] || die "STATE_FILE is not a file: $STATE_FILE"
    echo "$STATE_FILE"
    return
  fi
  local p
  for p in \
    /home/pi/idea/agents/idea/fleet-state.json \
    /home/pi/idea/fleet-state.json
  do
    if [ -f "$p" ]; then
      echo "$p"
      return
    fi
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
  HOST=$host
  log "hostname $host, fleet claim '$claim' (Kid) from $state"
}

assert_no_forbidden_target() {
  local target="$1"
  case "$target" in
    /disks|/disks/*)
      die "refusing to use $target (never touch /disks or /disks/sdb1)" ;;
  esac
}

check_protected_disks() {
  local line serial uuid path
  for path in $PROTECTED_PATHS; do
    case "${DISK_ROOT:-}" in
      "$path"|"$path"/*) die "refusing to use disk root ${DISK_ROOT} (protected $path)" ;;
    esac
  done
  # Presence of protected hardware is not itself a reason to abort (the
  # Intenso test stick is often docked on idea03; the WD SSD is often on
  # idea04). Install targets are checked later and must be the System Disk
  # only, never those devices and never /disks.
  if command -v lsblk >/dev/null 2>&1; then
    while IFS= read -r line; do
      for serial in $PROTECTED_SERIALS; do
        case "$line" in
          *"$serial"*) log "note: protected serial $serial is visible in lsblk (will not be targeted)" ;;
        esac
      done
      for uuid in $PROTECTED_UUIDS; do
        case "$line" in
          *"$uuid"*) log "note: protected UUID $uuid is visible in lsblk (will not be targeted)" ;;
        esac
      done
    done < <(lsblk -o NAME,SERIAL,UUID,LABEL,MOUNTPOINT 2>/dev/null || true)
  fi
}

# --- Engine helpers -------------------------------------------------------

engine_cmd() {
  ENGINE_ROOT="$ENGINE_ROOT" ENGINE_API="$ENGINE_API" node "$SEND" "$@"
}

inspect_store() {
  engine_cmd inspect
}

send_engine() {
  local cmd="$1"
  local out="${RUN_DIR:-/tmp}/engine-send-latest.json"
  log "Engine command: $cmd"
  mkdir -p "$(dirname "$out")"
  # Never print the inspect/send JSON on stdout: callers capture a single id line.
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
    sys.stderr.write("ERROR: refusing System Disk device %s (sdb / Disk B / WD SSD path is protected)\n" % dev)
    sys.exit(1)
print("%s\t%s" % (d["id"], dev))
PY
}

write_outside_config() {
  local src="$ENGINE_ROOT/config.yaml"
  local dst="$1"
  [ -f "$src" ] || die "deployed config.yaml not found at $src"
  # Copy + flip only systemDiskSkip. Never print the file (it has a default password field).
  python3 - "$src" "$dst" <<'PY'
import re, sys, os
src, dst = sys.argv[1], sys.argv[2]
text = open(src, "r", encoding="utf-8").read()
if re.search(r"(?m)^([ \t]*)systemDiskSkip:[ \t]*false[ \t]*$", text):
    new, n = text, 1
    note = "already-false"
else:
    new, n = re.subn(r"(?m)^([ \t]*)systemDiskSkip:[ \t]*true[ \t]*$", r"\1systemDiskSkip: false", text, count=1)
    note = "flipped-true-to-false"
    if n != 1:
        new, n = re.subn(r"(?m)^(settings:[ \t]*\n)", r"\1  systemDiskSkip: false\n", text, count=1)
        note = "inserted-under-settings"
if n != 1:
    sys.stderr.write("ERROR: could not set systemDiskSkip: false in the outside copy\n")
    sys.exit(1)
# Refuse to write if we accidentally dropped the only change scope.
if "systemDiskSkip: false" not in new:
    sys.stderr.write("ERROR: outside copy is missing systemDiskSkip: false\n")
    sys.exit(1)
os.umask(0o077)
with open(dst, "w", encoding="utf-8") as f:
    f.write(new)
os.chmod(dst, 0o600)
print(note)
PY
}

pm2_env_has() {
  local app="$1" key="$2"
  pm2 jlist 2>/dev/null | python3 -c '
import json, sys
apps = json.load(sys.stdin)
name, key = sys.argv[1], sys.argv[2]
for a in apps:
    if a.get("name") == name:
        env = (a.get("pm2_env") or {}).get("env") or {}
        val = env.get(key)
        if val is None:
            val = (a.get("pm2_env") or {}).get(key)
        if val:
            print(val)
            sys.exit(0)
        sys.exit(1)
sys.exit(1)
' "$app" "$key"
}

restart_engine_with_outside_config() {
  local cfg="$1"
  [ -f "$cfg" ] || die "outside config not found: $cfg"
  log "restarting engine + idea-usage with outside IDEA_CONFIG_FILE (deployed tree untouched)"
  # Write an outside ecosystem file so we never edit pm2.config.cjs.
  local eco="$RUN_DIR/pm2-i413.config.cjs"
  python3 - "$ENGINE_ROOT" "$cfg" "$eco" <<'PY'
import sys
root, cfg, dest = sys.argv[1], sys.argv[2], sys.argv[3]
open(dest, "w").write(
"""module.exports = {
  apps : [{
    name   : "engine",
    cwd    : %s,
    script : "./dist/src/index.js",
    kill_timeout: 10000,
    env: {
       NODE_ENV: "development",
       VERBOSITY: "3",
       IDEA_CONFIG_FILE: %s
    }
  }, {
    name   : "idea-usage",
    cwd    : %s,
    script : "./dist/src/usage/main.js",
    kill_timeout: 10000,
    env: {
       NODE_ENV: "development",
       VERBOSITY: "3",
       IDEA_CONFIG_FILE: %s
    }
  }]
}
""" % (repr(root), repr(cfg), repr(root), repr(cfg))
)
PY
  (
    cd "$ENGINE_ROOT"
    pm2 delete engine idea-usage || true
    pm2 start "$eco"
    pm2 save
  )
  DID_CONFIG=1
  CONFIG_NOTE="Applied outside IDEA_CONFIG_FILE at $cfg (systemDiskSkip: false only). Deployed config.yaml was not edited."
  log "waiting for Engine HTTP after outside-config restart"
  local _i
  for _i in $(seq 1 60); do
    if curl -fsS -m 3 "$ENGINE_API/api/store-url" >/dev/null 2>&1; then
      log "Engine HTTP is up"
      return 0
    fi
    sleep 2
  done
  die "Engine did not come back after the outside-config pm2 restart"
}

restore_pm2_from_config() {
  if [ "$DID_CONFIG" != 1 ]; then
    log "pm2 was not switched to an outside config; leaving it as found"
    return 0
  fi
  if [ "$RESTORED_PM2" = 1 ]; then
    return 0
  fi
  log "restoring engine + idea-usage from pm2.config.cjs (no IDEA_CONFIG_FILE, no IDEA_USAGE_AS_MAIN)"
  (
    cd "$ENGINE_ROOT"
    pm2 delete engine idea-usage || true
    pm2 start pm2.config.cjs
    pm2 save
  )
  RESTORED_PM2=1
  local _i
  for _i in $(seq 1 60); do
    if curl -fsS -m 3 "$ENGINE_API/api/store-url" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  if pm2_env_has engine IDEA_CONFIG_FILE || pm2_env_has engine IDEA_USAGE_AS_MAIN \
     || pm2_env_has idea-usage IDEA_CONFIG_FILE || pm2_env_has idea-usage IDEA_USAGE_AS_MAIN; then
    die "pm2 env still has IDEA_CONFIG_FILE or IDEA_USAGE_AS_MAIN after restore"
  fi
  log "pm2 restored from pm2.config.cjs and saved"
}

ensure_system_disk() {
  local pick rc
  rc=0
  pick=$(pick_system_disk) || rc=$?
  if [ "$rc" = 0 ]; then
    SYSTEM_DISK_ID=${pick%%$'\t'*}
    SYSTEM_DISK_DEV=${pick#*$'\t'}
    log "System Disk already registered id=$SYSTEM_DISK_ID device=$SYSTEM_DISK_DEV"
  elif [ "$rc" = 2 ]; then
    log "no System Disk in the store; using an outside IDEA_CONFIG_FILE (systemDiskSkip: false)"
    OUTSIDE_CONFIG="$RUN_DIR/engine-config-outside.yaml"
    local note
    note=$(write_outside_config "$OUTSIDE_CONFIG")
    log "outside config written ($note), mode 0600, contents not printed"
    restart_engine_with_outside_config "$OUTSIDE_CONFIG"
    sleep 5
    rc=0
    pick=$(pick_system_disk) || rc=$?
    if [ "$rc" != 0 ]; then
      die "System Disk still not registered after the outside-config restart"
    fi
    SYSTEM_DISK_ID=${pick%%$'\t'*}
    SYSTEM_DISK_DEV=${pick#*$'\t'}
    log "System Disk registered id=$SYSTEM_DISK_ID device=$SYSTEM_DISK_DEV"
  else
    die "failed to resolve the System Disk"
  fi
  case "$SYSTEM_DISK_DEV" in
    sdb|sdb*) die "refusing to install on $SYSTEM_DISK_DEV" ;;
  esac
  if [ ! -d /apps ] || [ ! -d /instances ]; then
    die "/apps and /instances must exist on the System Disk (is systemDiskSkip still true?)"
  fi
}

wait_for_instance() {
  local name="$1"
  local timeout="${2:-720}"
  local start now rc line
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
    *) die "refusing instance id that is not a simple token: ${id:0:80}" ;;
  esac
  if [ -d "/instances/$id" ]; then
    echo "/instances/$id"
    return
  fi
  die "instance directory /instances/$id not found"
}

# --- settings switch ------------------------------------------------------

backup_settings() {
  [ -f "$SETTINGS_PATH" ] || die "missing $SETTINGS_PATH"
  SETTINGS_BACKUP="$RUN_DIR/settings.json.before"
  cp -a "$SETTINGS_PATH" "$SETTINGS_BACKUP"
  log "backed up $SETTINGS_PATH to $SETTINGS_BACKUP"
}

write_usage_switch() {
  local value="$1"
  case "$value" in
    on|off) ;;
    *) die "usage switch must be on or off" ;;
  esac
  python3 - "$SETTINGS_PATH" "$value" <<'PY'
import json, os, sys
path, value = sys.argv[1], sys.argv[2]
tmp = path + ".tmp"
data = json.dumps({"usageMonitoring": value}) + "\n"
os.umask(0o177)
with open(tmp, "w", encoding="utf-8") as f:
    f.write(data)
os.chmod(tmp, 0o640)
os.replace(tmp, path)
PY
  # Keep ownership if we can (file is typically pi:pi).
  if command -v chown >/dev/null 2>&1; then
    chown pi:pi "$SETTINGS_PATH" 2>/dev/null || true
  fi
  log "wrote usageMonitoring=$value to $SETTINGS_PATH"
}

restore_settings_from_backup() {
  [ -f "$SETTINGS_BACKUP" ] || die "settings backup missing"
  cp -a "$SETTINGS_BACKUP" "$SETTINGS_PATH"
  if command -v chown >/dev/null 2>&1; then
    chown pi:pi "$SETTINGS_PATH" 2>/dev/null || true
  fi
  chmod 0640 "$SETTINGS_PATH" 2>/dev/null || true
  # Re-apply exact bytes (cp -a should already have done this).
  if ! cmp -s "$SETTINGS_BACKUP" "$SETTINGS_PATH"; then
    die "settings.json does not match the backup after restore"
  fi
  log "restored $SETTINGS_PATH from the backup (exact bytes)"
}

verify_settings_on() {
  python3 - "$SETTINGS_PATH" <<'PY'
import os, stat, sys
path = sys.argv[1]
raw = open(path, "r", encoding="utf-8").read()
if raw != '{"usageMonitoring":"on"}\n':
    sys.stderr.write("ERROR: settings.json is not exactly {\"usageMonitoring\":\"on\"} plus a newline\n")
    sys.stderr.write("repr: %r\n" % raw)
    sys.exit(1)
st = os.stat(path)
mode = stat.S_IMODE(st.st_mode)
if mode != 0o640:
    sys.stderr.write("ERROR: settings.json mode is %04o, expected 0640\n" % mode)
    sys.exit(1)
# owner names if available
try:
    import pwd, grp
    user = pwd.getpwuid(st.st_uid).pw_name
    group = grp.getgrgid(st.st_gid).gr_name
    if user != "pi" or group != "pi":
        sys.stderr.write("ERROR: settings.json owner is %s:%s, expected pi:pi\n" % (user, group))
        sys.exit(1)
except KeyError:
    pass
print("PASS settings.json is exactly {\"usageMonitoring\":\"on\"}\\n, pi:pi 0640")
PY
}

sighup_idea_usage() {
  local pid
  pid=$(pm2 pid idea-usage 2>/dev/null || true)
  if [ -z "$pid" ] || [ "$pid" = "0" ]; then
    die "could not read idea-usage pid from pm2 (not using pgrep -f)"
  fi
  case "$pid" in
    *[!0-9]*) die "pm2 pid idea-usage returned a non-numeric value" ;;
  esac
  kill -HUP "$pid"
  log "sent SIGHUP to idea-usage pid $pid (next tick re-reads settings.json)"
}

# --- install / seed -------------------------------------------------------

install_one() {
  local app_ref="$1" name="$2" timeout="$3"
  pause_if_hot "before installApp $name"
  send_engine "installApp $app_ref $SYSTEM_DISK_ID --fresh --name $name"
  local line id port status
  line=$(wait_for_instance "$name" "$timeout")
  id=${line%%$'\t'*}
  rest=${line#*$'\t'}
  port=${rest%%$'\t'*}
  status=${rest#*$'\t'}
  log "installed $name id=$id port=$port status=$status"
  printf '%s\n' "$line"
}

place_kiwix_zim() {
  local dir="$1"
  local dest="$dir/data/${ZIM_BOOK}.zim"
  assert_no_forbidden_target "$dir"
  if [ ! -d "$dir/data" ]; then
    mkdir -p "$dir/data" "$dir/logs" 2>/dev/null || sudo mkdir -p "$dir/data" "$dir/logs"
  fi
  mkdir -p "$dir/logs" 2>/dev/null || sudo mkdir -p "$dir/logs"
  if [ ! -f "$dest" ]; then
    if ! cp -a "$ZIM" "$dest" 2>/dev/null; then
      sudo cp -a "$ZIM" "$dest"
      sudo chmod 644 "$dest" || true
    fi
    log "copied stub ZIM to $dest"
  else
    log "stub ZIM already present at $dest"
  fi
  # Restart only this compose project so kiwix-serve sees the ZIM.
  # The Engine tree is not touched. Instance data is under /instances.
  (
    cd "$dir"
    docker compose restart || docker compose up -d
  )
  log "restarted Kiwix compose project so the stub ZIM is served"
}


# Kolibri 0.19 zeroconf walks every host interface. On a pool Pi with many
# leftover Docker bridges this fails with ENOBUFS and the process exits,
# leaving the Engine store at Error even after a later healthy restart.
# Write the option into instance data only (not the Engine tree, not /apps).
# The generated options.ini already comments "# ZEROCONF_ENABLED = True"
# under [Deployment]; do not append a second [Deployment] section (configobj
# DuplicateError) and do not treat the comment as already set.
disable_kolibri_zeroconf() {
  local dir="$1"
  local home="$dir/data/kolibri"
  local opt="$home/options.ini"
  local rc=0 note=""
  assert_no_forbidden_target "$dir"
  if [ ! -d "$home" ]; then
    log "Kolibri data dir $home not present yet; will retry"
    return 1
  fi
  note=$(python3 - "$opt" <<'PYZ'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text(encoding="utf-8") if p.is_file() else ""
active = any(
    (not line.lstrip().startswith("#")) and "ZEROCONF_ENABLED" in line
    and "False" in line.split("#", 1)[0]
    for line in text.splitlines()
)
if active:
    print("already-false")
    sys.exit(0)
old = "# ZEROCONF_ENABLED = True"
new = "ZEROCONF_ENABLED = False"
if old in text:
    text = text.replace(old, new, 1)
elif "[Deployment]" in text:
    text = text.replace("[Deployment]", "[Deployment]\nZEROCONF_ENABLED = False", 1)
else:
    if text and not text.endswith("\n"):
        text += "\n"
    text += "\n[Deployment]\nZEROCONF_ENABLED = False\n"
out = Path("/tmp/i413-kolibri-options.ini")
out.write_text(text, encoding="utf-8")
try:
    p.write_text(text, encoding="utf-8")
    print("updated")
except PermissionError:
    print("need-sudo")
    sys.exit(10)
PYZ
) || rc=$?
  if [ "$rc" = 10 ]; then
    sudo cp /tmp/i413-kolibri-options.ini "$opt"
    sudo chmod 644 "$opt" || true
    note="updated-via-sudo"
    rc=0
  fi
  if [ "$rc" != 0 ]; then
    log "WARN: could not update Kolibri options.ini (rc=$rc)"
    return "$rc"
  fi
  log "Kolibri ZEROCONF_ENABLED=False ($note)"
  return 0
}

import_kolibri_slice() {
  local dir="$1"
  log "importing Khan Academy G5A leaves-only slice (public channel, ~9 MB + 115 MB channel DB)"
  (
    cd "$dir"
    docker compose exec -T kolibri kolibri manage importchannel network "$KHAN_CHANNEL"
    docker compose exec -T kolibri kolibri manage importcontent --node_ids "$KHAN_LEAVES" network "$KHAN_CHANNEL"
  )
  log "Kolibri content slice imported"
}

disable_nc_firstrun() {
  local dir="$1"
  (
    cd "$dir"
    docker compose exec -T nextcloud-app php occ app:disable firstrunwizard || \
      log "WARN: could not disable firstrunwizard (may already be off)"
  )
}

# --- teardown -------------------------------------------------------------

docker_rm_exited() {
  local id="$1"
  local line cid name found=0
  [ -n "$id" ] || return 0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    cid=${line%% *}
    name=${line#* }
    case "$name" in
      *"$id"*)
        log "docker rm (no -v) leftover $name ($cid)"
        docker rm "$cid"
        found=1
        ;;
    esac
  done < <(docker ps -a --filter status=exited --format '{{.ID}} {{.Names}}' 2>/dev/null || true)
  if [ "$found" = 1 ]; then
    LEFTOVER_AFTER_REMOVE="${LEFTOVER_AFTER_REMOVE} ${id}:yes"
  else
    LEFTOVER_AFTER_REMOVE="${LEFTOVER_AFTER_REMOVE} ${id}:no"
  fi
}

remove_new_images() {
  local before="$1" after="$2" report="$3"
  : > "$report"
  python3 - "$before" "$after" "$report" <<'PY'
import subprocess, sys
before, after, report = sys.argv[1], sys.argv[2], sys.argv[3]
def tags(path):
    s=set()
    try:
        lines=open(path).read().splitlines()
    except OSError:
        return s
    # skip header
    for line in lines[1:]:
        parts=line.split()
        if len(parts) >= 3:
            s.add(parts[0] + ":" + parts[1])
    return s
new = sorted(tags(after) - tags(before))
# Only consider images our three Apps may have introduced.
prefixes = (
    "koenswings/kolibri:", "koenswings/nextcloud:", "koenswings/nextcloud-mariadb:",
    "ghcr.io/kiwix/kiwix-serve:", "nginx:", "collabora/code:",
    "koenswings/collabora", "nextcloud/nextcloud:",
)
ours = [t for t in new if t.startswith(prefixes)]
removed=[]
skipped=[]
for tag in ours:
    if tag.endswith(":latest") and "<none>" in tag:
        skipped.append(tag + " (dangling, skipped)")
        continue
    r = subprocess.run(["docker", "image", "rm", tag], capture_output=True, text=True)
    if r.returncode == 0:
        removed.append(tag)
    else:
        skipped.append(tag + " (docker image rm failed; left in place)")
open(report,"w").write("removed:\n" + "\n".join(removed) + "\n\nskipped:\n" + "\n".join(skipped) + "\nnew_not_ours:\n" + "\n".join(t for t in new if t not in ours) + "\n")
print("removed %d new app images; skipped %d" % (len(removed), len(skipped)))
PY
}

quarantine_instance_data() {
  local id="$1" dest="$2"
  [ -n "$id" ] || return 0
  local src="/instances/$id"
  if [ -e "$src" ]; then
    assert_no_forbidden_target "$src"
    mkdir -p "$dest"
    log "moving $src -> $dest/$id (quarantine, not delete)"
    mv "$src" "$dest/$id"
  fi
  # App bundles created during this run are moved in quarantine_new_apps.
}


quarantine_new_apps() {
  local dest="$1"
  local name base
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
  for id in "$KOLIBRI_ID" "$NEXTCLOUD_ID" "$KIWIX_ID"; do
    [ -n "$id" ] || continue
    if [ -n "$SYSTEM_DISK_ID" ]; then
      send_engine "stopInstance $id $SYSTEM_DISK_ID" || log "WARN: stopInstance $id failed"
      sleep 3
      send_engine "removeInstance $id" || log "WARN: removeInstance $id failed"
      sleep 3
      docker_rm_exited "$id"
    fi
  done
  mkdir -p "$RUN_DIR/quarantine-instances"
  for id in "$KOLIBRI_ID" "$NEXTCLOUD_ID" "$KIWIX_ID"; do
    quarantine_instance_data "$id" "$RUN_DIR/quarantine-instances"
  done
  quarantine_new_apps "$RUN_DIR/quarantine-apps"
  remove_new_images "$RUN_DIR/before/docker-images.txt" \
    "$RUN_DIR/after-images-pre-rm.txt" "$RUN_DIR/image-cleanup.txt" || true
  log "teardown finished"
}

on_exit() {
  local rc=$?
  if [ "$DRY_RUN" = 1 ]; then
    exit "$rc"
  fi
  if [ "$KEEP" = 1 ]; then
    log "exit rc=$rc keep=1 (teardown and pm2 restore skipped)"
    exit "$rc"
  fi
  # Best-effort restore even on failure, so the Pi can be released cleanly.
  if [ "$DID_TEARDOWN" != 1 ] && [ "$DID_INSTALL" = 1 ]; then
    docker images > "$RUN_DIR/after-images-pre-rm.txt" 2>&1 || true
    teardown || true
  fi
  if [ -n "$SETTINGS_BACKUP" ] && [ -f "$SETTINGS_BACKUP" ]; then
    restore_settings_from_backup || true
    verify_settings_on || true
  fi
  restore_pm2_from_config || true
  exit "$rc"
}

# --- evidence -------------------------------------------------------------

write_evidence() {
  local ev="$RUN_DIR/EVIDENCE.md"
  python3 - "$ev" <<'PY'
import json, os, sys, time
from pathlib import Path
ev = Path(sys.argv[1])
run = ev.parent
def read(p, default="(missing)"):
    try:
        return Path(p).read_text(encoding="utf-8")
    except OSError:
        return default
def loadj(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return None
meta = {}
for name in ("meta.json",):
    m = loadj(run / name)
    if m:
        meta = m
timings = loadj(run / "timings-on.json") or {}
off_report = read(run / "off-proof.txt")
leftovers = read(run / "leftovers.txt")
checks = read(run / "field-checks.txt")
host = meta.get("host") or "(unknown)"
day = meta.get("day") or "(unknown)"
sha = meta.get("engine_sha") or "(unknown)"
verdict = meta.get("verdict") or "INCOMPLETE"
lines = []
lines.append(f"# idea#413 hook proof — {host}")
lines.append("")
lines.append(f"- Host: `{host}`")
lines.append(f"- Kit-local day: `{day}`")
lines.append(f"- Engine SHA: `{sha}` (expected aec3930, runner/helper identical to e91467d)")
lines.append(f"- Helper: v7 (idea-usage-export / settings switch unchanged at aec3930)")
lines.append(f"- Run directory: `{run}`")
lines.append(f"- Verdict: **{verdict}**")
lines.append("")
lines.append("## How the run was triggered")
lines.append("")
lines.append("The live `idea-usage` process does **not** offer an on-demand CLI for today's day file.")
lines.append("Day hooks run in the kit-local night window 02:00–03:30 (for yesterday, plus catch-up of missing days in `today-14..yesterday` when the instance already existed that day) and on process start for that same catch-up window. Sample hooks run every 15 minutes, including on the first tick.")
lines.append("")
lines.append("For this proof, `script/i413-hook-proof/trigger-day-hooks.mjs` imported the Engine's own `runDayHook` / `runSampleHook` / `defaultExecHook` from the deployed `dist/` (read-only) and wrote today's day files under `/var/lib/idea/usage/<day>/`. Exit codes and durations were captured around that official exec path. The OFF proof used the **live** `idea-usage` process (SIGHUP, then one settings-poll tick) rather than the one-shot, so it tests the process that will run in the field.")
lines.append("")
lines.append("Hook timeouts (compose `timeoutS`; Engine also clamps to 120 s): Kolibri **60 s**, Nextcloud **30 s**, Kiwix **30 s**.")
lines.append("")
lines.append("## Instances")
lines.append("")
for key in ("kolibri", "nextcloud", "kiwix"):
    rec = meta.get("instances", {}).get(key) or {}
    lines.append(f"- {key}: id=`{rec.get('id','')}` port=`{rec.get('port','')}` dir=`{rec.get('dir','')}`")
lines.append("")
lines.append("## Per-hook timings vs timeout")
lines.append("")
for t in (timings.get("timings") or []):
    lines.append(
        f"- `{t.get('instanceId')}` {t.get('app')} mode={t.get('mode')} "
        f"exit={t.get('exitCode')} durationMs={t.get('durationMs')} "
        f"timeoutS={t.get('timeoutS')} timedOut={t.get('timedOut')}"
    )
if not timings.get("timings"):
    lines.append("- (no timings recorded)")
lines.append("")
lines.append("Day-file hookStatus:")
for d in (timings.get("dayFiles") or []):
    lines.append(f"- `{d.get('instanceId')}` {d.get('app')} hookStatus={d.get('hookStatus')}")
lines.append("")
lines.append("## §2 / contract §5.3 field coverage")
lines.append("")
lines.append("```")
lines.append(checks.strip() or "(no field-check output)")
lines.append("```")
lines.append("")
lines.append("Notes:")
lines.append("- Kolibri roles in the day file are `learner` / `coach` / `admin` (`teacher1` is a coach).")
lines.append("- Nextcloud `appsOpened` is omitted until Phase 3; the word processor is `office.*` (Nextcloud Office / Collabora CODE), not Text.")
lines.append("- Kiwix articles were fetched as `/content/<book>/<title>` on the 62 KB CC0 Grade 5A stub ZIM (verified `/content/` paths).")
lines.append("")
lines.append("## OFF proof")
lines.append("")
lines.append("```")
lines.append(off_report.strip() or "(no off-proof output)")
lines.append("```")
lines.append("")
lines.append("## Teardown, leftovers, snapshots")
lines.append("")
lines.append("```")
lines.append(leftovers.strip() or "(no leftover report)")
lines.append("```")
lines.append("")
lines.append("After snapshots and diffs are under this run directory. Instance data was moved to quarantine, not deleted. removeInstance leftovers were `docker rm` without `-v` if any Exited containers remained (#311 should have prevented that).")
lines.append("")
lines.append("## End state")
lines.append("")
for line in (meta.get("end_state") or []):
    lines.append(f"- {line}")
lines.append("")
ev.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(str(ev))
PY
  log "wrote evidence $ev"
}

# --- dry-run --------------------------------------------------------------

dry_run() {
  local out="${DEST:-/tmp/i413-hook-proof-dry-run}"
  mkdir -p "$out"
  log "dry-run: no hostname/claim check, no Engine, no Docker, no SSH"
  log "script dir: $HERE"
  log "expected engine SHA: $EXPECTED_ENGINE_SHA"
  log "hook timeouts: Kolibri 60s, Nextcloud 30s, Kiwix 30s (Engine clamp 120s)"
  log "day files: /var/lib/idea/usage/<day>/<instanceId>.json"
  log "switch: $SETTINGS_PATH {\"usageMonitoring\":\"on\"|\"off\"} plus newline"
  log "trigger: trigger-day-hooks.mjs imports Engine dist runDayHook (no live CLI for today)"
  log "OFF proof: SIGHUP live idea-usage, wait one 60s settings poll"
  log "systemDiskSkip: if no System Disk, outside IDEA_CONFIG_FILE with only that flag false, restore pm2.config.cjs at end"
  log "protected: $PROTECTED_SERIALS $PROTECTED_UUIDS $PROTECTED_PATHS"
  log "ZIM: $ZIM ($ZIM_BOOK)"
  log "Kolibri content: Khan channel $KHAN_CHANNEL leaves-only (~9 MB + 115 MB channel DB)"
  echo "----- seed_and_check self-test -----"
  python3 "$SEED" self-test
  echo "----- node syntax of helpers -----"
  node --check "$SEND"
  node --check "$TRIGGER"
  echo "PASS dry-run (helpers syntax-checked, field checker self-test passed)"
  printf '%s\n' "dry-run ok" > "$out/dry-run.txt"
}

# --- main proof -----------------------------------------------------------

run_proof() {
  TS=$(date +%Y%m%dT%H%M%S)
  DAY=$(date +%F)
  if [ -n "$DEST" ]; then
    RUN_DIR="$DEST"
  else
    RUN_DIR="$QUARANTINE_ROOT/i413-$TS"
  fi
  mkdir -p "$RUN_DIR/before" "$RUN_DIR/after" "$RUN_DIR/diffs" "$RUN_DIR/logs"
  log "run directory $RUN_DIR (quarantine root, nothing is deleted)"
  HOST=$(hostname -s 2>/dev/null || hostname)
  if [ -d "$ENGINE_ROOT/.git" ]; then
    ENGINE_SHA=$(git -C "$ENGINE_ROOT" rev-parse HEAD 2>/dev/null || true)
  fi
  if [ -n "$ENGINE_SHA" ] && [ "$ENGINE_SHA" != "$EXPECTED_ENGINE_SHA" ]; then
    log "WARN: Engine HEAD is $ENGINE_SHA, expected $EXPECTED_ENGINE_SHA (continuing if idea-usage is up)"
  fi
  check_host_and_claim
  check_protected_disks
  take_snapshot "$RUN_DIR/before" "before"
  ls -1 /apps > "$RUN_DIR/apps-before.txt" 2>/dev/null || true
  ls -1 /instances > "$RUN_DIR/instances-before.txt" 2>/dev/null || true
  cp -a "$RUN_DIR/before/docker-images.txt" "$RUN_DIR/docker-images-before.txt" || true
  backup_settings
  verify_settings_on || log "WARN: settings.json was not already in the exact ON form; backup kept; will restore to this backup at the end, then assert ON if the backup is ON"
  ensure_system_disk
  echo "$SYSTEM_DISK_ID" > "$RUN_DIR/system-disk-id.txt"
  echo "$SYSTEM_DISK_DEV" > "$RUN_DIR/system-disk-dev.txt"

  DID_INSTALL=1
  local line
  pause_if_hot "before installApp i413-Kolibri"
  send_engine "installApp kolibri@main $SYSTEM_DISK_ID --fresh --name i413-Kolibri"
  # Wait for the instance directory, disable zeroconf (ENOBUFS on many docker
  # bridges), then wait until the Engine reports Running with a port.
  kolibri_wait_start=$(date +%s)
  while true; do
    inspect_store > "$RUN_DIR/store-inspect-latest.json"
    line=$(python3 - "$RUN_DIR/store-inspect-latest.json" "i413-Kolibri" <<'PYK'
import json, sys, re
data = json.load(open(sys.argv[1]))
name = sys.argv[2]
found = [i for i in (data.get("localInstances") or []) if i.get("name") == name]
if not found:
    sys.exit(2)
pick = found[-1]
iid = str(pick.get("id") or "")
if not re.match(r"^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$", iid):
    sys.exit(2)
print("%s\t%s\t%s" % (iid, pick.get("port") or 0, pick.get("status") or ""))
PYK
) && break
    if [ $(( $(date +%s) - kolibri_wait_start )) -ge 420 ]; then
      die "timed out waiting for Engine to register instance i413-Kolibri"
    fi
    log "waiting for Engine to register instance i413-Kolibri (dir + id)"
    sleep 4
  done
  KOLIBRI_ID=${line%%$'	'*}
  KOLIBRI_PORT=${line#*$'	'}; KOLIBRI_PORT=${KOLIBRI_PORT%%$'	'*}
  for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if [ -d "/instances/$KOLIBRI_ID/data/kolibri" ]; then
      break
    fi
    sleep 2
  done
  KOLIBRI_DIR=$(instance_dir "$KOLIBRI_ID")
  disable_kolibri_zeroconf "$KOLIBRI_DIR" || true
  if docker inspect "$KOLIBRI_ID-kolibri-1" >/dev/null 2>&1 || docker inspect "${KOLIBRI_ID}-kolibri-1" >/dev/null 2>&1; then
    sudo docker restart "${KOLIBRI_ID}-kolibri-1" >/dev/null 2>&1 || docker restart "${KOLIBRI_ID}-kolibri-1" >/dev/null 2>&1 || true
  fi
  # If the store is still Error after the container is healthy, nudge startInstance.
  # A 90s soft wait (die in a subshell does not abort the parent) avoids sitting
  # on Error for the full 12-minute timeout.
  line=$(wait_for_instance "i413-Kolibri" 90) || true
  if ! printf "%s" "$line" | grep -q $'	'"Running"; then
    log "Engine status is not Running yet; sending startInstance to re-evaluate"
    send_engine "startInstance $KOLIBRI_ID $SYSTEM_DISK_ID"
    line=$(wait_for_instance "i413-Kolibri" 180)
  fi
  KOLIBRI_ID=${line%%$'	'*}
  KOLIBRI_PORT=${line#*$'	'}; KOLIBRI_PORT=${KOLIBRI_PORT%%$'	'*}
  KOLIBRI_DIR=$(instance_dir "$KOLIBRI_ID")
  log "installed i413-Kolibri id=$KOLIBRI_ID port=$KOLIBRI_PORT"


  line=$(install_one "nextcloud@main" "i413-Nextcloud" 1200)
  NEXTCLOUD_ID=${line%%$'\t'*}
  NEXTCLOUD_PORT=${line#*$'\t'}; NEXTCLOUD_PORT=${NEXTCLOUD_PORT%%$'\t'*}
  NEXTCLOUD_DIR=$(instance_dir "$NEXTCLOUD_ID")

  pause_if_hot "before installApp i413-Kiwix"
  send_engine "installApp kiwix@main $SYSTEM_DISK_ID --fresh --name i413-Kiwix"
  # Kiwix is unhealthy until a ZIM is in ./data. Wait for the instance
  # record and directory, copy the stub ZIM, then wait for Running.
  kiwix_wait_start=$(date +%s)
  while true; do
    inspect_store > "$RUN_DIR/store-inspect-latest.json"
    line=$(python3 - "$RUN_DIR/store-inspect-latest.json" "i413-Kiwix" <<'PY2'
import json, sys
data = json.load(open(sys.argv[1]))
name = sys.argv[2]
found = [i for i in (data.get("localInstances") or []) if i.get("name") == name]
if not found:
    sys.exit(2)
pick = found[-1]
print("%s\t%s\t%s" % (pick.get("id") or "", pick.get("port") or 0, pick.get("status") or ""))
PY2
) && break
    if [ $(( $(date +%s) - kiwix_wait_start )) -ge 420 ]; then
      die "timed out waiting for Engine to register instance i413-Kiwix"
    fi
    log "waiting for Engine to register instance i413-Kiwix (dir + id)"
    sleep 4
  done
  KIWIX_ID=${line%%$'	'*}
  KIWIX_PORT=${line#*$'	'}; KIWIX_PORT=${KIWIX_PORT%%$'	'*}
  # Directory may appear slightly after the store record.
  for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if [ -d "/instances/$KIWIX_ID" ]; then
      break
    fi
    sleep 2
  done
  KIWIX_DIR=$(instance_dir "$KIWIX_ID")
  place_kiwix_zim "$KIWIX_DIR"
  # First start is Error until the ZIM exists; compose restart leaves the
  # store in Error even after the containers are healthy. Nudge startInstance.
  line=$(wait_for_instance "i413-Kiwix" 90) || true
  kiwix_st=${line##*$'	'}
  if [ -z "$line" ] || [ "$kiwix_st" != "Running" ]; then
    log "Kiwix store is not Running yet; sending startInstance to re-evaluate"
    send_engine "startInstance $KIWIX_ID $SYSTEM_DISK_ID"
    line=$(wait_for_instance "i413-Kiwix" 180)
  fi
  KIWIX_ID=${line%%$'	'*}
  KIWIX_PORT=${line#*$'	'}; KIWIX_PORT=${KIWIX_PORT%%$'	'*}
  KIWIX_DIR=$(instance_dir "$KIWIX_ID")
  sleep 3

  pause_if_hot "before seeding"
  import_kolibri_slice "$KOLIBRI_DIR"
  python3 "$SEED" kolibri-provision --base "http://127.0.0.1:${KOLIBRI_PORT}" --data-dir "$KOLIBRI_DIR"
  python3 "$SEED" kolibri-view --base "http://127.0.0.1:${KOLIBRI_PORT}"
  disable_nc_firstrun "$NEXTCLOUD_DIR"
  python3 "$SEED" nextcloud-seed --base "http://127.0.0.1:${NEXTCLOUD_PORT}"
  python3 "$SEED" kiwix-seed --base "http://127.0.0.1:${KIWIX_PORT}" --book "$ZIM_BOOK"

  pause_if_hot "before ON hook run"
  local usage_log="${HOME}/.pm2/logs/idea-usage-error.log"
  local mark=0
  [ -f "$usage_log" ] && mark=$(wc -l < "$usage_log")
  ENGINE_ROOT="$ENGINE_ROOT" node "$TRIGGER" --day "$DAY" --sample \
    --out "$RUN_DIR/timings-on.json" \
    --instance-id "$KOLIBRI_ID" \
    --instance-id "$NEXTCLOUD_ID" \
    --instance-id "$KIWIX_ID" \
    | tee "$RUN_DIR/trigger-on.txt"
  if [ -f "$usage_log" ]; then
    tail -n +"$((mark + 1))" "$usage_log" > "$RUN_DIR/logs/idea-usage-on.log" || true
  fi

  # Copy day files (read-only) into the evidence dir.
  mkdir -p "$RUN_DIR/day-files-on"
  local inst f
  for inst in "$KOLIBRI_ID" "$NEXTCLOUD_ID" "$KIWIX_ID"; do
    f="/var/lib/idea/usage/$DAY/${inst}.json"
    if [ -f "$f" ]; then
      cp -a "$f" "$RUN_DIR/day-files-on/${inst}.json"
    else
      log "WARN: missing day file $f"
    fi
    if [ -f "/var/lib/idea/usage/$DAY/${inst}.samples.ndjson" ]; then
      cp -a "/var/lib/idea/usage/$DAY/${inst}.samples.ndjson" "$RUN_DIR/day-files-on/${inst}.samples.ndjson"
    fi
  done
  {
    python3 "$SEED" check-day-file --app kolibri --day "$DAY" --file "$RUN_DIR/day-files-on/${KOLIBRI_ID}.json" || true
    python3 "$SEED" check-day-file --app nextcloud --day "$DAY" --file "$RUN_DIR/day-files-on/${NEXTCLOUD_ID}.json" || true
    python3 "$SEED" check-day-file --app kiwix --day "$DAY" --file "$RUN_DIR/day-files-on/${KIWIX_ID}.json" || true
  } 2>&1 | tee "$RUN_DIR/field-checks.txt"

  # Record mtimes / checksums before the OFF run.
  python3 - "$DAY" "$KOLIBRI_ID" "$NEXTCLOUD_ID" "$KIWIX_ID" "$RUN_DIR/day-files-before-off.json" <<'PY'
import json, os, sys
day, ids, out = sys.argv[1], sys.argv[2:5], sys.argv[5]
root = "/var/lib/idea/usage/" + day
rec = {}
if os.path.isdir(root):
    for name in os.listdir(root):
        p = os.path.join(root, name)
        st = os.stat(p)
        rec[name] = {"mtime": st.st_mtime, "size": st.st_size, "sha256": None}
import hashlib
for name, info in rec.items():
    h = hashlib.sha256()
    with open(os.path.join(root, name), "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    info["sha256"] = h.hexdigest()
json.dump({"day": day, "instances": ids, "files": rec}, open(out,"w"), indent=2)
print("recorded %d files in %s" % (len(rec), root))
PY

  # OFF proof via the live idea-usage process (not the one-shot).
  log "OFF proof: writing usageMonitoring=off, SIGHUP, waiting one settings-poll tick (75s)"
  write_usage_switch off
  local off_mark=0
  [ -f "$usage_log" ] && off_mark=$(wc -l < "$usage_log")
  sighup_idea_usage
  sleep 75
  if [ -f "$usage_log" ]; then
    tail -n +"$((off_mark + 1))" "$usage_log" > "$RUN_DIR/logs/idea-usage-off.log" || true
  fi
  python3 - "$RUN_DIR/day-files-before-off.json" "$RUN_DIR/logs/idea-usage-off.log" "$RUN_DIR/off-proof.txt" <<'PY'
import hashlib, json, os, sys
before = json.load(open(sys.argv[1]))
logpath, out = sys.argv[2], sys.argv[3]
day = before["day"]
root = "/var/lib/idea/usage/" + day
ours = set(before.get("instances") or [])
problems = []
notes = []
# Live files vs recorded checksums / mtimes.
now = {}
if os.path.isdir(root):
    for name in os.listdir(root):
        p = os.path.join(root, name)
        st = os.stat(p)
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        now[name] = {"mtime": st.st_mtime, "size": st.st_size, "sha256": h.hexdigest()}
for name, info in before.get("files", {}).items():
    cur = now.get(name)
    if not cur:
        problems.append("day file disappeared while OFF: %s" % name)
        continue
    if cur["sha256"] != info["sha256"]:
        problems.append("day file %s changed while OFF (sha256)" % name)
    elif cur["mtime"] != info["mtime"]:
        problems.append("day file %s mtime changed while OFF (content same)" % name)
    else:
        notes.append("unchanged: %s" % name)
for name in now:
    if name not in before.get("files", {}):
        # Presence samples might still... no: processTick returns immediately
        # when the switch is off, so even presence should not be appended.
        problems.append("new file appeared while OFF: %s" % name)
logtxt = ""
try:
    logtxt = open(logpath, encoding="utf-8", errors="replace").read()
except OSError:
    logtxt = ""
hookish = [ln for ln in logtxt.splitlines() if "hook stderr" in ln or "hook threw" in ln or "invalid day hook" in ln or "invalid sample hook" in ln]
if hookish:
    problems.append("idea-usage log shows hook activity while OFF: %s" % "; ".join(hookish[:8]))
else:
    notes.append("no hook stderr/threw/invalid lines in the post-SIGHUP idea-usage log")
text = []
if problems:
    text.append("FAIL OFF proof:")
    text.extend("- " + p for p in problems)
    rc = 1
else:
    text.append("PASS no hook ran and no day file changed while usageMonitoring was off")
    rc = 0
text.extend(notes)
open(out, "w").write("\n".join(text) + "\n")
print("\n".join(text))
sys.exit(rc)
PY
  local off_rc=$?
  if [ "$off_rc" = 0 ]; then
    OFF_PROOF_OK=pass
  else
    OFF_PROOF_OK=fail
  fi

  log "restoring usageMonitoring from the backup (exact bytes)"
  restore_settings_from_backup
  sighup_idea_usage
  sleep 2
  if verify_settings_on; then
    ON_RESTORE_OK=pass
  else
    # If the original backup was already the exact ON form, this must pass.
    # If it differed, rewrite the exact Atlas end-state form.
    log "backup was not the exact ON form; writing the Atlas end-state form"
    write_usage_switch on
    chmod 0640 "$SETTINGS_PATH" || true
    chown pi:pi "$SETTINGS_PATH" 2>/dev/null || true
    if verify_settings_on; then
      ON_RESTORE_OK=pass
    else
      ON_RESTORE_OK=fail
    fi
  fi

  # Teardown + image cleanup + after snapshot.
  docker images > "$RUN_DIR/after-images-pre-rm.txt" 2>&1 || true
  teardown
  take_snapshot "$RUN_DIR/after" "after"
  diff_snapshots "$RUN_DIR/before" "$RUN_DIR/after" "$RUN_DIR/diffs"
  {
    echo "removeInstance leftovers (Exited containers docker rm without -v): ${LEFTOVER_AFTER_REMOVE:-none}"
    echo
    echo "image cleanup:"
    cat "$RUN_DIR/image-cleanup.txt" 2>/dev/null || echo "(none)"
    echo
    echo "snapshot diffs:"
    for f in "$RUN_DIR/diffs"/*.diff; do
      [ -f "$f" ] || continue
      if [ -s "$f" ]; then
        echo "### $(basename "$f")"
        cat "$f"
      else
        echo "### $(basename "$f"): no difference"
      fi
    done
  } > "$RUN_DIR/leftovers.txt"

  restore_pm2_from_config
  verify_settings_on

  local verdict="PASS"
  if ! grep -q "PASS kolibri" "$RUN_DIR/field-checks.txt" 2>/dev/null; then verdict="FAIL"; fi
  if ! grep -q "PASS nextcloud" "$RUN_DIR/field-checks.txt" 2>/dev/null; then verdict="FAIL"; fi
  if ! grep -q "PASS kiwix" "$RUN_DIR/field-checks.txt" 2>/dev/null; then verdict="FAIL"; fi
  if [ "$OFF_PROOF_OK" != pass ]; then verdict="FAIL"; fi
  if [ "$ON_RESTORE_OK" != pass ]; then verdict="FAIL"; fi

  export I413_HOST="$HOST" I413_DAY="$DAY" I413_ENGINE_SHA="${ENGINE_SHA:-}" I413_VERDICT="$verdict"
  export I413_OFF="$OFF_PROOF_OK" I413_ON="$ON_RESTORE_OK" I413_CONFIG_NOTE="$CONFIG_NOTE"
  export I413_LEFTOVERS="${LEFTOVER_AFTER_REMOVE:-}" I413_RUN_DIR="$RUN_DIR"
  export I413_KOLIBRI_ID="$KOLIBRI_ID" I413_KOLIBRI_PORT="$KOLIBRI_PORT" I413_KOLIBRI_DIR="$KOLIBRI_DIR"
  export I413_NEXTCLOUD_ID="$NEXTCLOUD_ID" I413_NEXTCLOUD_PORT="$NEXTCLOUD_PORT" I413_NEXTCLOUD_DIR="$NEXTCLOUD_DIR"
  export I413_KIWIX_ID="$KIWIX_ID" I413_KIWIX_PORT="$KIWIX_PORT" I413_KIWIX_DIR="$KIWIX_DIR"
  if [ "$DID_CONFIG" = 1 ]; then
    export I413_PM2_NOTE="pm2 engine and idea-usage restored from pm2.config.cjs (no IDEA_CONFIG_FILE, no IDEA_USAGE_AS_MAIN), pm2 saved"
  else
    export I413_PM2_NOTE="pm2 was left as found (no outside config was applied)"
  fi
  python3 -c '
import json, os
meta = {
  "host": os.environ["I413_HOST"],
  "day": os.environ["I413_DAY"],
  "engine_sha": os.environ.get("I413_ENGINE_SHA") or "",
  "verdict": os.environ["I413_VERDICT"],
  "off_proof": os.environ.get("I413_OFF") or "",
  "on_restore": os.environ.get("I413_ON") or "",
  "config_note": os.environ.get("I413_CONFIG_NOTE") or "",
  "leftovers": os.environ.get("I413_LEFTOVERS") or "",
  "instances": {
    "kolibri": {"id": os.environ.get("I413_KOLIBRI_ID") or "", "port": os.environ.get("I413_KOLIBRI_PORT") or "", "dir": os.environ.get("I413_KOLIBRI_DIR") or ""},
    "nextcloud": {"id": os.environ.get("I413_NEXTCLOUD_ID") or "", "port": os.environ.get("I413_NEXTCLOUD_PORT") or "", "dir": os.environ.get("I413_NEXTCLOUD_DIR") or ""},
    "kiwix": {"id": os.environ.get("I413_KIWIX_ID") or "", "port": os.environ.get("I413_KIWIX_PORT") or "", "dir": os.environ.get("I413_KIWIX_DIR") or ""},
  },
  "end_state": [
    "settings.json verified exactly {\"usageMonitoring\":\"on\"} plus a newline, pi:pi 0640",
    os.environ.get("I413_PM2_NOTE") or "",
    "scratch instances torn down; data moved under %s (not deleted)" % (os.environ.get("I413_RUN_DIR") or ""),
    "leftovers: %s" % (os.environ.get("I413_LEFTOVERS") or "none"),
  ],
}
json.dump(meta, open(os.environ["I413_RUN_DIR"] + "/meta.json", "w"), indent=2)
print("verdict=%s" % meta["verdict"])
'

  write_evidence
  log "PROOF $verdict on $HOST (evidence $RUN_DIR/EVIDENCE.md)"
  [ "$verdict" = PASS ]
}

# --- entry ----------------------------------------------------------------

if [ "$DRY_RUN" = 1 ]; then
  dry_run
  exit 0
fi

trap on_exit EXIT
run_proof
