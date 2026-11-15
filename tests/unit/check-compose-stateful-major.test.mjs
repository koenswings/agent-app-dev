// check-compose --base / --base-ref (idea#403, Steve's rule): a stateful service image that moves to a
// new series (MariaDB/MySQL/Mongo X.Y, Postgres/Redis X) needs an App major bump, because the Engine
// only requires a Backup Disk backup before an App major update (UpdateAppPolicy backupIsDue).
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { YAML } from 'zx';
import { checkStatefulMajor, imageSeries, statefulKind } from '../../lib/check-compose.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK = join(ROOT, 'script/check-compose.mjs');
const D = 'a'.repeat(64);
const compose = (version, db, extra = '') => `x-app:\n  name: demo\n  version: "${version}"\nservices:\n  app:\n    image: koenswings/nextcloud:1.0-31.0.1@sha256:${D}\n    labels:\n      x-app-version: "${version}"\n  db:\n    image: ${db}\n${extra}    labels:\n      x-app-version: "${version}"\n`;
const chk = (a, b) => checkStatefulMajor(YAML.parse(a), YAML.parse(b));
const NCDB = (v) => `koenswings/nextcloud-mariadb:1.0-${v}-MariaDB-ubu2404@sha256:${D}`;

it('reads the upstream series: X.Y for MariaDB/MySQL/Mongo, X for Postgres/Redis, IDEA retags unwrapped', () => {
  assert.equal(imageSeries(NCDB('11.7.2'), 2), '11.7');
  assert.equal(imageSeries('mariadb:10.11', 2), '10.11');
  assert.equal(imageSeries('mysql:8.0.39-debian', 2), '8.0');
  assert.equal(imageSeries('postgres:16-alpine', 1), '16');
  assert.equal(imageSeries('postgis/postgis:16-3.4', 1), '16');
  assert.equal(imageSeries('redis:7.2.5', 1), '7');
  assert.equal(imageSeries('mariadb:lts', 2), null);
  assert.equal(imageSeries('mariadb:11', 2), null);
  assert.equal(imageSeries('localhost:5000/mariadb:11.4@sha256:' + D, 2), '11.4');
});

it('which images count as stateful (Redis only with a volume)', () => {
  assert.equal(statefulKind({ image: NCDB('11.7.2') }).kind, 'mysql');
  assert.equal(statefulKind({ image: 'mongo:7.0' }).kind, 'mongo');
  assert.equal(statefulKind({ image: 'postgres:16' }).kind, 'postgres');
  assert.equal(statefulKind({ image: 'redis:7' }), null);
  assert.equal(statefulKind({ image: 'redis:7', volumes: ['./data/redis:/data'] }).kind, 'redis');
  assert.equal(statefulKind({ image: 'koenswings/nextcloud:1.0-31.0.1' }), null);
  assert.equal(statefulKind({ image: 'koenswings/mongoose-app:1.0' }), null);
});

it('a MariaDB series bump inside an App minor fails; with an App major it passes', () => {
  const base = compose('1.6-31.0.1', NCDB('11.7.2'));
  const errs = chk(base, compose('1.7-31.0.1', NCDB('11.8.2')));
  assert.equal(errs.length, 1); assert.match(errs[0], /service db: .*mysql 11\.7 -> 11\.8 without an App major bump/);
  assert.deepEqual(chk(base, compose('2.0-31.0.1', NCDB('11.8.2'))), []);
});

it('a patch bump, an unchanged image and non-stateful changes pass', () => {
  const base = compose('1.6-31.0.1', NCDB('11.7.2'));
  assert.deepEqual(chk(base, compose('1.7-31.0.1', NCDB('11.7.3'))), []);
  assert.deepEqual(chk(base, base), []);
  assert.deepEqual(chk(compose('1.0', 'koenswings/web:1.0'), compose('1.1', 'koenswings/web:9.0')), []);
});

it('Postgres and persistent Redis majors need an App major; Redis without a volume does not', () => {
  assert.equal(chk(compose('1.0', 'postgres:15-alpine'), compose('1.1', 'postgres:16-alpine')).length, 1);
  assert.deepEqual(chk(compose('1.0', 'postgres:16.2'), compose('1.1', 'postgres:16.4')), []);
  const vol = '    volumes:\n      - ./data/redis:/data\n';
  assert.equal(chk(compose('1.0', 'redis:6.2', vol), compose('1.1', 'redis:7.2', vol)).length, 1);
  assert.deepEqual(chk(compose('1.0', 'redis:6.2'), compose('1.1', 'redis:7.2')), []);
});

it('a downgrade always fails, an engine swap or an unreadable tag needs an App major', () => {
  assert.match(chk(compose('1.0', 'mariadb:11.4'), compose('2.0', 'mariadb:10.11'))[0], /cannot be downgraded/);
  assert.match(chk(compose('1.0', 'mysql:8.0'), compose('1.1', 'mariadb:11.4'))[0], /changes the database engine/);
  assert.match(chk(compose('1.0', 'koenswings/web:1.0'), compose('1.1', 'postgres:16'))[0], /changes the database engine/);
  assert.deepEqual(chk(compose('1.0', 'mysql:8.0'), compose('2.0', 'mariadb:11.4')), []);
  assert.match(chk(compose('1.0', 'mariadb:11.4'), compose('1.1', 'mariadb:lts'))[0], /cannot read the mysql series/);
  assert.deepEqual(chk(compose('1.0', 'mariadb:11.4'), compose('2.0', 'mariadb:lts')), []);
});

it('new or removed services are not compared', () => {
  const noDb = `x-app:\n  name: demo\n  version: "1.0"\nservices:\n  app:\n    image: koenswings/web:1.0\n`;
  assert.deepEqual(chk(noDb, compose('1.1', 'mariadb:11.4')), []);
  assert.deepEqual(chk(compose('1.0', 'mariadb:11.4'), noDb), []);
});

const cli = (...a) => spawnSync('node', [CHECK, ...a], { encoding: 'utf8' });
const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };

it('CLI --base <file>: exit 1 on a series bump in an App minor, 0 otherwise; no --base keeps the old rules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccs-'));
  const base = join(dir, 'base.yaml'), next = join(dir, 'compose.yaml');
  writeFileSync(base, compose('1.6-31.0.1', NCDB('11.7.2')));
  writeFileSync(next, compose('1.7-31.0.1', NCDB('11.8.2')));
  let r = cli('--base', base, next);
  assert.equal(r.status, 1); assert.match(r.stderr, /FAIL .*mysql 11\.7 -> 11\.8 without an App major bump/);
  assert.equal(cli(next).status, 0);
  writeFileSync(next, compose('2.0-31.0.1', NCDB('11.8.2')));
  r = cli('--base', base, next); assert.equal(r.status, 0, r.stderr);
});

it('CLI --base-ref <ref>: reads the compose at that git ref; a compose new at HEAD is skipped with a note', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccs-git-'));
  git(dir, 'init', '-q', '-b', 'main');
  const f = join(dir, 'compose.yaml');
  writeFileSync(join(dir, 'README'), 'x'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'empty'); git(dir, 'tag', 'v0');
  writeFileSync(f, compose('1.6-31.0.1', NCDB('11.7.2'))); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'a'); git(dir, 'tag', '1.6-31.0.1');
  writeFileSync(f, compose('1.7-31.0.1', NCDB('11.8.2')));
  let r = cli('--base-ref', '1.6-31.0.1', f);
  assert.equal(r.status, 1); assert.match(r.stderr, /without an App major bump/);
  r = cli('--base-ref', 'v0', f);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /no compose\.yaml at v0/);
});
