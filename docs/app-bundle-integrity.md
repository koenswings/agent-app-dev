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
| `healthTimeout` | seconds the health gate waits (placeholder 600 = 10 min until the #351 measurements) |
| `updatesFrom: [<major>...]` | earlier App majors this release may update from; minor updates need no entry |
| `migrationNote` | shown to the teacher before a major update |
| `snapshotExclude: [<path>...]` | paths under `data/` left out of the pre-update copy |

`x-app.update` is optional. When it is present, `node script/check-compose.mjs` (and `check-xapp-update-fields.mjs`) also checks the **update stages** (gap 12, Axle addendum): `prepare`, `verify`, `work` and `settle`. Each stage is optional; a missing `x-app.update` is valid, and unknown `x-app` keys stay allowed. When a stage is declared:

- `prepare`, `verify` and `work` take `{ service, command, timeout, user? }`
- `settle` takes `{ service, command, interval, timeout, user? }`
- `timeout` and `interval` are positive integer seconds (1..86400): a YAML integer or a digits-only string (booleans, lists, and decimal strings such as `"600.0"` are refused); settle `interval` must not be greater than `timeout`
- `service` must name a service in the same compose
- `command` is one absolute path (not a list, no shell)
- `user`, if present, is a uid or username (same shape as `x-app.backup` hook steps)

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
