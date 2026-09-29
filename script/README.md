# App Disk image scripts (idea#138)

Build throwaway GPT+ext4 App Disk `.img` files for hardware tests (Atlas writes them onto spare sticks on idea03).

- `build-app-disk-image.sh` — pack a fixture tree into a single-partition GPT+ext4 image (unique FS UUID, label `IDEA Disk`, root owned by uid 1000).
- `validate-app-disk-image.sh` — acceptance checks (GPT/one partition, ext4 UUID+label, META diskId, Disk A/B content rules, SHA-256).
- `build-files-disk-test-images.sh` — convenience wrapper for Disk A + Disk B from a `build-ids.env`.

Never targets block devices; idea03 stick IDs from `hw-roundtrip-disks.json` are refused (fail closed if missing on a fleet Pi). Images go on a GitHub Release, not in git.
