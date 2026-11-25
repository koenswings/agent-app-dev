# App bundle integrity: SHA256SUMS and image tar names (updateApp)

From the accepted proposal [idea#351](https://github.com/koenswings/idea/blob/main/proposals/2026-10-28-update-app.md) (agent-app-dev#23).

## Layout on an App Disk

```
apps/<appId>/              bundle: every git-tracked file of the App repo, file modes kept
                           (never __pycache__/ or *.pyc/*.pyo, even if force-added to the index)
apps/<appId>/SHA256SUMS    written at build time by script/build-app-bundle.sh (bundle-relative)
SHA256SUMS                 disk-root list: services/*.tar plus apps/** (disk-root-relative)
services/<image>.tar       one docker save per service image
```

- `<appId>` is `<x-app.name>-<tag>`, the folder name the Engine uses. `--ref` must be a release tag `<major>.<minor>[-<upstream>]` at HEAD (idea#76); `ALLOW_UNTAGGED=1` builds a dev bundle `<name>-0.0-dev+<sha12>` instead. The build stamps `x-app.version` and every service's `x-app-version` label with the version and runs `script/check-compose.mjs --tag`.
- `apps/<appId>/SHA256SUMS` is self-contained and **bundle-relative**: it lists only the bundle's own files (a bare `compose.yaml` line, `hooks/…`, never `services/*.tar`). This is the Engine contract in `UpdateApp.ts` (`defaultVerifySums`, `sumsLookUsable`): `cd apps/<appId> && sha256sum --check --strict SHA256SUMS`. The file never lists itself. Bundle-root names starting with `.idea-` are reserved for Engine markers (for example the Fetch done marker) and are never listed. The build refuses an App repo that has either name at its root.
- The disk-root `SHA256SUMS` lists `services/*.tar` plus every file under `apps/**` with paths relative to the disk root (including each bundle `SHA256SUMS`). It never lists itself. Check with `cd <disk root> && sha256sum --check --strict SHA256SUMS`. `script/verify-app-bundle.sh <root> <appId>` runs both checks, and also fails on a bundle file that the bundle list doesn't name, or if `__pycache__/` or a `*.pyc`/`*.pyo` file is present in the bundle (bytecode left by a test run against the tree must not ship).
- Symlinks are listed and hashed through their target.

## Image tar names

`services/<image with every "/" replaced by "_">.tar`, tag kept (for example `services/koenswings_kolibri:1.0-0.15.5-dev.tar`), the same as the Engine's `serviceImageTarPath()`. An image+tag is an immutable release, so:

- every image needs an explicit tag other than `latest` (the build refuses others);
- a new release with a new tag lands beside the old tar and never overwrites a tar the running instance uses;
- an existing tar with the same name is reused, not rewritten. Fetch may skip a tar already on the target whose checksum matches.

Never re-push a different image under a tag that is already on an App Disk.

## x-app fields for updateApp

Checked by `node script/check-xapp-update-fields.mjs <compose.yaml>`:

| Field | Meaning |
|-------|---------|
| `healthCheck: {path, expect?}` | URL path on the instance's main port; must return 2xx/3xx and contain `expect` when given |
| `healthTimeout` | seconds the health gate waits (integer 60–7200). Use a measured value; `600` is only a placeholder when unmeasured |
| `updatesFrom: [<major>...]` | earlier App majors this release may update from; minor updates need no entry |
| `migrationNote` | shown to the teacher before a major update |
| `snapshotExclude: [<path>...]` | paths under `data/` left out of the pre-update copy (rules below) |

### snapshotExclude rules (idea#396)

Each `snapshotExclude` entry is normalised like `x-app.backup.exclude` (a bare
name other than `data` becomes `data/<name>`; a leading `./` and trailing `/`
are dropped) and then **must be `data` or a path under `data/`**. No globs
(`* ? [ ]`), no absolute paths, no `.` or `..` components, no leading `-`. At
most 256 characters per token after trim, and at most 32 unique entries after
de-duplication. A bad list is refused as `INVALID_EXCLUDE` before anything is
stopped. Full path rules: [backup-hook.md](backup-hook.md#paths-exclude-hookexclude-verifypresent-verifyabsent)
and [compose-conventions.md](compose-conventions.md).

**updateApp** does not use only this list. The pre-update snapshot exclude list
is the merge of (1) the live instance's `x-app.backup.exclude`, (2) the new
bundle's `x-app.backup.exclude`, and (3) the **live** instance's
`x-app.snapshotExclude`. The new bundle's `snapshotExclude` is not used — the
snapshot is of the live instance. The merged list is then re-checked against the
snapshot rules, so a `backup.exclude` path that is not under `data/` (for
example `.env`) would refuse the update. A temporary pre-update Borg backup
(major hop, no linked Backup Disk) uses only the live `x-app.backup.exclude`.


### Nextcloud keeps config/ and custom_apps/ in the snapshot (E3)

`node script/check-compose.mjs` fails a Nextcloud App whose `x-app.backup.exclude` or `x-app.snapshotExclude` lists Nextcloud's `config/` or `custom_apps/` folder, a path inside one, or an ancestor of one (`data/nextcloud`, `data`, `.`).

Why: an updateApp rollback (agent-engine-dev `src/data/UpdateApp.ts` `rollBack` → `restoreSnapshot` → `idea-app-data restore-snapshot`) restores the instance folder in place from `.pre-update/<id>` with `rsync --delete`. It leaves alone only the excluded paths (`backup.exclude` ∪ `snapshotExclude`, recorded in the snapshot's `EXCLUDE`). With either folder excluded, a rolled-back Nextcloud would keep the newer `config.php` (new `version`, `appstoreenabled` false) or `custom_apps/.idea-update-state/` next to the old code.

- **Nextcloud App:** `x-app.name` is `nextcloud`, or a service image's repo name is exactly `nextcloud` (`nextcloud:31.0.14-apache`, `koenswings/nextcloud:…`). `nextcloud-code` and `nextcloud-mariadb` do not count.
- **Folders:** `data/nextcloud/config` and `data/nextcloud/custom_apps` (app-nextcloud binds `./data/nextcloud:/var/www/html`). A Nextcloud service's other relative bind onto `/var/www/html` adds `<src>/config` and `<src>/custom_apps`, and a bind onto `/var/www/html/config` or `/var/www/html/custom_apps` adds `<src>`.
- **Entries** are normalised like the Engine (`backupExclude.ts`): spaces, a leading `./` and a trailing `/` are dropped, and a bare name other than `data` means `data/<name>`, so `nextcloud` fails. A glob, which the Engine refuses anyway, fails when it could match a folder, a path inside it or an ancestor. `**` matches any depth.
- Unrelated excludes such as `data/nextcloud/data/appdata_<id>/preview` pass. So do non-Nextcloud Apps. Tests: `tests/unit/check-compose-nextcloud-rollback.test.mjs`.

`x-app.update` is optional. When it is present, `node script/check-compose.mjs` (and `check-xapp-update-fields.mjs`) also checks the **update stages** (gap 12, Axle addendum): `prepare`, `verify`, `work` and `settle`. Each stage is optional; a missing `x-app.update` is valid, and unknown `x-app` keys stay allowed. When a stage is declared:

- `prepare`, `verify` and `work` take `{ service, command, timeout, user? }`
- `settle` takes `{ service, command, interval, timeout, user? }`
- `timeout` and `interval` are positive integer seconds (1..86400): a YAML integer or a digits-only string (booleans, lists, and decimal strings such as `"600.0"` are refused); settle `interval` must not be greater than `timeout`
- `service` must name a service in the same compose
- `command` is one absolute path (not a list, no shell)
- `user`, if present, is a uid or username (same shape as `x-app.backup` hook steps)

### Engine floor for bundles that declare stages

**Kits on an Engine older than 41ba677 (engine#463) must never get Nextcloud 2.0+ bundles.** Those Engines ignore `x-app.update` stages and would run the hop without `prepare`, losing Office and idea_usage. Nextcloud 2.0+ needs an Engine with the full engine#456 stages (#456 L).

Why: on a Nextcloud major hop, `prepare` is the only step that replaces the bundled apps in `custom_apps` (richdocuments, idea_usage) before the image entrypoint runs `occ upgrade`. Without it, the old NC31-only copies stay. `occ upgrade` auto-disables them as incompatible, and the fail-open start hooks cannot enable them again. Health still passes, so the update reports Done while Office and the usage counter are lost. Nothing re-enables them on a later hop. On an online kit, `occ upgrade` may instead pull an unpinned richdocuments from the app store.

Which Engines do what:

- Engines from 41ba677 refuse any bundle that declares a stage (`UPDATE_STAGES_UNSUPPORTED` at Check, never offered) until #456 L lands. A kit on such an Engine stops safely at the last stage-less release (Nextcloud 1.8-31.0.14).
- Engines older than 41ba677 (for example 80ba4af) offer and run the hop without the stages. Do not put a 2.0+ Nextcloud bundle on an App Disk for such a kit.

The same holds for any App whose release declares `x-app.update` stages that its correctness depends on. The Nextcloud hop PRs are app-nextcloud#37 (2.0), #38 (3.0), #39 (4.0), #42 (5.0, MariaDB 11.8 only, whose stages are no-ops) and #40 (6.0). The 5.0 hop is also refused on Engines from 41ba677, because it declares stages.

## Stateful images need an App major

When a release moves a stateful service image to a new series, it must also bump the App major and list the old major in `updatesFrom`. **An App major caused only by such a database upgrade is allowed.** Its release notes must say plainly that the major comes from the database upgrade (for example "2.0: MariaDB 11.7 → 11.8; no change to Nextcloud or the App itself") and that the app itself is unchanged, and `updatesFrom` lists the previous major. The update is then offered with `--allow-major` and a Backup Disk backup first. The first start of a new database series rewrites the data files (mariadb-upgrade, the MySQL data dictionary, pg_upgrade, Mongo feature compatibility, the Redis RDB format), and they cannot go back. updateApp requires a Backup Disk backup (`NEEDS_BACKUP`) only for an App major update; a minor update gets only the local pre-update snapshot. This is a release rule and needs no Engine change.

| Image (by repo name) | Series |
|---|---|
| `mariadb`, `mongo` | `X.Y` (11.7 → 11.8 is a new series) |
| `mysql`, `percona` | `X.Y` (8.4 LTS, 9.x innovation), but `8.0.Z` for 8.0: each 8.0 patch upgrades the data dictionary in place |
| `postgres`, `postgis`, `timescaledb` | `X` from 10, `X.Y` before (9.5 → 9.6 is a major) |
| `redis`, `valkey`, `keydb`, only when the service has a volume | `X.Y` (the RDB format changes at minors) |

How the version is read:
- IDEA retags (`koenswings/…` or `ghcr.io/koenswings/…`, tag `<idea>.<n>-<upstream>`, e.g. `koenswings/nextcloud-mariadb:1.0-11.7.2-…`) are read by their upstream part.
- A retag whose upstream part is a date or unreadable (`koenswings/kolibri-postgres:1.0-2024.12.03`) is read from the `upstream_tag` of the App's `app.yaml` `services[]` entry, matched by service name, else by `image`. An entry whose `image` is a different repo (after normalising `docker.io/` and `ghcr.io/koenswings/` to `koenswings/`) is not used, and `current_version` is never used (for a date retag it is the date tag). Without a matching entry the series is unknown.
- **A date retag's `app.yaml` `upstream_tag` must be updated with every rebuild** to the upstream version the image was built from (e.g. `"16"` → `"17"`). Nothing checks it against the image, so a stale value hides a series bump.
- Services are compared by name. A stateful service removed from the base and one added of the same kind (MariaDB/MySQL, Postgres, Mongo, Redis) are paired as a rename; more than one of a kind on either side cannot be paired and needs an App major.

Checked by `node script/check-compose.mjs --base-ref <previous release tag> compose.yaml` (the compose and `app.yaml` at that git ref) or `--base <previous compose.yaml>` (and an `app.yaml` beside it). An unknown or unfetched ref fails (`git fetch --tags` in a shallow clone); a ref without the compose (a new App) is skipped with a note. The check fails when a series goes up without an App major bump, always when a series goes down, and without an App major also when the engine changes (MySQL → MariaDB), the series is unknown (`lts`, `11`, a date tag with no `app.yaml` entry) or a rename cannot be paired. Patch bumps within a series and other images pass. Not matched by name (no check): images such as `pgvector/pgvector:pg16` or minio.

In an App's release test, the base is the **previous release tag**: the highest release tag (`<major>.<minor>[-<upstream>]`) that is an ancestor of HEAD and does not point at HEAD itself. With no such tag (a first release) the check is skipped with a note. Tags must be present: a shallow or tagless clone fails (CI: `fetch-depth: 0`, or `git fetch --tags --unshallow`).
