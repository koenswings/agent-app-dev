# idea#374 kit-replica App-level data checks

Read-only before/after inventory for the visit rehearsal (Engine `adfd9d3` → new Engine, then
Nextcloud SHA → 1.7-31.0.1 → 1.8-31.0.14, Kolibri 0.15.5 → 1.3-0.19.5, Kiwix → 1.3-3.8.2).

It **complements** Atlas's replica `scripts/inventory.sh` (row counts, `nc_user`, `nc_fc`, host-side
`nc_file` sha256, Kolibri rows / users / per-user progress / content names+sizes, image list) and does
not repeat it. What it adds:

| App | Checks |
|---|---|
| Nextcloud | `occ status` (installed, version, **needsDbUpgrade false**, maintenance false) and `status.php`; users; groups + members; enabled apps; **Files Disk mounts incl. `enable_sharing`** and applicable groups; shares (no tokens); schema table list; MariaDB version; every user file **and Files Disk file** sha256 (inside the app container, caches/thumbnails/uploads/appdata excluded); seeded demo content found by sha256; HTTP login per known role (WebDAV PROPFIND 207) + apps open (Files app 200, OCS capabilities 200); **WebDAV GET sha256 == file list** |
| Kolibri | read-only sqlite copy (backup API, `mode=ro`): integrity, MORANGO_SYSTEM_ID, facility + dataset, morango database / instance id, users + roles, classes/groups, memberships, lessons, quizzes, per-user progress + a digest of (user, content, progress), logger/auth table counts, channels, available nodes per channel, **content files present** (and md5 == file id up to 2 GiB total); public API (`/api/public/info/`, facility list), `/` |
| Kiwix | ZIM list with size + sha256 (head+tail fingerprint for ZIMs > 4 GiB unless `KIWIX_ZIM_SHA=full`) and `.zim.sha256` sidecar match; `/`; OPDS library catalog; GET of every book's main page |

## Run (system-disk layout is the default)

One line from the box; ids are discovered under `/instances` by `x-app.name` (nextcloud, kolibri, kiwix):

```bash
ssh pi@100.126.117.80 'sudo -n bash -s -- before' < tests/kit-374/checks/kit374-inventory.sh   # -> /home/pi/r374-inventory/kid-before/
ssh pi@100.126.117.80 'sudo -n bash -s -- after'  < tests/kit-374/checks/kit374-inventory.sh   # -> /home/pi/r374-inventory/kid-after/
```

Per App (limit to instance ids): `... 'sudo -n bash -s -- before-nc <ncId>'`, `... -- before-kolibri <kolibriId>`, `... -- before-kiwix <kiwixId>`.
App Disk layout: `IDEA_ROOT=/disks/<dev>`; both: `IDEA_ROOT=auto` (pass it inside the ssh command: `'sudo -n env IDEA_ROOT=auto bash -s -- before'`).

Compare (on the Pi, or on the box after `scp -r`):

```bash
EXPECT_NEXTCLOUD_APP_VERSION=1.8-31.0.14 EXPECT_NC_VERSION_PREFIX=31.0.14 \
EXPECT_KOLIBRI_APP_VERSION=1.3-0.19.5 EXPECT_KOLIBRI_VERSION_PREFIX=0.19.5 \
EXPECT_KIWIX_APP_VERSION=1.3-3.8.2 \
  tests/kit-374/checks/compare.sh kid-before kid-after     # PASS/FAIL/WARN/INFO per check, exit 1 on any FAIL
```

Order: run it **after** Atlas's inventory. The login checks can add `oc_authtoken` / `oc_preferences`
rows in Nextcloud, which his row-count diff would otherwise show.

## Safety

- Only `docker ps`, `docker inspect`, `docker image inspect` and `docker exec` of read-only commands
  (`occ status|user:list|group:list|app:list|files_external:list|config:system:get`, MariaDB `SELECT`,
  `find | sha256sum`), and only on containers whose compose project label equals the instance id.
- HTTP only to `127.0.0.1:<that instance's port>` (URLs are checked, redirects too).
- Hands-off: ports in `HANDS_OFF_PORTS` (default 18080,18090), `HANDS_OFF_IDS` regex, demo names.
- Never signs in to Kolibri as a learner (optional `KOLIBRI_CREDS_FILE` takes coach/admin only) and
  never writes to Kolibri. Kolibri sign-ins add `logger_usersessionlog` rows, so that table may grow.
- Nextcloud passwords come from `.env` (`IDEA_NC_ADMIN_PASSWORD`, `IDEA_NC_SEED_USERS`, the `<user>911!`
  scheme) or `NC_CREDS_FILE`; they are never printed or written. A failed login is tried once only.
- Writes only under the output dir; refuses to reuse one that already holds an inventory.
- No `rm`, no `pkill`/`pgrep`, no prunes.

## Test

`tests/kit-374/checks/test/dry-run.sh`: a fake replica tree, a fake `docker` and a local mock HTTP server
(no containers). It checks discovery, hands-off refusal, exclusions, no secrets in the output, an
unchanged after → PASS, and a damaged after → the exact FAILs (changed file, `enable_sharing` false,
lost progress, missing ZIM).
