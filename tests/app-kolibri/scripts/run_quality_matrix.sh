#!/usr/bin/env bash
set -euo pipefail
: "${MANIFEST:?}"
: "${BASE_URL:?}"
: "${OUT_ROOT:?}"
DURATION="${DURATION:-60}"
NS="${NS:-8 16 32 48 64 80 96 128}"
SKIP_DOCKER="${SKIP_DOCKER:-1}"
export MANIFEST BASE_URL OUT_ROOT DURATION NS SKIP_DOCKER
export SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT_ROOT"
exec python3 - <<'PY'
import json, os, subprocess, urllib.request
from pathlib import Path

manifest = json.loads(Path(os.environ["MANIFEST"]).read_text())
base = os.environ["BASE_URL"].rstrip("/")
out_root = Path(os.environ["OUT_ROOT"])
duration = os.environ.get("DURATION", "60")
ns = os.environ.get("NS", "8 16 32 48 64 80 96 128")
skip = os.environ.get("SKIP_DOCKER", "1")
script_dir = Path(os.environ["SCRIPT_DIR"])
matrix_log = out_root / "matrix.log"
matrix_log.write_text(f"matrix start base={base} ns={ns} duration={duration}\n")

order = {"q_low_360p.mp4": 0, "q_med_480p.mp4": 1, "q_720p.mp4": 2, "q_high_1080p.mp4": 3}
manifest = sorted(manifest, key=lambda x: order.get(x["file"], 99))
summary_rows = []

for item in manifest:
    md5 = item["md5"]
    label = item["file"].replace(".mp4", "").replace("q_", "")
    url = f"{base}/content/storage/{md5[0]}/{md5[1]}/{md5}.mp4"
    out_dir = out_root / label
    out_dir.mkdir(parents=True, exist_ok=True)
    bitrate = str(item["bitrate_bps"])
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=15) as r:
            print(f"SMOKE {label} HTTP {r.status} len={r.headers.get('Content-Length')} bitrate={bitrate}", flush=True)
    except Exception as e:
        print(f"SMOKE FAIL {label}: {e}", flush=True)
        summary_rows.append({**item, "label": label, "SAFE_N": 0, "CLIFF_N": "smoke_fail", "RECOMMENDED": 0, "error": str(e)})
        continue

    env = os.environ.copy()
    env.update({
        "URL": url, "OUT_DIR": str(out_dir), "DURATION": duration,
        "BITRATE_BPS": bitrate, "PREFIX": label, "NS": ns, "SKIP_DOCKER": skip,
    })
    print(f"=== RAMP {label} bitrate={bitrate} ===", flush=True)
    proc = subprocess.run(["bash", str(script_dir / "run_ramp.sh")], env=env,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    with open(matrix_log, "a") as log:
        log.write(f"\n=== {label} bitrate={bitrate} url={url} ===\n")
        log.write(proc.stdout)
    print(proc.stdout[-2500:], flush=True)
    safe = cliff = rec = ""
    rp = out_dir / "RESULT.txt"
    if rp.exists():
        for line in rp.read_text().splitlines():
            if line.startswith("SAFE_N="): safe = line.split("=",1)[1].strip()
            if line.startswith("CLIFF_N="): cliff = line.split("=",1)[1].strip()
            if line.startswith("RECOMMENDED="): rec = line.split("=",1)[1].strip()
    def to_int(x):
        return int(x) if x.isdigit() else (0 if x == "" else x)
    row = {
        "label": label, "file": item["file"],
        "width": item.get("width"), "height": item.get("height"),
        "bitrate_bps": item["bitrate_bps"], "md5": md5,
        "SAFE_N": to_int(safe), "CLIFF_N": cliff, "RECOMMENDED": to_int(rec),
        "ramp_exit": proc.returncode,
    }
    summary_rows.append(row)
    print(f"RESULT {label}: {row}", flush=True)

(out_root / "matrix_summary.json").write_text(json.dumps(summary_rows, indent=2))
print("MATRIX_DONE", flush=True)
PY
