/**
 * Unit tests for idea-files-entrypoint.sh (fixture copy from app-nextcloud).
 * No root required: stubs chown / entrypoint on PATH; uses a temp IDEA_FILES_ROOT.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../fixtures/idea-files/idea-files-entrypoint.sh');

function runWrapper(env, args = []) {
  return spawnSync('sh', [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

describe('idea-files-entrypoint.sh', () => {
  let root;
  let bin;
  let chownLog;
  let entryLog;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'idea-files-wrap-'));
    bin = join(root, 'bin');
    mkdirSync(bin);
    chownLog = join(root, 'chown.log');
    entryLog = join(root, 'entrypoint.log');
    writeFileSync(chownLog, '');
    writeFileSync(entryLog, '');

    // Stub chown: record args, never touch real ownership
    writeFileSync(join(bin, 'chown'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${chownLog}"\n`);
    chmodSync(join(bin, 'chown'), 0o755);

    // Stub entrypoint: record args and exit 0
    writeFileSync(join(bin, 'fake-entrypoint'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${entryLog}"\nexit 0\n`);
    chmodSync(join(bin, 'fake-entrypoint'), 0o755);

    // Stub stat: reads a sidecar file <path>.uid written by the test
    writeFileSync(join(bin, 'stat'), `#!/bin/sh
# Support: stat -c '%u' path   OR   stat -f '%u' path
path=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -c|-f) shift; shift ;;
    *) path="\$1"; shift ;;
  esac
done
if [ -f "\$path.uid" ]; then cat "\$path.uid"; else echo 0; fi
`);
    chmodSync(join(bin, 'stat'), 0o755);
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function resetLogs() {
    writeFileSync(chownLog, '');
    writeFileSync(entryLog, '');
  }

  function baseEnv(filesRoot) {
    return {
      PATH: `${bin}:${process.env.PATH}`,
      IDEA_FILES_ROOT: filesRoot,
      WWW_DATA_UID: '33',
      IDEA_ENTRYPOINT: join(bin, 'fake-entrypoint'),
    };
  }

  it('skips when IDEA_FILES_ROOT is absent and still execs entrypoint', () => {
    resetLogs();
    const missing = join(root, 'no-such-files');
    const r = runWrapper(baseEnv(missing), ['apache2-foreground']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(chownLog, 'utf8'), '');
    assert.match(readFileSync(entryLog, 'utf8'), /apache2-foreground/);
  });

  it('chowns only top-level dirs whose uid ≠ 33 (non-recursive)', () => {
    resetLogs();
    const files = join(root, 'files-a');
    mkdirSync(files);
    const wrong = join(files, 'school-files-3f9a2c');
    const right = join(files, 'other-files-aabbcc');
    const nested = join(wrong, 'nested');
    mkdirSync(wrong);
    mkdirSync(right);
    mkdirSync(nested);
    writeFileSync(`${wrong}.uid`, '1000');
    writeFileSync(`${right}.uid`, '33');
    writeFileSync(`${nested}.uid`, '1000'); // must NOT be chowned (not top-level)
    writeFileSync(join(files, '.idea-files.json'), '{"school-files-3f9a2c":"School Files"}');

    const r = runWrapper(baseEnv(files), ['--test']);
    assert.equal(r.status, 0, r.stderr);
    const log = readFileSync(chownLog, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(log.length, 1, `expected one chown, got: ${log.join(' | ')}`);
    assert.match(log[0], /^33:33 /);
    assert.ok(log[0].endsWith(wrong));
    assert.ok(!log[0].includes('nested'));
    assert.match(readFileSync(entryLog, 'utf8'), /--test/);
  });

  it('skips files at the top level (e.g. .idea-files.json)', () => {
    resetLogs();
    const files = join(root, 'files-b');
    mkdirSync(files);
    writeFileSync(join(files, '.idea-files.json'), '{}');
    writeFileSync(join(files, 'notafile'), 'x'); // plain file without leading dot
    const r = runWrapper(baseEnv(files), []);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(chownLog, 'utf8'), '');
  });

  it('never chowns outside IDEA_FILES_ROOT', () => {
    resetLogs();
    const files = join(root, 'files-c');
    const outside = join(root, 'outside-dir');
    mkdirSync(files);
    mkdirSync(outside);
    writeFileSync(`${outside}.uid`, '1000');
    const r = runWrapper(baseEnv(files), []);
    assert.equal(r.status, 0, r.stderr);
    const log = readFileSync(chownLog, 'utf8');
    assert.ok(!log.includes(outside));
  });
});
