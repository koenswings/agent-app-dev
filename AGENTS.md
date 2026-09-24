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
apps/
  app-harness/      Integration test framework
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

```bash
ENGINE_BIN=/home/pi/idea/agents/agent-engine-dev/dist/src/index.js \
ENGINE_CWD=/home/pi/idea/agents/agent-engine-dev \
node tests/<app>/smoke.mjs
```

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
