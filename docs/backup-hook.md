# `x-app.backup`: live backup hooks for App authors (idea#403)

Contract for an App's `x-app.backup` block, as implemented by the Engine in
[agent-engine-dev#404](https://github.com/koenswings/agent-engine-dev/pull/404). `script/check-compose.mjs`
checks it (with and without `--release`) and is stricter than the Engine where noted.

## Fields

```yaml
x-app:
  backup:
    method: hook            # stop (default) | hook | none
    fallback: stop          # stop (default) | fail — what to do when a preHook step fails
    hookTimeout: 300        # seconds per step, integer 1..86400 (default 300)
    preHook:                # one {service, command, user} mapping, or an ordered non-empty list
      - service: app        # must be a service in this compose file
        user: "33"          # optional: uid or username (docker compose exec --user)
        command: [php, occ, maintenance:mode, --on]   # string = one argv word; list = argv
    postHook: [...]         # same form; optional
    exclude: [cache]        # every archive (hook, fallback, cold)
    hookExclude: [data/db]  # hook archives only (the live files the hook replaced)
    verify:                 # idea#446 restore check; required with method hook in --release
      present: [.env]
      absent: []
```

| method | Engine does |
|--------|-------------|
| `stop` | Stop the instance, borg the instance folder minus `exclude`, start it again. |
| `hook` | Running instance: preHook, borg minus `exclude` + `hookExclude`, postHook; no stop. |
| `none` | Nothing is copied: no borg run, no borg lock file on the Backup Disk, no hook, stop, cleanup or `lastBackup`. The instance and Backup Disk resource locks are still taken for the run, so it can be refused as busy (`backupMonitor.ts`). The op is Done with `args.hookResult: 'none'` and `lastResult {method: none, result: OK}`. For Apps with no school data (Kiwix: re-downloadable ZIMs). |

`live` is reserved and fails closed. Any other value is refused.

**Major updates (updateApp):** an App with method `none` never has a `lastBackup`, so it is exempt
from the `NEEDS_BACKUP` check on a major update. `--allow-major` (and `updatesFrom`) are still
required (`UpdateAppPolicy.ts`).

check-compose also refuses `preHook`, `postHook` and `hookExclude` with method `stop` or `none`
(the Engine ignores them silently), `method: hook` without a `preHook`, an empty list, unknown step
keys, and a step whose `service` is not in `services:`. The old single-mapping form stays valid.

## How a step runs

```
timeout --signal=TERM --kill-after=10s <hookTimeout> docker compose exec -T [--user U] -- <service> <argv…>
```

from the instance folder. **No shell and no extra env:** a string `command` is one argv word
(`"/hooks/pre.sh --x"` is a file named with a space), there is no `$VAR`, redirect or pipe. Put
anything that needs a shell, the container env or a redirect in a script file bound read-only
into the container (e.g. `./hooks/backup-pre.sh:/hooks/backup-pre.sh:ro`). Secrets come from
the container env inside that script; never put them on argv and never print them.

## Order and failure

1. preHook steps run in order and **stop at the first failure**.
2. borg runs only when every pre step succeeded.
3. **Every postHook step always runs**: after a failed pre step, after a failed earlier post step
   and after a failed borg run (borg failing still makes the backup FAILED). Several post failures
   are joined with `; ` in `HOOK_POST_WARNING`. So every post step must be idempotent and safe to
   run when its pre step never ran (e.g. "maintenance off", "remove the dump if present").
4. A failed pre step, then post, then the fallback: `stop` → a normal stop backup (`HOOK_FALLBACK`),
   `fail` → no archive (`HOOK_FAILED`).

**Exit codes:** 0 = success. **Any non-zero exit, or the timeout, is a failure** (fallback). There
are no special codes; print the reason on stderr (the Engine keeps it). updateApp's pre-update
backup forces `fallback: fail` (idea#448), so a pre-update hook failure stops the update.

## Stopped instances

A hook App whose instance is not Running or Starting gets a **cold backup**: hooks are skipped,
only `exclude` is applied (never `hookExclude`), `hookResult: 'cold'`, result OK. The cold archive
holds the live files the hook would have replaced (they are consistent because nothing runs), so
it must restore like a stop archive. A Starting instance still runs its hooks.

## Paths (`exclude`, `hookExclude`, `verify.present`, `verify.absent`)

- No globs (`* ? [ ]`), no absolute paths, no `.` or `..` components, no leading `-`.
- A bare name means `data/<name>` (`cache` → `data/cache`). A path with a `/` or a leading dot is
  instance-relative (`data/db`, `.env`, `hooks/backup-pre.sh`). So write `hooks/x.sh`, not `x.sh`;
  a bare `compose.yaml` would mean `data/compose.yaml`.
- List every file of a set explicitly (SQLite: `db.sqlite3`, `-wal`, `-shm`, `-journal`).

## verify (idea#446)

The Engine extracts the latest archive and checks that `present` paths exist and `absent` paths do
not. Until engine#401 (archive suffixes `-hook`/`-stop`/`-cold` and per-mode verify), verify cannot
tell a hook archive from a fallback or cold one. **List only paths true of every archive type**:
not a `hookExclude` path under `absent`, not a hook-only dump under `present`.

## Restore

`restoreApp` puts the instance folder back from the archive (in place it replaces the old folder;
onto another disk the old one is quarantined). **It does not apply dumps.** The App's own startup
must turn a hook archive back into a running App:

- detect the hook archive (dump present, live files missing) and import or copy back;
- undo state the preHook left in the archive (e.g. maintenance mode in a config file);
- leave a stop or cold archive alone (live files present: start normally);
- be idempotent and do it once (record what was applied).

Do not test with an in-place `restoreApp` on a kit; restore into a fresh instance or another disk.

## Examples

- **Kolibri** ([app-kolibri#27](https://github.com/koenswings/app-kolibri/pull/27)): one pre step
  copies every SQLite database with the online backup API into `idea-backup/`; `hookExclude` lists
  the live database files; `kolibri-start.sh` copies the backups back when the live files are
  missing. Fallback `stop`, timeout 300.
- **Nextcloud** (app-nextcloud `kid/backup-hook-403`): pre `occ maintenance:mode --on` (user 33),
  then a `mariadb-dump --single-transaction` script into MariaDB's initdb folder; post maintenance
  off and remove the dump; `hookExclude: [data/db]`. On restore MariaDB imports the dump into the
  empty datadir, a TCP healthcheck plus `depends_on: service_healthy` holds Nextcloud back until
  then, and a before-starting hook turns maintenance off and runs `files:scan --all` once.
- **Kiwix** (app-kiwix `kid/backup-none-403`): `method: none`.

## check-compose

`node script/check-compose.mjs [--release] [--tag <v>] compose.yaml`. Tests:
`tests/unit/check-compose-backup.test.mjs`.
