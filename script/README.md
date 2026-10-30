# App Disk image scripts (idea#138)

Build throwaway GPT+ext4 App Disk `.img` files for hardware tests (Atlas writes them onto spare sticks on idea03).

- `build-app-disk-image.sh` — pack a fixture tree into a single-partition GPT+ext4 image (unique FS UUID, label `IDEA Disk`, root owned by uid 1000).
- `validate-app-disk-image.sh` — acceptance checks (GPT/one partition, ext4 UUID+label, META diskId, Disk A/B content rules, SHA-256).
- `build-files-disk-test-images.sh` — convenience wrapper for Disk A + Disk B from a `build-ids.env`.

Never targets block devices; idea03 stick IDs from `hw-roundtrip-disks.json` are refused (fail closed if missing on a fleet Pi). Images go on a GitHub Release, not in git.
- `check-app-disk-tree.sh <root>` — idea#139: fails if any placeholder (.gitkeep, .keep, …) is under `files/`, if `files/` exists on an App-only disk, if any compose service image has no `services/<image, '/'→'_'>.tar` (Engine `serviceImageTarPath()`), or if an App has no build-time `SHA256SUMS`. `build-app-disk-image.sh` runs it on the staging tree and on the built filesystem; `validate-app-disk-image.sh` runs it on the image. Stage every App with `build-app-bundle.sh` (it writes the tars by `docker save <repo:tag>` and SHA256SUMS); never hand-copy an App folder into a tree.
- `stage-files-disk-b.sh` — idea#139: stage Disk B (App-only Nextcloud bundle + one Engine-style instance, no FILES.yaml/files/). `build-app-bundle.sh` sets the bundled compose `x-app.version` to the folder version, and `check-app-disk-tree.sh` fails if an App folder and its compose disagree or an instance's `x-app` name-version has no `apps/` folder. Its `--ref` (default 1.2-31.0.1) must be an app-nextcloud release tag at the checkout HEAD (idea#76); ALLOW_UNTAGGED=1 is for dev trees only.
