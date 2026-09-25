/**
 * harness.mjs — IDEA App Test Harness
 *
 * Starts a real engine process in testMode on a secondary port, presents a
 * fixture disk, waits for the instance to reach Running, hands off to the
 * app test suite, then tears everything down.
 *
 * Usage (called by per-app test scripts):
 *   import { runWithFixture } from './harness.mjs';
 *   await runWithFixture({ device, fixturePath, appName, testFn });
 *
 * Environment (all required or defaulted):
 *   ENGINE_BIN   - path to engine dist/src/index.js
 *   ENGINE_PORT  - Automerge WS port for test engine (default 18800)
 *   ENGINE_HTTP  - HTTP port for test engine (default 18801)
 *   STORE_DIR    - temp store dir (default /tmp/kit-test-store-<pid>)
 */

import { spawn, execSync as _execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'fs';
const execSync = (cmd) => _execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
import { readFile } from 'fs/promises';
import { createServer } from 'http';

// ── Engine binary path ──────────────────────────────────────────────────────

const ENGINE_BIN = process.env.ENGINE_BIN ||
  '/home/pi/projects/engine/dist/src/index.js';

const ENGINE_MODULES = process.env.ENGINE_MODULES ||
  '/home/node/workspace/agents/agent-engine-dev/node_modules';

// ── Defaults ────────────────────────────────────────────────────────────────

const ENGINE_PORT  = parseInt(process.env.ENGINE_PORT  || '18800', 10);
const ENGINE_HTTP  = parseInt(process.env.ENGINE_HTTP  || '18801', 10);
const STORE_DIR    = process.env.STORE_DIR    || `/tmp/kit-test-store-${process.pid}`;
const DEV_ENGINE   = process.env.IDEA_WATCH_DIR || '/dev/engine-test';
const DISKS_ROOT   = '/disks';
const STARTUP_TIMEOUT_MS  = 60_000;
const INSTANCE_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS    = 2_000;

// ── Utilities ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const log = (msg) => console.log(`[harness] ${msg}`);

import { createConnection } from 'net';

/**
 * Wait until the engine Automerge WS port is accepting TCP connections.
 */
async function waitForEngineWs(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const sock = createConnection({ host: '127.0.0.1', port }, () => {
          sock.destroy();
          resolve();
        });
        sock.on('error', reject);
        sock.setTimeout(1000, () => { sock.destroy(); reject(new Error('timeout')); });
      });
      log(`Engine WS port ${port} is accepting connections`);
      return;
    } catch { /* not ready yet */ }
    await sleep(1000);
  }
  throw new Error(`Engine WS port ${port} did not open within ${timeoutMs}ms`);
}

import { readdirSync } from 'fs';
import { Repo } from '@automerge/automerge-repo';
import { WebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';

/**
 * Wait until the named instance reaches Running state by watching the Automerge store.
 *
 * This is more reliable than docker ps because the engine writes status: 'Running'
 * only after port assignment, .env generation, password generation, and health checks
 * are complete — docker ps can return Up 5-10 seconds before the instance is truly ready.
 */
async function waitForInstanceRunning(instanceName, docId, timeoutMs) {
  const repo = new Repo({
    network: [new WebSocketClientAdapter(`ws://127.0.0.1:${ENGINE_PORT}`)]
  });

  // repo.find() is async in automerge-repo 2.5.x — await the handle
  const handle = await repo.find(`automerge:${docId}`);
  // Wait until the doc is ready (synced from engine) or unavailable
  await handle.whenReady(['ready', 'unavailable']);

  const deadline = Date.now() + timeoutMs;
  log(`Waiting for instance "${instanceName}" to reach Running state via store...`);

  while (Date.now() < deadline) {
    const doc = handle.doc();
    const instance = Object.values(doc?.instanceDB ?? {})
      .find(i => i.name === instanceName);

    if (instance?.status === 'Running') {
      log(`Instance "${instanceName}" is Running (id: ${instance.id})`);
      repo.off();  // disconnect cleanly
      return instance.id;
    }

    if (instance) log(`Instance status: "${instance.status}" — waiting...`);
    await sleep(POLL_INTERVAL_MS);
  }

  repo.off();
  throw new Error(`Instance "${instanceName}" did not reach Running within ${timeoutMs}ms`);
}


/**
 * Read the port the engine assigned from the fixture's instances .env file.
 * The engine writes: port=<number>\npass=<string> into instances/<id>/.env
 */
function readAssignedPort(fixturePath) {
  const instancesDir = `${fixturePath}/instances`;
  if (!existsSync(instancesDir)) return null;
  try {
    const ids = readdirSync(instancesDir);
    for (const id of ids) {
      const envFile = `${instancesDir}/${id}/.env`;
      if (existsSync(envFile)) {
        const content = readFileSync(envFile, 'utf8');
        const match = content.match(/^port=(\d+)/m);
        if (match) {
          log(`Read assigned port ${match[1]} from ${envFile}`);
          return parseInt(match[1], 10);
        }
      }
    }
  } catch (e) {
    log(`Could not read assigned port: ${e.message}`);
  }
  return null;
}

// ── Main harness ─────────────────────────────────────────────────────────────

/**
 * Run a test function against a fixture app disk.
 *
 * @param {object} opts
 * @param {string}   opts.device       - e.g. "sdb1"
 * @param {string}   opts.fixturePath  - path to pre-populated fixture dir (has META.yaml, apps/, etc.)
 * @param {string}   opts.instanceName - name of the instance to wait for
 * @param {number}   opts.port         - port the app will be served on (assigned by engine)
 * @param {Function} opts.testFn       - async (port) => void  — the actual test suite
 */
export async function runWithFixture({ device, fixturePath, instanceName, port, testFn }) {
  let engineProcess = null;
  const sentinelPath = `${DEV_ENGINE}/${device}`;
  const mountPath    = `${DISKS_ROOT}/${device}`;

  // Abort if any App Disk is currently running on production engine
  await checkNoProductionConflict();

  // ── 1. Prepare store dir ─────────────────────────────────────────────────
  log(`Preparing store dir: ${STORE_DIR}`);
  mkdirSync(STORE_DIR, { recursive: true });
  mkdirSync(`${STORE_DIR}/store-identity`, { recursive: true });

  // ── 2. Ensure fixture dir is in place ────────────────────────────────────
  log(`Fixture dir: ${fixturePath}`);
  if (!existsSync(fixturePath)) {
    throw new Error(`Fixture dir not found: ${fixturePath}`);
  }

  // Symlink or bind fixture to /disks/<device>
  mkdirSync(DISKS_ROOT, { recursive: true });
  if (existsSync(mountPath)) {
    rmSync(mountPath, { recursive: true, force: true });
  }
  // Use a symlink so testMode reads from the fixture
  // /disks/ is root-owned; use sudo for the symlink operation
  execSync(`sudo ln -sfn ${fixturePath} ${mountPath}`);
  log(`Linked ${fixturePath} → ${mountPath}`);

  // Ensure data directories in instance dirs are writable by the container user (uid 1001)
  if (existsSync(`${fixturePath}/instances`)) {
    execSync(`find ${fixturePath}/instances -maxdepth 2 -name data -type d -exec chmod 777 {} \\; 2>/dev/null || true`);
    // Create data dirs if missing
    execSync(`find ${fixturePath}/instances -maxdepth 1 -mindepth 1 -type d | xargs -I{} mkdir -p {}/data && chmod 777 ${fixturePath}/instances/*/data 2>/dev/null || true`);
  }

  // ── 3. Start test engine ─────────────────────────────────────────────────
  // Create a workdir with config.yaml + FRESH store-identity so the test engine
  // does not connect to the production store cluster.
  const ENGINE_CWD = process.env.ENGINE_CWD || '/home/pi/projects/engine';
  const WORK_DIR = `${STORE_DIR}-workdir`;
  mkdirSync(`${WORK_DIR}/store-identity`, { recursive: true });
  execSync(`cp ${ENGINE_CWD}/config.yaml ${WORK_DIR}/config.yaml`);
  // Copy the real production store URL — the engine will create a fresh local store
  // using this as the document ID (template-based creation, no syncing since MDNS disabled).
  // This ensures the doc ID is a valid Automerge base58 ID.
  try {
    execSync(`cp ${ENGINE_CWD}/store-identity/store-url.txt ${WORK_DIR}/store-identity/store-url.txt`);
  } catch {
    // Fallback: create a placeholder; engine will regenerate
    writeFileSync(`${WORK_DIR}/store-identity/store-url.txt`, 'automerge:placeholder');
  }
  // Copy template so engine can initialise the store schema
  try { execSync(`cp ${ENGINE_CWD}/store-identity/store-template.json ${WORK_DIR}/store-identity/store-template.json`); } catch {}

  log(`Starting test engine on port ${ENGINE_PORT} (HTTP ${ENGINE_HTTP})...`);
  engineProcess = spawn('node', [ENGINE_BIN], {
    env: {
      ...process.env,
      NODE_PATH: `${ENGINE_MODULES}`,
      IDEA_ENGINE_PORT:      String(ENGINE_PORT),
      IDEA_STORE_DIR:        `${WORK_DIR}/data`,
      IDEA_TEST_MODE:        'true',
      IDEA_SYSTEM_DISK_SKIP: 'true',
      VERBOSITY:             '2',
      // Watch a separate sentinel dir so the production engine is not triggered
      IDEA_WATCH_DIR:        process.env.IDEA_WATCH_DIR || '/dev/engine-test',
      IDEA_MDNS_DISABLE:     'true', // prevent test engine connecting to production store
    },
    cwd: WORK_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  engineProcess.stdout.on('data', d => process.stdout.write(`[engine] ${d}`));
  engineProcess.stderr.on('data', d => process.stderr.write(`[engine:err] ${d}`));
  engineProcess.on('exit', (code) => log(`Engine exited with code ${code}`));

  try {
    // ── 4. Wait for engine WS port to be ready ─────────────────────────────
    await waitForEngineWs(ENGINE_PORT, STARTUP_TIMEOUT_MS);

    // USB monitor starts ~15s after Automerge. Give it time.
    log("Waiting 18s for USB monitor to initialize...");
    await sleep(18000);

    // ── 5. Dock the fixture disk ───────────────────────────────────────────
    log(`Creating sentinel: ${sentinelPath}`);
    // Ensure the watch dir exists (engine watches it but won't create it)
    execSync(`sudo mkdir -p ${DEV_ENGINE}`);
    // /dev/engine is root-owned; use sudo
    execSync(`sudo touch ${sentinelPath}`);

    // Read the doc ID AFTER the engine is ready and sentinel is placed.
    // The engine regenerates store-url.txt during startup with the real doc ID.
    const storeUrlPath = `${WORK_DIR}/store-identity/store-url.txt`;
    const storeUrl = readFileSync(storeUrlPath, 'utf8').trim();
    const docId = storeUrl.replace('automerge:', '');
    log(`Using store doc ID: ${docId}`);

    // ── 6. Wait for instance Running, detect assigned port ────────────────
    await waitForInstanceRunning(instanceName, docId, INSTANCE_TIMEOUT_MS);
    const assignedPort = readAssignedPort(fixturePath);
    const effectivePort = assignedPort || port;
    log(`Instance running on port ${effectivePort}`);
    // Wait for container to be ready to accept connections
    // Poll with retries rather than fixed sleep
    for (let i = 0; i < 10; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${effectivePort}/`);
        if (res.ok) { log(`Container ready on port ${effectivePort}`); break; }
      } catch { /* not ready yet */ }
      await sleep(1000);
    }

    // ── 7. Run the test suite ──────────────────────────────────────────────
    log(`Running test suite for instance "${instanceName}"...`);
    await testFn(effectivePort);
    log('✅ All tests passed');

  } finally {
    // ── 8. Teardown ───────────────────────────────────────────────────────
    log('Tearing down...');

    // Remove sentinel → triggers undock in engine
    if (existsSync(sentinelPath)) {
      log(`Removing sentinel: ${sentinelPath}`);
      try { execSync(`sudo rm -f ${sentinelPath}`); } catch {}
    }
    await sleep(3000); // give engine time to undock

    // Kill engine
    if (engineProcess && !engineProcess.killed) {
      log('Killing test engine...');
      engineProcess.kill('SIGTERM');
      await sleep(2000);
      if (!engineProcess.killed) engineProcess.kill('SIGKILL');
    }

    // Remove symlink
    try { execSync(`sudo rm -f ${mountPath}`); } catch {}

    // Clean up store dir and workdir
    try { rmSync(STORE_DIR, { recursive: true, force: true }); } catch {}
    try { rmSync(WORK_DIR, { recursive: true, force: true }); } catch {}
    log('Teardown complete');
  }
}

/**
 * Check the production engine isn't running any active instances.
 * If it is, throw so the test run aborts rather than contending resources.
 */
// IDEA App Disk compose projects use the pattern: <appName>-<instanceId>
// They are identified by the compose project label starting with a known app name.
// MC, OpenClaw, and other infra containers are excluded.
const IDEA_APP_PREFIXES = ['kolibri', 'nextcloud', 'kiwix', 'seafile', 'kolibri-studio', 'milkwise'];

async function checkNoProductionConflict() {
  try {
      const out = execSync(
      'docker ps --format "{{.Names}}"',
      { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
    ).trim();
    const running = out.split('\n').filter(n => n.trim());
    const appContainers = running.filter(name =>
      IDEA_APP_PREFIXES.some(prefix => name.toLowerCase().startsWith(prefix))
    );
    if (appContainers.length > 0) {
      log(`WARNING: Active IDEA App containers detected: ${appContainers.join(', ')}`);
      log('Aborting test run to avoid resource conflict. Undock the App Disk first.');
      throw new Error(`IDEA App Disk is active — aborting test run: ${appContainers.join(', ')}`);
    }
    log('No active IDEA App containers — safe to proceed');
  } catch (e) {
    if (e.message.includes('aborting')) throw e;
    log(`Could not check production state: ${e.message} — proceeding anyway`);
  }
}
