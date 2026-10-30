# Kolibri Wi-Fi field test, run remotely (idea#159)

This is the remote version of [WIFI-FIELD-TEST.md](WIFI-FIELD-TEST.md): the same steps and pass rules, but we run it from our side. **Teachers only open a web page.**

**Design (option B, approved by Steve, 30 Oct 2026):** a temporary runner on the school Engine serves a player page. Laptops need **nothing installed**: no Tailscale, no SSH, no Node, no keys. This resolves decision D-1 on idea#375. There's no Tailscale on the laptops and no jump host. We reach only the Engine, directly over Tailscale.

> **Code only: not to be run anywhere until [idea#391](https://github.com/koenswings/idea/issues/391) is decided.** That means no test Pi, no kit Engine, no production. Koen's decision, 30 Oct 2026. Tests run locally or in CI only. The short operating guide is [wifi-remote/README.md](wifi-remote/README.md).

## 1. How it works

```
us --Tailscale SSH--> Engine: /tmp/i159/runner.mjs (port 3159, nohup, Node built-ins only)
laptop Chrome --LAN--> http://<engine>.local:3159/?laptop=A   (page opens every connection)
   GET  /events   server-sent events: hello / start-at-T / pause / resume / stop
   POST /ping     clock sync (fastest of 5 round trips, repeated every minute)
   POST /results  JSONL upload every 5 s, retried; deduped by sequence number
laptop Chrome --LAN--> Kolibri video (same content URLs as before)
```

**Pull model:** the router firewall rejects new connections from the Engine to the laptops (students 10.42.1.x, teachers 10.42.2.x, default REJECT), so the runner never dials a laptop. Student SSID isolation doesn't affect this. Laptop-to-Engine traffic is the normal school path.

The runner:
- Turns page times into Engine times, so all logs share one clock.
- Writes `results/<laptop>-<quality>-<step>-tab<n>.jsonl` in the existing `lib.mjs` format, so `summarise.mjs` works unchanged.
- Logs connects, reconnects, tab visibility and full-screen changes.
- Accepts `/control/*` from 127.0.0.1 only, and `run-remote.sh` drives it over SSH.

**Thermal (Atlas):**
- Before each quality, it waits for the Engine to drop under 65 °C. Engines idle at about 67 °C. The wait has a timeout (`COOL_TIMEOUT`) and logs a clear abort message if it runs out.
- During a step, the runner reads `/sys/class/thermal`. Above 75 °C it pauses the players and the synthetic ramp (SIGSTOP), resumes below 65 °C, and logs each pause.
- It **aborts** if `vcgencmd get_throttled` is not `0x0`.
- Keep `SYNTH_N` modest (2–4) so Kolibri stays responsive.

## 2. Preflight first (about 2 minutes, one laptop)

**The field run goes ahead only if the preflight passes.** There's no reachable Pi 400/500 learner client in our lab, so open checks 1 and 2 (§5) are answered here, at the school, as part of the field-run go.

**Us:** `CONF=./field.conf bash wifi-remote/run-remote.sh preflight`. It starts the runner exactly as for the field run (nohup, port 3159), waits for a result, prints a PASS/FAIL table (`preflight.md`), then does the same cleanup and verify. The exit code is non-zero on any FAIL or if no result arrives.

**Teacher:** on one laptop, open `http://<engine>.local:3159/preflight?laptop=A`. If it doesn't load, use `http://10.42.0.x:3159/preflight?laptop=A`.
1. Click **Start check**.
2. Leave the tab in front and full screen for about 2 minutes, and don't touch the laptop.
3. The page shows a big **PASS** or **FAIL**.
4. Tell us the verdict, and **whether the screen went dark or dim**.

| Item | Required | What the page checks |
|---|---|---|
| page_loaded | yes | which URL loaded (`.local` or the IP) |
| fetch / events / post | yes | Chrome policy or local-network access lets the page fetch, open the event stream, and POST to :3159 |
| other_url | info | probes the other URL (`.local` ↔ 10.42.0.x) through CORS, so we learn whether both work |
| playback | yes | about 2 min of muted Kolibri video: plays, no errors, no stalls hidden |
| stayed_visible | yes | no `visibilitychange` to hidden |
| no_throttle | yes | a 1 s timer is never more than 1.5 s late (Chrome throttles hidden or occluded tabs) |
| no_frame_gaps | yes | no `requestAnimationFrame` gap over 1 s |
| fullscreen | info | stayed full screen |
| wake_lock | info | expected to **FAIL**: plain http isn't a secure page |

**Limits (what a page can't know):**
- A page can't see the real display state. rAF stops when the tab is hidden, occluded or not being drawn. But a desktop idle dim, or a display-off that doesn't stop the compositor, may not show up as a gap. That's why the teacher's own "did the screen go dark?" answer is part of the result.
- The page can't stop the desktop idle timer. Wake Lock would need https or localhost.
- If the desktop blanks the screen during a 2-minute check, the real 3-minute steps will blank too, so a FAIL here stops the run.
- A PASS over 2 minutes doesn't prove a 20-minute session. The field logs keep recording visibility and frame data, so a later blank still shows up in the results.

## 2b. Teacher steps (field run, after a PASS)

1. Turn on each test laptop and let it join the classroom Wi-Fi as usual.
2. In Chrome, open **`http://<engine>.local:3159/?laptop=A`** (B, C, D on the other laptops). If that doesn't load, use **`http://10.42.0.x:3159/?laptop=A`**; we'll tell you the number.
3. For the multi-tab steps, also open `...&tab=2`, `&tab=3` and `&tab=4` on each laptop.
4. Click **Start** once on each tab. That click is the user gesture that lets the video play, and it puts the page full screen.
5. **Keep the tab in front and full screen.** Don't close it, don't switch tabs, and don't let the lid close. If the screen goes dark, tap a key; the page reconnects and rejoins by itself.
6. When we say we're done, close the tabs.

## 3. Running it (us)

```
cp wifi-remote/field.conf.example field.conf     # fill in ENGINE_SSH (Tailscale), KOLIBRI_BASE (LAN), md5s
CONF=./field.conf DRY_RUN=1 bash wifi-remote/run-remote.sh   # check the commands
CONF=./field.conf bash wifi-remote/run-remote.sh
```

**Preflight:**
- Picks `NODE`: `/usr/local/bin/node` (v22.20.0 on kit Engines), falling back to `command -v node`.
- Requires `throttled=0x0`.
- Records the pm2 process names.
- Checks that `/tmp/i159` doesn't exist and port 3159 is free.

**Run:**
- Copies the runner to `/tmp/i159`.
- Starts it and the Pi log with **nohup** only. No pm2, no systemd.
- Waits for the pages to connect, then runs each step: start at T, `DURATION` seconds, then `COOLDOWN`.

**Cleanup:**
- Collects the logs, then `kill $(cat /tmp/i159/runner.pid)` (and the Pi log's pid).
- `mv /tmp/i159 /tmp/i159.quarantine-<stamp>`.
- **No `rm -rf`, no `pkill -f` or `pgrep -f`.**

**Verify (fails the run if any check fails):**
- Nothing listens on 3159.
- Both pids are gone and `/tmp/i159` is gone.
- `pm2 jlist` names and states are unchanged.
- The Engine is healthy: Kolibri answers and `throttled=0x0`.

**Tests:** `node --test wifi-remote/test/*.test.mjs` (Node 20, 22 and 24). They include a local end-to-end test: the real runner, a fake player, the clock offset, start at T, merging retried uploads, heat pause and resume, the throttle abort, and kill-plus-quarantine cleanup.

**Lab mode:** `play-and-log.mjs` (Chrome over its debugging port, one laptop) stays as an optional lab tool. It needs Node and SSH on the laptop, so it can't be used on school clients.

## 4. What is measured, compared with the Chrome-script mode

| | Player page (B, field) | Chrome script (lab) |
|---|---|---|
| Video events, stalls, startup, resolution, dropped/total frames | yes (`<video>` + `getVideoPlaybackQuality`) | yes |
| CPU | no /proc; **event-loop lag, long tasks**, `performance.memory` heap | no (same page APIs) |
| Network hint | `navigator.connection` (type, downlink, rtt) | `iw` link in preflight |
| Remote control | start, pause, stop; crashed or closed tabs need a person | full (opens tabs itself) |
| Autoplay | Start click, muted; fine | muted autoplay |
| Screen sleep / tab throttling | **Wake Lock needs a secure page, so it doesn't work on plain http.** We rely on playing video and log `visibilitychange` | same desktop |
| Clock | NTP-style offset, Engine time in every log | laptop clock |

## 5. Open checks

1. **Plain-http screen blank and tab throttling (stays open):** no Pi 400/500 learner client is reachable from the lab, so the school preflight (§2) checks it.
2. **Chrome policy and mDNS (stays open, preflight):** does the client Chrome policy (`LocalNetworkAccessAllowedForUrls`) allow `http://<engine>.local:3159`? Does client-side mDNS resolve `<engine>.local`? If not, use the `http://10.42.0.x:3159` fallback.
3. **Laptop count and teacher timing:** for Steve and Marco.
4. **Running it at all:** tracked in [idea#391](https://github.com/koenswings/idea/issues/391), together with checks 1 and 2.

## 6. Option A (not used)

We considered jumping through the Engine to the laptops (`ssh -J`). It's **blocked**:
- The router firewall rejects Engine-to-laptop connections.
- It breaks the "never through a jump host" rule (`docs/ops/security-overview.md`).
- The client image allows SSH for `admin` only, with the support keys.
- admin's sudo needs a password, so `sudo -n` fails.
- The client image has no Node, and its root file system resets on reboot.
