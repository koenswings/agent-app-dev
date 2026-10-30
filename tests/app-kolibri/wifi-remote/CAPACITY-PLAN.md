# Kolibri serving capacity on one Pi: unattended measurement plan (idea#159)

Status: **plan only, nothing run.** Decisions by Steve (30 Oct 12:45 CET,
[#159 comment](https://github.com/koenswings/idea/issues/159#issuecomment-6521800435)):

- **Server: idea03** (Pi 5, like the kit Engines).
- **Load host: idea04** (Pi 4), sending the simulated clients over the fleet LAN.
- **Both pool Pis are claimed at once for the run; Steve has agreed to this.**
  - Claim: `update-fleet-state.sh <pi> status testing` and `claim Kid` for idea03 and idea04, with the
    note left untouched.
  - Release: the same way as #30, with the claim set to a real null and the status set to idle.
- **idea01 (golden) and idea02 stay untouched.**
- **RAM caveat:** idea03 has **less RAM than the 8 GB kit Engines**. The run records `free -m` and
  `/proc/device-tree/model`, and the report states this caveat.
Part of koenswings/idea#159. Reuses the `wifi-remote/` tooling (runner, sim-laptop, e2e-pi.sh guard and
cleanup, the thermal logic in lib.mjs) and the `scripts/` capacity tools from agent-app-dev#9.

## 0. Why run it again

#159 already has a LAN result: **≥128 paced streams at every quality, no hard failure**. That run used idea01
(**Pi 5**, 4 GB) as the server, idea04 as the client, and Kolibri **0.15.5**. The planning numbers came from
it: 360p **64**, 480p **32**, 720p **32**, 1080p **12** (rule: `32 × 902541 / bps`, capped at 50% of measured
SAFE). Three things are not covered yet:

1. **Kolibri 0.19.5 and viewer-side rules** on a Pi 5 server (idea03), with the clients on a separate host (idea04).
2. **The kit image.** The kit runs `koenswings/kolibri:1.1-0.19.5` (Kolibri 0.19.5), not 0.15.5.
3. **Viewer-side "safe".** The old success rule was ≥85% of the target bitrate on average. It did not
   measure stalls, start time, or whether a non-video user can still use Kolibri.

This plan measures those, unattended. It measures the **Pi's serving capacity over wired LAN (or
loopback)**, **not Wi-Fi airtime**. Wi-Fi capacity stays with the field run (WIFI-FIELD-TEST*.md, gated on
idea#391).

## 1. Definition of "safe" (per quality, per step N)

A step is **SAFE** only if every rule holds for the whole hold period. Thresholds marked **(proposal)** are
new numbers for Steve to confirm. The others come from #159 or #26.

| # | Rule | Threshold | Source |
|---|---|---|---|
| S1 | No stalls. Buffer model per stream: playback starts once 2 s of media is buffered, then drains at the file's measured bitrate. A stall is the buffer reaching 0. | no stall > 2 s, and ≤ 1 rebuffer per minute per stream, for **every** stream | #26 "smooth stream" |
| S2 | Sustained throughput per stream | ≥ 100% of bitrate over the hold (paced clients can't exceed it). Old rule ≥85% kept as a soft warning. | #159 (85%), tightened **(proposal)** |
| S3 | Time to first frame (TTFF ≈ time until 2 s of media is buffered, measured from the GET) | p95 ≤ **3 s** (accepted by Steve), max ≤ 5 s | Steve 30 Oct |
| S4 | A concurrent non-video user: Kolibri API probe every 2 s (`/api/public/info/`, a content-node list and the channel page HTML) | p95 ≤ **1000 ms** (accepted by Steve), no 5xx, no timeouts (10 s) | Steve 30 Oct |
| S5 | No HTTP errors | 0 × 5xx, 0 timeouts, 0 resets on video GETs | #159 "hard failure" |
| S6 | Thermal | Pi < **75 °C**, `get_throttled` = 0x0 for the whole step | #26 §8, runner rule |
| S7 | Memory | no OOM-kill (`dmesg`/journal check after), MemAvailable ≥ **150 MiB** | #159 |
| S8 | Health | Kolibri container up with an unchanged restart count; pm2 `engine` online; Engine responsive | #159 |
| S9 | Load (warning only) | loadavg1 ≤ 3 × nproc | #159 |

**Max safe N per quality** is the highest step where S1–S8 all pass. Hitting the top step means "≥ top".
We report it next to the planning N; the planning rule itself is not changed by this test.

## 2. Setup on idea03 (server)

**Preferred: a throwaway Kolibri compose** (Steve has already approved this pattern for #30) running the
**kit image `koenswings/kolibri:1.1-0.19.5`**, which is the image schools actually run.

- **Project and paths:** compose project `kid-cap-<stamp>`, scratch dir `/home/pi/kid-scratch-cap-<stamp>`,
  own port **≥ 3000** (e.g. 3190), bridge network.
- **Image:** cached if present, otherwise pulled and removed afterwards.
- **Pinned resources:** none. The Kolibri defaults are the kit defaults.
- **Content:**
  - Use the four fixture MP4s already measured in #159 (360p 370 kbps `cc504c3e…`, 480p 752 kbps
    `f64eb550…`, 720p 903 kbps `99ad895d…`, 1080p 2133 kbps `b560d819…`; 180 s, H.264 + AAC).
  - They are on the box under `/workspace/i159/content/qualities` and are copied with scp into the scratch
    dir as `KOLIBRI_HOME/content/storage/<m0>/<m1>/<md5>.mp4`, the same path Kolibri's WhiteNoise/Cheroot
    serves to students.
  - The API probe (S4) needs real channel metadata, so we also import one **small public channel** from
    Kolibri Studio with `kolibri manage importchannel`, metadata only, into the scratch KOLIBRI_HOME.
  - **Never** use kit or production disks, and never use anything under `/disks`.
  - **Plus one real public channel video** (Steve): import one video from a public Studio channel. Its
    bitrate is measured with ffprobe in the container (or from its file size and duration), and it is
    run as a fifth "quality" (`real`). Steve allowed pulling the image and importing the channel on the
    pool Pi.
- **Not used:**
  - A real Engine App instance. It would mean docking a Kolibri disk and touching Engine state.
  - The nginx stand-in runs only as a **control** at the last SAFE N of each quality. It separates "Kolibri
    or Python is the limit" from "the Pi, network or disk is the limit". 1 step per quality.
- **Engine:** left running and untouched (pm2 jlist unchanged), the same choice as #30. The result is then
  "Kolibri capacity with the Engine coexisting", which is the kit reality.

## 3. Load generator

- **Client:** `sim-laptop.mjs` in a new `--mode load` (no runner needed). It does N paced HTTP Range
  streams of `/content/storage/…/<md5>.mp4`.
  - Pacing is at the file's measured bitrate, with a 2 s startup buffer then real-time, like a player
    (not as fast as possible). It loops the file for the hold.
  - Per 1 s it logs bytes, buffer level, stalls and TTFF as JSONL.
  - One Node process can host many streams (an async loop, not one process per stream), so the client
    itself stays cheap.
  - `scripts/kolibri_stream_loadtest.py` from #9 stays as the cross-check for the old ≥85% metric.
- **Ramp:** N = **1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128**, continuing to **160, 192, 256** only if
  128 is still SAFE (Steve).
  - Each step: a 15 s ramp-in (streams staggered), a **120 s hold** (the #159 confirmation length), then
    30 s settle.
  - Qualities run in the order 360p, 480p, 720p, 1080p. The ramp for a quality stops at its first
    non-SAFE step (one confirmation retry of that step after cool-down, so a single hiccup doesn't decide
    it).
- **API probe:** a small `api-probe.mjs` (built-ins only), 1 virtual user, every 2 s, on the same host as
  the clients.
- **Where the clients run (decided):** on **idea04** (Pi 4), over the fleet LAN to idea03. One Node
  process holds many streams. The worst case is 256 × 2.1 Mbps ≈ 546 Mbps, which is below gigabit. The
  client host's CPU and NIC are sampled, so a client-side limit shows up as such. idea02 is not used.
  Tailscale is not used for the load (#159 showed it caps at ~1–2 Mbps); it is only the SSH control path.

## 4. What gets recorded

- **Per stream, per second** (JSONL): bytes, buffer s, stall start/end, TTFF, HTTP status, errors.
- **Per step summary:** stalls, rebuffers/min, throughput min/p5/mean vs bitrate, TTFF p50/p95/max, API
  p50/p95/max, errors.
- **Pi, every 2 s** (sampler started by nohup like run-remote.sh's pi.log, extended):
  - `vcgencmd measure_temp`, `get_throttled`;
  - `/proc/stat` CPU (total and per core), `/proc/loadavg`, `/proc/meminfo` (MemAvailable, swap);
  - `/proc/net/dev` rx/tx bytes for eth0 and lo;
  - `/proc/pressure/{cpu,memory,io}` if present;
  - disk read bytes for the SSD;
  - `docker stats --no-stream` for the Kolibri container (CPU %, mem);
  - the Kolibri/cheroot thread count from `/proc/<pid>/status`.
- **Before and after each quality:** container restart count, `dmesg | grep -i oom` delta, pm2 jlist.
- **Client host:** its own CPU sample, so a client-side bottleneck can be spotted.

## 5. Stop rules

- **Thermal (S6):** reuse `lib.mjs thermalNext`. Above **75 °C** pause the load (SIGSTOP the client
  process, as the runner does with the ramp) and mark the step **not SAFE (thermal)**. Resume below
  **65 °C**, then cool-wait < 65 °C before every step (COOL_TIMEOUT 900 s).
- **Throttle:** `get_throttled` ≠ 0x0 means **abort the whole run** and go to cleanup.
- **Safety:**
  - The first non-SAFE step (after its retry) ends that quality.
  - Kolibri down, an OOM, or the Engine unhealthy aborts the run.
  - MemAvailable < 100 MiB at any sample stops the step immediately **(proposal)**.
- **Time cap:** **3 h** total wall clock (hard). On the cap: stop, clean up, and report
  partial results.
- Deny-list guard from `e2e-pi.sh`: only idea03/idea04 plus an allowlist. The kit Engines, wh/idea,
  idea01 and idea02 are always refused. The protected disks are refused by ID, and Disk B and its instances
  are never touched.

## 6. Cleanup and verify (same as #30)

1. Kill by pid file (clients, probe, sampler); no `pkill`/`pgrep -f`/`rm -rf`.
2. `docker compose -p kid-cap-<stamp> down -v`, then remove any pulled image.
3. `mv` `/tmp/i159-cap*` and the scratch dir to `.quarantine-<stamp>`.
4. **Release checks** against the before-state captured at the start, all recorded in the evidence:
   - no listener on the test port;
   - pm2 jlist identical;
   - lsblk and losetup identical;
   - Disk B / any docked disk untouched;
   - `docker ps -a` and `docker images` **exactly** the same (IDs, names, images);
   - throttled 0x0.
5. Release **both** claims (idea03 and idea04): claim null, status idle.

## 7. Output

`results/cap-<stamp>/REPORT.md`:

- the conditions table (hardware, image, client option, bitrates);
- a per quality × N **PASS/FAIL table** (S1–S8 columns and the failing rule);
- **max safe N per quality** next to the current planning N and the old Pi 5 result;
- the peak temperature, the CPU/mem/NIC at max safe N, the bottleneck guess (CPU / NIC / disk / thermal /
  Kolibri);
- the release proof.

Raw JSONL stays alongside it. Steve copies the summary onto #159. **If max safe N differs from the
planning numbers, Kid opens a follow-up PR updating them, and Steve tells Koen.**

## 8. Runtime estimate

- **Per step:** about 165 s (15 + 120 + 30) plus a cool-wait.
- **Full ramp:** 12 steps ≈ 33 min per quality if nothing fails.
- **Qualities:** five (four fixtures plus the real channel video); a quality that fails early saves time.
- **Total:**
  - five qualities with controls and cool-waits ≈ **1.5–2.5 h**;
  - a hard cap of 3 h;
  - plus ~10 min for setup (pull, content copy, channel import) and ~5 min for cleanup.
- **Quick variant** (hold 60 s, N up to 64): ≈ 45 min.

## 9. Code changes needed (one PR, rough size)

| Change | Size |
|---|---|
| `sim-laptop.mjs --mode load`: N paced streams per process, buffer model, stall/TTFF JSONL | ~150 lines |
| `api-probe.mjs`: timed GETs, JSONL | ~60 lines |
| `capacity.sh`: orchestrator reusing the e2e-pi.sh guard, before/after state, cleanup, verify; ramp loop, stop rules, CLIENT=local\|<host> | ~250 lines |
| Pi sampler: extend the pi.log loop to JSONL with net/dev, pressure, docker stats | ~60 lines |
| `check-capacity.mjs`: S1–S9 per step, max safe N, REPORT.md (reuses lib.mjs summarise/markdown) | ~150 lines |
| Tests (node --test, local stub server: pacing, stall model, verdicts, guard refusals), README section | ~250 lines |

Total ≈ 900 lines. Built and tested on the box only (Node 20/22/24), then a DRY_RUN; the real run happens
on idea03 (server) and idea04 (load host) after both are claimed.

## 10. Decisions (Steve, 30 Oct 12:45 CET)

1. Server: idea03. Clients: idea04 over the LAN. Both pool Pis are claimed. idea01 and idea02 are untouched.
2. Thresholds accepted: TTFF p95 ≤ 3 s, API p95 ≤ 1 s.
3. Content: the #159 fixtures plus one real public channel video. Pulling the image and importing the
   channel on the pool Pi is OK.
4. Ramp to 128; go to 256 only if 128 is still SAFE.
5. If the results differ from the planning N, a follow-up PR updates them.
