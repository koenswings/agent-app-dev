#!/usr/bin/env bash
# run-remote.sh — run the Kolibri Wi-Fi field test (idea#159) from our side over Tailscale.
# Teachers only do the setup (WIFI-FIELD-TEST-REMOTE.md §2). Everything here is remote.
#
#   CONF=./field.conf bash run-remote.sh            # full run
#   CONF=./field.conf DRY_RUN=1 bash run-remote.sh  # print the commands only
#
# field.conf (see field.conf.example) sets: KOLIBRI_BASE, PI_SSH, LAPTOPS, QUALITIES, STEPS, and optional
# SSH_JUMP, LAUNCH_PREFIX, SYNTH_N, DURATION, COOLDOWN, RESULTS. No secrets live in it: SSH uses your agent/keys.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CONF="${CONF:?set CONF=path/to/field.conf}"
# shellcheck source=/dev/null
. "$CONF"
: "${KOLIBRI_BASE:?}" "${PI_SSH:?}" "${LAPTOPS:?}" "${QUALITIES:?}"
STEPS="${STEPS:-L1:1:1 L2:2:1 L3:3:1 L4:4:1 T2:4:2 T3:4:3 T4:4:4}"   # name:laptops:tabs-per-laptop
DURATION="${DURATION:-180}"
COOLDOWN="${COOLDOWN:-120}"
SYNTH_N="${SYNTH_N:-0}"            # extra synthetic streams from the Pi during every step (0 = off)
SSH_JUMP="${SSH_JUMP:-}"           # e.g. root@<router-tailscale-ip> if laptops are not on the tailnet themselves
LAUNCH_PREFIX="${LAUNCH_PREFIX:-}" # e.g. 'sudo -n -u learner env XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0'
RESULTS="${RESULTS:-./results/i159-$(date +%Y%m%d-%H%M)}"
REMOTE_DIR="${REMOTE_DIR:-/var/tmp/i159}"
DRY_RUN="${DRY_RUN:-0}"
PI_LOCAL_URL="${PI_LOCAL_URL:-http://127.0.0.1:${KOLIBRI_BASE##*:}}"

case "$KOLIBRI_BASE" in
  *//100.*|*.ts.net*) echo "KOLIBRI_BASE must be the LAN name/IP (<sticker>.local), not Tailscale" >&2; exit 2;;
esac

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15)
[ -n "$SSH_JUMP" ] && SSH_OPTS+=(-J "$SSH_JUMP")
run() { if [ "$DRY_RUN" = 1 ]; then printf 'DRY:'; printf ' %q' "$@"; echo; else "$@"; fi; }
rssh() { local host="$1"; shift; run ssh "${SSH_OPTS[@]}" "$host" "$@"; }
pissh() { run ssh -o BatchMode=yes -o ConnectTimeout=15 "$PI_SSH" "$@"; }   # Pi: direct over Tailscale, no jump
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RESULTS/run.log"; }

mkdir -p "$RESULTS"
read -r -a LAPTOP_LIST <<<"$LAPTOPS"   # "A=admin@idea-pc-fc95 B=admin@idea-pc-7d02 ..."

pi_temp() { ssh -o BatchMode=yes "$PI_SSH" "vcgencmd measure_temp" 2>/dev/null | sed -E 's/[^0-9.]//g'; }
wait_cool() {
  [ "$DRY_RUN" = 1 ] && return 0
  local t; t="$(pi_temp)"
  while [ -n "$t" ] && awk -v t="$t" 'BEGIN{exit !(t>=65)}'; do log "Pi ${t} C >= 65, waiting"; sleep 30; t="$(pi_temp)"; done
}
too_hot() { [ "$DRY_RUN" = 1 ] && return 1; local t; t="$(pi_temp)"; [ -n "$t" ] && awk -v t="$t" 'BEGIN{exit !(t>75)}'; }

# 1. Preflight + push the player to each laptop (Node >= 22 and Chrome are checked, not installed).
for kv in "${LAPTOP_LIST[@]}"; do
  label="${kv%%=*}"; host="${kv#*=}"
  log "preflight $label ($host)"
  rssh "$host" "mkdir -p $REMOTE_DIR && node --version && (google-chrome --version || chromium --version) && curl -s -o /dev/null -w 'kolibri %{http_code} %{time_total}s\n' $KOLIBRI_BASE/ && (iw dev 2>/dev/null | awk '/Interface/{print \$2}' | xargs -r -I{} iw dev {} link || true)" \
    | tee "$RESULTS/preflight-$label.txt"
  run scp -q "${SSH_OPTS[@]}" "$HERE/play-and-log.mjs" "$HERE/lib.mjs" "$host:$REMOTE_DIR/"
done

# 2. Pi log (same fields as WIFI-FIELD-TEST.md §4.3), started over Tailscale.
log "starting Pi log on $PI_SSH"
# shellcheck disable=SC2016  # expanded on the Pi
pissh 'nohup bash -c '\''while true; do echo "=== $(date -Iseconds) $(vcgencmd measure_temp) $(vcgencmd get_throttled)"; vmstat 1 2 | tail -1; free -m | awk "/Mem:/{print \"mem_used_mb=\"\$3\" mem_avail_mb=\"\$7}"; uptime; sleep 10; done'\'' > ~/i159-wifi-remote.log 2>&1 & echo $! > ~/i159-wifi-remote.pid'
[ "$SYNTH_N" -gt 0 ] && run scp -q "$HERE/../scripts/kolibri_stream_loadtest.py" "$PI_SSH:/tmp/"

# 3. Steps per quality.
for q in $QUALITIES; do                       # "360p=<md5>:<bps> 480p=..."
  name="${q%%=*}"; rest="${q#*=}"; md5="${rest%%:*}"; bps="${rest#*:}"
  wait_cool
  for st in $STEPS; do
    IFS=: read -r sname nlap ntabs <<<"$st"
    [ "$nlap" -gt "${#LAPTOP_LIST[@]}" ] && { log "skip $name $sname (only ${#LAPTOP_LIST[@]} laptops)"; continue; }
    start_at=$(( $(date +%s) + 20 ))
    log "$name $sname: $nlap laptops x $ntabs tabs, synthetic $SYNTH_N, start $(date -d "@$start_at" +%H:%M:%S)"
    pids=()
    for kv in "${LAPTOP_LIST[@]:0:$nlap}"; do
      label="${kv%%=*}"; host="${kv#*=}"
      rssh "$host" "cd $REMOTE_DIR && $LAUNCH_PREFIX node play-and-log.mjs --base $KOLIBRI_BASE --md5 $md5 --quality $name --laptop $label --step $sname --tabs $ntabs --duration $DURATION --start-at $start_at --out $REMOTE_DIR/out" \
        > "$RESULTS/stdout-$label-$name-$sname.txt" 2>&1 & pids+=($!)
    done
    if [ "$SYNTH_N" -gt 0 ]; then
      url="$PI_LOCAL_URL/content/storage/${md5:0:1}/${md5:1:1}/$md5.mp4"
      pissh "sleep $(( start_at - $(date +%s) )); python3 /tmp/kolibri_stream_loadtest.py --url $url --n $SYNTH_N --duration $DURATION --bitrate-bps $bps --out-dir /tmp/i159-synth --tag $name-$sname-n$SYNTH_N" \
        > "$RESULTS/synth-$name-$sname.txt" 2>&1 & pids+=($!)
    fi
    fail=0; for p in "${pids[@]}"; do wait "$p" || fail=1; done
    [ "$fail" = 1 ] && log "WARN: a laptop/synth job exited non-zero in $name $sname (see stdout-*)"
    if too_hot; then log "Pi above 75 C: hard fail (Pi overheating), stopping this quality"; break; fi
  done
  log "cooldown ${COOLDOWN}s"; [ "$DRY_RUN" = 1 ] || sleep "$COOLDOWN"
done

# 4. Collect, stop the Pi log, summarise.
for kv in "${LAPTOP_LIST[@]}"; do
  label="${kv%%=*}"; host="${kv#*=}"
  mkdir -p "$RESULTS/$label"
  run scp -q -r "${SSH_OPTS[@]}" "$host:$REMOTE_DIR/out/." "$RESULTS/$label/" || log "WARN: collect failed for $label"
done
# shellcheck disable=SC2016  # expanded on the Pi
pissh 'kill "$(cat ~/i159-wifi-remote.pid)" 2>/dev/null; rm -f ~/i159-wifi-remote.pid'
run scp -q "$PI_SSH:~/i159-wifi-remote.log" "$RESULTS/pi.log" || true
[ "$SYNTH_N" -gt 0 ] && { run scp -q -r "$PI_SSH:/tmp/i159-synth" "$RESULTS/synth" || true; }
[ "$DRY_RUN" = 1 ] || node "$HERE/summarise.mjs" "$RESULTS"
log "done: $RESULTS"
