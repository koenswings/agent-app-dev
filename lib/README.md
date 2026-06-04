# app-harness

IDEA App compatibility test harness. Owned by Kit 🎒.

## What it does

Starts a real engine process in testMode on a secondary port, presents a fixture App Disk, waits for the instance to reach Running, runs the app test suite, then tears everything down cleanly.

## Structure

```
lib/
  harness.mjs           ← Core harness: engine spawn, fixture setup, teardown
tests/
  app-milkwise/
    smoke.mjs           ← Smoke tests for app-milkwise
    fixture/
      META.yaml
      apps/milkwise-1.0.0/compose.yaml
      instances/milkwise-smoke-test-001/
        compose.yaml
        .env            ← port=13334
```

## Running tests

```bash
# On idea02 (or any Pi with the engine installed)
ENGINE_BIN=/home/pi/projects/engine/dist/src/index.js \
ENGINE_MODULES=/home/pi/projects/engine/node_modules \
ENGINE_CWD=/home/pi/projects/engine \
ENGINE_PORT=18800 \
IDEA_WATCH_DIR=/dev/engine-test \
STORE_DIR=/tmp/kit-test-store-$$ \
node tests/app-milkwise/smoke.mjs
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGINE_BIN` | `/home/pi/projects/engine/dist/src/index.js` | Path to engine binary |
| `ENGINE_MODULES` | `/home/node/workspace/agents/agent-engine-dev/node_modules` | Engine node_modules |
| `ENGINE_CWD` | `/home/pi/projects/engine` | Engine working directory (must have config.yaml) |
| `ENGINE_PORT` | `18800` | Automerge WS port for test engine |
| `IDEA_WATCH_DIR` | `/dev/engine-test` | Sentinel directory (must differ from production `/dev/engine`) |
| `STORE_DIR` | `/tmp/kit-test-store-<pid>` | Isolated store data directory |

## How the harness works

1. Checks no production IDEA App containers are running (aborts if so)
2. Creates a workdir with fresh store identity (isolated from production store)
3. Symlinks the fixture directory to `/disks/<device>/`
4. Spawns the engine in testMode on a secondary port
5. Waits for WS port + USB monitor to be ready (~18s)
6. Touches `/dev/engine-test/<device>` → engine fires `addDevice`
7. Engine reads fixture META.yaml, finds instances/, starts containers via docker compose
8. Waits for container to show `Up` in `docker ps`
9. Reads assigned port from fixture instances/.env
10. Runs app test suite
11. Removes sentinel → engine undocks → containers stopped
12. Kills engine, cleans up

## Design doc

See `design/kit-app-dev-agent-full.pdf` and `design/kit-compatibility-matrix.pdf` in `agent-app-dev`.
