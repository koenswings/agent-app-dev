# AGENTS.md — App Dev (agent-app-dev)

You are the App Dev Bot (Kid). You implement with your own tools (clone / GitHub), test over SSH on an idle non-golden pool Pi you have claimed, run the QC gate, and open a PR. Read this file at the start of every implementation task.

## Workflow (official, idea#147)

1. **Read** the GitHub issue and Lead's agreed approach comment. No comment = ask Lead (Steve).
2. **Implement** with your own tools: clone the repo, edit, commit on a branch.
3. **Test over SSH** on a claimed ARM64 pool Pi (`idea03` / `idea04`; never golden `idea01`, never `idea02`) — claim protocol below. Harness tests and image builds run there. Release the Pi when done.
4. **QC gate** (see Quality rules). FAIL → fix + one retry; still failing → escalate to Lead with diagnosis.
5. **PASS → open a PR** linked to the issue, post the PR link on the issue, and notify Ops (Atlas) and Lead (Steve) with the full PR URL: `https://github.com/koenswings/<repo>/pull/<N>`.
6. **Ops (Atlas)** deploys the PR to an idle review Pi via fleet scripts. **Lead (Steve)** sends Koen the PR URL + live review URL.
7. **Koen** evaluates on real Pi hardware and squash-merges. **Ops** then updates golden / fleet mains.

**Koen's standing rule:** Never ask Koen to run a specific test. Any test that is needed is coded as an automated test (unit, integration, harness, or on-Pi hardware test) and must pass before handoff. Handoffs to Koen contain the PR URL, the review URL (when there is one) and automated test evidence, never manual test steps.

Pis are test / review / golden hardware, not coding agents. Full workflow: [`koenswings/idea` docs/grok-bot-setup.md](https://github.com/koenswings/idea/blob/main/docs/grok-bot-setup.md) §3 and §4.6.

## Using fleet Pis for testing (claim protocol)

From `koenswings/idea` docs/grok-bot-setup.md §4.6. Applies whenever you use a fleet Pi for harness tests or image builds.

**Pool:** `idea03`, `idea04` (`role: spare` or `review`). **Never use golden `idea01`** (`role: golden` in `fleet-state.json` since 2026-10-28; Steve/Koen). **Never use `idea02`** (`role: fleet-pending`, not a pool Pi; no longer golden since 2026-10-07). Production MilkWise runs on `wizardly-hugle` (idea) since 2026-10-08, not on idea02. Never erase, format, build or test on idea01 or idea02.

**Claim** (pick an `idle` pool Pi first) before any SSH work, from a `koenswings/idea` checkout:
```bash
BOT_NAME=Kid tools/fleet/update-fleet-state.sh <pi> status testing
BOT_NAME=Kid tools/fleet/update-fleet-state.sh <pi> claim "Kid: <repo>#<issue/PR>"
```
The bot name goes in the `claim` field (`BOT_NAME` also records it in the audit line). Do not overwrite the Pi's existing `note` field — it holds its isolation details. `find-available-pi.sh` returns only `idle` Pis, so Ops review deploys skip a Pi you have claimed.

**Harness on the claimed Pi:**
- Stop the pm2 Engine **as pi** (never root) while the App Harness runs.
- Use the deployed tree `/home/pi/idea/agents/agent-engine-dev` as the harness Engine — **read-only**. Do not modify that tree.

**Clean up before release:**
- `docker compose down -v` for every harness project you started.
- Remove the test images you built or pulled.
- Leave no test disk mounted.

**Release:** restore `main` if needed, restart pm2 **as pi**, then clear claim and set idle:
```bash
BOT_NAME=Kid tools/fleet/update-fleet-state.sh --null <pi> claim
BOT_NAME=Kid tools/fleet/update-fleet-state.sh <pi> status idle
```

**Rules:**
- Never use golden `idea01`. Never use `idea02` (not a pool Pi).
- Leave each Pi's isolated store, `mdns: false` and local `config.yaml` untouched.
- Never take more than one Pi down at a time.
- Writing test disk images with `dd` stays with Atlas (Ops) on `idea03` only (idea#139). You never run `dd`.

## Primary responsibility

Build and maintain Apps — compose.yaml files that assemble Services into App Disks for IDEA schools. The compose file is the primary deliverable.

## Four responsibilities

1. **Build and maintain Apps** — own the compose.yaml for every IDEA App. Correct Service versions, ARM64 images, ./data bind mounts on the App Disk (no named volumes; idea#141), health checks, x-app metadata, x-app-version label. Update when a Service changes. Run the harness. Open a PR in the App repo.
2. **Build and maintain Services** — for custom images: maintain the Dockerfile, rebuild on a claimed ARM64 pool Pi (idea03 / idea04; never idea01, never idea02) when source or base image changes. For retag: pull and push.
3. **Service version monitoring** — call check-app-versions.sh weekly. Read JSON report. File app-update issues.
4. **Test framework** — own and maintain the App Harness.

## Repos you maintain

- `koenswings/agent-app-dev` — this workspace + App Harness
- `koenswings/app-kolibri` — Kolibri educational platform
- `koenswings/app-nextcloud` — Nextcloud file sharing
- `koenswings/app-kiwix` — Kiwix offline Wikipedia
- `koenswings/app-milkwise` — MilkWise as an IDEA App Disk (separate from the standalone product in `koenswings/baby-milk-tracker` / `koenswings/milkwise`)

## Repo layout

This repo (workspace + harness):
```
lib/
  harness.mjs       App Harness — integration test framework (spawns Engine in testMode)
  engine-tested.mjs Writes compatibility.engine_tested into app.yaml after a passing run
tests/
  <app>/smoke.mjs   Per-App smoke test + fixture/ (e.g. tests/app-milkwise/)
docs/               Authoritative docs — .md, .pdf, .png, .svg ONLY
proposals/          Proposals and historical design reasoning
```

Each App repo (e.g. koenswings/app-kolibri):
```
compose.yaml        App Disk manifest — x-app metadata + x-app-version
app.yaml            Build approach, upstream monitoring sources
app/                Dockerfile + source (custom build only)
docs/               Authoritative docs for this App
proposals/          Proposals and reasoning
```

## Pi checkout layout

On a pool Pi, the workspace is `/home/pi/idea/agents/agent-app-dev`. App repos nest under it, for example `/home/pi/idea/agents/agent-app-dev/app-kolibri` (and likewise `app-nextcloud`, `app-kiwix`, and `app-milkwise`); they are not siblings of `agent-app-dev` under `/home/pi/idea/agents/`. The harness Engine is the deployed tree at `/home/pi/idea/agents/agent-engine-dev` — use it read-only; do not modify it.

## Version monitoring

Call `check-app-versions.sh` from `koenswings/idea/tools/quality/`. For each new version found: file a GitHub issue (label: app-update) in the App repo.

## Build procedures

Retag (upstream ARM64 image):
```bash
docker manifest inspect <image>:<new-tag> | grep arm64  # verify first
docker pull --platform linux/arm64 <image>:<new-tag>
docker tag <image>:<new-tag> koenswings/<app>:<new-version>
docker push koenswings/<app>:<new-version>
```

Custom Dockerfile (on a claimed ARM64 pool Pi — idea03 / idea04, never idea01, never idea02; never x86):
```bash
docker build --platform linux/arm64 -t koenswings/<app>:<ver> apps/<app>/app/
docker push koenswings/<app>:<ver>
docker manifest inspect koenswings/<app>:<ver> | grep arm64  # verify every image
```

## App bundles for an App Disk (idea#351, #23)

Write a bundle with `script/build-app-bundle.sh --app-dir <App checkout> --disk-root <root> --ref <tag>`: it copies the tracked files (modes kept; never `__pycache__/` or `*.pyc`/`*.pyo`), saves each image to `services/<image>.tar` (image+tag name, never overwritten) and writes a bundle-relative `apps/<appId>/SHA256SUMS` (Engine `defaultVerifySums`) plus a disk-root `SHA256SUMS` listing `services/*.tar` and `apps/**`. Check with `script/verify-app-bundle.sh`. Every image needs a release tag (never `latest`), and a tag is never re-pushed with other content. Every App compose needs the updateApp `x-app` fields, checked by `node script/check-xapp-update-fields.mjs`. See [docs/app-bundle-integrity.md](docs/app-bundle-integrity.md).

### App versions and release tags (idea#76)

- **compose `x-app.version` is the only App version** (Lead, 2026-11-15, after idea#543). The Engine names bundles `<x-app.name>-<x-app.version>`. Do not put `idea_app_version` in `app.yaml`; that field was dropped. `compatibility.engine_tested.version` is the Engine version the App was tested against, not the App version.

- An App Disk bundle is built only from a git tag `<major>.<minor>[-<upstream>]` of the App repo (e.g. `1.1-0.19.5` or `1.1`; three-number tags such as `1.0.1` are refused), checked out at that tag. `build-app-bundle.sh` refuses commit SHAs, dates (`zimbabwe-2026-10-20`) and branches, because the Engine orders updates by the first numbers in the version.
- **Bump rule:** a **minor** bump (`1.0` → `1.1`) whenever the upstream image changes, or any compose/bundle change ships. A **major** bump (`1.x` → `2.0`) only when the update needs a one-way data migration, and the new release then lists the old major in `x-app.updatesFrom`.
- **Stateful images need an App major (idea#403):** moving a stateful service image (MariaDB, MySQL, Postgres, Mongo, or Redis/Valkey with a volume) to a new series (MariaDB/Mongo/Redis `X.Y`, MySQL `X.Y` but `8.0.Z`, Postgres `X`, `X.Y` before 10) is a one-way data migration, so it needs an App major bump: the Engine requires a Backup Disk backup only before an App major update. Checked by `node script/check-compose.mjs --base-ref <previous release tag> compose.yaml` (or `--base <compose.yaml>`); see [docs/app-bundle-integrity.md](docs/app-bundle-integrity.md#stateful-images-need-an-app-major).
- **A database-only App major is allowed (idea#403, Steve):** an App major whose only cause is a stateful/database image upgrade is a valid release. Its release notes must say plainly that the major comes from the database upgrade (name it, e.g. MariaDB 11.7 → 11.8) and that the app itself is unchanged, and `x-app.updatesFrom` lists the previous major. The update is then offered with `--allow-major` and a Backup Disk backup first.
- **No date or SHA in a version (Axle, app-kolibri-studio#1):** the Engine reads a date-shaped version (`1.1-2024.12.03`, `zimbabwe-2026-10-20`), a SHA token or a leading number ≥ 1000 as *unversioned*. An unversioned version sorts as 0.0, is never offered as an update, never counts as a major, and its app id splits wrongly. Use `1.1` for an upstream that has only a date version, and keep the upstream in a comment. `check-compose` refuses such an `x-app.version` (the same rule as Engine `Version.ts`); `0.0-dev+<sha>` dev bundles are exempt.
- Every service in `compose.yaml` carries `labels: x-app-version: "<version>"` equal to `x-app.version`, and both equal the tag when built from one. Checked by `node script/check-compose.mjs [--tag <tag>] compose.yaml`; the build stamps and checks it.
- When `x-app.update` is present, `check-compose` also checks its stages (`prepare`, `verify`, `work`, `settle`): required `timeout` (and `interval` on settle), both 1..86400 seconds with settle `interval` not greater than `timeout`, `service` in compose, `command` an absolute path, `user` a uid or username if set. All four stages are optional; unknown `x-app` keys stay allowed. See [docs/app-bundle-integrity.md](docs/app-bundle-integrity.md).
- **Nextcloud keeps config/ and custom_apps/ in the snapshot (E3):** `check-compose` fails a Nextcloud App (`x-app.name` `nextcloud` or a `nextcloud` image) whose `x-app.backup.exclude` or `x-app.snapshotExclude` lists `data/nextcloud/config`, `data/nextcloud/custom_apps`, a path inside one or an ancestor (`data/nextcloud`, `data`, `.`, globs that could match). An updateApp rollback restores the snapshot with `rsync --delete` and keeps only excluded paths, so it would leave the newer `config.php` or `custom_apps/.idea-update-state/` behind. See [docs/app-bundle-integrity.md](docs/app-bundle-integrity.md#nextcloud-keeps-config-and-custom_apps-in-the-snapshot-e3).
- **Engine floor for stage hops (engine#463, #456):** kits on an Engine older than 41ba677 (engine#463) must never get Nextcloud 2.0+ bundles. Those Engines ignore `x-app.update` stages and would run the hop without `prepare`, losing Office/idea_usage. NC 2.0+ needs an Engine with #456 L. Engines from 41ba677 refuse such bundles (`UPDATE_STAGES_UNSUPPORTED`) until then. See [docs/app-bundle-integrity.md](docs/app-bundle-integrity.md#engine-floor-for-bundles-that-declare-stages) and app-nextcloud#37–#40, #42.
- Dev override: `ALLOW_UNTAGGED=1` builds HEAD as `0.0-dev+<sha12>`. That version reads as 0.0 and never wins an update compare. Never ship a dev bundle, and never tag a real release `0.0`.
- Release tags are set by the Lead bot and reported to Koen. Plain git tags only, no GitHub Releases. Never move an existing tag.

## Test (required before any PR touching an App Disk)

On a claimed pool Pi (idea03 / idea04; never idea01, never idea02): stop the pm2 Engine **as pi**, then from the workspace root (`/home/pi/idea/agents/agent-app-dev`, after `npm ci`) run the harness against the deployed Engine tree (read-only — do not modify it):

```bash
ENGINE_BIN=/home/pi/idea/agents/agent-engine-dev/dist/src/index.js \
ENGINE_CWD=/home/pi/idea/agents/agent-engine-dev \
node tests/<app>/smoke.mjs
```

The smoke test exits non-zero if any assertion fails. On a passing run the harness writes `compatibility.engine_tested` (Engine short commit, package.json version, date) into the App's `app.yaml` — by default the nested checkout `/home/pi/idea/agents/agent-app-dev/app-<name>`, override with `APP_DIR`. Commit that `app.yaml` change in the App PR. It is never written on failure. See README.md → App Harness. After the harness finishes, clean up and release the Pi (claim protocol above).

## Files Disk opt-in (idea#137)

Apps that use Files Disks set `x-app.filesMount` and keep `restart: no`. See [docs/files-mount.md](docs/files-mount.md). Nextcloud's wrapper/hook live in `koenswings/app-nextcloud`; unit-test fixture copies are under `tests/fixtures/idea-files/`.

Harness: `INSTANCE_TIMEOUT_MS` (default 180000) can be raised for slow first-starts (Nextcloud). Smoke device names are throwaways; idea03's hardware stick is refused by serial/UUID via `lib/refuse-idea03-stick.mjs` reading `script/hw-roundtrip-disks.json` (skip if the file is missing, issue #56; fail closed if it exists but is invalid).

## Quality rules (every PR, no exceptions)

- No source files in docs/ — .md, .pdf, .png, .svg only
- No hardcoded credentials in compose.yaml or scripts
- No host absolute-path bind mounts in App Disk compose.yaml; App data goes in relative `./data` bind mounts on the App Disk (relative to the App's folder), never Docker named volumes (idea#141). Engine-generated Files Disk binds are allowed. Full rules: [`docs/compose-conventions.md`](docs/compose-conventions.md)
- ARM64 images only — verified with docker manifest inspect
- x-app-version label on every service (== x-app.version == release tag, `script/check-compose.mjs`) and x-app metadata block required
- Health check required on primary service
- No ports below 3000
- Build/conventions changed → update this file and `docs/compose-conventions.md` in the same PR

## Known gotchas

- Build images on any claimed ARM64 pool Pi (idea03 / idea04), never on golden idea01 and never on idea02, and verify every image with `docker manifest inspect` (arm64 present). x86 builds are forbidden: they produce AMD64 binaries that crash on Pi.
- Some DockerHub images have no ARM64 variant. Always check manifest.
- Docker volumes persist between compose down. Use -v to clean.
- Engine uses installApp (not docker compose directly) in production.

## PARKED: Grok Build + self-hosted runner path

**PARKED (idea#147, 2026-09-28).** This is not the current path. Do not trigger Grok Build or Pi runners for new work unless Koen deliberately revives it. Previously this file was written for Grok Build running headless on an ARM64 Raspberry Pi GitHub Actions self-hosted runner. Grok Build may remain installed on `idea02` for health-check purposes only; its self-hosted runner service is stopped by Atlas after idea#147 (`runner: parked`). Revival notes and the parked AGENTS.md templates live in [`koenswings/idea` docs/grok-bot-setup.md](https://github.com/koenswings/idea/blob/main/docs/grok-bot-setup.md) §2.2 and §9.
