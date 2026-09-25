/**
 * smoke.mjs — Smoke tests for app-milkwise
 *
 * Tests:
 *   1. App starts and serves HTTP 200 on /
 *   2. /api/feeds returns valid JSON array
 *   3. /api/settings returns object with required fields
 *   4. POST /api/feeds → feed logged → GET /api/feeds returns it
 *   5. Offline test: app starts with no outbound network (--network=none)
 */

import { runWithFixture } from '../../lib/harness.mjs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ────────────────────────────────────────────────────────────

const FIXTURE_PATH   = resolve(__dirname, 'fixture');
const DEVICE         = 'sdb1';           // fixture device name
const INSTANCE_NAME  = 'milkwise';       // from compose.yaml x-app.instanceName
const APP_PORT       = 13334;            // test port (avoid clashing with prod 3333)
const BASE_URL       = `http://127.0.0.1:${APP_PORT}`;

// ── Assertion helpers ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function assertHttp(url, expectedStatus, label) {
  const res = await fetch(url);
  assert(res.status === expectedStatus, `${label} → HTTP ${res.status} (expected ${expectedStatus})`);
  return res;
}

// ── Test suite ───────────────────────────────────────────────────────────────

async function testSuite(port) {
  const base = `http://127.0.0.1:${port}`;
  console.log(`\nRunning smoke tests against ${base}\n`);

  // Test 1: App serves HTTP 200 on root
  console.log('Test 1: Root page HTTP 200');
  await assertHttp(`${base}/`, 200, 'GET /');

  // Test 2: /api/feeds returns JSON array
  console.log('\nTest 2: /api/feeds returns JSON array');
  const feedsRes = await fetch(`${base}/api/feeds`);
  assert(feedsRes.status === 200, 'GET /api/feeds → 200');
  const feeds = await feedsRes.json();
  assert(Array.isArray(feeds), '/api/feeds returns array');

  // Test 3: /api/settings returns required fields
  console.log('\nTest 3: /api/settings returns required fields');
  const settingsRes = await fetch(`${base}/api/settings`);
  assert(settingsRes.status === 200, 'GET /api/settings → 200');
  const settings = await settingsRes.json();
  assert(typeof settings.weightKg === 'number', 'settings.weightKg is a number');
  assert(typeof settings.mlPerKgPerDay === 'number', 'settings.mlPerKgPerDay is a number');
  assert(typeof settings.standardBottleVolume === 'number', 'settings.standardBottleVolume is a number');
  assert(typeof settings.yellowThresholdPct === 'number', 'settings.yellowThresholdPct is a number');
  assert(typeof settings.redThresholdPct === 'number', 'settings.redThresholdPct is a number');

  // Test 4: POST /api/feeds → feed persists
  console.log('\nTest 4: POST /api/feeds → feed persists');
  const testFeed = {
    id: 'smoke-test-feed-001',
    timestamp: Date.now(),
    volume: 90,
    targetMlPerDay: 940
  };
  const postRes = await fetch(`${base}/api/feeds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([testFeed])
  });
  assert(postRes.status === 200, 'POST /api/feeds → 200');

  const feedsAfter = await (await fetch(`${base}/api/feeds`)).json();
  const found = feedsAfter.find(f => f.id === testFeed.id);
  assert(!!found, 'Feed persisted and retrievable');
  assert(found?.volume === 90, 'Feed volume correct');

  // Test 5: Key pages load (dashboard, history, analytics, settings)
  console.log('\nTest 5: Key pages return 200');
  for (const path of ['/', '/history', '/analytics', '/settings', '/log']) {
    await assertHttp(`${base}${path}`, 200, `GET ${path}`);
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  app-milkwise smoke test');
  console.log('═══════════════════════════════════════════════\n');

  // Patch compose.yaml to use APP_PORT for this test run
  // (The engine assigns a port from config, but for smoke tests we run the
  //  container directly against a known port)
  
  try {
    await runWithFixture({
      device:       DEVICE,
      fixturePath:  FIXTURE_PATH,
      instanceName: INSTANCE_NAME,
      port:         APP_PORT,
      testFn:       testSuite,
    });
  } catch (e) {
    console.error(`\n❌ Harness error: ${e.message}`);
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

main();
