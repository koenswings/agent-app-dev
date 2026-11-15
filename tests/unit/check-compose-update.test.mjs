// check-compose x-app.update structure (gap 12, Axle addendum 2026-11-15):
// optional prepare/verify/work/settle stages; required timeout (interval+timeout on settle);
// service must exist in compose; command is one absolute path; user if present is a uid or
// username (same shape as x-app.backup hook steps). Applied with and without --release.
// Unknown x-app keys stay allowed. Fixtures: tests/fixtures/xapp-update/.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { YAML } from 'zx';
import { checkComposeUpdate } from '../../lib/check-compose.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK = join(ROOT, 'script/check-compose.mjs');
const CHECK_FIELDS = join(ROOT, 'script/check-xapp-update-fields.mjs');
const FIX = join(ROOT, 'tests/fixtures/xapp-update');
const D = 'a'.repeat(64);
const svc = (n) => `  ${n}:\n    image: koenswings/x:1.0@sha256:${D}\n    labels:\n      x-app-version: "2.0-32.0.15"\n`;
const compose = (update) => `x-app:\n  name: demo\n  version: "2.0-32.0.15"\n${update}services:\n${svc('nextcloud-app')}${svc('nextcloud-db')}`;
const chk = (update) => checkComposeUpdate(YAML.parse(compose(update)));
const file = (text) => { const f = join(mkdtempSync(join(tmpdir(), 'ccu-')), 'compose.yaml'); writeFileSync(f, text); return f; };
const cli = (...a) => spawnSync('node', [CHECK, ...a], { encoding: 'utf8' });

const ALIGNED = `  update:
    prepare:
      service: nextcloud-app
      user: "0"
      command: /idea/hooks/prep-custom-apps-for-upgrade.sh
      timeout: 600
    verify:
      service: nextcloud-app
      user: "33"
      command: /idea/hooks/verify-update.sh
      timeout: 120
    work:
      service: nextcloud-app
      user: "33"
      command: /idea/hooks/work-update.sh
      timeout: 3600
    settle:
      service: nextcloud-app
      user: "33"
      command: /idea/hooks/settle-update.sh
      interval: 60
      timeout: 3600
`;

it('no update block, an empty update mapping, and a single optional stage are valid', () => {
  assert.deepEqual(chk(''), []);
  assert.deepEqual(chk('  update: {}\n'), []);
  assert.deepEqual(chk('  update:\n    prepare:\n      service: nextcloud-app\n      command: /idea/hooks/prep-custom-apps-for-upgrade.sh\n      timeout: 600\n'), []);
  assert.deepEqual(chk('  update:\n    settle:\n      service: nextcloud-app\n      command: /idea/hooks/settle-update.sh\n      interval: 60\n      timeout: 3600\n'), []);
});

it('the aligned Nextcloud four-stage block is valid, including numeric or named users', () => {
  assert.deepEqual(chk(ALIGNED), []);
  const numeric = ALIGNED.replace('user: "0"', 'user: 0').replaceAll('user: "33"', 'user: 33');
  assert.deepEqual(chk(numeric), []);
  const named = ALIGNED.replace('user: "0"', 'user: root').replaceAll('user: "33"', 'user: www-data');
  assert.deepEqual(chk(named), []);
});

it('unknown x-app keys stay allowed, with or without an update block', () => {
  const extra = (update) => YAML.parse(`x-app:\n  name: demo\n  version: "2.0-32.0.15"\n  customNote: allowed\n  futureFlag: true\n${update}services:\n${svc('nextcloud-app')}`);
  assert.deepEqual(checkComposeUpdate(extra('')), []);
  assert.deepEqual(checkComposeUpdate(extra(ALIGNED)), []);
});

it('aligned app-nextcloud hop composes and current App mains (no update block) pass check-compose', () => {
  const files = {
    'nextcloud-2.0-32.0.15.compose.yaml': '2.0-32.0.15',
    'nextcloud-3.0-33.0.11.compose.yaml': '3.0-33.0.11',
    'nextcloud-4.0-34.0.6.compose.yaml': '4.0-34.0.6',
    'nextcloud-main.compose.yaml': '1.7-31.0.1',
    'kolibri-main.compose.yaml': '1.3-0.19.5',
    'kiwix-main.compose.yaml': '1.3-3.8.2',
  };
  for (const [name, tag] of Object.entries(files)) {
    const f = join(FIX, name);
    const r = cli('--tag', tag, f);
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    assert.match(r.stdout, /^ok   /, name);
    const fields = spawnSync('node', [CHECK_FIELDS, f], { encoding: 'utf8' });
    assert.equal(fields.status, 0, `${name} check-xapp-update-fields: ${fields.stderr}`);
  }
});

it('unknown update keys are refused; only prepare, verify, work and settle are stages', () => {
  assert.deepEqual(chk('  update:\n    prepre:\n      service: nextcloud-app\n      command: /x\n      timeout: 1\n'), ["x-app.update has unknown key 'prepre'"]);
});

it('prepare, verify and work each need a timeout (positive integer seconds)', () => {
  for (const name of ['prepare', 'verify', 'work']) {
    const missing = chk(`  update:\n    ${name}:\n      service: nextcloud-app\n      command: /idea/hooks/${name}.sh\n`);
    assert.deepEqual(missing, [`x-app.update.${name}.timeout is required`], name);
    for (const t of ['0', '-5', '1.5', 'soon']) {
      const bad = chk(`  update:\n    ${name}:\n      service: nextcloud-app\n      command: /idea/hooks/${name}.sh\n      timeout: ${t}\n`);
      assert.deepEqual(bad, [`x-app.update.${name}.timeout must be a positive integer number of seconds`], `${name} ${t}`);
    }
  }
});

it('settle needs both interval and timeout (positive integer seconds)', () => {
  const base = '  update:\n    settle:\n      service: nextcloud-app\n      command: /idea/hooks/settle-update.sh\n';
  assert.deepEqual(chk(base), ['x-app.update.settle.timeout is required', 'x-app.update.settle.interval is required']);
  assert.deepEqual(chk(`${base}      timeout: 3600\n`), ['x-app.update.settle.interval is required']);
  assert.deepEqual(chk(`${base}      interval: 60\n`), ['x-app.update.settle.timeout is required']);
  assert.deepEqual(chk(`${base}      interval: 0\n      timeout: soon\n`), [
    'x-app.update.settle.timeout must be a positive integer number of seconds',
    'x-app.update.settle.interval must be a positive integer number of seconds',
  ]);
  assert.deepEqual(chk(`${base}      interval: 60\n      timeout: 3600\n`), []);
});

it('every stage service must exist in compose; the bad stage is named', () => {
  const b = '  update:\n    prepare:\n      service: nextcloud\n      command: /idea/hooks/prep-custom-apps-for-upgrade.sh\n      timeout: 600\n'
    + '    settle:\n      service: cache\n      command: /idea/hooks/settle-update.sh\n      interval: 60\n      timeout: 3600\n';
  assert.deepEqual(chk(b), [
    "x-app.update.prepare.service 'nextcloud' is not a service in this compose",
    "x-app.update.settle.service 'cache' is not a service in this compose",
  ]);
});

it('every command must be an absolute path (one string, not a list or a shell line)', () => {
  const stage = (command) => chk(`  update:\n    prepare:\n      service: nextcloud-app\n      command: ${command}\n      timeout: 600\n`);
  assert.deepEqual(stage('hooks/prep.sh'), ["x-app.update.prepare.command 'hooks/prep.sh' must be an absolute path"]);
  assert.deepEqual(stage('""'), ['x-app.update.prepare.command must be an absolute path']);
  assert.deepEqual(stage('[/idea/hooks/prep.sh]'), ['x-app.update.prepare.command must be an absolute path']);
  assert.deepEqual(stage('"/idea/hooks/prep.sh --flag"'), ["x-app.update.prepare.command '/idea/hooks/prep.sh --flag' must be an absolute path"]);
  assert.deepEqual(chk('  update:\n    prepare:\n      service: nextcloud-app\n      timeout: 600\n'), ['x-app.update.prepare.command must be an absolute path']);
});

it('user, if present, must be a uid or username (string or integer, same shape as backup)', () => {
  const withUser = (u) => chk(`  update:\n    prepare:\n      service: nextcloud-app\n      command: /idea/hooks/prep.sh\n      timeout: 600\n      user: ${u}\n`);
  assert.deepEqual(withUser('"-u0"'), ["x-app.update.prepare.user '-u0' is not a uid or username"]);
  assert.deepEqual(withUser('true'), ["x-app.update.prepare.user 'true' is not a uid or username"]);
  assert.deepEqual(withUser('[33]'), ["x-app.update.prepare.user '33' is not a uid or username"]);
  assert.deepEqual(withUser('"0"'), []);
  assert.deepEqual(withUser('"33"'), []);
  assert.deepEqual(withUser('www-data'), []);
});

it('a stage must be a mapping; interval on prepare and other unknown stage keys are refused', () => {
  assert.deepEqual(chk('  update:\n    prepare: /idea/hooks/prep.sh\n'), ['x-app.update.prepare must be a mapping {service, command, timeout, user?}']);
  assert.deepEqual(chk('  update:\n    settle: []\n'), ['x-app.update.settle must be a mapping {service, command, interval, timeout, user?}']);
  const extra = chk('  update:\n    prepare:\n      service: nextcloud-app\n      command: /idea/hooks/prep.sh\n      timeout: 600\n      interval: 60\n      shell: true\n');
  assert.deepEqual(extra, [
    "x-app.update.prepare has unknown key 'interval'",
    "x-app.update.prepare has unknown key 'shell'",
  ]);
  assert.deepEqual(chk('  update: []\n'), ['x-app.update must be a mapping']);
});

it('CLI applies the update checks with and without --release', () => {
  const bad = file(compose('  update:\n    prepare:\n      service: nextcloud\n      command: hooks/prep.sh\n      timeout: 0\n'));
  const want = [
    "x-app.update.prepare.service 'nextcloud' is not a service in this compose",
    "x-app.update.prepare.command 'hooks/prep.sh' must be an absolute path",
    'x-app.update.prepare.timeout must be a positive integer number of seconds',
  ];
  for (const args of [[bad], ['--release', bad]]) {
    const r = cli(...args);
    assert.equal(r.status, 1);
    for (const line of want) assert.match(r.stderr, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const ok = file(compose(ALIGNED));
  const r = cli('--release', '--tag', '2.0-32.0.15', ok);
  assert.equal(r.status, 0, r.stderr);
});
