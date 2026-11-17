# updtest rollback fixture (console / idea#243)

Throwaway App pair for Atlas to run on a pool Pi (idea01). It gives Pixel's
**Remove backup** button ([agent-console-dev#243](https://github.com/koenswings/agent-console-dev/issues/243))
a real `tempBackupState: kept` target.

**NOT for any release channel, catalog, school kit, or production Engine.**
Do not tag these versions on a real App repo, do not publish the image, and
do not add `updtest` to any app catalog.

| Version | Role |
|---------|------|
| `updtest` 1.0 (`apps/updtest-1.0`) | Healthy busybox httpd. Host port `${port}` → container 8080. Writes `data/updtest-marker.txt` and `data/visits.log`. |
| `updtest` 2.0 (`apps/updtest-2.0`) | Identical image and bind mounts. `x-app.updatesFrom: [1]` (major). Primary-service health check is `["CMD", "false"]` so it never becomes healthy. |

Image: `busybox:1.36.1@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662`
(top-level index digest; `linux/arm64` is in the index). `pull_policy: never`.
Data is a relative `./data` bind mount (idea#141); no named volumes and no
absolute host paths. `x-app.backup.method` is `stop` (not `none`) so a major
update without a linked Backup Disk takes a temporary system-disk backup
(engine#469). `healthTimeout` is 60 s (the check-compose minimum).

## Built trees

Build on the box (no containers are started):

```bash
# after docker pull --platform linux/arm64 and docker save of busybox:1.36.1
bash tests/fixtures/updtest/build-updtest-rollback-fixtures.sh \
  --out /workspace/kid-updtest/out \
  --image-tar /path/to/busybox-1.36.1-linux-arm64.tar
```

The script tags 1.0 and 2.0 only in a throwaway local git repo under `<out>/src`
(never pushed; Steve owns real App release tags). It runs `check-compose`
(`--release`, and `--base` / `--base-ref` for 2.0 vs 1.0) and
`build-app-bundle.sh`.

Hand-off copies for Atlas live at `/workspace/kid-updtest-243/` (see `HANDOFF.md`
there). The dockable tree is `disk-combined/`: `META.yaml` (`diskId: updtest243`),
`apps/updtest-1.0/`, `apps/updtest-2.0/`, and `services/busybox:1.36.1.tar`.

## How Atlas docks 1.0 and triggers the update

Same pattern as other fixture App Disks (idea#76 updtest trees, duration-test
software docks): copy the combined tree onto a spare App Disk (or a
software-dock folder) on idea01, dock it, then install and update through the
Engine. Do not use this on golden idea02. Leave any fixture already running on
idea01 (for example a docked Kolibri on sdb1) untouched.

Engine on idea01 must be **8c384bc** (or a later main that still has engine#469
and helper **v18**). Do **not** link a Backup Disk to the new instance — a
linked Backup Disk would satisfy `NEEDS_BACKUP` without creating the temporary
backup Pixel needs.

1. Copy `disk-combined/` onto the chosen disk so the mount root contains
   `META.yaml`, `apps/updtest-1.0/`, `apps/updtest-2.0/`, and `services/`.
   If the disk already has a `SHA256SUMS`, merge the tree's lines in; do not
   overwrite a live disk's checksum file. You may keep or replace `META.yaml`;
   `diskId: updtest243` is the fixture default (`isHardwareId: false`).
2. Dock the disk and wait until the Engine lists it.
3. Install a fresh 1.0 instance, sourcing the bundle from the same disk:

   ```text
   installApp updtest-1.0 <diskId> --source <diskId> --name updtest-243 --fresh
   ```

   `--name updtest-243` is the display name (`x-app.instanceName` / store
   `name`). The instance id and folder are a UUID the Engine generates; they
   never contain the display name. Default name without `--name` would be the
   appId `updtest-1.0`. Use a unique name on that Engine.
4. Wait until the instance is `Running` and `http://<idea01>:<port>/` returns
   `updtest 1.0`. The start command creates `data/updtest-marker.txt`, so the
   upcoming temp backup holds real content.
5. Trigger the major update (no Backup Disk linked):

   ```text
   updateApp updtest-243 updtest-2.0 --allow-major
   ```

   The name `updtest-243` is accepted; the UUID instance id also works. Both
   bundles are already on the instance disk, so `--source` is not needed.
6. Health fails after 60 s (`not healthy after 60 s`). The operation ends
   **Failed**. Rollback restores 1.0 and starts it. The temporary backup is
   **kept**.

## Expected result (Engine 8c384bc)

Confirmed in `src/data/UpdateApp.ts` and `docs/COMMANDS.md` at **8c384bc**
(engine#469):

- A major `updateApp` with live `x-app.backup.method` not `none`, no backup in
  the last hour, and no linked Backup Disk docked here, writes a Borg repo to
  `/.idea-temp-backups/<instanceId>/<UTC stamp>/` during Snapshot (`args.tempBackupState: created`).
- After the Health gate **passes**, that folder is deleted (`tempBackupState: deleted`).
- On **any** failure after the temp backup exists — including Health —
  `keepTempBackup` sets `op.args.tempBackupState` to **`kept`**, the operation
  is marked **`Failed`**, rollback restores the snapshot (and starts 1.0), and
  the error text ends with
  `; the temporary pre-update backup is kept at /.idea-temp-backups/<id>/<stamp>`.

So `updateApp 1.0 -> 2.0` on 8c384bc is expected to end **Failed** with
**`tempBackupState: kept`**. That kept path is the Remove backup button target.
The 2.0 container still serves HTTP (Start can pass); only the Docker
healthcheck is `false`. `healthGate` treats `unhealthy` as wait-until-timeout,
not an immediate fail, so the Health step lasts about `healthTimeout` (60 s).

## Cleanup

- `removeInstance` on the UUID instance id (quarantines the instance folder;
  it does not delete the temp backup).
- Remove the kept tree with the documented helper, only after Pixel is done:
  `sudo -n /usr/local/sbin/idea-app-data temp-backup-delete <instanceId> <stamp>`
  (or the Console Remove backup button).
- Undock and remove the fixture disk tree. Do not `docker image rm` shared
  images on the Pi; only drop `updtest` containers/projects this test started.
