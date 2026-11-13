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
    labels:
      x-app-version: "1.2"
  db:
    image: "mariadb:11.7"
    labels:
      x-app-version: "1.2"
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
// Release refs are git tags at HEAD (idea#76); the helper tags HEAD like a release would.
const build = (s, ref = '1.2', env = {}) => {
  if (/^[0-9]+\.[0-9]+(-[A-Za-z0-9._]+)?$/.test(ref)) spawnSync('git', ['-C', s.app, 'tag', '-f', ref], { stdio: 'pipe' });
  return spawnSync('bash', [BUILD, '--app-dir', s.app, '--disk-root', s.disk, '--ref', ref], { env: { ...s.env, ...env }, encoding: 'utf8' });
};
const verify = (s, id = 'demo-1.2') => spawnSync('bash', [VERIFY, s.disk, id], { encoding: 'utf8' });

const listed = (file) => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.slice(66));

it('writes a bundle-relative SHA256SUMS and a disk-root SHA256SUMS that both verify', () => {
  const s = setup();
  const r = build(s); assert.equal(r.status, 0, r.stderr);
  const sums = listed(join(s.disk, 'apps/demo-1.2/SHA256SUMS'));
  assert.deepEqual(sums, [
    'Teacher  Notes/n.txt', 'compose.yaml', 'hooks/10-x.sh']);
  const rootSums = listed(join(s.disk, 'SHA256SUMS'));
  assert.deepEqual(rootSums, [
    'apps/demo-1.2/SHA256SUMS', 'apps/demo-1.2/Teacher  Notes/n.txt', 'apps/demo-1.2/compose.yaml',
    'apps/demo-1.2/hooks/10-x.sh', 'services/koenswings_demo-web:1.2-3.4.tar', 'services/mariadb:11.7.tar']);
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

it("the Engine's apps/<appId>/.idea-fetched done marker is ignored, but a nested .idea-* file is not", () => {
  const s = setup(); assert.equal(build(s).status, 0);
  writeFileSync(join(s.disk, 'apps/demo-1.2/.idea-fetched'), '{"at":"2026-10-28"}\n');
  const r = verify(s); assert.equal(r.status, 0, r.stderr);
  writeFileSync(join(s.disk, 'apps/demo-1.2/hooks/.idea-fetched'), 'x');
  assert.notEqual(verify(s).status, 0, 'only bundle-root markers are exempt');
});

it('verifies regardless of the caller locale (mixed-case and punctuation names, as in app-nextcloud)', () => {
  const s = setup();
  for (const f of ['B-hook.sh', 'a_file.txt', 'Zz.md', 'docs/b.md', 'docs/A.md']) {
    mkdirSync(dirname(join(s.app, f)), { recursive: true }); writeFileSync(join(s.app, f), f);
  }
  execFileSync('git', ['-C', s.app, 'add', '.'], { stdio: 'pipe' });
  execFileSync('git', ['-C', s.app, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'y']);
  assert.equal(build(s).status, 0);
  for (const loc of ['C.UTF-8', 'en_US.UTF-8']) {
    const r = spawnSync('bash', [VERIFY, s.disk, 'demo-1.2'], { encoding: 'utf8', env: { ...process.env, LC_ALL: loc, LANG: loc } });
    assert.equal(r.status, 0, `${loc}: ${r.stderr}`);
  }
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

it('excludes __pycache__ and *.pyc/*.pyo from the bundle, and verify fails if one is planted', () => {
  // Untracked bytecode in the source tree (the usual case: a local pytest run).
  const s = setup();
  mkdirSync(join(s.app, '__pycache__'), { recursive: true });
  writeFileSync(join(s.app, '__pycache__/x.pyc'), 'bytecode');
  writeFileSync(join(s.app, 'hooks/stale.pyo'), 'opt');
  let r = build(s);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(s.disk, 'apps/demo-1.2/__pycache__')), 'untracked pycache stays out');
  assert.ok(!existsSync(join(s.disk, 'apps/demo-1.2/hooks/stale.pyo')), 'untracked .pyo stays out');
  assert.equal(verify(s).status, 0, verify(s).stderr);

  // Force-added to the index: the copy filter must still drop it.
  const s2 = setup();
  mkdirSync(join(s2.app, '__pycache__'), { recursive: true });
  writeFileSync(join(s2.app, '__pycache__/x.pyc'), 'bytecode');
  execFileSync('git', ['-C', s2.app, 'add', '-f', '__pycache__/x.pyc'], { stdio: 'pipe' });
  execFileSync('git', ['-C', s2.app, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'pyc']);
  r = build(s2);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(s2.disk, 'apps/demo-1.2/__pycache__')), 'tracked pycache is filtered out');
  assert.doesNotMatch(readFileSync(join(s2.disk, 'apps/demo-1.2/SHA256SUMS'), 'utf8'), /__pycache__|\.pyc|\.pyo/);
  assert.equal(verify(s2).status, 0, verify(s2).stderr);

  // Planted in the built bundle (e.g. unit tests run against the deliverable): verify must fail.
  mkdirSync(join(s2.disk, 'apps/demo-1.2/__pycache__'), { recursive: true });
  writeFileSync(join(s2.disk, 'apps/demo-1.2/__pycache__/x.pyc'), 'bytecode');
  const v = verify(s2);
  assert.notEqual(v.status, 0);
  assert.match(v.stderr, /bytecode/);
  assert.match(v.stderr, /__pycache__/);
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
  const rootSums = listed(join(s.disk, 'SHA256SUMS'));
  for (const p of ['apps/demo-1.2/compose.yaml', 'apps/demo-1.3/compose.yaml',
    'services/koenswings_demo-web:1.2-3.4.tar', 'services/koenswings_demo-web:1.3-3.5.tar', 'services/mariadb:11.7.tar']) {
    assert.ok(rootSums.includes(p), p);
  }
  assert.doesNotMatch(readFileSync(join(s.disk, 'apps/demo-1.2/SHA256SUMS'), 'utf8'), /services\//);
  assert.doesNotMatch(readFileSync(join(s.disk, 'apps/demo-1.3/SHA256SUMS'), 'utf8'), /services\//);
});

it('refuses :latest, untagged images, an existing bundle and an appId receive-app refuses', () => {
  assert.match(build(setup(COMPOSE.replace('mariadb:11.7', 'mariadb:latest'))).stderr, /latest/);
  assert.match(build(setup(COMPOSE.replace('mariadb:11.7', 'mariadb'))).stderr, /no tag/);
  const s = setup(); assert.equal(build(s).status, 0); assert.match(build(s).stderr, /already exists/);
  assert.match(build(setup(), 'feat/x').stderr, /not a release tag/);
  assert.notEqual(build(setup(COMPOSE.replace('name: demo', 'name: .demo'))).status, 0);
});

it('idea#139: bundled compose x-app.version is the folder version', () => {
  const s = setup(); const r = build(s, '1.2');
  assert.equal(r.status, 0, r.stderr);
  const c = readFileSync(join(s.disk, 'apps/demo-1.2/compose.yaml'), 'utf8');
  assert.match(c, /^  version: "1.2"$/m);
  assert.match(c, /#image: upstream\/web/);
});

// Engine contract (agent-engine-dev cc219476 src/data/UpdateApp.ts).
// defaultVerifySums (lines 137–139):
//   const defaultVerifySums = async (dir: string): Promise<boolean> => {
//     if (!await fs.pathExists(path.join(dir, 'SHA256SUMS'))) return false
//     try { await $({ cwd: dir })`sha256sum --check --strict --quiet SHA256SUMS`.quiet(); return true } catch { return false }
//   }
// sumsLookUsable (lines 536–537):
//   export const sumsLookUsable = (sums: string | null): boolean =>
//     !!sums && sums.split('\n').some(l => /^[0-9a-f]{64} [ *]\.?\/?compose\.yaml$/.test(l.trim()))
const sumsLookUsable = (sums) =>
  !!sums && sums.split('\n').some((l) => /^[0-9a-f]{64} [ *]\.?\/?compose\.yaml$/.test(l.trim()));

it('Engine-exact defaultVerifySums and sumsLookUsable pass on the bundle SHA256SUMS; disk-root sums check from the root', () => {
  const s = setup();
  assert.equal(build(s).status, 0);
  const bundle = join(s.disk, 'apps/demo-1.2');
  const sums = readFileSync(join(bundle, 'SHA256SUMS'), 'utf8');
  assert.equal(sumsLookUsable(sums), true, 'sumsLookUsable (UpdateApp.ts:536-537) must match a bare compose.yaml line');
  // defaultVerifySums (UpdateApp.ts:137-139): cd into the bundle dir and run sha256sum --check --strict SHA256SUMS
  const ev = spawnSync('sha256sum', ['--check', '--strict', 'SHA256SUMS'], { cwd: bundle, encoding: 'utf8' });
  assert.equal(ev.status, 0, ev.stdout + ev.stderr);
  const root = spawnSync('sha256sum', ['--check', '--strict', 'SHA256SUMS'], { cwd: s.disk, encoding: 'utf8' });
  assert.equal(root.status, 0, root.stdout + root.stderr);
  // The old disk-root-relative layout would not look usable to the Engine.
  assert.equal(sumsLookUsable('deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  apps/demo-1.2/compose.yaml\n'), false);
});

it('disk-root SHA256SUMS check does not flag unlisted top-level content (live App Disk)', () => {
  // Disk B already holds META.yaml, BACKUP.yaml, backups/, and other apps. sha256sum --check
  // only verifies listed paths; unlisted files must not fail the root or verify-app-bundle check.
  const s = setup();
  assert.equal(build(s).status, 0);
  writeFileSync(join(s.disk, 'META.yaml'), 'diskId: other\n');
  writeFileSync(join(s.disk, 'BACKUP.yaml'), 'role: backup\n');
  mkdirSync(join(s.disk, 'backups', 'x'), { recursive: true });
  writeFileSync(join(s.disk, 'backups/x/a'), 'old\n');
  mkdirSync(join(s.disk, 'apps/other-app-1.0'), { recursive: true });
  writeFileSync(join(s.disk, 'apps/other-app-1.0/compose.yaml'), 'x-app: {name: other}\n');
  const root = spawnSync('sha256sum', ['--check', '--strict', 'SHA256SUMS'], { cwd: s.disk, encoding: 'utf8' });
  assert.equal(root.status, 0, root.stdout + root.stderr);
  const v = verify(s);
  assert.equal(v.status, 0, v.stderr);
});
