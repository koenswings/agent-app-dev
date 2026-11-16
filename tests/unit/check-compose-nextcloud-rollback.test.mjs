// check-compose E3: a Nextcloud App must not exclude config/ or custom_apps/ (or a path inside or
// above them) from x-app.backup.exclude or x-app.snapshotExclude. An updateApp rollback restores the
// instance folder from the .pre-update snapshot with rsync --delete and leaves only excluded paths
// alone (agent-engine-dev fac5b1a UpdateApp.ts rollBack, idea-app-data restore-snapshot).
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { YAML } from 'zx';
import { checkNextcloudRollbackPaths, isNextcloudApp, nextcloudProtectedPaths } from '../../lib/check-compose.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK = join(ROOT, 'script/check-compose.mjs');
const D = 'a'.repeat(64);
const V = '1.8-31.0.14';
const NC_SVC = `  nextcloud-app:\n    image: nextcloud:31.0.14-apache@sha256:${D}\n    labels:\n      x-app-version: "${V}"\n    volumes:\n      - ./data/nextcloud:/var/www/html\n`
  + `  nextcloud-db:\n    image: koenswings/nextcloud-mariadb:1.0-11.7.2@sha256:${D}\n    labels:\n      x-app-version: "${V}"\n    volumes:\n      - ./data/db:/var/lib/mysql\n`;
const nc = ({ name = 'nextcloud', xapp = '', services = NC_SVC } = {}) => `x-app:\n  name: ${name}\n  version: "${V}"\n${xapp}services:\n${services}`;
const chk = (text) => checkNextcloudRollbackPaths(YAML.parse(text));
const ex = (list) => `  backup:\n    exclude: ${JSON.stringify(list)}\n`;
const snap = (list) => `  snapshotExclude: ${JSON.stringify(list)}\n`;
const file = (text) => { const f = join(mkdtempSync(join(tmpdir(), 'ccnc-')), 'compose.yaml'); writeFileSync(f, text); return f; };
const E3 = ': a Nextcloud App must not exclude config/ or custom_apps/ from the backup or the pre-update snapshot, since an updateApp rollback (restore-snapshot, rsync --delete) would then keep the newer config.php or custom_apps/.idea-update-state/ (E3)';

it('Nextcloud detection: x-app.name or an image whose repo is nextcloud; nextcloud-code/mariadb do not count', () => {
  assert.equal(isNextcloudApp(YAML.parse(nc())), true);
  assert.equal(isNextcloudApp(YAML.parse(nc({ name: 'files' }))), true, 'by image');
  const other = `  app:\n    image: koenswings/nextcloud-code:1.0@sha256:${D}\n  db:\n    image: koenswings/nextcloud-mariadb:1.0@sha256:${D}\n`;
  assert.equal(isNextcloudApp(YAML.parse(nc({ name: 'office', services: other }))), false);
  assert.equal(isNextcloudApp(YAML.parse(nc({ name: 'x', services: `  a:\n    image: ghcr.io/koenswings/nextcloud:1.0-31@sha256:${D}\n` }))), true);
  assert.equal(isNextcloudApp(YAML.parse(nc({ name: 'Nextcloud', services: `  a:\n    image: busybox\n` }))), true);
});

it('protected folders come from the /var/www/html bind, plus the app-nextcloud default', () => {
  assert.deepEqual(nextcloudProtectedPaths(YAML.parse(nc())), ['data/nextcloud/config', 'data/nextcloud/custom_apps']);
  const moved = `  web:\n    image: nextcloud:31@sha256:${D}\n    volumes:\n      - ./data/html/:/var/www/html/:rw\n      - type: bind\n        source: ./data/cfg\n        target: /var/www/html/config\n      - ncdata:/var/www/html/data\n`;
  assert.deepEqual(nextcloudProtectedPaths(YAML.parse(nc({ services: moved }))),
    ['data/nextcloud/config', 'data/nextcloud/custom_apps', 'data/html/config', 'data/html/custom_apps', 'data/cfg']);
});

it('fails on the exact folder, for each key and each folder', () => {
  for (const [k, x] of [['x-app.backup.exclude', ex], ['x-app.snapshotExclude', snap]]) {
    for (const d of ['config', 'custom_apps']) {
      assert.deepEqual(chk(nc({ xapp: x([`data/nextcloud/${d}`]) })), [`${k} entry 'data/nextcloud/${d}' is data/nextcloud/${d}${E3}`], `${k} ${d}`);
    }
  }
});

it('fails on a path inside, and on every ancestor (data/nextcloud, data, a bare nextcloud, .)', () => {
  assert.deepEqual(chk(nc({ xapp: snap(['data/nextcloud/custom_apps/.idea-update-state']) })),
    [`x-app.snapshotExclude entry 'data/nextcloud/custom_apps/.idea-update-state' (data/nextcloud/custom_apps/.idea-update-state) is inside data/nextcloud/custom_apps${E3}`]);
  assert.deepEqual(chk(nc({ xapp: ex(['data/nextcloud/config/config.php']) })),
    [`x-app.backup.exclude entry 'data/nextcloud/config/config.php' (data/nextcloud/config/config.php) is inside data/nextcloud/config${E3}`]);
  assert.deepEqual(chk(nc({ xapp: snap(['data/nextcloud']) })), [`x-app.snapshotExclude entry 'data/nextcloud' (data/nextcloud) contains data/nextcloud/config${E3}`]);
  assert.deepEqual(chk(nc({ xapp: snap(['data']) })), [`x-app.snapshotExclude entry 'data' (data) contains data/nextcloud/config${E3}`]);
  // The Engine reads a bare name as data/<name> (backupExclude.ts): 'nextcloud' is data/nextcloud.
  assert.deepEqual(chk(nc({ xapp: ex(['nextcloud']) })), [`x-app.backup.exclude entry 'nextcloud' (data/nextcloud) contains data/nextcloud/config${E3}`]);
  for (const root of ['.', './', '../x']) assert.equal(chk(nc({ xapp: ex([root]) })).length, 1, root);
  assert.equal(chk(nc({ xapp: ex(['data/x/../nextcloud']) })).length, 1, 'lexical ..');
});

it('normalises a trailing slash, a leading ./ and surrounding spaces', () => {
  for (const p of ['data/nextcloud/config/', './data/nextcloud/config', '././data/nextcloud/config//', '  data/nextcloud/config  ', 'data//nextcloud/config']) {
    const errs = chk(nc({ xapp: snap([p]) }));
    assert.equal(errs.length, 1, p); assert.ok(errs[0].startsWith(`x-app.snapshotExclude entry '${p}' `), errs[0]);
  }
});

it('a glob that could match a folder, a path inside it or an ancestor fails', () => {
  assert.deepEqual(chk(nc({ xapp: snap(['data/nextcloud/conf*']) })), [`x-app.snapshotExclude entry 'data/nextcloud/conf*' could match data/nextcloud/config${E3}`]);
  assert.deepEqual(chk(nc({ xapp: ex(['data/*/custom_apps/*']) })), [`x-app.backup.exclude entry 'data/*/custom_apps/*' could match a path inside data/nextcloud/custom_apps${E3}`]);
  assert.deepEqual(chk(nc({ xapp: ex(['data/next?loud']) })), [`x-app.backup.exclude entry 'data/next?loud' could match an ancestor of data/nextcloud/config${E3}`]);
  for (const g of ['*', 'data/*', 'data/**', '**/config', 'data/nextcloud/[cx]onfig', 'data/nextcloud/custom_[!x]pps', 'next*', 'data/[nope']) {
    assert.equal(chk(nc({ xapp: snap([g]) })).length, 1, g);
  }
});

it('passes: unrelated excludes, empty lists, missing keys, and non-Nextcloud Apps', () => {
  for (const x of ['', ex([]), snap([]), `  backup:\n    method: hook\n`, ex(['data/db', 'data/backup/db', 'keys', 'data/nextcloud/data/appdata_x/preview', 'data/nextcloud/data/*/preview', 'data/nextcloud/configs', 'data/nextcloud/config.bak'])
    + snap(['data/nextcloud/data/appdata_oc1/preview', 'data/nextcloud/custom_apps_old', 'data/nextcloud/[ab]*'])]) {
    assert.deepEqual(chk(nc({ xapp: x })), [], x);
  }
  // A non-Nextcloud App may exclude the same paths (e.g. a dashboard with its own data/nextcloud dir).
  const other = `  app:\n    image: koenswings/usage-dashboard:1.0@sha256:${D}\n    labels:\n      x-app-version: "${V}"\n    volumes:\n      - ./data/nextcloud:/var/www/html\n`;
  assert.deepEqual(chk(nc({ name: 'usage-dashboard', services: other, xapp: ex(['data/nextcloud/config', 'data']) + snap(['data/nextcloud/custom_apps']) })), []);
  // Shape problems are left to checkComposeBackup / the Engine, not reported twice here.
  assert.deepEqual(chk(nc({ xapp: `  backup:\n    exclude: data\n  snapshotExclude: 5\n` })), []);
});

it('the app-nextcloud hop fixtures pass', () => {
  const dir = join(ROOT, 'tests/fixtures/xapp-update');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.compose.yaml'))) {
    assert.deepEqual(checkNextcloudRollbackPaths(YAML.parse(readFileSync(join(dir, f), 'utf8'))), [], f);
  }
});

it('CLI applies the rule with and without --release', () => {
  const bad = file(nc({ xapp: snap(['data/nextcloud/custom_apps/']) }));
  for (const args of [[bad], ['--release', bad]]) {
    const r = spawnSync('node', [CHECK, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1); assert.match(r.stderr, /x-app.snapshotExclude entry 'data\/nextcloud\/custom_apps\/' is data\/nextcloud\/custom_apps: .*\(E3\)/);
  }
  const ok = file(nc({ xapp: snap([]) }));
  const r = spawnSync('node', [CHECK, '--tag', V, ok], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
