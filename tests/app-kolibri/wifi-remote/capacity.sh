#!/usr/bin/env bash
# capacity.sh: UNATTENDED Kolibri serving-capacity measurement (idea#159, CAPACITY-PLAN.md).
# Server = a POOL Pi running a throwaway Kolibri compose; load host = another pool Pi running the paced
# streams (sim-laptop.mjs --mode load) and the API probe over the fleet LAN. Driven from the box over SSH.
#
#   SERVER=idea03 LOADGEN=idea04 bash capacity.sh             # real run (claim both Pis in fleet-state first)
#   SERVER=idea03 LOADGEN=idea04 DRY_RUN=1 bash capacity.sh   # print the commands only
#
# Run 2 defaults (#159): MODE=step STEPS="48 50 52 56 60 64" (pin the break; MODE=ramp = run 1's NS ramp),
# THREAD_POOL="default 128" (one full pass per pool: "default" = image as shipped; a number sets Kolibri's
# [Server] CHERRYPY_THREAD_POOL via KOLIBRI_CHERRYPY_THREAD_POOL and raises the container nofile to NOFILE,
# because Kolibri caps its default pool at (soft nofile - 64) // 19 = 50 at nofile 1024), CAP_S=14400 (4 h)
# for the synthetic qualities, and the real channel video as its own phase per pool with its own REAL_CAP.
#
# Phases: 0 guards + before-state (both Pis) -> 1 throwaway Kolibri (own compose project, port >= 3000,
# scratch under /home/pi, never /disks) + content (#159 fixtures + one real public channel video) ->
# 2 per quality: ramp N (1..128, on to 256 only if 128 is SAFE), 1 retry of a failing step ->
# 3 cleanup (kill pid files, compose down -v, remove a pulled image, quarantine by mv) + release checks
# (docker ps -a, docker images, pm2 jlist, lsblk, losetup identical; no listener) -> REPORT.md.
# Stop rules: real temp > 75 C pauses the load (SIGSTOP) until < 65 C and fails the step; throttled != 0x0
# aborts; Kolibri down / OOM / Engine not online aborts; CAP_S (4 h) cap on the synthetic qualities, REAL_CAP per real phase. The Engine is never stopped.
# Never: kit Engines, wh/'idea', idea01, idea02; no rm -rf, no pkill/pgrep -f, no pm2/systemd for our processes.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER="${SERVER:?SERVER=<pool Pi> (idea03)}"; LOADGEN="${LOADGEN:?LOADGEN=<pool Pi> (idea04)}"
DRY_RUN="${DRY_RUN:-0}"; CHECK_ONLY="${CHECK_ONLY:-0}"
STAMP="$(date +%Y%m%d-%H%M%S)"; OUT="${OUT:-./results/cap-$STAMP}"
KPORT="${KPORT:-3190}"; IMAGE="${IMAGE:-koenswings/kolibri:1.1-0.19.5}"; NODE="${NODE:-/usr/local/bin/node}"
FIXTURES="${FIXTURES:-/workspace/i159/content/qualities}"     # #159 test videos + manifest.json (on the box)
QUALITIES="${QUALITIES:-low_360p med_480p 720p high_1080p real}"
REAL_CHANNEL="${REAL_CHANNEL:-c9d7f950ab6b5a1199e3d6c10d7f0103}"   # Khan Academy (English - US), public
REAL_NODE="${REAL_NODE:-ef35763056fe5113946710a750e4e75c}"         # "Visually adding fractions: 5/6+1/4"
REAL_MD5="${REAL_MD5:-0d6955991681b56bb5dfc9fa777e355d}"; REAL_BPS="${REAL_BPS:-}"
HOLD_S="${HOLD_S:-120}"; RAMP_S="${RAMP_S:-15}"; SETTLE_S="${SETTLE_S:-30}"; CAP_S="${CAP_S:-14400}"; COOL_TIMEOUT="${COOL_TIMEOUT:-900}"
NS="${NS:-1 2 4 8 12 16 24 32 48 64 96 128}"; NS_EXT="${NS_EXT:-160 192 256}"
MODE="${MODE:-step}"; STEPS="${STEPS:-48 50 52 56 60 64}"; THREAD_POOL="${THREAD_POOL:-default 128}"; NOFILE="${NOFILE:-65536}"
REAL_CAP="${REAL_CAP:-2400}"
case "$MODE" in step|ramp) ;; *) echo "MODE must be step or ramp"; exit 2;; esac
for p in $THREAD_POOL; do [ "$p" = default ] || { [[ "$p" =~ ^[0-9]+$ ]] && [ "$p" -ge 1 ] && [ "$p" -le 1000 ]; } || { echo "THREAD_POOL entries: default or 1..1000 (got $p)"; exit 2; }; done
[ "$KPORT" -ge 3000 ] || { echo "KPORT must be >= 3000"; exit 2; }

source "$HERE/pi-guard.sh"
guard "$SERVER" || exit 2; guard "$LOADGEN" || exit 2
[ "$(host_of "$SERVER")" != "$(host_of "$LOADGEN")" ] || { echo "REFUSED: SERVER and LOADGEN must be different Pis"; exit 2; }
[ "$CHECK_ONLY" = 1 ] && { echo "allowed: server $SERVER, load host $LOADGEN"; exit 0; }

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15)
tgt() { case "$1" in *@*) echo "$1";; *) echo "pi@$1";; esac; }
S_T="$(tgt "$SERVER")"; L_T="$(tgt "$LOADGEN")"
run() { if [ "$DRY_RUN" = 1 ]; then printf 'DRY:'; printf ' %q' "$@"; echo; else "$@"; fi; }
s_ssh() { run "${SSH[@]}" "$S_T" "$@"; }
l_ssh() { run "${SSH[@]}" "$L_T" "$@"; }
s_get() { [ "$DRY_RUN" = 1 ] && { echo "${2:-}"; return 0; }; "${SSH[@]}" "$S_T" "$1" 2>/dev/null; }
l_get() { [ "$DRY_RUN" = 1 ] && { echo "${2:-}"; return 0; }; "${SSH[@]}" "$L_T" "$1" 2>/dev/null; }
mkdir -p "$OUT"; T0=$(date +%s); ABORT=""; RESULT=0
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT/capacity.log"; }
check() { if [ "$2" = 0 ]; then say "PASS $1"; echo "$1|PASS" >> "$OUT/release.txt"; else say "FAIL $1"; echo "$1|FAIL" >> "$OUT/release.txt"; RESULT=1; fi; }
temp() { s_get "awk '{printf \"%.1f\", \$1/1000}' /sys/class/thermal/thermal_zone0/temp" 50; }
throttled() { s_get "vcgencmd get_throttled | sed 's/.*=//'" 0x0; }
gt() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a>b)}'; }
cool_wait() {   # real temperature: wait until < 65 C (COOL_TIMEOUT), abort on throttle
  local t i=0; t="$(temp)"
  while gt "$t" 64.99; do [ $i -ge $((COOL_TIMEOUT / 15)) ] && { ABORT="still $t C after ${COOL_TIMEOUT}s cool-wait"; return 1; }; say "cool-wait: $t C (< 65 C)"; sleep 15; i=$((i+1)); t="$(temp)"; done
  [ "$(throttled)" = 0x0 ] || { ABORT="throttled=$(throttled)"; return 1; }; return 0
}
PM2_NAMES='pm2 jlist 2>/dev/null | NODEB -e '\''let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).map(p=>p.name+":"+p.pm2_env.status).sort().join(" "))}catch{console.log("?")}})'\'''
state_cmd() {   # the before/after state compared at release (exact match required)
  echo "echo '## docker ps -a'; docker ps -a --format '{{.ID}} {{.Image}} {{.Names}}' | sort; echo '## docker images'; docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | sort; echo '## pm2'; ${PM2_NAMES//NODEB/$1}; echo '## lsblk'; $(disk_ids_cmd); echo '## losetup'; /usr/sbin/losetup -a 2>&1 | sort"
}

# ---- 0. guards, facts, before-state ----
S_HOST="$(s_get hostname "$(host_of "$SERVER")")"; L_HOST="$(l_get hostname "$(host_of "$LOADGEN")")"
[ -n "$S_HOST" ] && [ -n "$L_HOST" ] || { echo "FAIL: cannot reach $S_T or $L_T"; exit 1; }
guard "$SERVER" "$S_HOST" || exit 2; guard "$LOADGEN" "$L_HOST" || exit 2
say "server $S_T ($S_HOST), load host $L_T ($L_HOST), out $OUT"
S_NODE="$(s_get "test -x $NODE && echo $NODE || command -v node" "$NODE")"; L_NODE="$(l_get "test -x $NODE && echo $NODE || command -v node" "$NODE")"
[ -n "$S_NODE" ] && [ -n "$L_NODE" ] || { say "FAIL: node missing on a Pi"; exit 1; }
SCR=/home/pi/kid-scratch-cap-$STAMP; RS=/tmp/i159-cap; RL=/tmp/i159-cap-load; PROJ=kid-cap-$STAMP; CNAME=$PROJ-kolibri-1
for p in "$SCR" "$RS"; do s_ssh "$(path_guard_cmd "$p")" || { say "FAIL: path guard $p"; exit 2; }; done
l_ssh "$(path_guard_cmd "$RL")" || { say "FAIL: path guard $RL"; exit 2; }
s_ssh "test ! -e $SCR && test ! -e $RS && ! (ss -ltn | grep -q ':$KPORT ')" || { say "FAIL: $SCR/$RS exist or :$KPORT is in use on $S_HOST"; exit 1; }
l_ssh "test ! -e $RL" || { say "FAIL: $RL exists on $L_HOST (quarantine it first)"; exit 1; }
S_LAN="${SERVER_LAN:-$(s_get "ip -4 -o route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p'" 192.168.0.228)}"
S_IF="$(s_get "ip -4 -o route get 1.1.1.1 | sed -n 's/.* dev \([^ ]*\).*/\1/p'" eth0)"
S_DISK="$(s_get "lsblk -no PKNAME \$(findmnt -n -o SOURCE /) | head -1" sda)"
S_MODEL="$(s_get "tr -d '\0' < /proc/device-tree/model" 'Raspberry Pi (dry)')"; S_RAM="$(s_get "free -m | awk '/^Mem:/{print \$2\" MiB\"}'" '? MiB')"
S_NPROC="$(s_get nproc 4)"; L_MODEL="$(l_get "tr -d '\0' < /proc/device-tree/model" 'Raspberry Pi (dry)')"
say "server $S_MODEL, RAM $S_RAM (kit Engines have 8 GB), LAN $S_LAN dev $S_IF disk $S_DISK; load host $L_MODEL"
s_get "$(state_cmd "$S_NODE")" "dry" > "$OUT/before-server.txt"; l_get "$(state_cmd "$L_NODE")" "dry" > "$OUT/before-loadgen.txt"
LIMITS_CMD="echo '## load-host limits'; echo \"nofile soft \$(ulimit -Sn) hard \$(ulimit -Hn)\"; echo \"ip_local_port_range \$(cat /proc/sys/net/ipv4/ip_local_port_range)\"; echo \"tcp_fin_timeout \$(cat /proc/sys/net/ipv4/tcp_fin_timeout) somaxconn \$(cat /proc/sys/net/core/somaxconn)\""
l_get "$LIMITS_CMD" "## load-host limits (dry)" >> "$OUT/before-loadgen.txt"   # rule out client fd / ephemeral ports (#159 run 2)
say "load host: $(sed -n '/^## load-host limits/,$p' "$OUT/before-loadgen.txt" | tail -n +2 | tr '\n' ';')"
grep -q 'engine:online' "$OUT/before-server.txt" || [ "$DRY_RUN" = 1 ] || say "note: pm2 engine not online on $S_HOST before the run"
cool_wait || { say "ABORT before start: $ABORT"; exit 1; }

cleanup_done=0
cleanup() {
  [ "$cleanup_done" = 1 ] && return; cleanup_done=1
  say "phase 3: cleanup + release checks"
  l_ssh "for f in $RL/load.pid $RL/api.pid; do [ -f \$f ] && kill \$(cat \$f) 2>/dev/null; done; sleep 1; test ! -e $RL || mv $RL $RL.quarantine-$STAMP"
  s_ssh "test -f $RS/sampler.pid && kill \$(cat $RS/sampler.pid) 2>/dev/null; true"
  s_ssh "test -f $SCR/compose.yaml && cd $SCR && docker compose -p $PROJ down -v 2>&1 | tail -3; true"
  [ "${PULLED:-0}" = 1 ] && s_ssh "docker rmi $IMAGE >/dev/null && echo removed pulled $IMAGE"
  s_ssh "test ! -e $RS || mv $RS $RS.quarantine-$STAMP; test ! -e $SCR || mv $SCR $SCR.quarantine-$STAMP"
  s_get "$(state_cmd "$S_NODE")" "dry" > "$OUT/after-server.txt"; l_get "$(state_cmd "$L_NODE")" "dry" > "$OUT/after-loadgen.txt"
  l_get "$LIMITS_CMD" "## load-host limits (dry)" >> "$OUT/after-loadgen.txt"
  local sec h
  for h in server loadgen; do for sec in 'docker ps -a' 'docker images' 'pm2' 'lsblk' 'losetup'; do
    diff <(sed -n "/^## $sec\$/,/^## /p" "$OUT/before-$h.txt") <(sed -n "/^## $sec\$/,/^## /p" "$OUT/after-$h.txt") > /dev/null; check "$h: $sec identical" $?
  done; done
  # Release probes: an ssh failure (exit 255, e.g. the Pi briefly unreachable right after the 64-stream
  # overload) used to read as FAIL. Retry on 255 and log UNREACHABLE separately from a real FAIL (#159 run 1).
  probe() { local h="$1" c="$2" rc i; for i in 1 2 3 4 5; do "${h}_ssh" "$c"; rc=$?; [ $rc = 255 ] || return $rc; say "probe: ssh $h exit 255, retry $i/5 in 20s"; sleep 20; done; return 255; }
  pcheck() { if [ "$2" = 255 ]; then say "FAIL $1 (UNREACHABLE: ssh exit 255, state not checked)"; echo "$1|UNREACHABLE" >> "$OUT/release.txt"; RESULT=1; else check "$1" "$2"; fi; }
  probe s "! (ss -ltn | grep -q ':$KPORT ')"; pcheck "server: no listener on :$KPORT" $?
  probe s "test ! -e $SCR && test ! -e $RS && ls -d $SCR.quarantine-$STAMP >/dev/null"; pcheck "server: scratch + sampler dirs quarantined" $?
  probe l "test ! -e $RL"; pcheck "load host: $RL quarantined" $?
  [ "$(throttled)" = 0x0 ]; check "server: throttled 0x0 ($(temp) C)" $?
}
trap 'ABORT="${ABORT:-interrupted}"; cleanup; exit 1' INT TERM

# ---- 1. throwaway Kolibri + content ----
say "phase 1: throwaway Kolibri ($IMAGE, project $PROJ, :$KPORT, $SCR)"
if [ "$(s_get "docker image inspect $IMAGE >/dev/null 2>&1 && echo yes || echo no" yes)" = no ]; then
  s_ssh "docker pull -q $IMAGE" || { ABORT="pull failed"; }; PULLED=1; say "pulled $IMAGE (removed at cleanup)"
fi
KHOME="$(s_get "docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $IMAGE | sed -n 's/^KOLIBRI_HOME=//p'" /root/.kolibri)"; KHOME="${KHOME:-/root/.kolibri}"
s_ssh "mkdir -p $SCR/home/content/storage $SCR/media $RS"
POOL_NOTE=""
write_compose() {   # write_compose <pool>: "default" = image as shipped; N = explicit CherryPy pool + raised nofile
  {
    echo "# throwaway Kolibri for the idea#159 capacity run (Kid), pool $1; removed with docker compose -p $PROJ down -v"
    echo "services:"; echo "  kolibri:"; echo "    image: $IMAGE"; echo "    pull_policy: never"; echo "    init: true"
    echo '    restart: "no"'; echo "    network_mode: host"; echo "    environment:"
    echo "      - KOLIBRI_HTTP_PORT=$KPORT"; echo "      - KOLIBRI_LISTEN_PORT=$KPORT"
    if [ "$1" != default ]; then
      echo "      - KOLIBRI_CHERRYPY_THREAD_POOL=$1"
      echo "    ulimits:"; echo "      nofile:"; echo "        soft: $NOFILE"; echo "        hard: $NOFILE"
    fi
    echo "    volumes:"; echo "      - ./home:$KHOME"
  } > "$OUT/compose-$1.yaml"
  cp "$OUT/compose-$1.yaml" "$OUT/compose.yaml"
  run scp -q -o BatchMode=yes "$OUT/compose.yaml" "$S_T:$SCR/compose.yaml"
}
kolibri_up() {   # kolibri_up <pool>: (re)create the throwaway container with that pool, wait for :KPORT
  local ok=0 i h kp lim
  write_compose "$1"
  s_ssh "cd $SCR || exit 1; docker compose -p $PROJ up -d --force-recreate 2>&1 | tail -2" || { ABORT="compose up failed (pool $1)"; return 1; }
  for i in $(seq 1 60); do h="$(s_get "curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:$KPORT/" 200)"; [[ "$h" =~ ^[23] ]] && { ok=1; break; }; [ "$DRY_RUN" = 1 ] && break; sleep 5; done
  [ $ok = 1 ] || { ABORT="Kolibri did not answer on :$KPORT within 300 s (pool $1)"; return 1; }
  # effective pool: Kolibri's default is min(RAM-scaled 50..150, (soft nofile - 64) // 19) (kolibri/utils/options.py)
  kp="$(s_get "docker inspect -f '{{.State.Pid}}' $CNAME" 0)"
  lim="$(s_get "for c in \$(cat /proc/$kp/task/$kp/children 2>/dev/null) $kp; do awk '/^Max open files/{print \$4; exit}' /proc/\$c/limits 2>/dev/null && break; done" 1024)"
  POOL_NOTE="pool $1: container nofile soft ${lim:-?}"
  if [ "$1" = default ] && [[ "$lim" =~ ^[0-9]+$ ]]; then POOL_NOTE="$POOL_NOTE, fd-cap $(( (lim - 64) / 19 )) threads (RAM-scaled default capped by it)"; fi
  say "Kolibri up: $POOL_NOTE"
}
declare -A QBPS QMD5
for q in $QUALITIES; do
  [ "$q" = real ] && continue
  line="$(node -e "const m=require('$FIXTURES/manifest.json');const f=m.find(x=>x.file==='q_$q.mp4');if(f)console.log(f.md5,f.bitrate_bps)" 2>/dev/null)"
  [ -n "$line" ] || { say "FAIL: no fixture q_$q.mp4 in $FIXTURES/manifest.json"; ABORT="fixtures"; break; }
  QMD5[$q]="${line% *}"; QBPS[$q]="${line#* }"; m="${QMD5[$q]}"
  run scp -q -o BatchMode=yes "$FIXTURES/q_$q.mp4" "$S_T:$SCR/media/"
  s_ssh "mkdir -p $SCR/home/content/storage/${m:0:1}/${m:1:1} && mv $SCR/media/q_$q.mp4 $SCR/home/content/storage/${m:0:1}/${m:1:1}/$m.mp4 && echo '$m  $SCR/home/content/storage/${m:0:1}/${m:1:1}/$m.mp4' | md5sum -c --quiet" || { ABORT="fixture $q copy/md5"; break; }
done
FIRST_POOL="${THREAD_POOL%% *}"
[ -z "$ABORT" ] && kolibri_up "$FIRST_POOL"
if [ -z "$ABORT" ] && [[ " $QUALITIES " == *" real "* ]]; then
  KCMD="$(s_get "docker exec $CNAME sh -c 'command -v kolibri || ls -d \$PWD/kolibri-* 2>/dev/null | head -1'" kolibri)"
  say "importing real channel video: channel $REAL_CHANNEL node $REAL_NODE (metadata ~115 MB + one video)"
  if s_ssh "docker exec $CNAME $KCMD manage importchannel network $REAL_CHANNEL > $RS/import.log 2>&1 && docker exec $CNAME $KCMD manage importcontent --node_ids $REAL_NODE network $REAL_CHANNEL >> $RS/import.log 2>&1 && test -s $SCR/home/content/storage/${REAL_MD5:0:1}/${REAL_MD5:1:1}/$REAL_MD5.mp4"; then
    if [ -z "$REAL_BPS" ]; then
      nid="${REAL_NODE:0:8}-${REAL_NODE:8:4}-${REAL_NODE:12:4}-${REAL_NODE:16:4}-${REAL_NODE:20}"
      REAL_BPS="$(s_get "sz=\$(stat -c %s $SCR/home/content/storage/${REAL_MD5:0:1}/${REAL_MD5:1:1}/$REAL_MD5.mp4); d=\$(curl -s -m 10 http://127.0.0.1:$KPORT/api/content/contentnode/$nid/ | $S_NODE -e 'let s=\"\";process.stdin.on(\"data\",x=>s+=x).on(\"end\",()=>{try{console.log(JSON.parse(s).duration||0)}catch{console.log(0)}})'); [ \"\$d\" -gt 0 ] && echo \$((sz*8/d))" 300000)"
    fi
    if [ -n "$REAL_BPS" ] && [ "$REAL_BPS" -gt 0 ] 2>/dev/null; then QMD5[real]=$REAL_MD5; QBPS[real]=$REAL_BPS; say "real video $REAL_MD5 at $REAL_BPS bps"
    else say "real video: bitrate unknown (set REAL_BPS); skipped"; fi
  else say "real channel import failed (see $RS/import.log); real quality skipped"; fi
fi
s_get "curl -s -o /dev/null -w '%{http_code}' -m 10 http://127.0.0.1:$KPORT/content/storage/0/0/none.mp4" 404 > /dev/null
LH="$(l_get "curl -s -o /dev/null -w '%{http_code}' -m 10 http://$S_LAN:$KPORT/" 200)"; [[ "$LH" =~ ^[23] ]] || [ -n "$ABORT" ] || ABORT="load host cannot reach http://$S_LAN:$KPORT/ (got $LH)"

# sampler on the server, load tools on the load host (nohup, pid files; 'cd X || exit 1; nohup ...')
if [ -z "$ABORT" ]; then
  run scp -q -o BatchMode=yes "$HERE/pi-sampler.sh" "$S_T:$RS/"
  s_ssh "cd $RS || exit 1; nohup bash pi-sampler.sh $RS/samples.jsonl $CNAME 2 $S_IF $S_DISK > $RS/sampler.out 2>&1 < /dev/null & echo \$! > $RS/sampler.pid"
  l_ssh "mkdir -p $RL"
  run scp -q -o BatchMode=yes "$HERE/sim-laptop.mjs" "$HERE/load-streams.mjs" "$HERE/capacity-lib.mjs" "$HERE/lib.mjs" "$HERE/api-probe.mjs" "$L_T:$RL/"
fi

# ---- 2. per pool: step test (or ramp) per synthetic quality under CAP_S, then the real video under REAL_CAP ----
run_step() {   # run_step <quality> <n> <retry 0|1> -> sets STEP_SAFE, may set ABORT (writes under $PR, pool $POOL)
  local q=$1 n=$2 retry=$3 m=${QMD5[$1]} bps=${QBPS[$1]} sfx="" paused=0 aborted="" t k
  [ "$retry" = 1 ] && sfx=-retry
  local d="$PR/$q/n$n$sfx" L="$RL/p$POOL-$q-n$n$sfx" url="http://$S_LAN:$KPORT/content/storage/${m:0:1}/${m:1:1}/$m.mp4"
  mkdir -p "$d"; say "step pool=$POOL $q N=$n$sfx ($bps bps)"
  l_ssh "cd $RL || exit 1; nohup $L_NODE sim-laptop.mjs --mode load --url $url --n $n --bps $bps --hold-s $HOLD_S --ramp-s $RAMP_S --out $L.jsonl --summary $L.summary.json > $L.out 2>&1 < /dev/null & echo \$! > $RL/load.pid; nohup $L_NODE api-probe.mjs --base http://$S_LAN:$KPORT --duration-s $((RAMP_S + HOLD_S)) --out $L.api.jsonl > $L.api.out 2>&1 < /dev/null & echo \$! > $RL/api.pid"
  [ "$LOADLIM_LOGGED" = 1 ] || { LOADLIM_LOGGED=1; say "load process: $(l_get "awk '/^Max open files/' /proc/\$(cat $RL/load.pid)/limits" 'Max open files (dry)')"; }
  local deadline=$(( $(date +%s) + RAMP_S + HOLD_S + 90 ))
  while [ "$DRY_RUN" != 1 ]; do
    sleep 10
    [ "$(l_get "kill -0 \$(cat $RL/load.pid) 2>/dev/null && echo up || echo done")" = done ] && break
    [ "$(date +%s)" -gt "$deadline" ] && { aborted="load did not finish in time"; break; }
    k="$(throttled)"; [ "$k" = 0x0 ] || { aborted="throttled=$k"; ABORT="$aborted"; break; }
    t="$(temp)"
    if gt "$t" 75; then
      paused=1; say "thermal: $t C > 75 C, pausing the load (SIGSTOP)"; l_ssh "kill -STOP \$(cat $RL/load.pid) \$(cat $RL/api.pid) 2>/dev/null"
      local w=0; while gt "$(temp)" 64.99; do sleep 15; w=$((w+15)); [ $w -ge "$COOL_TIMEOUT" ] && { ABORT="no cool-down below 65 C"; break; }; done
      l_ssh "kill -CONT \$(cat $RL/load.pid) \$(cat $RL/api.pid) 2>/dev/null"; say "thermal: resumed at $(temp) C"
      [ -n "$ABORT" ] && break
    fi
  done
  l_ssh "for f in $RL/load.pid $RL/api.pid; do kill \$(cat \$f) 2>/dev/null; done; true"
  run scp -q -o BatchMode=yes "$L_T:$L.summary.json" "$d/load.summary.json"; run scp -q -o BatchMode=yes "$L_T:$L.api.jsonl" "$d/api.jsonl"
  run scp -q -o BatchMode=yes "$S_T:$RS/samples.jsonl" "$OUT/samples.jsonl"
  local eng=true; s_get "${PM2_NAMES//NODEB/$S_NODE}" engine:online | grep -q 'engine:online' || eng=false
  printf '{"n":%s,"retry":%s,"engineOnline":%s,"thermalPaused":%s,"aborted":%s,"nproc":%s}\n' "$n" "$([ "$retry" = 1 ] && echo true || echo false)" "$eng" "$([ $paused = 1 ] && echo true || echo false)" "$([ -n "$aborted" ] && echo "\"$aborted\"" || echo null)" "$S_NPROC" > "$d/health.json"
  if node "$HERE/check-capacity.mjs" step "$d" "$OUT/samples.jsonl" | tee -a "$OUT/capacity.log"; then STEP_SAFE=1; else STEP_SAFE=0; fi
  grep -qE '"S8 |OOM kill' "$d/verdict.json" 2>/dev/null && ABORT="${ABORT:-Kolibri/Engine down or OOM at pool $POOL $q N=$n}"
  [ "$DRY_RUN" = 1 ] || sleep "$SETTLE_S"
}
STEP_COST=$(( RAMP_S + HOLD_S + SETTLE_S + 120 ))
if [ "$MODE" = step ]; then LIST="$STEPS"; else LIST="$NS __EXT__ $NS_EXT"; fi
run_quality() {   # run_quality <q> <cap kind: global|real> <deadline epoch>; stops at the first step not SAFE after its retry
  local q=$1 kind=$2 dl=$3 nn last_safe=0
  for nn in $LIST; do
    if [ "$nn" = __EXT__ ]; then [ "$last_safe" = "${NS##* }" ] && { say "$q: ${NS##* } SAFE, continuing to $NS_EXT"; continue; } || break; fi
    if [ $(( $(date +%s) + STEP_COST )) -gt "$dl" ]; then
      if [ "$kind" = global ]; then CAPPED="global cap ${CAP_S}s"; else say "pool $POOL real: REAL_CAP ${REAL_CAP}s reached before N=$nn"; echo "$POOL real N=$nn" >> "$OUT/real-capped.txt"; fi
      say "pool $POOL $q: time cap ($kind) before N=$nn"; break
    fi
    cool_wait || break
    run_step "$q" "$nn" 0
    if [ "$STEP_SAFE" = 0 ] && [ -z "$ABORT" ]; then cool_wait && run_step "$q" "$nn" 1; fi
    [ -n "$ABORT" ] && break
    [ "$STEP_SAFE" = 1 ] || { say "pool $POOL $q: first not-SAFE step N=$nn (max safe ${last_safe})"; break; }
    last_safe=$nn
  done
}
write_meta() {   # write_meta <poolRoot> <pool> <qualities ran>
  node -e "
const fs=require('fs');const rel={};if(fs.existsSync('$OUT/release.txt'))for(const l of fs.readFileSync('$OUT/release.txt','utf8').trim().split('\n')){const [k,v]=l.split('|');if(k)rel[k]=v}
const q=process.argv[1].trim().split(/\s+/).filter(Boolean).map(x=>({name:x,bps:Number(JSON.parse(process.argv[2])[x]||0),prior:x==='real'?'run 1: not reached':'run 1: 48 safe, 64 fails (Pi 5, 0.19.5)'}));
fs.writeFileSync('$1/meta.json',JSON.stringify({server:'$S_HOST',loadgen:'$L_HOST',image:'$IMAGE',port:$KPORT,started:new Date($T0*1000).toISOString(),ended:new Date($T1*1000).toISOString(),runtimeS:$T1-$T0,dry:$([ "$DRY_RUN" = 1 ] && echo true || echo false),
 conditions:{'server model':'$S_MODEL','server RAM':'$S_RAM','load host':'$L_MODEL','path':'fleet LAN $S_LAN:$KPORT (not Wi-Fi airtime)','mode / steps':'$MODE / ${LIST//__EXT__/+}','CherryPy pool':'$2 (${POOL_NOTES[$2]:-?})','hold / ramp-in':'${HOLD_S}s / ${RAMP_S}s','caps':'synthetic ${CAP_S}s total, real ${REAL_CAP}s per pool','abort':'${ABORT:-none}${CAPPED:+; $CAPPED}','Engine':'left running (pm2 untouched)'},release:rel,qualities:q},null,1))" "$3" "{$(for q in $3; do printf '"%s":%s,' "$q" "${QBPS[$q]}"; done | sed 's/,$//')}" 2>&1 | tee -a "$OUT/capacity.log"
}
declare -A RAN POOL_NOTES; CAPPED=""; LOADLIM_LOGGED=0
SYN=""; for q in $QUALITIES; do [ "$q" = real ] || SYN="$SYN $q"; done
HAS_REAL=0; [ -n "${QMD5[real]:-}" ] && HAS_REAL=1
NPOOLS=$(wc -w <<< "$THREAD_POOL")
if [ -z "$ABORT" ]; then
  say "phase 2: mode $MODE ($LIST), pools [$THREAD_POOL], hold ${HOLD_S}s, ramp-in ${RAMP_S}s, settle ${SETTLE_S}s, cap ${CAP_S}s + real ${REAL_CAP}s/pool"
  pi=0
  for POOL in $THREAD_POOL; do
    pi=$((pi+1)); PR="$OUT/pool-$POOL"; mkdir -p "$PR"; RAN[$POOL]=""
    if [ "$pi" -gt 1 ]; then s_ssh "cd $SCR || exit 1; docker compose -p $PROJ down 2>&1 | tail -1" ; kolibri_up "$POOL" || break; fi
    POOL_NOTES[$POOL]="$POOL_NOTE"
    # global cap for synthetics keeps room for every remaining real phase, so the cap can never skip the real video
    reserve=$(( HAS_REAL * REAL_CAP * (NPOOLS - pi + 1) ))
    for q in $SYN; do
      [ -n "${QMD5[$q]:-}" ] || continue; [ -n "$CAPPED" ] && break
      RAN[$POOL]="${RAN[$POOL]} $q"; run_quality "$q" global $(( T0 + CAP_S - reserve ))
      [ -n "$ABORT" ] && break
    done
    [ -n "$ABORT" ] && { say "ABORT: $ABORT"; break; }
    if [ "$HAS_REAL" = 1 ]; then
      say "pool $POOL: real channel video phase (own cap ${REAL_CAP}s)"
      RAN[$POOL]="${RAN[$POOL]} real"; run_quality real real $(( $(date +%s) + REAL_CAP ))
      [ -n "$ABORT" ] && { say "ABORT: $ABORT"; break; }
    fi
  done
else say "ABORT before ramp: $ABORT"; fi

cleanup
T1=$(date +%s)
: > "$OUT/REPORT.md"
for POOL in $THREAD_POOL; do
  PR="$OUT/pool-$POOL"; [ -d "$PR" ] || continue
  write_meta "$PR" "$POOL" "${RAN[$POOL]:-}"
  node "$HERE/check-capacity.mjs" report "$PR" | sed "s/^/pool $POOL: /" | tee -a "$OUT/capacity.log"
  { echo "<!-- pool $POOL -->"; sed "1s/^# /# [CherryPy pool $POOL] /" "$PR/REPORT.md"; echo; } >> "$OUT/REPORT.md"
done
[ -z "$ABORT" ] || { say "run aborted: $ABORT"; RESULT=1; }
[ -z "$CAPPED" ] || say "note: $CAPPED reached; later synthetic steps not run (the real phases have their own cap)"
if [ "$RESULT" = 0 ]; then say "CAPACITY RUN COMPLETE, RELEASE OK ($OUT/REPORT.md)"; else say "CAPACITY RUN FAIL ($OUT/REPORT.md)"; fi
exit "$RESULT"
