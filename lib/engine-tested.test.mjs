// Unit tests for engine-tested.mjs — run with: node --test lib/
// No Engine, Docker or npm dependencies required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { setEngineTested, recordEngineTested } from './engine-tested.mjs';

const INFO = { commit: 'abc1234', version: '1.0', date: '2026-09-25' };
const APP_YAML = `app: kolibri
idea_app_version: "1.0"

compatibility:
  engine_min: "0.9.0"       # minimum Engine version this App Disk requires
  engine_tested: "unknown"  # to be updated on first test harness run

services:
  - name: kolibri
    build: custom
`;

test('replaces "unknown" and preserves everything else', () => {
  const out = setEngineTested(APP_YAML, INFO);
  assert.equal(out, `app: kolibri
idea_app_version: "1.0"

compatibility:
  engine_min: "0.9.0"       # minimum Engine version this App Disk requires
  engine_tested:
    commit: "abc1234"
    version: "1.0"
    date: "2026-09-25"

services:
  - name: kolibri
    build: custom
`);
});

test('re-recording replaces the previous mapping (idempotent shape)', () => {
  const once = setEngineTested(APP_YAML, INFO);
  const twice = setEngineTested(once, { ...INFO, commit: 'def5678' });
  assert.equal(twice, once.replace('abc1234', 'def5678'));
});

test('adds engine_tested when missing and compatibility when missing', () => {
  assert.match(setEngineTested('app: x\ncompatibility:\n  engine_min: "0.9.0"\n', INFO),
    /compatibility:\n  engine_min: "0.9.0"\n  engine_tested:\n    commit: "abc1234"\n/);
  assert.match(setEngineTested('app: x\n', INFO), /\ncompatibility:\n  engine_tested:\n/);
});

test('recordEngineTested writes Engine commit + package.json version', () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-tested-'));
  try {
    const eng = join(root, 'engine'); const app = join(root, 'app');
    execFileSync('mkdir', ['-p', eng, app]);
    writeFileSync(join(eng, 'package.json'), '{"version":"1.0"}');
    const git = (...a) => execFileSync('git', ['-C', eng, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
    git('init', '-q'); git('add', '.'); git('commit', '-qm', 'x');
    const sha = git('rev-parse', '--short', 'HEAD').trim();
    writeFileSync(join(app, 'app.yaml'), APP_YAML);
    const info = recordEngineTested({ appDir: app, engineCwd: eng, now: new Date(2026, 8, 25), log: () => {} });
    assert.deepEqual(info, { commit: sha, version: '1.0', date: '2026-09-25' });
    assert.match(readFileSync(join(app, 'app.yaml'), 'utf8'), new RegExp(`commit: "${sha}"`));
    assert.equal(recordEngineTested({ appDir: root, engineCwd: eng, log: () => {} }), null); // no app.yaml → no-op
  } finally { rmSync(root, { recursive: true, force: true }); }
});
