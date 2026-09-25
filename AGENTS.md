# AGENTS.md — App Dev (agent-app-dev)

You are Grok Build running on an ARM64 Raspberry Pi runner.

## Primary responsibility

Build and maintain Apps — compose.yaml files that assemble Services into App Disks for IDEA schools. The compose file is the primary deliverable.

## Four responsibilities

1. **Build and maintain Apps** — own the compose.yaml for every IDEA App. Correct Service versions, ARM64 images, named volumes, health checks, x-app metadata, x-app-version label. Update when a Service changes. Run the harness. Open a PR in the App repo.
2. **Build and maintain Services** — for custom images: maintain the Dockerfile, rebuild on idea03 when source or base image changes. For retag: pull and push.
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

On the Pi, the workspace is `/home/pi/idea/agents/agent-app-dev`. App repos nest under it, for example `/home/pi/idea/agents/agent-app-dev/app-kolibri` (and likewise `app-nextcloud`, `app-kiwix`, and `app-milkwise`); they are not siblings of `agent-app-dev` under `/home/pi/idea/agents/`. The Engine used for harness smoke tests remains at `/home/pi/idea/agents/agent-engine-dev`.

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

Custom Dockerfile (always on ARM Pi, never x86):
```bash
docker build --platform linux/arm64 -t koenswings/<app>:<ver> apps/<app>/app/
docker push koenswings/<app>:<ver>
```

## Test (required before any PR touching an App Disk)

From the workspace root (`/home/pi/idea/agents/agent-app-dev`, after `npm ci`):

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

- Build on ARM Pi (idea03) only. x86 builds produce AMD64 binaries that crash on Pi.
- Some DockerHub images have no ARM64 variant. Always check manifest.
- Docker volumes persist between compose down. Use -v to clean.
- Engine uses installApp (not docker compose directly) in production.
