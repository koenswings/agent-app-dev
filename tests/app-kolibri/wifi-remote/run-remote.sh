#!/usr/bin/env bash
# run-remote.sh — Kolibri Wi-Fi field test (idea#159), option B: player page served by a temporary runner on the Engine.
# We reach ONLY the Engine, directly over Tailscale (never a jump host). Laptops need nothing installed: a teacher
# opens http://<engine>.local:3159/?laptop=A (fallback http://10.42.0.x:3159/?laptop=A) and clicks Start.
# Pull model: the router REJECTs Engine->laptop, so the page opens every connection; the runner never dials laptops.
#
#   CONF=./field.conf bash run-remote.sh preflight  # FIRST: ~2 min teacher check on one laptop (/preflight)
#   CONF=./field.conf bash run-remote.sh            # full run (only if preflight passed)
#   CONF=./field.conf DRY_RUN=1 bash run-remote.sh  # print the commands only
#
# NEVER on a kit Engine without Koen's go (separate idea#375 item). Build/test on pool or test hardware only.
# Cleanup rule (Atlas): no rm -rf, no pkill -f/pgrep -f, no pm2, no systemd. nohup + pid file; stop with
# kill $(cat pidfile); quarantine /tmp/i159 by mv. A verify step proves port closed, pid gone, pm2 unchanged, Engine healthy.
set -euo pipefail
MODE="${1:-field}"; case "$MODE" in preflight|field) ;; *) echo "usage: run-remote.sh [preflight|field]" >&2; exit 2;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
CONF="${CONF:?set CONF=path/to/field.conf}"
# shellcheck source=/dev/null
. "$CONF"
: "${ENGINE_SSH:?}" "${KOLIBRI_BASE:?}" "${LAPTOPS:?}" "${QUALITIES:?}"
STEPS="${STEPS:-L1:1:1 L2:2:1 L3:3:1 L4:4:1 T2:4:2 T3:4:3 T4:4:4}"   # name:laptops:tabs-per-laptop
DURATION="${DURATION:-180}"; COOLDOWN="${COOLDOWN:-120}"; SYNTH_N="${SYNTH_N:-0}"
PORT="${PORT:-3159}"; NODE="${NODE:-/usr/local/bin/node}"
COOL_TIMEOUT="${COOL_TIMEOUT:-1800}"   # max wait for the Engine to drop under 65 C before a quality starts
CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-600}"
RESULTS="${RESULTS:-./results/i159-${1:-field}-$(date +%Y%m%d-%H%M)}"
R=/tmp/i159; DRY_RUN="${DRY_RUN:-0}"
ENGINE_URLS="${ENGINE_URLS:-}"     # preflight: "http://<engine>.local:3159,http://10.42.0.x:3159"
PREFLIGHT_WAIT="${PREFLIGHT_WAIT:-900}"; PREFLIGHT_S="${PREFLIGHT_S:-120}"
KOLIBRI_LOCAL="${KOLIBRI_LOCAL:-http://127.0.0.1:${KOLIBRI_BASE##*:}}"
[ "$PORT" -ge 3000 ] || { echo "PORT must be >= 3000" >&2; exit 2; }
case "$ENGINE_SSH" in *" -J"*|*ProxyJump*) echo "no jump hosts: ENGINE_SSH must be the Engine's Tailscale address" >&2; exit 2;; esac
case "$KOLIBRI_BASE" in *//100.*|*.ts.net*) echo "KOLIBRI_BASE must be the LAN name/IP the laptops use, not Tailscale" >&2; exit 2;; esac

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15)
run() { if [ "$DRY_RUN" = 1 ]; then printf 'DRY:'; printf ' %q' "$@"; echo; else "$@"; fi; }
essh() { run "${SSH[@]}" "$ENGINE_SSH" "$@"; }
eget() { [ "$DRY_RUN" = 1 ] && { echo "${2:-}"; return 0; }; "${SSH[@]}" "$ENGINE_SSH" "$1" 2>/dev/null || true; }
mkdir -p "$RESULTS"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RESULTS/run.log"; }
ctl() { eget "curl -s -m 10 -X ${2:-GET} ${3:+-d '$3'} http://127.0.0.1:$PORT/control/$1" '{"at":0,"players":0}'; }

temp() { eget "awk '{printf \"%.1f\", \$1/1000}' /sys/class/thermal/thermal_zone0/temp" 50; }
throttled() { eget "vcgencmd get_throttled | sed 's/.*=//'" 0x0; }
pm2_names() { eget "pm2 jlist 2>/dev/null | NODE_PATH= $NODE -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{try{console.log(JSON.parse(s).map(p=>p.name+\":\"+p.pm2_env.status).sort().join(\" \"))}catch{console.log(\"?\")}})'" "dry"; }
cool_wait() {   # Engines idle ~67 C: wait for < 65 C before starting, with a timeout and a clear message
  local t0 t; t0=$(date +%s)
  while :; do
    t="$(temp)"; awk -v t="$t" 'BEGIN{exit !(t<65)}' && return 0
    [ $(( $(date +%s) - t0 )) -ge "$COOL_TIMEOUT" ] && { log "ABORT: Engine still ${t} C after ${COOL_TIMEOUT}s cool-down (needs < 65 C). Nothing started for this quality."; return 1; }
    log "Engine ${t} C, waiting for < 65 C"; sleep 30
  done
}
stop_all() {
  log "stopping runner and Pi log"
  essh "kill \$(cat $R/runner.pid) 2>/dev/null; kill \$(cat $R/pilog.pid) 2>/dev/null; sleep 2; true"
}
trap 'stop_all || true' INT TERM

# 0. Preflight on the Engine: node, throttling, health, pm2 baseline, port free.
read -r -a LAPTOP_LIST <<<"$LAPTOPS"   # "A B C D" (labels the teachers type on the page)
NODE_R="$(eget "test -x $NODE && echo $NODE || command -v node" "$NODE")"; [ -n "$NODE_R" ] || { log "no node on the Engine"; exit 3; }
NODE="$NODE_R"
log "preflight $ENGINE_SSH node=$NODE $(eget "$NODE --version" v22)"
[ "$(throttled)" = 0x0 ] || { log "ABORT: Engine throttled=$(throttled) (must be 0x0)"; exit 3; }
PM2_BEFORE="$(pm2_names)"; echo "$PM2_BEFORE" > "$RESULTS/pm2-before.txt"
essh "test ! -e $R || { echo '$R exists; quarantine it first'; exit 1; }; ! (ss -ltn | grep -q ':$PORT ')"
essh "curl -s -o /dev/null -w 'kolibri %{http_code} %{time_total}s\n' $KOLIBRI_LOCAL/" | tee "$RESULTS/preflight-engine.txt"

q1="${QUALITIES%% *}"; m1="${q1#*=}"; m1="${m1%%:*}"
PF_ARGS="--pf-urls ${ENGINE_URLS:-none} --pf-video ${KOLIBRI_BASE%/}/content/storage/${m1:0:1}/${m1:1:1}/$m1.mp4"
# 1. Copy the runner to /tmp/i159 and start it with nohup (not pm2, not systemd).
essh "mkdir -p $R"
run scp -q -o BatchMode=yes "$HERE/runner.mjs" "$HERE/lib.mjs" "$HERE/player.html" "$HERE/player.js" "$HERE/preflight.html" "$HERE/preflight.js" "$ENGINE_SSH:$R/"
[ "$SYNTH_N" -gt 0 ] && run scp -q -o BatchMode=yes "$HERE/../scripts/kolibri_stream_loadtest.py" "$ENGINE_SSH:$R/"
essh "cd $R && nohup $NODE runner.mjs --dir $R --port $PORT $PF_ARGS > $R/runner.out 2>&1 < /dev/null & sleep 2; cat $R/runner.pid"
# Pi log (same fields as WIFI-FIELD-TEST.md §4.3), into /tmp/i159 as well.
# shellcheck disable=SC2016
essh 'nohup bash -c '\''while true; do echo "=== $(date -Iseconds) $(vcgencmd measure_temp) $(vcgencmd get_throttled)"; vmstat 1 2 | tail -1; free -m | awk "/Mem:/{print \"mem_used_mb=\"\$3\" mem_avail_mb=\"\$7}"; uptime; sleep 10; done'\'' > '$R'/pi.log 2>&1 < /dev/null & echo $! > '$R'/pilog.pid'

aborted=0
if [ "$MODE" = preflight ]; then
  log "PREFLIGHT: teacher opens $(echo "${ENGINE_URLS:-http://<engine>.local:$PORT}" | cut -d, -f1)/preflight?laptop=A&s=$PREFLIGHT_S (fallback: the second ENGINE_URLS entry) and clicks Start check"
  t0=$(date +%s)
  while [ "$DRY_RUN" != 1 ]; do
    ctl preflight | grep -q '"pass":' && break
    [ $(( $(date +%s) - t0 )) -ge "$PREFLIGHT_WAIT" ] && { log "no preflight result after ${PREFLIGHT_WAIT}s"; aborted=1; break; }
    sleep 10
  done
else
# 2. Wait for the teachers' pages to connect (they open the URL and click Start).
log "waiting for players: ${LAPTOP_LIST[*]} at http://<engine>.local:$PORT/?laptop=X (fallback http://10.42.0.x:$PORT/?laptop=X)"
t0=$(date +%s)
while [ "$DRY_RUN" != 1 ]; do
  st="$(ctl status)"; ok=1
  for l in "${LAPTOP_LIST[@]}"; do echo "$st" | grep -q "\"laptop\":\"$l\",\"tab\":1,\"connected\":true" || ok=0; done
  [ "$ok" = 1 ] && break
  [ $(( $(date +%s) - t0 )) -ge "$CONNECT_TIMEOUT" ] && { log "not all laptops connected after ${CONNECT_TIMEOUT}s; continuing with the ones that are"; break; }
  sleep 10
done

# 3. Steps per quality. The runner pauses players + ramp above 75 C, resumes below 65 C, aborts if throttled.
for q in $QUALITIES; do                       # "360p=<md5>:<bps> 480p=..."
  name="${q%%=*}"; rest="${q#*=}"; md5="${rest%%:*}"
  url="${KOLIBRI_BASE%/}/content/storage/${md5:0:1}/${md5:1:1}/$md5.mp4"
  cool_wait || { aborted=1; break; }
  for st in $STEPS; do
    IFS=: read -r sname nlap ntabs <<<"$st"
    [ "$nlap" -gt "${#LAPTOP_LIST[@]}" ] && continue
    laps="$(printf '"%s",' "${LAPTOP_LIST[@]:0:$nlap}")"; laps="[${laps%,}]"
    ramp=""
    if [ "$SYNTH_N" -gt 0 ]; then   # gentle: ramp only on the last (heaviest) steps, modest stream count
      ramp="python3 $R/kolibri_stream_loadtest.py --url $KOLIBRI_LOCAL/content/storage/${md5:0:1}/${md5:1:1}/$md5.mp4 --n $SYNTH_N --duration $DURATION"
    fi
    body="{\"quality\":\"$name\",\"step\":\"$sname\",\"md5\":\"$md5\",\"url\":\"$url\",\"laptops\":$laps,\"tabs\":$ntabs,\"duration\":$DURATION,\"synthN\":$SYNTH_N,\"rampCmd\":\"$ramp\"}"
    log "step $name $sname: $nlap laptop(s) x $ntabs tab(s) -> $(ctl start POST "$body")"
    [ "$DRY_RUN" = 1 ] || sleep $(( DURATION + 15 ))
    st_now="$(ctl status)"; echo "$st_now" | grep -q '"aborted":"' && { log "ABORT from runner: $st_now"; aborted=1; break 2; }
    [ "$DRY_RUN" = 1 ] || sleep "$COOLDOWN"
  done
done

fi

# 4. Collect, stop, quarantine, verify.
log "collecting results"
run scp -q -r -o BatchMode=yes "$ENGINE_SSH:$R/results" "$ENGINE_SSH:$R/runner.log" "$ENGINE_SSH:$R/thermal.log" "$ENGINE_SSH:$R/pi.log" "$RESULTS/" || true
stop_all; trap - INT TERM
Q="$R.quarantine-$(date +%Y%m%d-%H%M%S)"
essh "mv $R $Q && echo quarantined: $Q"
log "verify"
PM2_AFTER="$(pm2_names)"; echo "$PM2_AFTER" > "$RESULTS/pm2-after.txt"
fail=0
essh "! (ss -ltn | grep -q ':$PORT ')" && log "ok: nothing listens on $PORT" || { log "FAIL: port $PORT still open"; fail=1; }
essh "! test -e $R && ! ps -p \$(cat $Q/runner.pid) >/dev/null && ! ps -p \$(cat $Q/pilog.pid) >/dev/null" \
  && log "ok: runner and Pi-log pids gone, $R moved to quarantine" || { log "FAIL: a pid is alive or $R still exists"; fail=1; }
[ "$PM2_BEFORE" = "$PM2_AFTER" ] && log "ok: pm2 unchanged ($PM2_AFTER)" || { log "FAIL: pm2 changed: before [$PM2_BEFORE] after [$PM2_AFTER]"; fail=1; }
h="$(eget "curl -s -o /dev/null -w '%{http_code}' -m 15 $KOLIBRI_LOCAL/" 200)"; th="$(throttled)"
{ [ "${h:0:1}" = 2 ] || [ "${h:0:1}" = 3 ]; } && [ "$th" = 0x0 ] && log "ok: Engine healthy (kolibri $h, throttled $th, $(temp) C)" || { log "FAIL: Engine health kolibri=$h throttled=$th"; fail=1; }
if [ "$MODE" = preflight ]; then
  pf=0; [ "$DRY_RUN" = 1 ] || { node "$HERE/summarise.mjs" --preflight "$RESULTS" | tee -a "$RESULTS/run.log"; pf=${PIPESTATUS[0]}; }
  [ "$pf" = 0 ] || aborted=1
else
  [ "$DRY_RUN" = 1 ] || node "$HERE/summarise.mjs" "$RESULTS" || true
fi
log "done: results in $RESULTS (aborted=$aborted verify_fail=$fail)"
exit $(( aborted || fail ))
