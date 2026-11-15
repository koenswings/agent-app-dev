// check-compose --base / --base-ref (idea#403, Steve's rule): a stateful service image that moves to a
// new series needs an App major bump, because the Engine only requires a Backup Disk backup before an
// App major update (UpdateAppPolicy backupIsDue). Series: MariaDB/Mongo/Redis/Valkey/KeyDB X.Y,
// MySQL/Percona X.Y but 8.0.Z, Postgres X (X.Y before 10).
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { YAML } from 'zx';
import { checkStatefulMajor, imageSeries, statefulKind, upstreamVersion } from '../../lib/check-compose.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK = join(ROOT, 'script/check-compose.mjs');
const D = 'a'.repeat(64);
const compose = (version, db, extra = '', dbName = 'db') => `x-app:\n  name: demo\n  version: "${version}"\nservices:\n  app:\n    image: koenswings/nextcloud:1.0-31.0.1@sha256:${D}\n    labels:\n      x-app-version: "${version}"\n  ${dbName}:\n    image: ${db}\n${extra}    labels:\n      x-app-version: "${version}"\n`;
const chk = (a, b, opts) => checkStatefulMajor(YAML.parse(a), YAML.parse(b), opts);
const NCDB = (v) => `koenswings/nextcloud-mariadb:1.0-${v}-MariaDB-ubu2404@sha256:${D}`;
const series = (image, svc = {}) => imageSeries(image, statefulKind({ image, volumes: ['./d:/d'], ...svc }));

it('reads the upstream series per engine, IDEA retags unwrapped', () => {
  assert.equal(series(NCDB('11.7.2')), '11.7');
  assert.equal(series('mariadb:10.11'), '10.11');
  assert.equal(series('mongo:7.0.12'), '7.0');
  assert.equal(series('postgres:16-alpine'), '16');
  assert.equal(series('postgis/postgis:16-3.4'), '16');
  assert.equal(series('mariadb:lts'), null);
  assert.equal(series('mariadb:11'), null);
  assert.equal(series('localhost:5000/mariadb:11.4@sha256:' + D), '11.4');
});

it('which images count as stateful (Redis only with a volume)', () => {
  assert.equal(statefulKind({ image: NCDB('11.7.2') }).product, 'mariadb');
  assert.equal(statefulKind({ image: 'mongo:7.0' }).kind, 'mongo');
  assert.equal(statefulKind({ image: 'postgres:16' }).kind, 'postgres');
  assert.equal(statefulKind({ image: 'redis:7' }), null);
  assert.equal(statefulKind({ image: 'redis:7', volumes: ['./data/redis:/data'] }).kind, 'redis');
  assert.equal(statefulKind({ image: 'koenswings/nextcloud:1.0-31.0.1' }), null);
  assert.equal(statefulKind({ image: 'koenswings/mongoose-app:1.0' }), null);
});

it('Axle must-fix 2: ghcr.io/koenswings retags are unwrapped like Docker Hub ones', () => {
  const G = (v) => `ghcr.io/koenswings/app-mariadb:${v}-noble@sha256:${D}`;
  assert.equal(series(G('1.0-11.8.2')), '11.8');
  assert.equal(chk(compose('1.6', G('1.0-11.7.2')), compose('1.7', G('1.0-11.8.2'))).length, 1);   // was a false negative
  assert.deepEqual(chk(compose('1.6', G('1.0-11.7.2')), compose('1.7', G('1.1-11.7.2'))), []);     // IDEA rebuild only
  assert.equal(upstreamVersion('ghcr.io/other/mariadb:1.0-11.7.2'), '1.0-11.7.2');                 // not an IDEA retag
});

it('Axle should-fix 3: Redis, Valkey and KeyDB minors are a new series (RDB format)', () => {
  const vol = '    volumes:\n      - ./data/redis:/data\n';
  assert.equal(series('redis:7.2.5'), '7.2');
  assert.match(chk(compose('1.0', 'redis:7.2', vol), compose('1.1', 'redis:7.4', vol))[0], /redis 7\.2 -> 7\.4 without an App major/);
  assert.equal(chk(compose('1.0', 'valkey/valkey:8.0', vol), compose('1.1', 'valkey/valkey:8.1', vol)).length, 1);
  assert.equal(chk(compose('1.0', 'eqalpha/keydb:6.2', vol), compose('1.1', 'eqalpha/keydb:6.3', vol)).length, 1);
  assert.deepEqual(chk(compose('1.0', 'redis:7.2.4', vol), compose('1.1', 'redis:7.2.5', vol)), []);
  assert.deepEqual(chk(compose('1.0', 'redis:6.2'), compose('1.1', 'redis:7.2')), []);   // no volume: not stateful
});

it('Axle should-fix 4: MySQL/Percona 8.0 patches are one-way (8.0.Z); 8.4 LTS and 9.x stay X.Y', () => {
  assert.equal(series('mysql:8.0.39-debian'), '8.0.39');
  assert.equal(series('mysql:8.0'), null);                  // floating 8.0 cannot be compared
  assert.equal(series('mysql:8.4.2'), '8.4');
  assert.equal(series('percona/percona-server:8.0.36'), '8.0.36');
  assert.match(chk(compose('1.0', 'mysql:8.0.33'), compose('1.1', 'mysql:8.0.36'))[0], /mysql 8\.0\.33 -> 8\.0\.36 without/);
  assert.deepEqual(chk(compose('1.0', 'mysql:8.4.1'), compose('1.1', 'mysql:8.4.2')), []);
  assert.equal(chk(compose('1.0', 'mysql:8.0.39'), compose('1.1', 'mysql:8.4.2')).length, 1);
  assert.equal(chk(compose('1.0', 'mysql:9.0.1'), compose('1.1', 'mysql:9.1.0')).length, 1);
});

it('Axle should-fix 6: Postgres before 10 counts X.Y', () => {
  assert.equal(series('postgres:9.6.24'), '9.6');
  assert.match(chk(compose('1.0', 'postgres:9.5'), compose('1.1', 'postgres:9.6'))[0], /postgres 9\.5 -> 9\.6 without/);
  assert.deepEqual(chk(compose('1.0', 'postgres:9.6.1'), compose('1.1', 'postgres:9.6.24')), []);
  assert.equal(chk(compose('1.0', 'postgres:9.6'), compose('1.1', 'postgres:10')).length, 1);
  assert.equal(chk(compose('1.0', 'postgres:15-alpine'), compose('1.1', 'postgres:16-alpine')).length, 1);
  assert.deepEqual(chk(compose('1.0', 'postgres:16.2'), compose('1.1', 'postgres:16.4')), []);
});

it('Axle should-fix 5: a renamed stateful service is paired with its old name', () => {
  const base = compose('1.6', 'mariadb:11.7');
  const errs = chk(base, compose('1.7', 'mariadb:11.8', '', 'nextcloud-db'));
  assert.equal(errs.length, 1); assert.match(errs[0], /service db \(renamed nextcloud-db\): .*mariadb 11\.7 -> 11\.8/);
  assert.deepEqual(chk(base, compose('1.7', 'mariadb:11.7.3', '', 'nextcloud-db')), []);
  assert.deepEqual(chk(base, compose('2.0', 'mariadb:11.8', '', 'nextcloud-db')), []);
  // two removed and two added of one kind cannot be paired: fail closed without an App major
  const two = (v, a, b) => `x-app:\n  version: "${v}"\nservices:\n  ${a}:\n    image: postgres:15\n  ${b}:\n    image: postgres:15\n`;
  assert.match(chk(two('1.0', 'pg1', 'pg2'), two('1.1', 'pgA', 'pgB'))[0], /cannot pair the rename/);
  assert.deepEqual(chk(two('1.0', 'pg1', 'pg2'), two('2.0', 'pgA', 'pgB')), []);
});

it('Axle should-fix 7: date-tagged retags read the upstream version from app.yaml services[]', () => {
  const P = (d) => `koenswings/kolibri-postgres:1.0-${d}`;
  const ay = (tag, name = 'db') => ({ services: [{ name, image: 'koenswings/kolibri-postgres', upstream: 'postgres', upstream_tag: tag }] });
  assert.equal(upstreamVersion(P('2024.12.03'), { appYaml: ay('16'), service: 'db' }), '16');
  assert.equal(upstreamVersion(P('2024.12.03'), { appYaml: ay('16', 'other'), service: 'db' }), '16');   // matched by image repo
  assert.equal(upstreamVersion(P('2024.12.03')), null);                                                    // no app.yaml: unknown
  assert.match(chk(compose('1.0', P('2024.12.03')), compose('1.1', P('2025.03.01')), { baseAppYaml: ay('16'), appYaml: ay('17') })[0], /postgres 16 -> 17 without/);
  assert.deepEqual(chk(compose('1.0', P('2024.12.03')), compose('1.1', P('2025.03.01')), { baseAppYaml: ay('16'), appYaml: ay('16') }), []);
  assert.match(chk(compose('1.0', P('2024.12.03')), compose('1.1', P('2025.03.01')))[0], /cannot read the postgres series/);   // fail closed
});

it('Axle re-check fix 7a: an app.yaml entry that names another image is not used (fails closed)', () => {
  const P = (d) => `koenswings/kolibri-postgres:1.0-${d}`;
  // app-kolibri-studio today: service postgres runs koenswings/kolibri-postgres, its app.yaml entry describes kolibri-studio-postgres
  const studio = { services: [{ name: 'postgres', image: 'koenswings/kolibri-studio-postgres', upstream: 'postgres', upstream_tag: '16' }] };
  assert.equal(upstreamVersion(P('2024.12.03'), { appYaml: studio, service: 'postgres' }), null);
  assert.equal(upstreamVersion(P('2024.12.03'), { appYaml: { services: [{ name: 'db', image: 'koenswings/other', upstream_tag: '16' }] }, service: 'db' }), null);
  assert.match(chk(compose('1.0', P('2024.12.03'), '', 'postgres'), compose('1.1', P('2025.03.01'), '', 'postgres'), { baseAppYaml: studio, appYaml: studio })[0], /cannot read the postgres series/);
  // same image after normalisation (ghcr.io/koenswings, docker.io/koenswings, digest) is used; an entry without image matches by name
  for (const image of ['ghcr.io/koenswings/kolibri-postgres', 'docker.io/koenswings/kolibri-postgres', `koenswings/kolibri-postgres@sha256:${D}`]) {
    assert.equal(upstreamVersion(P('2024.12.03'), { appYaml: { services: [{ name: 'db', image, upstream_tag: '16' }] }, service: 'db' }), '16', image);
  }
  assert.equal(upstreamVersion(P('2024.12.03'), { appYaml: { services: [{ name: 'db', upstream_tag: '16' }] }, service: 'db' }), '16');
});

it('Axle re-check fix 7b: current_version is not a fallback (a stale value cannot pass a date-tag move)', () => {
  const P = (d) => `koenswings/kolibri-postgres:${d}`;
  const stale = { services: [{ name: 'db', image: 'koenswings/kolibri-postgres', current_version: '1.0-16.1' }] };
  assert.equal(upstreamVersion(P('1.0-2024.12.03'), { appYaml: stale, service: 'db' }), null);
  assert.match(chk(compose('1.0', P('1.0-2024.12.03')), compose('1.1', P('1.1-2025.03.01')), { baseAppYaml: stale, appYaml: stale })[0], /cannot read the postgres series/);
  const cv = { services: [{ name: 'db', image: 'koenswings/kolibri-postgres', upstream_tag: 'latest', current_version: '1.0-16.4' }] };
  assert.equal(upstreamVersion(P('1.0-2024.12.03'), { appYaml: cv, service: 'db' }), null);
});

it('a MariaDB series bump inside an App minor fails; with an App major it passes; patch and other images pass', () => {
  const base = compose('1.6-31.0.1', NCDB('11.7.2'));
  const errs = chk(base, compose('1.7-31.0.1', NCDB('11.8.2')));
  assert.equal(errs.length, 1); assert.match(errs[0], /service db: .*mariadb 11\.7 -> 11\.8 without an App major bump/);
  assert.deepEqual(chk(base, compose('2.0-31.0.1', NCDB('11.8.2'))), []);
  assert.deepEqual(chk(base, compose('1.7-31.0.1', NCDB('11.7.3'))), []);
  assert.deepEqual(chk(base, base), []);
  assert.deepEqual(chk(compose('1.0', 'koenswings/web:1.0'), compose('1.1', 'koenswings/web:9.0')), []);
});

it('a downgrade always fails, an engine swap or an unreadable tag needs an App major', () => {
  assert.match(chk(compose('1.0', 'mariadb:11.4'), compose('2.0', 'mariadb:10.11'))[0], /cannot be downgraded/);
  assert.match(chk(compose('1.0', 'mysql:8.4'), compose('1.1', 'mariadb:11.4'))[0], /changes the database engine/);
  assert.match(chk(compose('1.0', 'koenswings/web:1.0'), compose('1.1', 'postgres:16'))[0], /changes the database engine/);
  assert.deepEqual(chk(compose('1.0', 'mysql:8.4'), compose('2.0', 'mariadb:11.4')), []);
  assert.match(chk(compose('1.0', 'mariadb:11.4'), compose('1.1', 'mariadb:lts'))[0], /cannot read the mariadb series/);
  assert.deepEqual(chk(compose('1.0', 'mariadb:11.4'), compose('2.0', 'mariadb:lts')), []);
});

it('new or removed services without a counterpart are not compared', () => {
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
  assert.equal(r.status, 1); assert.match(r.stderr, /FAIL .*mariadb 11\.7 -> 11\.8 without an App major bump/);
  assert.equal(cli(next).status, 0);
  writeFileSync(next, compose('2.0-31.0.1', NCDB('11.8.2')));
  r = cli('--base', base, next); assert.equal(r.status, 0, r.stderr);
});

it('CLI --base-ref <ref>: compose and app.yaml at that ref; new compose skipped; Axle must-fix 1: unknown ref fails', () => {
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
  for (const bad of ['no-such-tag', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef']) {
    r = cli('--base-ref', bad, f);
    assert.equal(r.status, 1, bad); assert.match(r.stderr, new RegExp(`--base-ref ${bad}: not a commit in this repo`));
  }
  // date retag read through app.yaml at the ref and in the worktree
  const P = (d) => `koenswings/kolibri-postgres:1.0-${d}`;
  const ay = (t) => `services:\n  - name: db\n    image: koenswings/kolibri-postgres\n    upstream: postgres\n    upstream_tag: "${t}"\n`;
  writeFileSync(f, compose('1.0', P('2024.12.03'))); writeFileSync(join(dir, 'app.yaml'), ay('16'));
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'pg'); git(dir, 'tag', '1.0');
  writeFileSync(f, compose('1.1', P('2025.03.01'))); writeFileSync(join(dir, 'app.yaml'), ay('17'));
  r = cli('--base-ref', '1.0', f);
  assert.equal(r.status, 1); assert.match(r.stderr, /postgres 16 -> 17 without an App major bump/);
});

it('Axle nit (f346270): the image-only app.yaml lookup strips the tag and digest before normRepo', () => {
  const P = (d) => `koenswings/kolibri-postgres:1.0-${d}`;
  for (const image of ['koenswings/kolibri-postgres:1.0-2024.12.03', `koenswings/kolibri-postgres:1.0-2024.12.03@sha256:${D}`, 'ghcr.io/koenswings/kolibri-postgres:16']) {
    const ay = { services: [{ name: 'not-this-service', image, upstream_tag: '16' }] };   // found by image only
    assert.equal(upstreamVersion(P('2024.12.03'), { appYaml: ay, service: 'db' }), '16', image);
  }
  const other = { services: [{ name: 'x', image: 'koenswings/other-postgres:1.0-2024.12.03', upstream_tag: '16' }] };
  assert.equal(upstreamVersion(P('2024.12.03'), { appYaml: other, service: 'db' }), null);
});
