#!/usr/bin/env bash
# e2e-pi.sh — UNATTENDED end-to-end test of the remote Wi-Fi field test (idea#159) on a POOL TEST PI.
# No humans, no laptops: 3 simulated laptops (sim-laptop.mjs, Node clients) run ON THE PI against the runner.
#
#   ENGINE=idea04 bash e2e-pi.sh                # or ENGINE=pi@<tailscale-ip> with E2E_ALLOW=<hostname>
#   ENGINE=idea04 DRY_RUN=1 bash e2e-pi.sh      # print the commands only
#
# Phases: 0 guard (allowlist) + preflight checks -> 1 preflight via run-remote.sh (expect PASS) ->
#         2 short field run via run-remote.sh (~2.5 min, low load) + result checks ->
#         3 thermal stop in TEST MODE (fake temp 76 -> pause, 64 -> resume, throttled -> abort) on port 3160 ->
#         4 cleanup + verify. Prints PASS/FAIL per phase; exits non-zero on any FAIL.
# Never: kit Engines, wh/'idea', idea01, idea02. No rm -rf, no pkill/pgrep -f, no pm2/systemd for our processes.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENGINE="${ENGINE:?ENGINE=<pool test Pi> (idea03 or idea04, or a host in E2E_ALLOW)}"
E2E_ALLOW="${E2E_ALLOW:-}"
DRY_RUN="${DRY_RUN:-0}"; CHECK_ONLY="${CHECK_ONLY:-0}"
PORT=3159; TPORT=3160; NODE="${NODE:-/usr/local/bin/node}"
OUT="${OUT:-./results/e2e-$(date +%Y%m%d-%H%M%S)}"
DENY_NAMES="happy-zebra sunny-robin kind-panda wh idea idea01 idea02 wizardly-hugle"
# wh/idea, kit Engines + routers (koenswings/idea deployments records), extendable via E2E_DENY_IPS
DENY_IPS="100.115.60.6 100.102.94.100 100.110.73.52 100.96.98.10 100.99.84.61 100.80.238.59 ${E2E_DENY_IPS:-}"
ALLOW_NAMES="idea03 idea04 $E2E_ALLOW"

# ---- guard: deny always wins; allow only by hostname ----
host_of() { local h="${1#*@}"; h="${h%%:*}"; case "$h" in *[a-z]*) echo "${h%%.*}";; *) echo "$h";; esac; }  # pi@idea04.x.ts.net -> idea04
denied() { local x; for x in $DENY_NAMES $DENY_IPS; do [ "$1" = "$x" ] && return 0; done; return 1; }
allowed() { local x; for x in $ALLOW_NAMES; do [ "$1" = "$x" ] && return 0; done; return 1; }
is_ip() { [[ "$1" =~ ^[0-9.]+$ ]]; }
# guard <target> [remote hostname]: a raw IP passes the first (local) check only if not denied; the remote
# hostname must then be allowlisted. Names must be allowlisted directly.
guard() {
  local n; n="$(host_of "$1")"
  denied "$n" && { echo "REFUSED: $1 ($n) is a kit, production, golden or client host"; return 2; }
  if [ -n "${2:-}" ]; then denied "$2" && { echo "REFUSED: $1 is $2 (kit, production, golden or client host)"; return 2; }
    allowed "$2" || { echo "REFUSED: $1 is $2, not on the allowlist ($ALLOW_NAMES)"; return 2; }
    is_ip "$n" || [ "$n" = "$2" ] || { echo "REFUSED: $1 reports hostname $2"; return 2; }; return 0; fi
  is_ip "$n" && return 0
  allowed "$n" || { echo "REFUSED: $1 is not on the allowlist ($ALLOW_NAMES)"; return 2; }
}
guard "$ENGINE" || exit 2
[ "$CHECK_ONLY" = 1 ] && { echo "allowed: $ENGINE"; exit 0; }

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15)
SSH_T="$ENGINE"; case "$ENGINE" in *@*) ;; *) SSH_T="pi@$ENGINE";; esac
run() { if [ "$DRY_RUN" = 1 ]; then printf 'DRY:'; printf ' %q' "$@"; echo; else "$@"; fi; }
essh() { run "${SSH[@]}" "$SSH_T" "$@"; }
eget() { [ "$DRY_RUN" = 1 ] && { echo "${2:-}"; return 0; }; "${SSH[@]}" "$SSH_T" "$1" 2>/dev/null; }
mkdir -p "$OUT"; RESULT=0
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT/e2e.log"; }
verdict() { if [ "$2" = 0 ]; then say "PASS $1"; else say "FAIL $1"; RESULT=1; fi; }
temp() { eget "awk '{printf \"%.1f\", \$1/1000}' /sys/class/thermal/thermal_zone0/temp" 50; }
real_heat_wait() {   # REAL temperature: pause above 75 C until below 65 C (max 20 min)
  local t i=0; t="$(temp)"
  if awk -v t="$t" 'BEGIN{exit !(t>75)}'; then
    while ! awk -v t="$t" 'BEGIN{exit !(t<65)}'; do say "real temp $t C: paused until < 65 C"; sleep 30; t="$(temp)"; i=$((i+1)); [ $i -ge 40 ] && { say "still $t C after 20 min"; return 1; }; done
  fi; return 0
}

# ---- 0. remote guard + facts ----
RHOST="$(eget hostname "$(host_of "$ENGINE")")"; [ -n "$RHOST" ] || { echo "FAIL: cannot reach $SSH_T"; exit 1; }
guard "$ENGINE" "$RHOST" || exit 2
say "target $SSH_T (hostname $RHOST)"
NODE="$(eget "test -x $NODE && echo $NODE || command -v node" "$NODE")"; [ -n "$NODE" ] || { say "FAIL: no node on the Pi"; exit 1; }
KPORT="${KOLIBRI_PORT:-$(eget "docker ps --format '{{.Ports}} {{.Names}}' | grep -i kolibri | grep -o '0.0.0.0:[0-9]*' | head -1 | cut -d: -f2" 18080)}"
[ -n "$KPORT" ] || { say "FAIL: no running Kolibri container found (set KOLIBRI_PORT)"; exit 1; }
MD5="${MD5:-$(eget "find /disks -path '*content/storage*' -name '*.mp4' -size +2M 2>/dev/null | head -1 | xargs -r basename | cut -d. -f1" 0123456789abcdef0123456789abcdef)}"
[[ "$MD5" =~ ^[0-9a-f]{32}$ ]] || { say "FAIL: no Kolibri mp4 found under /disks (set MD5)"; exit 1; }
say "node $NODE, kolibri :$KPORT, video $MD5"
for d in /tmp/i159 /tmp/i159-sim /tmp/i159-thermal; do essh "test ! -e $d" || { say "FAIL: $d exists (quarantine it first)"; exit 1; }; done
PM2_BEFORE="$(eget "pm2 jlist 2>/dev/null | $NODE -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{try{console.log(JSON.parse(s).map(p=>p.name+\":\"+p.pm2_env.status).sort().join(\" \"))}catch{console.log(\"?\")}})'" dry)"
real_heat_wait || exit 1

# sim laptops live in /tmp/i159-sim (run-remote.sh needs /tmp/i159 absent at start); nohup, pid files
SIM=/tmp/i159-sim
essh "mkdir -p $SIM"
run scp -q -o BatchMode=yes "$HERE/sim-laptop.mjs" "$HERE/lib.mjs" "$HERE/runner.mjs" "$HERE/player.html" "$HERE/player.js" "$HERE/preflight.html" "$HERE/preflight.js" "$SSH_T:$SIM/"
sim_start() {   # sim_start <label> <args...>
  local l="$1"; shift
  essh "cd $SIM && nohup $NODE sim-laptop.mjs --laptop $l $* --out $SIM/sim-$l.jsonl > $SIM/sim-$l.out 2>&1 < /dev/null & echo \$! >> $SIM/sim.pids"
}
CONF="$OUT/e2e.conf"
cat > "$CONF" <<C
ENGINE_SSH="$SSH_T"
KOLIBRI_BASE="http://127.0.0.1:$KPORT"
KOLIBRI_LOCAL="http://127.0.0.1:$KPORT"
ENGINE_URLS="http://127.0.0.1:$PORT,http://localhost:$PORT"
LAPTOPS="A B C"
QUALITIES="sim=$MD5:300000"
STEPS="L1:1:1 L3:3:1"
DURATION=45
COOLDOWN=10
SYNTH_N=0
PORT=$PORT
NODE=$NODE
COOL_TIMEOUT=900
CONNECT_TIMEOUT=120
PREFLIGHT_S=30
PREFLIGHT_WAIT=180
C

# ---- 1. preflight (expect PASS) ----
say "phase 1: preflight"
sim_start P --mode preflight --runner http://127.0.0.1:$PORT --pf-s 25 --exit-after-s 120
DRY_RUN="$DRY_RUN" CONF="$CONF" RESULTS="$OUT/preflight" bash "$HERE/run-remote.sh" preflight > "$OUT/preflight.out" 2>&1
verdict "preflight (run-remote.sh preflight exit + verify)" $?
[ "$DRY_RUN" = 1 ] || { grep -q '# Preflight P: PASS' "$OUT/preflight/preflight.md" 2>/dev/null; verdict "preflight verdict PASS for sim laptop" $?; }

# ---- 2. short field run, 3 sim laptops with skewed clocks, B drops and reconnects ----
real_heat_wait || exit 1
say "phase 2: field run (~2.5 min)"
sim_start A --runner http://127.0.0.1:$PORT --skew-ms 0 --rate 300000 --exit-after-s 600
sim_start B --runner http://127.0.0.1:$PORT --skew-ms 3000 --rate 300000 --drop-after-s 10 --exit-after-s 600
sim_start C --runner http://127.0.0.1:$PORT --skew-ms -2000 --rate 300000 --exit-after-s 600
DRY_RUN="$DRY_RUN" CONF="$CONF" RESULTS="$OUT/field" bash "$HERE/run-remote.sh" > "$OUT/field.out" 2>&1
verdict "field run (run-remote.sh exit + verify)" $?
if [ "$DRY_RUN" != 1 ]; then
  node "$HERE/check-e2e.mjs" field "$OUT/field" "A B C" 500 | tee -a "$OUT/e2e.log"; verdict "field results: all logs, clocks aligned, summarise" "${PIPESTATUS[0]}"
  grep -q '"ev":"reconnect"' "$OUT/field/runner.log"; verdict "reconnect seen (B dropped its event stream)" $?
fi

# ---- 3. thermal stop in TEST MODE (fake sources; production default unchanged) ----
real_heat_wait || exit 1
say "phase 3: thermal stop (test mode, port $TPORT)"
TH=/tmp/i159-thermal
essh "mkdir -p $TH && cp $SIM/runner.mjs $SIM/lib.mjs $SIM/player.html $SIM/player.js $SIM/preflight.html $SIM/preflight.js $TH/ && echo 50000 > $TH/fake-temp && echo 0x0 > $TH/fake-throttled && cd $TH && I159_TEST_MODE=1 I159_TEMP_FILE=$TH/fake-temp I159_THROTTLE_FILE=$TH/fake-throttled I159_THERMAL_MS=500 nohup $NODE runner.mjs --dir $TH --port $TPORT > $TH/runner.out 2>&1 < /dev/null & sleep 2; cat $TH/runner.pid"
sim_start T --runner http://127.0.0.1:$TPORT --rate 100000 --exit-after-s 120
ctl() { eget "curl -s -m 10 ${2:+-X POST -d '$2'} http://127.0.0.1:$TPORT/control/$1" '{"paused":true,"aborted":"x"}'; }
until_status() { local i; for i in $(seq 1 20); do ctl status | grep -q "$1" && return 0; [ "$DRY_RUN" = 1 ] && return 0; sleep 1; done; return 1; }
until_status '"laptop":"T","tab":1,"connected":true'
ctl start "{\"quality\":\"sim\",\"step\":\"TH\",\"md5\":\"$MD5\",\"url\":\"http://127.0.0.1:$KPORT/content/storage/${MD5:0:1}/${MD5:1:1}/$MD5.mp4\",\"laptops\":[\"T\"],\"tabs\":1,\"duration\":60,\"leadMs\":1000}" >/dev/null
sleep 3
essh "echo 76000 > $TH/fake-temp"; until_status '"paused":true'; verdict "thermal: 76 C -> paused" $?
essh "echo 64000 > $TH/fake-temp"; until_status '"paused":false'; verdict "thermal: 64 C -> resumed" $?
essh "echo 0x50000 > $TH/fake-throttled"; until_status '"aborted":"throttled=0x50000"'; verdict "thermal: throttled -> aborted" $?
run scp -q -o BatchMode=yes "$SSH_T:$TH/runner.log" "$OUT/thermal-runner.log"
[ "$DRY_RUN" = 1 ] || { node "$HERE/check-e2e.mjs" thermal "$OUT/thermal-runner.log" | tee -a "$OUT/e2e.log"; verdict "thermal log order (pause > resume > abort)" "${PIPESTATUS[0]}"; }
run scp -q -o BatchMode=yes "$SSH_T:$SIM/sim-*.jsonl" "$OUT/" 2>/dev/null
[ "$DRY_RUN" = 1 ] || { grep -q '"type":"pause"' "$OUT/sim-T.jsonl" && grep -q '"type":"resume"' "$OUT/sim-T.jsonl" && grep -q '"type":"stop"' "$OUT/sim-T.jsonl"; verdict "sim laptop received pause, resume, stop" $?; }

# ---- 4. cleanup (kill pid files, quarantine by mv) + verify ----
say "phase 4: cleanup + verify"
STAMP="$(date +%Y%m%d-%H%M%S)"
essh "kill \$(cat $TH/runner.pid) 2>/dev/null; for p in \$(cat $SIM/sim.pids 2>/dev/null); do kill \$p 2>/dev/null; done; sleep 2; true"
essh "mv $TH $TH.quarantine-$STAMP && mv $SIM $SIM.quarantine-$STAMP"
essh "! (ss -ltn | grep -qE ':($PORT|$TPORT) ')"; verdict "no listener on $PORT/$TPORT" $?
essh "for p in \$(cat $SIM.quarantine-$STAMP/sim.pids) \$(cat $TH.quarantine-$STAMP/runner.pid); do ps -p \$p >/dev/null && exit 1; done; exit 0"; verdict "all sim and runner pids gone" $?
essh "test ! -e /tmp/i159 && test ! -e $SIM && test ! -e $TH && ls -d /tmp/i159.quarantine-* $SIM.quarantine-$STAMP $TH.quarantine-$STAMP >/dev/null"; verdict "/tmp/i159* moved to quarantine" $?
PM2_AFTER="$(eget "pm2 jlist 2>/dev/null | $NODE -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{try{console.log(JSON.parse(s).map(p=>p.name+\":\"+p.pm2_env.status).sort().join(\" \"))}catch{console.log(\"?\")}})'" dry)"
[ "$PM2_BEFORE" = "$PM2_AFTER" ]; verdict "pm2 jlist unchanged ($PM2_AFTER)" $?
h="$(eget "curl -s -o /dev/null -w '%{http_code}' -m 15 http://127.0.0.1:$KPORT/" 200)"; th="$(eget "vcgencmd get_throttled | sed 's/.*=//'" 0x0)"
{ [ "${h:0:1}" = 2 ] || [ "${h:0:1}" = 3 ]; } && [ "$th" = 0x0 ]; verdict "Engine healthy (kolibri $h, throttled $th, $(temp) C)" $?

if [ "$RESULT" = 0 ]; then say "E2E PASS ($OUT)"; else say "E2E FAIL ($OUT)"; fi
exit "$RESULT"
