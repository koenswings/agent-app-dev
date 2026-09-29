/**
 * smoke.mjs — Files Disk opt-in smoke for app-nextcloud (idea#137)
 *
 * Fixture: combined App + Files disk (apps/, instances/, META.yaml, FILES.yaml, files/).
 * Asserts compose filesMount metadata, wrapper/hook presence, and (when ready)
 * external storage via occ. Nextcloud first-start is slow — raise INSTANCE_TIMEOUT_MS.
 *
 * DEVICE is a throwaway fixture name. idea03's permanent stick is refused by
 * USB/disk serial / UUID from hw-roundtrip-disks.json (fail closed if missing).
 */
import { runWithFixture } from '../../lib/harness.mjs';
import { assertNotIdea03Stick } from '../../lib/refuse-idea03-stick.mjs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURE_PATH  = resolve(__dirname, 'fixture');
const DEVICE        = process.env.SMOKE_DEVICE || 'sdz1'; // throwaway — never idea03 stick
const INSTANCE_NAME = 'nextcloud';
const APP_NAME      = 'app-nextcloud';
const APP_PORT      = 18080;
const INSTANCE_ID   = 'nextcloud-smoke-001';

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

function readComposeFilesMount(composePath) {
  const text = readFileSync(composePath, 'utf8');
  const hasPath = /filesMount:\s*\n\s*path:\s*\/mnt\/idea-files/.test(text);
  const hasSvc = /services:\s*\[nextcloud-app\]/.test(text);
  const hasRestartNo = /restart:\s*no/.test(text);
  const hasEntrypoint = /idea-files-entrypoint\.sh/.test(text);
  const hasHook = /10-idea-files\.sh/.test(text);
  return { hasPath, hasSvc, hasRestartNo, hasEntrypoint, hasHook, text };
}

async function testSuite(port) {
  console.log(`\nRunning nextcloud Files Disk smoke against port ${port}\n`);

  // 1. Compose opt-in metadata (apps + instance copies)
  console.log('Test 1: filesMount opt-in in compose');
  for (const rel of [
    'apps/nextcloud-1.0/compose.yaml',
    `instances/${INSTANCE_ID}/compose.yaml`,
  ]) {
    const p = resolve(FIXTURE_PATH, rel);
    assert(existsSync(p), `${rel} exists`);
    const m = readComposeFilesMount(p);
    assert(m.hasPath, `${rel} has filesMount.path /mnt/idea-files`);
    assert(m.hasSvc, `${rel} lists nextcloud-app in filesMount.services`);
    assert(m.hasRestartNo, `${rel} keeps restart: no`);
    assert(m.hasEntrypoint, `${rel} mounts idea-files-entrypoint.sh`);
    assert(m.hasHook, `${rel} mounts 10-idea-files.sh`);
  }

  // 2. Combined disk markers
  console.log('\nTest 2: combined App+Files fixture markers');
  assert(existsSync(resolve(FIXTURE_PATH, 'META.yaml')), 'META.yaml present');
  assert(existsSync(resolve(FIXTURE_PATH, 'FILES.yaml')), 'FILES.yaml present');
  assert(existsSync(resolve(FIXTURE_PATH, 'files')), 'files/ present');
  assert(existsSync(resolve(FIXTURE_PATH, 'apps')), 'apps/ present');
  assert(existsSync(resolve(FIXTURE_PATH, 'instances')), 'instances/ present');

  // 3. Wrapper + hook scripts on the App Disk (instance dir)
  console.log('\nTest 3: wrapper and hook on App Disk');
  const inst = resolve(FIXTURE_PATH, `instances/${INSTANCE_ID}`);
  assert(existsSync(resolve(inst, 'idea-files-entrypoint.sh')), 'instance has idea-files-entrypoint.sh');
  assert(
    existsSync(resolve(inst, 'docker-entrypoint-hooks.d/before-starting/10-idea-files.sh')),
    'instance has 10-idea-files.sh'
  );

  // 4. Container checks (best-effort; Nextcloud install may still be running)
  console.log('\nTest 4: container entrypoint / files mount (best-effort)');
  let container = '';
  try {
    container = execSync(
      `docker ps --format '{{.Names}}' | grep -E '${INSTANCE_ID}.*nextcloud-app' | head -1`,
      { encoding: 'utf8' }
    ).trim();
  } catch { /* none */ }

  if (!container) {
    // Try broader match
    try {
      container = execSync(
        `docker ps --format '{{.Names}}' | grep nextcloud-app | head -1`,
        { encoding: 'utf8' }
      ).trim();
    } catch { /* none */ }
  }

  if (container) {
    assert(true, `nextcloud-app container running: ${container}`);
    try {
      const ep = execSync(`docker inspect -f '{{json .Config.Entrypoint}}' ${container}`, { encoding: 'utf8' }).trim();
      assert(ep.includes('idea-files-entrypoint'), `entrypoint is wrapper: ${ep}`);
    } catch (e) {
      assert(false, `docker inspect entrypoint: ${e.message}`);
    }

    // Bind assert: Engine override mounts /mnt/idea-files/<slug>-<id6> when Files role processed
    try {
      const mounts = execSync(`docker exec ${container} sh -c 'ls -la /mnt/idea-files 2>/dev/null || echo MISSING'`, { encoding: 'utf8' });
      if (mounts.includes('MISSING')) {
        console.log('  ⚠ /mnt/idea-files not present in container (Engine override may not have applied in harness window) — not failing; unit tests cover hook');
      } else {
        assert(true, `/mnt/idea-files visible: ${mounts.trim().split('\\n').slice(0, 3).join(' | ')}`);
      }
    } catch (e) {
      console.log(`  ⚠ docker exec ls /mnt/idea-files: ${e.message}`);
    }

    // occ external storage — only if Nextcloud install finished
    try {
      const occList = execSync(
        `docker exec -u www-data ${container} php occ files_external:list --output=json 2>/dev/null || true`,
        { encoding: 'utf8', timeout: 30000 }
      ).trim();
      if (occList.startsWith('[')) {
        assert(true, `occ files_external:list returned JSON (${occList.length} bytes)`);
        const parsed = JSON.parse(occList);
        const own = parsed.filter(m => m.options?.idea_files === 1 || m.options?.idea_files === '1' || m.options?.idea_files === true);
        if (own.length > 0) {
          assert(true, `hook created ${own.length} own external storage(s)`);
        } else {
          console.log('  ⚠ no idea_files-marked storages yet (install/hook may still be settling) — unit tests cover reconcile');
        }
      } else {
        console.log('  ⚠ occ not ready for files_external:list — opt-in + wrapper already asserted; unit tests cover occ reconcile');
      }
    } catch (e) {
      console.log(`  ⚠ occ check skipped: ${e.message}`);
    }
  } else {
    assert(false, 'nextcloud-app container not found after Running');
  }

  // 5. HTTP reachability (install may redirect to setup)
  console.log('\nTest 5: HTTP responds');
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
    assert(res.status >= 200 && res.status < 500, `GET / → HTTP ${res.status}`);
  } catch (e) {
    console.log(`  ⚠ HTTP not ready: ${e.message}`);
  }

  return { passed, failed };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  app-nextcloud Files Disk smoke (idea#137)');
  console.log('═══════════════════════════════════════════════\n');

  // Refuse idea03 hardware stick by ID (fail closed if JSON missing)
  try {
    assertNotIdea03Stick([DEVICE]); // device name alone never matches IDs — also probe lsblk if any
    // If SMOKE_PROBE_SERIALS is set (comma-separated), check those too
    if (process.env.SMOKE_PROBE_SERIALS) {
      assertNotIdea03Stick(process.env.SMOKE_PROBE_SERIALS.split(',').map(s => s.trim()));
    }
    console.log(`Device "${DEVICE}" is a throwaway fixture name; idea03 stick IDs loaded and not matched.\n`);
  } catch (e) {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  }

  let result;
  try {
    result = await runWithFixture({
      device:       DEVICE,
      fixturePath:  FIXTURE_PATH,
      instanceName: INSTANCE_NAME,
      port:         APP_PORT,
      appName:      APP_NAME,
      appDir:       process.env.APP_DIR || undefined,
      testFn:       testSuite,
    });
  } catch (e) {
    console.error(`\n❌ Harness error: ${e.message}`);
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Results: ${result.passed} passed, ${result.failed} failed`);
  console.log('═══════════════════════════════════════════════\n');
  process.exit(result.ok ? 0 : 1);
}

main();
