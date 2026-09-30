#!/usr/bin/env bash
# Ramp concurrent Kolibri stream clients until unsafe, logging under OUT_DIR.
set -euo pipefail

URL="${URL:?}"
OUT_DIR="${OUT_DIR:?}"
BITRATE_BPS="${BITRATE_BPS:-902541}"
DURATION="${DURATION:-90}"
CONTAINER="${CONTAINER:-i159-kolibri}"
SKIP_DOCKER="${SKIP_DOCKER:-0}"
PREFIX="${PREFIX:-samehost}"
# Success criteria: >=95% clients usable AND Kolibri up AND mem available > 150MB AND loadavg_1 < (nproc*3)
MEM_FLOOR_KB="${MEM_FLOOR_KB:-153600}"   # 150 MiB
LOAD_MULT="${LOAD_MULT:-3}"
NS="${NS:-1 2 4 8 12 16 20 24 32}"

mkdir -p "$OUT_DIR"
NPROC=$(nproc)
LOAD_CEIL=$(python3 -c "print($NPROC * $LOAD_MULT)")
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "ramp start $(date -Iseconds) url=$URL prefix=$PREFIX duration=$DURATION bitrate=$BITRATE_BPS load_ceil=$LOAD_CEIL mem_floor_kb=$MEM_FLOOR_KB" | tee -a "$OUT_DIR/ramp.log"

SAFE_N=0
CLIFF_N=""
for n in $NS; do
  tag="${PREFIX}-n${n}"
  echo "=== RUN $tag ===" | tee -a "$OUT_DIR/ramp.log"
  # Confirm container still up (skip when clients are remote)
  if [ "$SKIP_DOCKER" != "1" ]; then
    if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
      echo "HARD FAIL: container $CONTAINER not running before n=$n" | tee -a "$OUT_DIR/ramp.log"
      CLIFF_N=$n
      break
    fi
  fi
  EXTRA_ARGS=()
  if [ "$SKIP_DOCKER" = "1" ]; then
    EXTRA_ARGS+=(--container "")
  else
    EXTRA_ARGS+=(--container "$CONTAINER")
  fi
  python3 "$SCRIPT_DIR/kolibri_stream_loadtest.py" \
    --url "$URL" --n "$n" --duration "$DURATION" \
    --bitrate-bps "$BITRATE_BPS" "${EXTRA_ARGS[@]}" \
    --out-dir "$OUT_DIR" --tag "$tag" | tee -a "$OUT_DIR/ramp.log"

  # Evaluate
  eval "$(python3 - <<PY
import json
from pathlib import Path
s=json.loads(Path("$OUT_DIR/$tag.json").read_text())
post=s.get("post") or {}
docker=post.get("docker") or {}
print(f'SUCCESS_RATE={s["success_rate"]}')
print(f'HARD_FAIL={s["clients_hard_fail"]}')
print(f'LOAD={post.get("loadavg_1", 0)}')
print(f'MEM_AVAIL={post.get("mem_available_kb", 0)}')
print(f'DOCKER_ERR={1 if docker.get("error") else 0}')
PY
)"
  UP=1
  if [ "$SKIP_DOCKER" != "1" ]; then
    docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" || UP=0
  fi

  UNSAFE=0
  REASON=""
  python3 - <<PY
success=float("$SUCCESS_RATE")
hard=int("$HARD_FAIL")
load=float("$LOAD")
mem=int("$MEM_AVAIL")
up=int("$UP")
load_ceil=float("$LOAD_CEIL")
mem_floor=int("$MEM_FLOOR_KB")
reasons=[]
if success < 0.95: reasons.append(f"success_rate={success:.3f}<0.95")
if hard > 0: reasons.append(f"hard_fail_clients={hard}")
if up != 1: reasons.append("container_down")
if load > load_ceil: reasons.append(f"loadavg_1={load}>{load_ceil}")
if mem < mem_floor: reasons.append(f"mem_available_kb={mem}<{mem_floor}")
open("$OUT_DIR/eval_$tag.txt","w").write("\\n".join(reasons) if reasons else "SAFE")
print("EVAL", "UNSAFE" if reasons else "SAFE", ";", "; ".join(reasons) if reasons else "ok")
PY

  EVAL=$(cat "$OUT_DIR/eval_$tag.txt")
  echo "eval: $EVAL" | tee -a "$OUT_DIR/ramp.log"
  if [ "$EVAL" = "SAFE" ]; then
    SAFE_N=$n
  else
    CLIFF_N=$n
    echo "Stopping ramp at unsafe n=$n" | tee -a "$OUT_DIR/ramp.log"
    break
  fi
  # Brief cooldown
  sleep 10
done

# Recommend conservative: if we found cliff, take previous; else SAFE_N; optionally step down one rung
python3 - <<PY
safe=int("$SAFE_N")
cliff="$CLIFF_N"
# Conservatively leave headroom: if cliff exists and safe>=4, recommend max(1, safe that is one step below or 80%)
# Use the last SAFE_N but if SAFE_N == highest tried without cliff, still OK.
# Headroom: recommend floor(safe * 0.75) rounded to previous ramp step, min 1 if safe>=1
steps=[int(x) for x in "$NS".split()]
if safe <= 0:
  rec=0
else:
  # pick largest step <= 0.75*safe, else safe itself if only small
  target=safe * 0.75
  below=[s for s in steps if s <= target and s <= safe]
  rec = max(below) if below else safe
open("$OUT_DIR/RESULT.txt","w").write(f"SAFE_N={safe}\\nCLIFF_N={cliff}\\nRECOMMENDED={rec}\\n")
print(f"SAFE_N={safe} CLIFF_N={cliff} RECOMMENDED={rec}")
PY
cat "$OUT_DIR/RESULT.txt" | tee -a "$OUT_DIR/ramp.log"
echo "ramp done $(date -Iseconds)" | tee -a "$OUT_DIR/ramp.log"
