# Kolibri Wi‑Fi field test — remote‑run version (idea#159)

This is the remote version of [WIFI-FIELD-TEST.md](WIFI-FIELD-TEST.md). The goal, the qualities
(360p / 480p / 720p / 1080p), the 3–4 laptops, the step order (§5), the definitions (§3), the pass criteria (§6)
and the heat rules (§8) all stay the same. What changes is **who does what**:

- **Teachers** only do the setup in §2: laptops on, on mains, placed where the students sit, and a few notes.
- **We** (IDEA team, from our side over Tailscale) start everything else: the Pi log, a scripted browser player
  on every laptop instead of people counting stalls, the optional synthetic ramp, and collecting the logs.

Steve still schedules it on [idea#375](https://github.com/koenswings/idea/issues/375); results go to idea#159.

## 1. Files (`tests/app-kolibri/wifi-remote/`)

| File | Runs on | Does |
|---|---|---|
| `play-and-log.mjs` | each laptop | Starts Chrome (headed kiosk by default), opens the Kolibri video in 1–N tabs, logs HTML5 video events to JSONL, writes a summary JSON |
| `lib.mjs` | anywhere | Event parsing, stall/rebuffer maths, LAN‑only URL guard (shared by the player and the summariser) |
| `run-remote.sh` | our admin machine | SSHes to the laptops and the Pi, syncs the start time, runs every quality × step, starts the Pi log and the optional synthetic streams, collects everything into `results/…`, summarises |
| `summarise.mjs` | our admin machine | Turns all JSONL logs into `summary.md` / `summary.json`: per laptop/tab and per quality/step |
| `field.conf.example` | — | Template for the per‑school config (no secrets) |
| `test/lib.test.mjs`, `fixtures/` | — | `node --test tests/app-kolibri/wifi-remote/test/*.test.mjs` |

What the player logs per tab (one JSON object per line, `t` = ms since epoch):
`start` (laptop, quality, step, tab, URL, browser user agent), `playing`, `waiting`, `stalled`, `pause`, `ended`,
`error` (with code), `resize`, `seeking`, and once a second `quality` with `videoWidth`/`videoHeight`,
`currentSrc` (the rendition actually chosen), `getVideoPlaybackQuality()` dropped/total frames, seconds buffered
ahead and `readyState`; finally `end`.

The summariser computes per stream: startup time, **stall count**, **total and longest stall**, **rebuffers per
minute** (the first wait before playback starts is startup, not a rebuffer; a `waiting` + `stalled` pair counts
once), **dropped frames**, resolution and whether it dropped, and **smooth yes/no** using the plan's definition:
no stall over 2 s, at most 1 rebuffer per minute, no resolution drop, no error.

## 2. Teacher checklist (the only on‑site part)

Print this. It takes about 15 minutes, once, before the agreed test time.

1. Switch on the Pi and the router as usual. Check the Console shows the Engine running (`http://<sticker-name>.local`).
2. Switch on the 3–4 test laptops and **plug each into mains power**. Do not let them run on battery.
3. Put each laptop **where students normally sit**, lid open. Label them **A, B, C, D** with a sticky note.
   Put A closest to the router and D furthest away.
4. Leave them logged in on the desktop and connected to the school Wi‑Fi. Close other programs. Don't close the lid.
5. Fill in the form below and send a photo of it (or the answers) to the IDEA team.
6. During the test (about 2 hours), the laptops play videos by themselves. Please don't use them, and keep the
   room as it is on a normal day (other devices on the Wi‑Fi are fine — just write them down).
7. Afterwards, nothing to do: we clean up remotely. You can switch the laptops off when we tell you we're done.

**Teacher form**

| Item | Answer |
|---|---|
| School / sticker name | |
| Date and agreed start time | |
| Room (name, rough size in metres) | |
| Where is the router? (room, height, e.g. "on cupboard, 2 m") | |
| Other devices on the Wi‑Fi during the test (phones, other computers, roughly how many) | |
| Room temperature (warm / normal / cool) | |

| Laptop | Make / model (sticker) | Distance to router (metres) | Walls between laptop and router | On mains? |
|---|---|---:|---:|---|
| A | | | | |
| B | | | | |
| C | | | | |
| D | | | | |

We read signal strength (RSSI), channel, band, OS and browser version ourselves in the preflight (§5 step 1).

## 3. What the laptops need, and how we reach them

### 3.1 Classroom computers with the IDEA client image

The IDEA client image exists (`koenswings/idea` `tools/client-image/`, manual `install-manual-classroom-computer`):
Ubuntu Desktop 26.04 on a Pi 400 / Pi 500, **Google Chrome** (official arm64, has H.264/AAC), `openssh-server`,
a hidden `admin` account with SSH **key‑only** (`AllowUsers admin`, local password `admin911!` by convention for
`sudo`), the `learner` account with Wayland autologin and no password, and an `overlayroot` root file system.
It does **not** include Node.js or Tailscale, and holds no SSH keys (keys are added at flash time, idea#322).

So on client‑image machines we still need, per laptop:
- **Node.js ≥ 22** (the player has no npm dependencies; it drives Chrome over the DevTools protocol with Node's
  built‑in `fetch`/`WebSocket`). Put an arm64 Node tarball in `/var/tmp/i159/` — no apt, no package changes.
  Because of `overlayroot`, anything written outside persistent storage is gone after a reboot; that is fine
  (and is our clean‑up), but don't reboot during the test.
- **Our test admin SSH key** in `admin`'s `authorized_keys` (as the acceptance check `first-login-check.sh` already uses).
- A way to start Chrome on the learner's desktop: `LAUNCH_PREFIX` in `field.conf` runs the player as `learner` with the
  Wayland session env. That needs either a `sudo -n` rule for `admin` → `learner` for this command, or running the
  player as `admin` with `--headless` (works with Google Chrome; see §7 codecs).
- Power settings: screen blank/suspend off for the test (`gsettings` as learner, or `systemd-inhibit` around the player).

A future client image could ship Node and a `i159` sudo rule so none of this is needed; that is a proposal, not done.

### 3.2 Other laptops (Windows / macOS / plain Linux): one‑time install

Done once by someone with admin rights (an IDEA installer, not a teacher):
1. Google Chrome (not Chromium: see §7), Node.js ≥ 22, and this folder copied to the laptop.
2. An SSH server with our admin key only (Linux/macOS: `openssh-server`, key only; Windows: OpenSSH Server feature).
3. Reachability per §3.3 below.
4. Power plan "never sleep" on mains, screen never off, Windows Update / Chrome update paused for the day.

Windows: `run-remote.sh` assumes a POSIX shell on the laptop. On Windows, run the player by hand over SSH
(`node play-and-log.mjs … --chrome "C:\Program Files\Google\Chrome\Application\chrome.exe"`) or use WSL; the
orchestrator for Windows is not written yet.

### 3.3 Reachability (Tailscale rules)

The fleet rules ([idea `docs/ops/security-overview.md`](https://github.com/koenswings/idea/blob/main/docs/ops/security-overview.md)):
one fleet tag `tag:idea` and one fleet auth key, no school tags, admins → `tag:idea` allowed, `tag:idea` → anything denied
(no Pi‑to‑Pi over Tailscale). Today **only Pis and routers** are on the tailnet; classroom computers are not.

Two ways to reach the laptops, both need a decision by Koen (for Steve's list, [idea#375](https://github.com/koenswings/idea/issues/375)):

- **A. Laptops join the tailnet** for the test (Tailscale + fleet key + `--advertise-tags=tag:idea
  --accept-routes=false --accept-dns=false`, hostname `idea-pc-…`). Admins can then SSH to them under the existing ACL,
  no ACL change needed — but it puts student machines under the fleet tag and the fleet key on them, which the rules
  never planned for. Alternative: a separate tag (e.g. `tag:idea-client`) plus an `admins → tag:idea-client:22` ACL line:
  that **is** an ACL change. Remove them from the tailnet after the test.
- **B. Jump through the school router** (`SSH_JUMP=root@<router tailscale IP>` in `field.conf`), then SSH to the laptops on
  the school LAN. No tailnet change, but the router needs an SSH key that may log in to the laptops, or agent forwarding.
  (The Pi itself is still reached **directly** over Tailscale, never through a jump host.)

Koen action items (to list on idea#375, not done here): choose A or B; if A with a new tag, add the ACL line; approve which
SSH key goes on the test laptops.

**Laptop → Pi traffic must cross the school Wi‑Fi under test, never Tailscale.** `KOLIBRI_BASE` is
`http://<sticker-name>.local:<port>` or the Pi's LAN IP (`10.42.x.x`). Both the orchestrator and the player refuse a
Tailscale address (`100.64.0.0/10`, `*.ts.net`). With option A keep `--accept-routes=false`, so the LAN route is used.
Only control traffic (SSH, a few kB) goes over Tailscale.

## 4. Before the day (our side)

1. Seed the test channel with the four videos (WIFI-FIELD-TEST.md §1), note each video's content **MD5** and measured bitrate.
2. Copy `field.conf.example` to `field.conf` (outside git): `KOLIBRI_BASE`, `PI_SSH` (Pi Tailscale IP), `LAPTOPS`,
   `QUALITIES` (`360p=<md5>:<bps> …`), optional `SSH_JUMP`, `LAUNCH_PREFIX`, `SYNTH_N`.
3. `CONF=field.conf DRY_RUN=1 bash run-remote.sh` and read the commands.
4. Laptop setup per §3 done and SSH tested to each laptop.

## 5. Run procedure (remote)

```bash
cd tests/app-kolibri/wifi-remote
CONF=~/i159/field.conf bash run-remote.sh
```

What it does:
1. **Preflight** per laptop: Node and Chrome versions, a timed request to Kolibri over the LAN, and `iw dev … link`
   (RSSI, frequency/band, bitrate) → `preflight-<laptop>.txt`. Then copies the player to `/var/tmp/i159/`.
2. **Pi log** started over Tailscale (same fields as WIFI-FIELD-TEST.md §4.3, every 10 s) → collected as `pi.log`.
3. For each quality in order 360p → 1080p, for each step in `STEPS`
   (default `L1:1:1 L2:2:1 L3:3:1 L4:4:1 T2:4:2 T3:4:3 T4:4:4` = name : laptops : tabs per laptop), it sets a
   **common start time** 20 s ahead and starts the player on the needed laptops; they all begin together and play
   `DURATION` (180) s. With `SYNTH_N>0` the Pi also runs `kolibri_stream_loadtest.py` with that many paced streams
   against itself (`PI_LOCAL_URL`) at the same moment. Synthetic streams from the Pi don't use the Wi‑Fi; they add
   Pi‑side load only, so the real laptops show whether the Pi or the Wi‑Fi gives out first.
   Raise `SYNTH_N` in later runs (8, 16, 32 …) as in WIFI-FIELD-TEST.md §5.1, or add longer `STEPS` (T5, T6 …) up to
   4× planning N.
4. After each step: if the Pi is **above 75 °C** it stops that quality (hard fail `Pi overheating`). Before each quality it
   waits `COOLDOWN` (120 s) and until the Pi is **below 65 °C**.
5. **Collect**: copies every laptop's `out/` into `results/<date>/<laptop>/`, stops the Pi log and fetches it, fetches
   synthetic logs, then runs `summarise.mjs`.

The router is not required to run anything. If a router‑side Wi‑Fi log is wanted (associated clients, signal), it can be
added later on the router over Tailscale; it is not part of this version.

## 6. Outputs and pass/fail

`results/i159-<date>/`: `run.log`, `preflight-*.txt`, `stdout-*.txt`, `<laptop>/*.jsonl` and `*.summary.json`,
`pi.log`, `synth/` (if used), and **`summary.md`** / `summary.json` with two tables:
- per stream: laptop, quality, step, tab, smooth, stalls, total stall s, longest stall s, rebuffers/min,
  dropped/total frames, resolution, startup s;
- per quality × step: streams, all smooth, stalls, total stall s, worst rebuffers/min, dropped frames.

Fill WIFI-FIELD-TEST.md §7 from these: the highest step where **All smooth = yes** gives the "Max smooth streams (Wi‑Fi)"
per quality, and the first NO row gives the first failure mode (stalls → `buffering`, resolution drop → `quality drop`,
`error` events → `Kolibri error` or `page timeout`, Pi log → `Pi overheating`).
Pass criteria are unchanged (WIFI-FIELD-TEST.md §6): reach the smaller of planning N (64 / 32 / 32 / 12) or what the
laptops can physically play; Pi above 75 °C, a Kolibri error or an unhealthy Engine is a **hard fail**. A high
dropped‑frame count with no stalls while the Pi is idle points to a **laptop** limit, not Wi‑Fi: note it.

## 7. Risks

- **Codecs.** Kolibri videos are H.264/AAC MP4. Google Chrome plays them headed and headless; **Chromium builds,
  especially headless or distro snaps, may lack H.264** and log `error` code 4 at once. Use Google Chrome (the client
  image already has it) and headed `--kiosk` (the default); `--headless` only when a desktop session can't be used.
- **Sleep / power.** Laptops that sleep, dim, or throttle on battery invalidate the run. Mains power, sleep off, lid open.
  The player keeps background tabs playing (`--disable-background-media-suspend`, no renderer backgrounding), but an OS
  sleep stops everything: check `stdout-*` for gaps.
- **Windows vs Linux.** The orchestrator expects a POSIX shell and `iw` (Linux). macOS/Windows need the manual route in §3.2
  and RSSI read by hand (`netsh wlan show interfaces`). Different OSes give different decode cost: compare like with like.
- **Overlayroot (client image).** Files in `/var/tmp/i159` vanish on reboot. Collect before any reboot.
- **Clock skew.** The common start time uses each laptop's clock. Laptops on the school network get time from the router;
  a few seconds of skew is fine, minutes is not — check `t` of the `start` lines across laptops.
- **What's not proven yet.** The player was exercised here against a local HTTP server with Google Chrome headless
  (2 tabs, 720p, smooth, frames counted). It has **not** run against a real Kolibri on a Pi over Wi‑Fi, on a client‑image
  machine, or on Windows. Do a 1‑laptop dry run at an office Pi before the school day.

## 8. Clean‑up (remote)

`run-remote.sh` stops the Pi log and removes its pid file. Afterwards: delete `/var/tmp/i159` on each laptop (the client
image loses it on reboot anyway), remove the test SSH key, take laptops off the tailnet if option A was used, and remove
the test account/channel from Kolibri if the school should not keep them. Check the Console that the Engine and Kolibri
are healthy.
