# idea#413 hook-proof checklist

Operator steps for a pool Pi. The script itself does **not** claim or release
the Pi; do that around it, one Pi at a time (idea03 first, then idea04).

## Before the run

1. Pull `koenswings/idea` `main` and confirm the Pi is `idle`, `claim` null.
2. Pull fleet-state again immediately before writing.
3. Claim, leaving `note`, `pr` and `version` as they are:
   - `BOT_NAME=Kid tools/fleet/update-fleet-state.sh <pi> status testing`
   - `BOT_NAME=Kid tools/fleet/update-fleet-state.sh <pi> claim Kid`
   - Commit and push: `fleet-state: <pi> claimed by Kid (idea#413 hook proof)`.
4. Sync this directory onto the Pi as `pi` (do not edit the deployed Engine tree):
   - `scp -i ~/.ssh/id_ed25519 -r script/i413-hook-proof pi@<tailscale>:/home/pi/kid-i413-hook-proof`
5. SSH: `ssh -i ~/.ssh/id_ed25519 pi@<tailscale>`. idea03 is `100.126.117.80`, idea04 is `100.108.39.45`.

## Exact run command (on the Pi, as `pi`)

```bash
bash /home/pi/kid-i413-hook-proof/prove-hooks.sh
```

Dry-run (any host, including this box):

```bash
bash script/i413-hook-proof/prove-hooks.sh --dry-run
```

`--keep` leaves instances running (no teardown, no pm2 restore). Do not use that on a Pi you are about to release.

## What the script checks

- Hostname is idea03 or idea04 and fleet-state `claim` is Kid.
- Before/after snapshots: `docker ps -a`, `docker images`, `pm2 ls`, `lsblk`, `losetup -a`, plus a copy of `settings.json`.
- Scratch install of `kolibri@main`, `nextcloud@main`, `kiwix@main` onto the **System Disk** only (never `/disks`, never `/disks/sdb1`, never serials `AA202000000000004820`, `AA000000000000005638`, `3813430-532011020`, `20070Q450002`, never UUID `3E50-902A`).
- If `installApp` has no System Disk (deployed `config.yaml` still has `systemDiskSkip: true`), an **outside** `IDEA_CONFIG_FILE` copy is used, with only that flag set false. The deployed tree is not edited. At the end, pm2 is restored from `pm2.config.cjs` with no `IDEA_CONFIG_FILE` and no `IDEA_USAGE_AS_MAIN`, then `pm2 save`.
- Seeding (passwords follow `<account>911!` and are never printed):
  - Kolibri: facility “i413 Proof School”, `teacher1` (coach) and `learner1` sign in, learner views a Khan Academy G5A leaves-only slice.
  - Nextcloud: `admin`, `teacher1`, `learner1` log in; teacher opens Nextcloud Office so a WOPI token is issued (`oc_richdocuments_wopi`). The OCS document API alone only returns a direct-edit URL. `appsOpened` is Phase 3 and is not required.
  - Kiwix: several `/content/…` articles on the 62 KB CC0 stub ZIM.
- With monitoring ON, today’s day hooks run through the Engine’s own `runDayHook` (there is no live CLI for today’s file; the night window is 02:00–03:30 for yesterday, plus catch-up of past days). Exit codes and durations are checked against `timeoutS` (Kolibri 60 s, Nextcloud 30 s, Kiwix 30 s; Engine clamp 120 s).
- §2 / contract §5.3 fields present and non-zero where activity was seeded (see the evidence file).
- Switch OFF: backup `settings.json`, write off, SIGHUP the live `idea-usage` process, wait one 60 s poll, prove no hook ran and no day file changed, restore the exact backup bytes, verify ON as `{"usageMonitoring":"on"}` plus a newline, `pi:pi`, mode `0640`.
- Teardown: `stopInstance <id> <diskId>`, `removeInstance`, `docker rm` without `-v` for any Exited leftovers (#311). New images not in the before snapshot are removed. Data is moved to `/home/pi/kid-quarantine/i413-<ts>/`, never deleted. After snapshots are diffed.
- Thermal: pause above 75 °C, resume below 65 °C. No `rm -rf`, `pkill -f`, `pgrep -f`, `dd`, `mkfs`, wipe, or `archive-and-clear`.

## After the run

1. Confirm Atlas’s end state on the Pi:
   - `settings.json` is exactly `{"usageMonitoring":"on"}` followed by a newline, owned `pi:pi`, mode `0640`.
   - `engine` and `idea-usage` run as `pi` from `pm2.config.cjs`, with no `IDEA_CONFIG_FILE` or `IDEA_USAGE_AS_MAIN`; `pm2` is saved.
   - Scratch instances are gone; leftovers are under `/home/pi/kid-quarantine/i413-<ts>/`.
2. Copy `$RUN_DIR/EVIDENCE.md` off the Pi (the script prints the path).
3. Release, leaving `note`, `pr` and `version` as they are:
   - `BOT_NAME=Kid tools/fleet/update-fleet-state.sh --null <pi> claim`
   - `BOT_NAME=Kid tools/fleet/update-fleet-state.sh <pi> status idle`
   - Commit and push: `fleet-state: <pi> released by Kid (idea#413 hook proof)`.
4. Only then claim the next Pi. Never both at once. Do not use idea04’s WD SSD (`20070Q450002`) or `/disks`.

## Evidence

The script writes a per-Pi `EVIDENCE.md` in the quarantine run directory. The ready-to-paste idea#413 comment that covers both Pis is composed after both releases; it is not posted by this script (opening issue comments needs Koen’s approval).
