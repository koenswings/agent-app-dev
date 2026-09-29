# Kolibri stream capacity load test (idea#159)

Measures how many simultaneous video streams one Kolibri instance on one Pi can safely sustain, across **multiple stream qualities**.

## Scripts

| Script | Role |
|---|---|
| `scripts/kolibri_stream_loadtest.py` | N concurrent HTTP Range clients (playback-paced or `--unpaced`) |
| `scripts/run_ramp.sh` | Ramp N until unsafe for one URL/bitrate |
| `scripts/run_quality_matrix.sh` | Loop a qualities `manifest.json` and ramp each |

## Encode / seed fixtures

Encode representative MP4s (180s classroom-like), then place each under Kolibri content storage by MD5:

```bash
# example encodes (see idea#159 run)
ffmpeg -y -f lavfi -i 'testsrc2=size=640x360:rate=25' -f lavfi -i 'sine=frequency=440:sample_rate=44100' \
  -t 180 -c:v libx264 -preset veryfast -b:v 300k -maxrate 350k -bufsize 600k \
  -pix_fmt yuv420p -c:a aac -b:a 64k -shortest q_low_360p.mp4
# … similarly 854x480 ~650k, 1280x720 ~800k, 1920x1080 ~2000k

python3 - <<'PY'
import json, hashlib, shutil
from pathlib import Path
import subprocess
rows=[]
for p in sorted(Path('.').glob('q_*.mp4')):
    md5=hashlib.md5(p.read_bytes()).hexdigest()
    probe=json.loads(subprocess.check_output([
      'ffprobe','-v','error','-show_entries','format=duration,size,bit_rate',
      '-show_entries','stream=codec_name,width,height,bit_rate','-of','json',str(p)]))
    v=next(s for s in probe['streams'] if s.get('codec_name')=='h264')
    rows.append({"file":p.name,"md5":md5,"bitrate_bps":int(probe['format']['bit_rate']),
                 "width":int(v['width']),"height":int(v['height']),
                 "duration_s":float(probe['format']['duration']),"size_b":int(probe['format']['size'])})
    dest=Path(f"data/kolibri/content/storage/{md5[0]}/{md5[1]}/{md5}.mp4")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, dest)
Path('manifest.json').write_text(json.dumps(rows, indent=2))
print(json.dumps(rows, indent=2))
PY
```

Example manifest shape: `fixtures/qualities-manifest.example.json`.

Start Kolibri (`koenswings/kolibri:1.0-0.15.5-dev`, host network). If Engine owns `:8080`, use port `18080`.

## Run one quality

```bash
MD5=…; BPS=902541
URL="http://127.0.0.1:18080/content/storage/${MD5:0:1}/${MD5:1:1}/${MD5}.mp4"
OUT_DIR=./logs/samehost DURATION=60 BITRATE_BPS=$BPS PREFIX=samehost \
  NS="8 16 32 48 64 80 96 128" bash scripts/run_ramp.sh
```

## Run quality × N matrix (LAN client host preferred)

```bash
MANIFEST=./manifest.json \
BASE_URL=http://<kolibri-lan-ip>:18080 \
OUT_ROOT=./logs/matrix \
DURATION=60 SKIP_DOCKER=1 \
NS="8 16 32 48 64 80 96 128" \
  bash scripts/run_quality_matrix.sh
# → OUT_ROOT/matrix_summary.json + per-quality RESULT.txt
```

## Success criteria

- ≥95% of clients sustain ≥85% of that file’s target bitrate for the window
- Kolibri stays up; MemAvailable ≥ 150 MiB; loadavg_1 ≤ 3× nproc
- Planning N leaves headroom below last SAFE (and below Wi‑Fi / browser reality)

See idea#159 comments for measured quality → concurrency tables.
