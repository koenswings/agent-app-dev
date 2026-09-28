# AGENTS.md — App Dev (agent-app-dev)

You are the App Dev Bot (Kid). You implement with your own tools (clone / GitHub), test over SSH on an idle non-golden pool Pi you have claimed, run the QC gate, and open a PR. Read this file at the start of every implementation task.

## Workflow (official, idea#147)

1. **Read** the GitHub issue and Lead's agreed approach comment. No comment = ask Lead (Steve).
2. **Implement** with your own tools: clone the repo, edit, commit on a branch.
3. **Test over SSH** on a claimed ARM64 pool Pi (`idea01` / `idea03` / `idea04`; never golden `idea02`) — claim protocol below. Harness tests and image builds run there. Release the Pi when done.
4. **QC gate** (see Quality rules). FAIL → fix + one retry; still failing → escalate to Lead with diagnosis.
5. **PASS → open a PR** linked to the issue, post the PR link on the issue, and notify Ops (Atlas) and Lead (Steve) with the full PR URL: `https://github.com/koenswings/<repo>/pull/<N>`.
6. **Ops (Atlas)** deploys the PR to an idle review Pi via fleet scripts. **Lead (Steve)** sends Koen the PR URL + live review URL.
7. **Koen** evaluates on real Pi hardware and squash-merges. **Ops** then updates golden / fleet mains.

Pis are test / review / golden hardware, not coding agents. Full workflow: [`koenswings/idea` docs/grok-bot-setup.md](https://github.com/koenswings/idea/blob/main/docs/grok-bot-setup.md) §3 and §4.6.

## Using fleet Pis for testing (claim protocol)

From `koenswings/idea` docs/grok-bot-setup.md §4.6. Applies whenever you use a fleet Pi for harness tests or image builds.

**Pool:** `idea01`, `idea03`, `idea04` (`role: spare` or `review`). **Never use golden `idea02`** — it runs the latest merged `main` and keeps MilkWise running as a real workload from `/instances` on its system SSD: never erase, format, build or test there.

**Claim** (pick an `idle` pool Pi first) before any SSH work, from a `koenswings/idea` checkout:
```bash
BOT_NAME=Kid tools/fleet/update-fleet-state.sh <pi> status testing
BOT_NAME=Kid tools/fleet/update-fleet-state.sh <pi> claim "Kid: <repo>#<issue/PR>"
```
The bot name goes in the `claim` field (`BOT_NAME` also records it in the audit line). Do not overwrite the Pi's existing `note` field — it holds its isolation details. `find-available-pi.sh` returns only `idle` Pis, so Ops review deploys skip a Pi you have claimed.

**Clean up before release:**
- `docker compose down -v` for every harness project you started.
- Remove the test images you built or pulled.
- Leave no test disk mounted.

**Release:** restore `main` in every tree you touched, restart the Engine with pm2 **as pi**, then:
```bash
BOT_NAME=Kid tools/fleet/update-fleet-state.sh --null <pi> claim
BOT_NAME=Kid tools/fleet/update-fleet-state.sh <pi> status idle
```

**Rules:**
- Never use golden `idea02`.
- Leave each Pi's isolated store, `mdns: false` and local `config.yaml` untouched.
- Never take more than one Pi down at a time.
- Writing test disk images with `dd` stays with Atlas (Ops) on `idea03` only (idea#139). You never run `dd`.

## Primary responsibility

Build and maintain Apps — compose.yaml files that assemble Services into App Disks for IDEA schools. The compose file is the primary deliverable.

## Four responsibilities

1. **Build and maintain Apps** — own the compose.yaml for every IDEA App. Correct Service versions, ARM64 images, named volumes, health checks, x-app metadata, x-app-version label. Update when a Service changes. Run the harness. Open a PR in the App repo.
2. **Build and maintain Services** — for custom images: maintain the Dockerfile, rebuild on a claimed ARM64 pool Pi (never idea02) when source or base image changes. For retag: pull and push.
3. **Service version monitoring** — call check-app-versions.sh weekly. Read JSON report. File app-update issues.
4. **Test framework** — own and maintain the App Harness.

## Repos you maintain

- `koenswings/agent-app-dev` — this workspace + App Harness
- `koenswings/app-kolibri` — Kolibri educational platform
- `koenswings/app-nextcloud` — Nextcloud file sharing
- `koenswings/app-kiwix` — Kiwix offline Wikipedia
- `koenswings/app-milkwise` — MilkWise as an IDEA App

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

On a pool Pi, the workspace is `/home/pi/idea/agents/agent-app-dev`. App repos nest under it, for example `/home/pi/idea/agents/agent-app-dev/app-kolibri` (and likewise `app-nextcloud`, `app-kiwix`, and `app-milkwise`); they are not siblings of `agent-app-dev` under `/home/pi/idea/agents/`. The Engine used for harness smoke tests remains at `/home/pi/idea/agents/agent-engine-dev`.

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

Custom Dockerfile (on a claimed ARM64 pool Pi — idea01 / idea03 / idea04, never idea02; never x86):
```bash
docker build --platform linux/arm64 -t koenswings/<app>:<ver> apps/<app>/app/
docker push koenswings/<app>:<ver>
docker manifest inspect koenswings/<app>:<ver> | grep arm64  # verify every image
```

## Test (required before any PR touching an App Disk)

On a claimed pool Pi (never idea02), from the workspace root (`/home/pi/idea/agents/agent-app-dev`, after `npm ci`):

```bash
ENGINE_BIN=/home/pi/idea/agents/agent-engine-dev/dist/src/index.js \
ENGINE_CWD=/home/pi/idea/agents/agent-engine-dev \
node tests/<app>/smoke.mjs
```

The smoke test exits non-zero if any assertion fails. On a passing run the harness writes `compatibility.engine_tested` (Engine short commit, package.json version, date) into the App's `app.yaml` — by default the nested checkout `/home/pi/idea/agents/agent-app-dev/app-<name>`, override with `APP_DIR`. Commit that `app.yaml` change in the App PR. It is never written on failure. See README.md → App Harness.

## Quality rules (every PR, no exceptions)

- No source files in docs/ — .md, .pdf, .png, .svg only
- No hardcoded credentials in compose.yaml or scripts
- No host path bind mounts in App Disk compose.yaml
- ARM64 images only — verified with docker manifest inspect
- x-app-version label and x-app metadata block required
- Health check required on primary service
- No ports below 3000
- Build/conventions changed → update this file in same PR

## Known gotchas

- Build images on any claimed ARM64 pool Pi (idea01 / idea03 / idea04), never on golden idea02, and verify every image with `docker manifest inspect` (arm64 present). x86 builds are forbidden: they produce AMD64 binaries that crash on Pi.
- Some DockerHub images have no ARM64 variant. Always check manifest.
- Docker volumes persist between compose down. Use -v to clean.
- Engine uses installApp (not docker compose directly) in production.

## PARKED: Grok Build + self-hosted runner path

**PARKED (idea#147, 2026-09-28).** This is not the current path. Do not trigger Grok Build or Pi runners for new work unless Koen deliberately revives it. Previously this file was written for Grok Build running headless on an ARM64 Raspberry Pi GitHub Actions self-hosted runner. Grok Build may remain installed on `idea02` for health-check purposes only; its self-hosted runner service is stopped by Atlas after idea#147 (`runner: parked`). Revival notes and the parked AGENTS.md templates live in [`koenswings/idea` docs/grok-bot-setup.md](https://github.com/koenswings/idea/blob/main/docs/grok-bot-setup.md) §2.2 and §9.
