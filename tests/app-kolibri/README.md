# Kolibri stream capacity load test (idea#159)

Measures how many simultaneous video streams one Kolibri instance on one Pi can safely sustain (playback-paced HTTP Range clients against `/content/storage/…`).

**Measured (2026-09-29, idea01 Pi 5):** recommended planning number **32 students/instance**; hardware held ≥128 paced and unpaced over gigabit LAN with no hard failure. See idea#159 comment and `/workspace/i159/REPORT.md`.

## Prerequisites

- Claimed ARM64 pool Pi (`idea01` / `idea04`; never `idea02`)
- Docker image `koenswings/kolibri:1.0-0.15.5-dev` pulled on the Pi
- A representative MP4 placed in Kolibri content storage:

```bash
MD5=$(md5sum classroom_demo.mp4 | awk '{print $1}')
mkdir -p data/kolibri/content/storage/${MD5:0:1}/${MD5:1:1}
cp classroom_demo.mp4 data/kolibri/content/storage/${MD5:0:1}/${MD5:1:1}/${MD5}.mp4
```

- Kolibri running (compose `network_mode: host`). If Engine already owns `:8080`, use `--port=18080` / `KOLIBRI_HTTP_PORT=18080`.

## Run

On the Pi (same-host / loopback — upper bound):

```bash
URL="http://127.0.0.1:18080/content/storage/${MD5:0:1}/${MD5:1:1}/${MD5}.mp4"
OUT_DIR=./logs/samehost DURATION=60 BITRATE_BPS=902541 PREFIX=samehost \
  NS="1 2 4 8 12 16 20 24 32" \
  bash scripts/run_ramp.sh
```

From another host on the LAN (preferred):

```bash
URL="http://<pi-lan>:18080/content/storage/..."
OUT_DIR=./logs/lan DURATION=60 PREFIX=lan SKIP_DOCKER=1 \
  NS="1 2 4 8 12 16 20 24 32 40 48 64 80 96 128" \
  bash scripts/run_ramp.sh
```

Single step / unpaced burst:

```bash
python3 scripts/kolibri_stream_loadtest.py \
  --url "$URL" --n 32 --duration 90 --bitrate-bps 902541 \
  --out-dir ./logs --tag probe-n32

python3 scripts/kolibri_stream_loadtest.py \
  --url "$URL" --n 64 --duration 45 --unpaced \
  --out-dir ./logs --tag unpaced-n64
```

## Success criteria

- ≥95% of clients sustain ≥85% of target bitrate for the run window
- Kolibri container stays up; host `MemAvailable` ≥ 150 MiB; loadavg_1 ≤ 3× nproc
- Recommended safe N leaves headroom below the last SAFE step (and below Wi‑Fi / browser reality)
