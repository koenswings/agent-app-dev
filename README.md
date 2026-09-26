# App Dev — IDEA Platform

This is the App Dev workspace for the IDEA platform. It contains the App Harness integration test framework and is the workspace for managing IDEA App Disks.

## What are App Disks?

An App Disk is a USB/SSD drive that the Engine auto-detects when docked. It contains a `compose.yaml` and `META.yaml` that tell the Engine which Docker containers to start. App Disks are the distribution mechanism for getting educational apps into schools — no download, no internet, no installer.

## Current IDEA Apps

| App | Repo |
|-----|------|
| Kolibri (educational content) | `koenswings/app-kolibri` |
| Nextcloud (file sharing) | `koenswings/app-nextcloud` |
| Kiwix (offline Wikipedia) | `koenswings/app-kiwix` |
| MilkWise (baby milk tracker) | `koenswings/app-milkwise` |

## This repo contains

- `lib/harness.mjs` — App Harness: integration test framework that spawns a real Engine in testMode
- `lib/engine-tested.mjs` — records the tested Engine build in an App's `app.yaml` after a passing run
- `tests/<app>/smoke.mjs` — per-App smoke tests, each with a `fixture/` App Disk (e.g. `tests/app-milkwise/`)
- `proposals/` — past decisions and design reasoning

The harness was moved here from the former `koenswings/app-harness` repo (history preserved) — see koenswings/idea#96.

## App Harness

Starts a real Engine process in testMode on a secondary port, presents a fixture App Disk, waits for the instance to reach Running, runs the App's test suite, then tears everything down cleanly.

### Layout

```
lib/
  harness.mjs            ← Core harness: engine spawn, fixture setup, teardown, summary
  engine-tested.mjs      ← Writes compatibility.engine_tested into app.yaml (passing runs only)
  engine-tested.test.mjs ← Unit tests (node --test lib/)
tests/
  app-milkwise/
    smoke.mjs            ← Smoke tests for app-milkwise (imports ../../lib/harness.mjs)
    fixture/
      META.yaml
      apps/milkwise-1.0.0/compose.yaml
      instances/milkwise-smoke-test-001/
        compose.yaml
        .env             ← port=13334
```

This matches what `koenswings/idea/tools/quality/quality-scan.sh` expects: it detects the harness with `find tests -name smoke.mjs` and runs every `tests/*/smoke.mjs` from the repo root.

### Running tests

```bash
# On a Pi with the Engine checked out and built (idea02 / idea03)
cd /home/pi/idea/agents/agent-app-dev
npm ci
ENGINE_CWD=/home/pi/idea/agents/agent-engine-dev \
ENGINE_BIN=/home/pi/idea/agents/agent-engine-dev/dist/src/index.js \
ENGINE_MODULES=/home/pi/idea/agents/agent-engine-dev/node_modules \
ENGINE_PORT=18800 \
IDEA_WATCH_DIR=/dev/engine-test \
STORE_DIR=/tmp/kit-test-store-$$ \
node tests/app-milkwise/smoke.mjs

# Unit tests for the app.yaml writer (no Engine needed)
npm run test:unit
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGINE_CWD` | `/home/pi/idea/agents/agent-engine-dev` | Engine checkout (must have `config.yaml`); also the source of the recorded commit and version |
| `ENGINE_BIN` | `$ENGINE_CWD/dist/src/index.js` | Path to engine entry point |
| `ENGINE_MODULES` | `$ENGINE_CWD/node_modules` | Engine node_modules (`NODE_PATH` for the engine process) |
| `ENGINE_PORT` | `18800` | Automerge WS port for test engine |
| `IDEA_WATCH_DIR` | `/dev/engine-test` | Sentinel directory (must differ from production `/dev/engine`) |
| `STORE_DIR` | `/tmp/kit-test-store-<pid>` | Isolated store data directory |
| `APP_DIR` | `/home/pi/idea/agents/agent-app-dev/<app>` | App repo checkout whose `app.yaml` receives `engine_tested` |
| `RECORD_ENGINE_TESTED` | (unset) | Set to `0` to skip writing `app.yaml` on a passing run |

### Pass/fail and exit code

Each smoke test's `testFn(port)` returns `{ passed, failed }` assertion counts. The harness prints the summary from those counts (`✅ All N assertions passed` / `❌ X of N assertions failed`) and the smoke script exits non-zero if any assertion failed, if `testFn` threw, or if it reported no results.

### Recording `engine_tested`

Only after a passing run (every assertion passed, exit code 0) does the harness write the Engine build into the tested App's `app.yaml`:

```yaml
compatibility:
  engine_tested:
    commit: "<short sha>"   # git -C $ENGINE_CWD rev-parse --short HEAD
    version: "1.0"          # "version" from $ENGINE_CWD/package.json
    date: "YYYY-MM-DD"
```

- The App repo is `$APP_DIR`, or by default `/home/pi/idea/agents/agent-app-dev/<appName>` (each smoke test passes its `appName`, e.g. `app-milkwise`).
- Only the `compatibility.engine_tested` entry is rewritten; other keys, `engine_min` and comments are preserved. No YAML dependency is used.
- On a failing run `app.yaml` is never touched. If `app.yaml` is missing the harness logs it and skips recording.
- Commit the resulting `app.yaml` change in the App PR.

### How the harness works

1. Checks no production IDEA App containers are running (aborts if so)
2. Creates a workdir with fresh store identity (isolated from production store)
3. Symlinks the fixture directory to `/disks/<device>/`
4. Spawns the engine in testMode on a secondary port
5. Waits for WS port + USB monitor to be ready (~18s)
6. Touches `/dev/engine-test/<device>` → engine fires `addDevice`
7. Engine reads fixture META.yaml, finds instances/, starts containers via docker compose
8. Waits for the instance to reach `Running` in the Automerge store
9. Reads assigned port from fixture instances/.env
10. Runs app test suite
11. Removes sentinel → engine undocks → containers stopped
12. Kills engine, cleans up
13. Prints the summary; on a passing run records `engine_tested` in `app.yaml`

## Repos

| Repo | Purpose |
|------|---------|
| `koenswings/agent-app-dev` | This repo — workspace and harness |
| `koenswings/app-<name>` | Per-App repos |
| `koenswings/idea` | Org root — tasks, proposals, docs |
