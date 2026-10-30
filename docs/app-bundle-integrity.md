# App bundle integrity: SHA256SUMS and image tar names (updateApp)

From the accepted proposal [idea#351](https://github.com/koenswings/idea/blob/main/proposals/2026-10-28-update-app.md) (agent-app-dev#23).

## Layout on an App Disk

```
apps/<appId>/              bundle: every git-tracked file of the App repo, file modes kept
apps/<appId>/SHA256SUMS    written at build time by script/build-app-bundle.sh
services/<image>.tar       one docker save per service image
```

- `<appId>` is `<x-app.name>-<tag>`, the folder name the Engine uses. `--ref` must be a release tag `<major>.<minor>[-<upstream>]` at HEAD (idea#76); `ALLOW_UNTAGGED=1` builds a dev bundle `<name>-0.0-dev+<sha12>` instead. The build stamps `x-app.version` and every service's `x-app-version` label with the version and runs `script/check-compose.mjs --tag`.
- `SHA256SUMS` paths are relative to the **disk root**, so it covers the bundle and the `services/` tars it needs. Check it with `cd <disk root> && sha256sum -c apps/<appId>/SHA256SUMS`, or `script/verify-app-bundle.sh <root> <appId>`. Verify also fails on a bundle file that the list doesn't name.
- It never lists itself. Bundle-root names starting with `.idea-` are reserved for Engine markers (for example the Fetch done marker) and are never listed. The build refuses an App repo that has either name at its root.
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
