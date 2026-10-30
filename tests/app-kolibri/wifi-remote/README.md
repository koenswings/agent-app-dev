# Remote Kolibri Wi-Fi field test: operating guide (idea#159)

> **Do not run this until [idea#391](https://github.com/koenswings/idea/issues/391) is decided.** That means no test Pi, no kit Engine, no production. Koen decided on 30 Oct 2026 that this is code only for now. Tests run locally or in CI. The full background is in [../WIFI-FIELD-TEST-REMOTE.md](../WIFI-FIELD-TEST-REMOTE.md).

## What it does
A temporary runner (`runner.mjs`) on the school Engine serves a player web page on port 3159. Teachers open the page on the classroom laptops, and the laptops play Kolibri videos at set times. The page sends its playback logs back to the runner. We control everything from our side, over Tailscale SSH to the Engine only. Nothing is installed on the laptops, there's no Tailscale on them, and there's no jump host. The laptops open every connection; the runner never contacts a laptop.

## Prerequisites
- Koen's go in idea#391.
- SSH as `pi` directly to the Engine's Tailscale address, with your own key.
- Node on the Engine: `/usr/local/bin/node` (v22 on kit Engines), or set `NODE`. No npm needed.
- Port 3159 free on the Engine, and `/tmp/i159` not present.
- `field.conf` copied from `field.conf.example`: `ENGINE_SSH`, `KOLIBRI_BASE` (the laptops' LAN address), `ENGINE_URLS` (both the `.local` and the 10.42.0.x address), `LAPTOPS`, and `QUALITIES` (Kolibri content md5s).
- A teacher at the school, and up to 4 laptops on the classroom Wi-Fi.

## 1. Preflight (first, about 2 minutes, one laptop)
```
CONF=./field.conf DRY_RUN=1 bash run-remote.sh preflight   # check the commands
CONF=./field.conf bash run-remote.sh preflight
```
**Teacher:**
1. Open `http://<engine>.local:3159/preflight?laptop=A`. If that doesn't load, use `http://10.42.0.x:3159/preflight?laptop=A`.
2. Click **Start check**, and leave the tab in front and full screen for about 2 minutes.
3. Report the big **PASS** or **FAIL**, and whether the screen went dark.

The script prints the table and exits non-zero on a FAIL. **Only continue if it's PASS and the screen stayed on.**

## 2. Field run
```
CONF=./field.conf bash run-remote.sh
```
**Teacher:**
1. On each laptop, open `http://<engine>.local:3159/?laptop=A` (B, C, D on the others). The fallback is `http://10.42.0.x:3159/?laptop=A`.
2. For the multi-tab steps, also open `&tab=2`, `&tab=3` and `&tab=4`.
3. Click **Start** on each tab. Keep each tab in front and full screen, and keep the lids open.
4. Close the tabs when we say we're done.

The script waits for the laptops to connect, then runs every quality and step (`DURATION` seconds each, then `COOLDOWN`), collects the logs, cleans up, verifies, and prints the summary.

## Safety stops
- **Before each quality:** wait for the Engine to drop under 65 °C. It gives up after `COOL_TIMEOUT` (default 30 min) with a clear message.
- **During a run:** above 75 °C the runner pauses the players and the synthetic ramp. They resume below 65 °C, and each pause is logged.
- **Throttling:** if `vcgencmd get_throttled` isn't `0x0`, the run aborts, both in preflight and during the run.
- **Load:** keep `SYNTH_N` small (2–4) so Kolibri stays responsive.
- **No unauthorised runs:** never on a kit Engine or a production host without Koen's go in idea#391.

## Cleanup (automatic, at the end or on Ctrl-C)
- **Stop:** `kill $(cat /tmp/i159/runner.pid)` and the Pi log's pid. No `pkill` or `pgrep`, no pm2, no systemd.
- **Quarantine:** `mv /tmp/i159 /tmp/i159.quarantine-<stamp>`. No `rm -rf`.
- **Verify (the run fails if any check fails):**
  - nothing listens on 3159;
  - both pids are gone;
  - `/tmp/i159` is gone;
  - the `pm2 jlist` names and states are unchanged;
  - Kolibri answers;
  - `throttled=0x0`.

## What it measures, and its limits
**Measured:** for each laptop, tab, quality and step:
- startup time, stalls, rebuffers per minute and errors;
- resolution, and dropped vs. total frames;
- event-loop lag and long tasks;
- network hints and JS heap;
- visibility and full-screen changes.

On the Engine: temperature, throttling, vmstat, memory and load. All timestamps use the Engine's clock.

**Limits:**
- **No real CPU %** on the laptops. Lag and long tasks stand in for it.
- **No screen-dim detection.** Frame gaps catch a hidden or undrawn tab, not a desktop dim, so the teacher is asked about it.
- **No Wake Lock** on a plain-http page, so it relies on playing video and the desktop settings.
- **No remote tab restart.** A closed or crashed tab needs a person; reconnects after a network drop are automatic.

## Tests
`node --test test/*.test.mjs` runs unit tests and local end-to-end tests with a fake player. No Pi is needed.
