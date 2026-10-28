// agent-app-dev#23 (idea#351 updateApp): build-time SHA256SUMS, image+tag tar names, file modes.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, chmodSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD = join(ROOT, 'script/build-app-bundle.sh');
const VERIFY = join(ROOT, 'script/verify-app-bundle.sh');

const COMPOSE = `x-app:
  name: demo
  version: 1.2
services:
  web:
    #image: upstream/web
    image: koenswings/demo-web:1.2-3.4
  db:
    image: "mariadb:11.7"
`;

function setup(compose = COMPOSE) {
  const d = mkdtempSync(join(tmpdir(), 'bundle-'));
  const app = join(d, 'app'); const disk = join(d, 'disk'); const bin = join(d, 'bin');
  for (const p of [app, disk, bin, join(app, 'hooks'), join(app, 'Teacher  Notes')]) mkdirSync(p, { recursive: true });
  writeFileSync(join(app, 'compose.yaml'), compose);
  writeFileSync(join(app, 'hooks/10-x.sh'), '#!/bin/sh\necho hi\n'); chmodSync(join(app, 'hooks/10-x.sh'), 0o755);
  writeFileSync(join(app, 'Teacher  Notes/n.txt'), 'notes\n');
  writeFileSync(join(app, 'untracked.txt'), 'not in git\n');
  const g = (...a) => execFileSync('git', ['-C', app, ...a], { stdio: 'pipe' });
  g('init', '-q'); g('add', 'compose.yaml', 'hooks', 'Teacher  Notes');
  g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x');
  const log = join(d, 'docker.log');
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\necho "$@" >> ${log}\n[ "$1" = save ] && printf 'tar-of-%s' "$2"\n`);
  chmodSync(join(bin, 'docker'), 0o755);
  return { d, app, disk, log, env: { ...process.env, DOCKER: join(bin, 'docker') } };
}
const build = (s, ref = '1.2') => spawnSync('bash', [BUILD, '--app-dir', s.app, '--disk-root', s.disk, '--ref', ref], { env: s.env, encoding: 'utf8' });
const verify = (s, id = 'demo-1.2') => spawnSync('bash', [VERIFY, s.disk, id], { encoding: 'utf8' });

it('writes bundle, image+tag tars and a disk-root-relative SHA256SUMS that verifies', () => {
  const s = setup();
  const r = build(s); assert.equal(r.status, 0, r.stderr);
  const sums = readFileSync(join(s.disk, 'apps/demo-1.2/SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.slice(66));
  assert.deepEqual(sums, [
    'apps/demo-1.2/Teacher  Notes/n.txt', 'apps/demo-1.2/compose.yaml', 'apps/demo-1.2/hooks/10-x.sh',
    'services/koenswings_demo-web:1.2-3.4.tar', 'services/mariadb:11.7.tar']);
  assert.ok(!existsSync(join(s.disk, 'apps/demo-1.2/untracked.txt')), 'untracked files stay out');
  assert.ok(!existsSync(join(s.disk, 'apps/demo-1.2/.git')));
  assert.equal(statSync(join(s.disk, 'apps/demo-1.2/hooks/10-x.sh')).mode & 0o777, 0o755, 'hook stays executable');
  assert.equal(readFileSync(join(s.disk, 'services/mariadb:11.7.tar'), 'utf8'), 'tar-of-mariadb:11.7');
  assert.equal(verify(s).status, 0, verify(s).stderr);
});

it('an Engine done marker at the bundle root does not break verification', () => {
  const s = setup(); assert.equal(build(s).status, 0);
  writeFileSync(join(s.disk, 'apps/demo-1.2/.idea-bundle-complete'), '');
  assert.equal(verify(s).status, 0);
});

it('verification fails on a changed file, a changed tar, or an extra file', () => {
  for (const mutate of [
    (s) => appendFileSync(join(s.disk, 'apps/demo-1.2/compose.yaml'), '#x'),
    (s) => appendFileSync(join(s.disk, 'services/mariadb:11.7.tar'), 'x'),
    (s) => writeFileSync(join(s.disk, 'apps/demo-1.2/extra'), 'x'),
  ]) {
    const s = setup(); assert.equal(build(s).status, 0); mutate(s);
    assert.notEqual(verify(s).status, 0);
  }
});

it('reuses an existing tar of the same image+tag and never overwrites it', () => {
  const s = setup();
  mkdirSync(join(s.disk, 'services'));
  writeFileSync(join(s.disk, 'services/mariadb:11.7.tar'), 'already-here');
  assert.equal(build(s).status, 0);
  assert.equal(readFileSync(join(s.disk, 'services/mariadb:11.7.tar'), 'utf8'), 'already-here');
  assert.doesNotMatch(readFileSync(s.log, 'utf8'), /save mariadb/);
  assert.equal(verify(s).status, 0);
});

it('a second release lands beside the first without touching its tars or bundle', () => {
  const s = setup(); assert.equal(build(s).status, 0);
  const before = readFileSync(join(s.disk, 'services/koenswings_demo-web:1.2-3.4.tar'), 'utf8');
  writeFileSync(join(s.app, 'compose.yaml'), COMPOSE.replace(/1\.2-3\.4/, '1.3-3.5'));
  execFileSync('git', ['-C', s.app, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'y']);
  assert.equal(build(s, '1.3').status, 0);
  assert.ok(existsSync(join(s.disk, 'services/koenswings_demo-web:1.3-3.5.tar')));
  assert.equal(readFileSync(join(s.disk, 'services/koenswings_demo-web:1.2-3.4.tar'), 'utf8'), before);
  assert.equal(verify(s).status, 0); assert.equal(verify(s, 'demo-1.3').status, 0);
});

it('refuses :latest, untagged images, an existing bundle and an appId receive-app refuses', () => {
  assert.match(build(setup(COMPOSE.replace('mariadb:11.7', 'mariadb:latest'))).stderr, /latest/);
  assert.match(build(setup(COMPOSE.replace('mariadb:11.7', 'mariadb'))).stderr, /no tag/);
  const s = setup(); assert.equal(build(s).status, 0); assert.match(build(s).stderr, /already exists/);
  assert.equal(build(setup(), 'feat/x').status, 0, 'slash in ref becomes "-" like the Engine');
  assert.notEqual(build(setup(COMPOSE.replace('name: demo', 'name: .demo'))).status, 0);
});
