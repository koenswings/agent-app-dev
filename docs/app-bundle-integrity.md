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

## Stateful images need an App major

When a release moves a stateful service image to a new series, it must also bump the App major and list the old major in `updatesFrom`. The first start of a new database series rewrites the data files (mariadb-upgrade, pg_upgrade, Mongo feature compatibility, Redis RDB/AOF format), and they cannot go back. updateApp requires a Backup Disk backup (`NEEDS_BACKUP`) only for an App major update; a minor update gets only the local pre-update snapshot. This is a release rule and needs no Engine change.

| Image (by repo name, IDEA retags such as `koenswings/nextcloud-mariadb:1.0-11.7.2-…` read as the upstream tag) | Series |
|---|---|
| `mariadb`, `mysql`, `percona`, `mongo` | `X.Y` (11.7 → 11.8 is a new series) |
| `postgres`, `postgis`, `timescaledb` | `X` |
| `redis`, `valkey`, `keydb`, only when the service has a volume | `X` |

Checked by `node script/check-compose.mjs --base-ref <previous release tag> compose.yaml` (the compose at that git ref; a compose not there yet is skipped with a note) or `--base <previous compose.yaml>`. It fails when a series goes up without an App major bump, always when a series goes down, and without an App major also when the engine changes (MySQL → MariaDB) or the tag has no readable series (`lts`, `11`). Patch bumps and other images pass.
