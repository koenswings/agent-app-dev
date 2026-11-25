# App and App Disk conventions

How a school App is laid out and declared, as the Engine and
`script/check-compose.mjs` implement it. App data uses `./data` bind mounts on
the App Disk, never Docker named volumes
([idea#141](https://github.com/koenswings/idea/issues/141), decided 2026-10-29).

## Layout on an App Disk

```
META.yaml                     # disk identity (Engine DiskMeta)
apps/<appId>/                 # release bundle (see app-bundle-integrity.md)
  compose.yaml
  SHA256SUMS
  hooks/, …                   # App files from the repo
instances/<id>/               # one installed instance
  compose.yaml
  .env                        # Engine-written: port, pass, …
  data/                       # App data (bind-mounted as ./data)
services/<image>.tar          # docker-save of each service image (disk root)
SHA256SUMS                    # disk-root checksums
```

`<appId>` is `<x-app.name>-<x-app.version>`. The disk-root `META.yaml` identifies
the disk; `compose.yaml` lives in the bundle and in each instance folder, not at
the disk root. A Files Disk also has `FILES.yaml` and `files/`; a Backup Disk
has `BACKUP.yaml`.

## `compose.yaml`

The compose file is the App manifest. Every service must:

- use an ARM64 image (`docker manifest inspect`, linux/arm64). A `--release`
  build also pins `repo:<tag>@sha256:<64 hex>` and has no `build:` block
- carry label `x-app-version` equal to `x-app.version` (and to the release tag
  when the bundle is built from a tag)
- publish no host port below 3000 (the Engine assigns from 3000)
- put a Docker `healthcheck` on the primary service

`restart: no` is required on every service when the App uses `x-app.filesMount`
(the Engine decides when to start or recreate; see [files-mount.md](files-mount.md)).

### Volumes (idea#141)

- **App data** goes in relative `./data` (or `./data/…`) bind mounts on the App
  Disk, relative to the instance folder, so the data travels with the disk.
- **Never** Docker named volumes for App data.
- **Never** absolute host-path binds in the App's `compose.yaml`.
- **Engine-generated Files Disk binds** (and USB-stick binds from
  `x-app.usbMount`) are allowed: the Engine writes them in a compose override.
  Do not list those binds in the App compose file.
- Other **relative binds** that live on the App Disk are normal App content:
  hook scripts, entrypoint wrappers, config next to `compose.yaml`. Ephemeral
  files that are not App data (for example Kiwix's `./logs` access logs) may
  also use a relative bind outside `./data`.

### `x-app` metadata

Required identity: `name`, `title`, `version` (`<major>.<minor>[-<upstream>]`;
the Engine must not read it as unversioned — no date-shaped suffix, see
`lib/check-compose.mjs`). Optional but expected on a release:

| Field | Role |
|-------|------|
| `healthCheck: {path, expect?}` | updateApp Health probe on the instance's main port (2xx/3xx, and `expect` when set) |
| `healthTimeout` | seconds the health gate waits (integer 60–7200). Use a measured value; `600` is only a placeholder when unmeasured |
| `updatesFrom: [<major>…]` | earlier App majors this release may update from; a first major uses `[]` |
| `migrationNote` | shown before a major update |
| `snapshotExclude` | paths left out of the pre-update snapshot (rules below) |
| `backup` | live backup contract; see [backup-hook.md](backup-hook.md) |
| `update` | optional stages `prepare` / `verify` / `work` / `settle`; see [app-bundle-integrity.md](app-bundle-integrity.md) |
| `filesMount` / `usbMount` | Files Disk / USB stick opt-in |
| `usage` | `{service, command, timeoutS}` for the idea-usage runner |

`x-app.version` is the only App version. Do not put `idea_app_version` in
`app.yaml` (dropped).

## snapshotExclude and backup.exclude (Engine `UpdateApp.ts`, `backupExclude.ts`)

Two lists, different jobs:

- **`x-app.backup.exclude`** always applies to a Backup Disk / `backupApp`
  archive (plus `hookExclude` after a successful preHook). Paths are
  **instance-relative**. A bare name other than `data` means `data/<name>`
  (`keys` → `data/keys`). A path that already contains a `/`, or that starts
  with `.`, is used as written (`.env`, `hooks/backup-pre.sh`). No globs
  (`* ? [ ]`), no absolute paths, no `.` or `..` components, no leading `-`.
- **`x-app.snapshotExclude`** is for the pre-update copy under
  `.pre-update/<id>/`. After the same normalisation, each path **must be
  `data` or under `data/`**. No globs, no absolute paths, no `.` or `..`, no
  leading `-`. At most **256** characters per token after trim, and at most
  **32** unique entries after de-duplication. A bad list is refused
  (`INVALID_EXCLUDE`) before anything is stopped.

**updateApp** builds the snapshot exclude list by merging, then re-checking the
snapshot rules:

1. the live instance's `x-app.backup.exclude`
2. the new bundle's `x-app.backup.exclude`
3. the live instance's `x-app.snapshotExclude`

The new bundle's `snapshotExclude` is not used (the snapshot is of the live
instance). Because the merged list must pass the snapshot rules, a
`backup.exclude` path that is not under `data/` (for example `.env`) would
make updateApp refuse `INVALID_EXCLUDE`. Keep backup excludes under `data/`
when the App can be updated, or leave `.env`-style paths out of `exclude`
(they are small and can go in the snapshot).

A temporary pre-update Borg backup (major hop, no linked Backup Disk docked)
uses **only** the live `x-app.backup.exclude`, not `snapshotExclude`.

## `app.yaml` (still used)

`app.yaml` is **not** the App version and is **not** what the Engine starts.
It stays in the App repo for build and compatibility metadata:

- `compatibility.engine_min` — minimum Engine version
- `compatibility.engine_tested` — written by the App Harness after a passing
  run (`commit`, Engine `version`, `date`). Not written on failure
- `services[]` — build approach (`custom` / `retag` / `direct` / `official`),
  image names, `current_version`, `upstream_tag`, version monitors
- optional `demo:` block for Console “Demo apps” (`setupDemo`)

`services[].current_version` is the **image** tag (or a date retag), not
`x-app.version`. A date retag's `upstream_tag` must stay in sync with the
upstream series the image was actually built from
([app-bundle-integrity.md](app-bundle-integrity.md)).

## Checks

```bash
node script/check-compose.mjs [--release] [--tag <v>] [--base-ref <previous release tag>] compose.yaml
node script/check-xapp-update-fields.mjs compose.yaml
```

See [backup-hook.md](backup-hook.md), [app-bundle-integrity.md](app-bundle-integrity.md)
and [files-mount.md](files-mount.md).
