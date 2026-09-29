# Files Disk mounts (`x-app.filesMount`)

Apps that can use docked Files Disks opt in in their compose file:

```yaml
x-app:
  filesMount:
    path: /mnt/idea-files
    services: [my-app-service]   # never the database
```

## What the Engine mounts

For every create, start or remount of an opted-in instance, the Engine writes a compose override (long bind syntax, `create_host_path: false`) that mounts **every** Files Disk on that Engine into each listed service:

| Inside the container | Source |
|---|---|
| `<path>/<slug>-<id6>` | Files Disk `files/` folder (read-write) |
| `<path>/.idea-files.json` | Display-name map (read-only) |

- `slug` is the Engine-sanitised share name (lower-case, spaces→hyphens, drop non `[a-z0-9-]`, no leading dot; empty → `files`).
- `id6` is the first six characters of the disk ID. The suffix is **always** added.
- JSON keys are `slug-id6`; values are the share names (for example `"School Files"`).
- Constant name on the Engine side: `IDEA_FILES_JSON = '.idea-files.json'`.

Example: `/mnt/idea-files/school-files-3f9a2c` plus `/mnt/idea-files/.idea-files.json`.

Do **not** list those binds in the App's `compose.yaml` — the Engine override adds them. Only the services named in `filesMount.services` receive the mounts.

## `restart: no`

Apps that use `filesMount` **must** keep `restart: no` on every service. Docker must not restart a container on its own with a stale Files Disk mount; the Engine decides when the instance starts or is recreated.

## Engine-generated Files Disk binds are allowed

Engine-generated Files Disk binds (the override above) are **allowed**. They are not an exception to a ban — they are how Files Disks reach Apps. Reconciling the general App volume convention (named volumes vs relative App Disk binds) is a separate issue ([idea#141](https://github.com/koenswings/idea/issues/141)); do not rewrite that convention here.

Relative binds that live on the App Disk itself (for example `./data/...`, or a read-only script next to `compose.yaml`) remain normal App Disk content.

## Reference pattern: Nextcloud

[`koenswings/app-nextcloud`](https://github.com/koenswings/app-nextcloud) is the first opted-in App:

- `x-app.filesMount: { path: /mnt/idea-files, services: [nextcloud-app] }`
- `idea-files-entrypoint.sh` — root wrapper on the App Disk, mounted read-only; chowns each top-level `/mnt/idea-files/<x>` to uid 33 only when wrong, then `exec`s `/entrypoint.sh`. No custom image. Never touches `instances/<id>/data`.
- `docker-entrypoint-hooks.d/before-starting/10-idea-files.sh` — enables `files_external`, reconciles Local storages with folders under `/mnt/idea-files/` (display names from `.idea-files.json`), deletes only storages it marked (`idea_files=1`) whose folder is gone, sets `filesystem_check_changes=1`. Admin storages are never deleted. Deleting a storage removes Nextcloud config only, never files.

Hook and wrapper need **no special case** when Nextcloud runs on a combined App+Files disk.

See also: [`proposals/files-disk.md`](https://github.com/koenswings/idea/blob/main/proposals/files-disk.md) §9.
