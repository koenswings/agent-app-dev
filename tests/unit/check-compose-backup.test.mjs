// check-compose x-app.backup structure (idea#403), matching the Engine parser of agent-engine-dev#404:
// method stop|hook|none, pre/postHook as one mapping or an ordered list, step services in compose,
// path lists without globs. Applied with and without --release.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { YAML } from 'zx';
import { checkComposeBackup, checkComposeRelease } from '../../lib/check-compose.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK = join(ROOT, 'script/check-compose.mjs');
const D = 'a'.repeat(64);
const svc = (n) => `  ${n}:\n    image: koenswings/x:1.0@sha256:${D}\n    labels:\n      x-app-version: "1.6-31.0.1"\n`;
const compose = (backup) => `x-app:\n  name: demo\n  version: "1.6-31.0.1"\n${backup}services:\n${svc('app')}${svc('db')}`;
const chk = (backup) => checkComposeBackup(YAML.parse(compose(backup)));
const file = (text) => { const f = join(mkdtempSync(join(tmpdir(), 'ccb-')), 'compose.yaml'); writeFileSync(f, text); return f; };
const VERIFY = '    verify:\n      present: [.env]\n      absent: [keys]\n';

it('no backup block, method stop, and the existing single-mapping hook form are valid', () => {
  assert.deepEqual(chk(''), []);
  assert.deepEqual(chk('  backup:\n    method: stop\n    exclude: [keys]\n'), []);
  assert.deepEqual(chk('  backup:\n    exclude: [keys, data/backup/daily]\n'), []);
  const single = '  backup:\n    method: hook\n    fallback: stop\n    hookTimeout: 300\n'
    + '    preHook:\n      service: app\n      command: /app/scripts/backup-snapshot.sh\n'
    + '    postHook:\n      service: app\n      command: /app/scripts/backup-cleanup.sh\n'
    + '    exclude: [keys]\n    hookExclude: [usage.sqlite, usage.sqlite-wal]\n' + VERIFY;
  assert.deepEqual(chk(single), []);
});

it('ordered hook lists are valid, with argv lists and numeric or named users', () => {
  const lists = '  backup:\n    method: hook\n    preHook:\n'
    + '      - service: app\n        user: 33\n        command: [php, /var/www/html/occ, maintenance:mode, --on]\n'
    + '      - service: db\n        command: /idea/backup/db-dump.sh\n'
    + '    postHook:\n      - service: app\n        user: www-data\n        command: [php, occ, maintenance:mode, --off]\n'
    + '      - service: db\n        command: [/idea/backup/db-dump-remove.sh]\n'
    + '    hookExclude: [data/db]\n' + VERIFY;
  assert.deepEqual(chk(lists), []);
});

it('method none is valid (Kiwix), with no hooks', () => {
  assert.deepEqual(chk('  backup:\n    method: none\n'), []);
});

it('every step service must exist in compose; the bad step is named', () => {
  const b = '  backup:\n    method: hook\n    preHook:\n      - service: app\n        command: /a\n      - service: nextcloud-db\n        command: /b\n'
    + '    postHook:\n      service: cache\n      command: /c\n';
  assert.deepEqual(chk(b), [
    "x-app.backup.preHook[1].service 'nextcloud-db' is not a service in this compose",
    "x-app.backup.postHook.service 'cache' is not a service in this compose",
  ]);
});

it('bad steps: empty list, missing command, empty argv, option-like service, bad user, unknown key', () => {
  assert.deepEqual(chk('  backup:\n    method: hook\n    preHook: []\n'), ['x-app.backup.preHook is an empty list']);
  const errs = chk('  backup:\n    method: hook\n    preHook:\n      - service: app\n      - service: -app\n        command: []\n'
    + '      - service: app\n        command: /x\n        user: "-u0"\n      - service: app\n        command: /x\n        shell: true\n');
  assert.deepEqual(errs, [
    'x-app.backup.preHook[0].command must be a string or a list of strings',
    "x-app.backup.preHook[1].service '-app' is not a compose service name",
    'x-app.backup.preHook[1].command must be a non-empty list of non-empty strings',
    "x-app.backup.preHook[2].user '-u0' is not a uid or username",
    "x-app.backup.preHook[3] has unknown key 'shell'",
  ]);
});

it('method hook needs a preHook; unknown/live methods and bad fallback/hookTimeout are refused', () => {
  assert.deepEqual(chk('  backup:\n    method: hook\n'), ["x-app.backup.method is 'hook' but preHook is missing"]);
  assert.deepEqual(chk('  backup:\n    method: live\n'), ["x-app.backup.method 'live' is not implemented by the Engine (use stop, hook or none)"]);
  assert.deepEqual(chk('  backup:\n    method: snapshot\n'), ["x-app.backup.method 'snapshot' is not allowed (use stop, hook or none)"]);
  const p = '    preHook:\n      service: app\n      command: /x\n';
  assert.deepEqual(chk(`  backup:\n    method: hook\n    fallback: skip\n${p}`), ["x-app.backup.fallback 'skip' is not allowed (use stop or fail)"]);
  for (const t of ['0', '-5', '1.5', '86401', 'soon']) {
    assert.deepEqual(chk(`  backup:\n    method: hook\n    hookTimeout: ${t}\n${p}`), ['x-app.backup.hookTimeout must be a positive integer number of seconds (max 86400)'], t);
  }
});

it('preHook, postHook and hookExclude are refused with method stop or none', () => {
  for (const m of ['stop', 'none']) {
    const errs = chk(`  backup:\n    method: ${m}\n    preHook:\n      service: app\n      command: /x\n    postHook:\n      service: app\n      command: /y\n    hookExclude: [data/db]\n`);
    assert.deepEqual(errs, ['preHook', 'postHook', 'hookExclude'].map((k) => `x-app.backup.${k} is only used with method hook (method is ${m})`), m);
  }
  assert.deepEqual(chk('  backup:\n    hookExclude: [data/db]\n'), ['x-app.backup.hookExclude is only used with method hook (method is stop)'], 'default method is stop');
});

it('path lists: globs, absolute paths, .. and option-like entries are refused', () => {
  const errs = chk('  backup:\n    exclude: ["data/*.log", /etc/passwd, ../x, -rf, data/./x]\n    verify:\n      present: [ok/path]\n      absent: [db?]\n');
  assert.deepEqual(errs, [
    "x-app.backup.exclude entry 'data/*.log' is a glob (globs are not allowed)",
    "x-app.backup.exclude entry '/etc/passwd' is absolute",
    "x-app.backup.exclude entry '../x' has a '.' or '..' component",
    "x-app.backup.exclude entry '-rf' looks like an option",
    "x-app.backup.exclude entry 'data/./x' has a '.' or '..' component",
    "x-app.backup.verify.absent entry 'db?' is a glob (globs are not allowed)",
  ]);
  assert.deepEqual(chk('  backup:\n    exclude: keys\n'), ['x-app.backup.exclude must be a list of paths']);
});

it('--release still requires verify for hook, for the list form too; none and stop need none', () => {
  const lists = '  backup:\n    method: hook\n    preHook:\n      - service: app\n        command: /a\n';
  const t = compose(lists);
  assert.deepEqual(checkComposeRelease(YAML.parse(t), t), ['release: x-app.backup.verify (present/absent, idea#446) is required when method is hook']);
  for (const m of ['none', 'stop']) { const n = compose(`  backup:\n    method: ${m}\n`); assert.deepEqual(checkComposeRelease(YAML.parse(n), n), []); }
});

it('CLI applies the backup checks with and without --release', () => {
  const bad = file(compose('  backup:\n    method: none\n    hookExclude: [data/db]\n'));
  for (const args of [[bad], ['--release', bad]]) {
    const r = spawnSync('node', [CHECK, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1); assert.match(r.stderr, /x-app.backup.hookExclude is only used with method hook \(method is none\)/);
  }
  const ok = file(compose('  backup:\n    method: none\n'));
  const r = spawnSync('node', [CHECK, '--release', '--tag', '1.6-31.0.1', ok], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
