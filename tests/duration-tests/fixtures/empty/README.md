# Empty duration-test disk (`duration-empty-001`)

**Purpose:** Dockable disk that Engine classifies as `empty` so Console shows
`EmptyDiskPanel` (Install App / Make Files Disk / Make Backup Disk). Used by
Axle Prefer A for `install_app`, `make_files_disk`, `make_backup_disk` — **not**
a remap onto Path A Kolibri/Nextcloud Grade 5A.

## Stable IDs

| Field | Value |
|-------|-------|
| diskId | `duration-empty-001` |
| Source tree | `tests/duration-tests/fixtures/empty/` |
| Suggested Atlas slot | `idea-test-3` (leave `idea-test-1` / `idea-test-2` for Grade5A kolibri + nextcloud) |

## What makes it empty

Engine (`Disk.ts`): `detectedTypes.length === 0` → push `empty`.

- **Present:** `META.yaml` only (plus this README for humans; ignored by role detect)
- **Absent:** `apps/` (→ not App Disk), `instances/`, `FILES.yaml`, `BACKUP.yaml`, `files/`, `backups/`
- **No Running apps** — nothing to auto-start; DiskView stays empty → EmptyDiskPanel

Do **not** add an `apps/` directory even if empty — `isAppDisk` is `test -d …/apps`.

## Atlas dock (testMode — Prefer A alongside Grade5A)

Roots (never `/disks`, never idea02, never idea03 Intenso `sdb1`):

```text
IDEA_DISKS_ROOT=/home/pi/idea/duration-disks
IDEA_WATCH_DIR=/home/pi/idea/duration-watch
```

Manual / one-shot (suggest **idea-test-3**):

```bash
# On claimed pool Pi (idea01 or idea03) — App#10 tree synced under agent-app-dev
SRC=/home/pi/idea/agents/agent-app-dev/tests/duration-tests/fixtures/empty
DEST=/home/pi/idea/duration-disks/idea-test-3
WATCH=/home/pi/idea/duration-watch

mkdir -p "$DEST" "$WATCH"
rsync -a --delete "$SRC/" "$DEST/"
# Confirm META diskId
grep -F 'diskId: duration-empty-001' "$DEST/META.yaml"
# Sentinel: unlink then touch (chokidar needs create, not mtime-only)
rm -f "$WATCH/idea-test-3"
sleep 5
touch "$WATCH/idea-test-3"
```

**RealFleetOps:** Axle `infra_dock_fixture` with `diskId: duration-empty-001` and
pack path above; allocator prefers free `idea-test-N` — pin slot 3 in walk YAML /
`DURATION_*` if Grade5A already owns 1–2.

**Undock:** `rm -f $WATCH/idea-test-3` (then eject via FleetOps if needed). Keep
the tree under `duration-disks/idea-test-3/` or wipe after Prefer A.

## Console / Pixel

After dock + store settle: select disk `duration-empty-001` in NetworkTree →
right panel `empty-disk` (`EmptyDiskPanel`). No demo remap; live `demoMode=false`.

## Constraints

- Separate diskId from Path A Running packs (`duration-kolibri-grade5a-001`,
  `duration-nextcloud-grade5a-001`)
- Do not merge App#10 until Koen asks
- Never golden idea02
