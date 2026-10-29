# Kolibri Wi‑Fi field test — real school, real laptops (idea#159)

The LAN tests (Sep 29) showed one Pi running Kolibri never hit a hard limit up to 128 streams
on wired gigabit. In a real school the limit is the **Wi‑Fi, the laptops and their browsers**.
This plan measures that limit on a real school setup with 3–4 real laptops.

Run it **once a school with 3–4 client laptops is set up**. The hands‑on steps are tracked on
Steve's list in [idea#375](https://github.com/koenswings/idea/issues/375); nobody runs it until Steve
schedules it there.

Planning numbers to compare with (wired LAN, Sep 29):

| Quality | Bitrate | Planning N (students per Kolibri) |
|---|---:|---:|
| 360p | ~370 kbps | 64 |
| 480p | ~752 kbps | 32 |
| 720p | ~903 kbps | 32 |
| 1080p | ~2133 kbps | 12 |

---

## 1. Prerequisites

**Hardware (as installed at the school)**
- The school's IDEA router and the Pi, on the school's own Wi‑Fi (`10.42.x.x` range).
- Pi reachable as `<sticker-name>.local` (e.g. `happy-zebra.local`). Write down the **Pi model and RAM**
  (`cat /proc/device-tree/model; free -h`), and whether it has a fan/heatsink.
- 3–4 client laptops (the school's real ones). For each: make/model, OS, browser + version,
  Wi‑Fi adapter if known.
- One extra laptop or phone for the tester to watch the Pi (SSH) — optional, the commands can also run
  from one of the test laptops before the test starts.
- Mains power for every laptop (battery saving can throttle video).

**Software / content**
- Kolibri `koenswings/kolibri:1.1-0.19.5` running as an Engine app instance, and the Engine healthy in the Console.
- A **test channel** (not the school's real content or users) with **four real videos**, one per quality:
  360p, 480p, 720p, 1080p, each at least 3 minutes long. Write down each video's title and measured bitrate
  (`ffprobe -v error -show_entries format=bit_rate -of csv=p=0 <file>.mp4`).
- A **test learner account** (or guest access) — never a real pupil's account.
- Browsers: Chrome or Firefox, up to date, no other tabs, no browser updates pending.

## 2. Roles

| Role | Who | Does |
|---|---|---|
| Tester | the person on site (teacher or IDEA volunteer) | Follows the steps below exactly and fills in the tables |
| Pi watcher | the same person, or a second one | Starts the Pi log (§4.3) and checks the temperature between steps |
| Coordinator | Steve (Lead Bot) | Schedules the test via idea#375 and collects the results onto idea#159 |

All steps are written so a teacher can follow them without knowing IDEA internals.

## 3. Definitions

- **Smooth stream:** during a 3‑minute watch, **no stall longer than 2 seconds** and **no more than one
  rebuffer (spinning wheel) per minute**, and the picture stays at the chosen quality.
- **Stream count:** the number of videos playing at the same time across all laptops and tabs.
- **First failure mode:** the first thing that goes wrong as streams are added. Use one of:
  `buffering` · `quality drop` · `page timeout` · `Kolibri error` · `Pi overheating` · `other (describe)`.

## 4. Before you start (once)

### 4.1 Record the Wi‑Fi conditions
Fill in the Wi‑Fi table (§7.1): router model, band (2.4 or 5 GHz), channel, how many other people/devices
are on the Wi‑Fi, and for each laptop its distance to the router and number of walls.

Signal strength (RSSI) per laptop:
- Windows: `netsh wlan show interfaces` → *Signal* (%) and *Channel*
- macOS: hold ⌥ Option and click the Wi‑Fi icon → *RSSI* (dBm) and *Channel*
- Linux: `iw dev wlan0 link` → *signal* (dBm)

### 4.2 Check the Engine is healthy
Open the IDEA Console at `http://<sticker-name>.local` and check the Engine and the Kolibri app show as running.
Write "OK" or what you see in the results.

### 4.3 Start the Pi log (copy‑paste)
SSH into the Pi (`ssh pi@<sticker-name>.local`) and paste:

```bash
LOG=~/i159-wifi-$(date +%Y%m%d-%H%M).log
( while true; do
    echo "=== $(date -Iseconds) $(vcgencmd measure_temp) $(vcgencmd get_throttled)"
    vmstat 1 2 | tail -1
    free -m | awk '/Mem:/{print "mem_used_mb="$3" mem_avail_mb="$7}'
    uptime
    sleep 10
  done ) >> "$LOG" 2>&1 &
echo "logging to $LOG (pid $!)"
```

Check the temperature at any time with `vcgencmd measure_temp`. Stop the log at the end with `kill %1`
(or `pkill -f i159-wifi`) and keep the file.

## 5. Test steps — repeat for each quality

Do the qualities in this order: **360p, 480p, 720p, 1080p**. For each quality:

1. **1 laptop:** on laptop A, sign in with the test account, open the quality's video, press play,
   make it full screen. Watch for 3 minutes. Count stalls and rebuffers. Record a row in §7.2.
2. **2 laptops:** keep A playing; start the same video on laptop B. Watch both for 3 minutes. Record.
3. **3 laptops:** add laptop C. Watch 3 minutes. Record.
4. **4 laptops:** add laptop D (if there is one). Watch 3 minutes. Record.
5. **More tabs:** on each laptop open a second browser tab with the same video playing (not muted is fine,
   or mute it) → 2 tabs per laptop. Watch 3 minutes. Record. Then 3 tabs per laptop, then 4, and so on,
   **until a stream stops being smooth** or you reach 4× the planning N for that quality. Watch only the
   visible tab carefully, and click through the other tabs once a minute to check they still play.
6. Write down the **highest stream count where every stream was smooth** and the **first failure mode**.
7. Stop all videos, close the extra tabs, and wait **2 minutes** (and below 65 °C, see §8) before the next quality.

Always check the Pi temperature (`vcgencmd measure_temp`) after each step and write it in the row.

### 5.1 Optional: synthetic streams on top
If one laptop can run Python 3 and has this repo, add synthetic streams **while the real laptops play**
to see how far the Pi side goes on this Wi‑Fi. Use the video's content URL and measured bitrate:

```bash
MD5=<video file md5>; BPS=<measured bitrate>
URL="http://<sticker-name>.local:<kolibri-port>/content/storage/${MD5:0:1}/${MD5:1:1}/${MD5}.mp4"
python3 scripts/kolibri_stream_loadtest.py --url "$URL" --n 8 --duration 180 \
  --bitrate-bps "$BPS" --out-dir ./logs/wifi --tag wifi-<quality>-n8
```

Increase `--n` (8, 16, 32 …) between runs, and record in §7.2 whether the **real** laptops stay smooth.
Stop at the first non‑smooth real stream. (`run_ramp.sh` with `SKIP_DOCKER=1` does the same ramp
automatically.) Note that synthetic clients also use that laptop's Wi‑Fi.

## 6. Pass criteria

For each quality, the field result **passes** if the smooth stream count on Wi‑Fi reaches at least the
smaller of:
- the **planning N** for that quality (64 / 32 / 32 / 12), or
- the number of streams the 3–4 laptops can physically play (laptops × tabs before the laptop itself struggles —
  if a laptop's own CPU is at 100 % or its own video stutters while the Pi is idle, that is a laptop limit,
  not a Pi/Wi‑Fi limit: note it).

If a quality fails, the result still counts: it gives the real per‑school number. Report it as
"Wi‑Fi limit = N streams at <quality>, failure = <mode>". If the Pi went above 75 °C, Kolibri errored or
the Engine became unhealthy, that is a **hard** fail and must be reported even below planning N.

## 7. Results template (copy into the idea#159 comment)

### 7.1 Setup

| Item | Value |
|---|---|
| School / sticker name | |
| Date, start–end time | |
| Pi model / RAM / cooling | |
| Kolibri image | koenswings/kolibri:1.1-0.19.5 |
| Engine version (Console) | |
| Router model | |
| Wi‑Fi band / channel / width | |
| Other devices on the Wi‑Fi | |
| Room temperature (approx.) | |

| Laptop | Model / OS | Browser + version | RSSI | Distance / walls |
|---|---|---|---|---|
| A | | | | |
| B | | | | |
| C | | | | |
| D | | | | |

| Quality | Video title | Resolution | Measured bitrate |
|---|---|---|---|
| 360p | | | |
| 480p | | | |
| 720p | | | |
| 1080p | | | |

### 7.2 Per step

| Quality | Laptops | Tabs/laptop | Streams total | Synthetic N | All smooth? | Stalls >2 s | Rebuffers/min (worst) | Pi °C | Pi CPU idle % | Pi RAM avail MB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 360p | 1 | 1 | 1 | 0 | | | | | | | |
| 360p | 2 | 1 | 2 | 0 | | | | | | | |
| … | | | | | | | | | | | |

### 7.3 Summary

| Quality | Planning N | Max smooth streams (Wi‑Fi) | First failure mode | Max Pi °C | Pass? |
|---|---:|---:|---|---:|---|
| 360p | 64 | | | | |
| 480p | 32 | | | | |
| 720p | 32 | | | | |
| 1080p | 12 | | | | |

Engine health at the end (Console): ____ · Pi log file attached: ____

## 8. Safety and clean‑up

- **Heat:** if `vcgencmd measure_temp` shows **above 75 °C**, stop all videos immediately and wait until it is
  **below 65 °C** before continuing. Record this as failure mode `Pi overheating`.
  If `get_throttled` is not `0x0`, write it down.
- **Data:** never use the school's real pupils, classes or content. Use only the test channel and test account.
- **Teaching time:** do not run during lessons that need the Wi‑Fi or Kolibri.
- **Clean‑up afterwards:**
  - close all tabs and sign out of the test account on every laptop;
  - stop the Pi log (`pkill -f i159-wifi`) and copy the log off (`scp pi@<sticker-name>.local:~/i159-wifi-*.log .`);
  - remove the test account and test channel from Kolibri if the school should not keep them;
  - delete synthetic test logs from the laptop;
  - check in the Console that the Engine and Kolibri are still healthy.
