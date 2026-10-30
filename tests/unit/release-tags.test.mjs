// idea#76 (Steve, decisions 3 and 4): bundles only from <major>.<minor>[-<upstream>] tags,
// ALLOW_UNTAGGED=1 dev builds stamp 0.0-dev+<sha>, and x-app-version label == x-app.version == tag.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { YAML } from 'zx';
import { checkComposeVersion, RELEASE_TAG, DEV_VERSION } from '../../lib/check-compose.mjs';
import { updatePair, compareVersions } from '../../lib/update-pair.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD = join(ROOT, 'script/build-app-bundle.sh'), CHECK = join(ROOT, 'script/check-compose.mjs');
const compose = (v) => `x-app:\n  name: demo\n  version: ${v}\nservices:\n  web:\n    image: koenswings/demo-web:1.1-3.5\n    labels:\n      x-app-version: "${v}"\n  db:\n    image: "mariadb:11.7"\n    labels:\n      x-app-version: "${v}"\n`;

function repo(c = compose('1.1-3.5')) {
  const d = mkdtempSync(join(tmpdir(), 'tag-')), app = join(d, 'app'), disk = join(d, 'disk'), bin = join(d, 'bin');
  for (const p of [app, disk, bin]) mkdirSync(p);
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\n[ "$1" = save ] && printf 'tar'\nexit 0\n`, { mode: 0o755 });
  writeFileSync(join(app, 'compose.yaml'), c);
  const g = (...a) => execFileSync('git', ['-C', app, ...a], { stdio: 'pipe', encoding: 'utf8' }).trim();
  g('init', '-q'); g('add', '.'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x');
  const build = (ref, env = {}) => spawnSync('bash', [BUILD, '--app-dir', app, '--disk-root', disk, '--ref', ref],
    { env: { ...process.env, DOCKER: join(bin, 'docker'), ...env }, encoding: 'utf8' });
  return { app, disk, g, build };
}

it('builds from a release tag at HEAD and stamps label == x-app.version == tag', () => {
  const r = repo(compose('5ab9f6428b7143c42feee29cc4b9bf950bab3b3e')); r.g('tag', '1.1-3.5');
  const b = r.build('1.1-3.5'); assert.equal(b.status, 0, b.stderr);
  const doc = YAML.parse(readFileSync(join(r.disk, 'apps/demo-1.1-3.5/compose.yaml'), 'utf8'));
  assert.equal(doc['x-app'].version, '1.1-3.5');
  assert.deepEqual(Object.values(doc.services).map((s) => s.labels['x-app-version']), ['1.1-3.5', '1.1-3.5']);
  assert.deepEqual(checkComposeVersion(doc, '1.1-3.5'), []);
});

it('refuses SHA, date and branch refs, a release-shaped ref that is not a tag, and a tag not at HEAD', () => {
  const r = repo(); const sha = r.g('rev-parse', 'HEAD');
  for (const ref of [sha, sha.slice(0, 7), 'zimbabwe-2026-10-20', '2026-10-20', 'main', 'v1.1', '1', '1.1.']) {
    const b = r.build(ref); assert.notEqual(b.status, 0, ref); assert.match(b.stderr, /not a release tag/, ref);
  }
  assert.match(r.build('1.1-3.5').stderr, /not a git tag/);
  r.g('tag', '1.0'); writeFileSync(join(r.app, 'x'), 'y'); r.g('add', 'x'); r.g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'y');
  assert.match(r.build('1.0').stderr, /not the checked-out HEAD/);
  assert.deepEqual(readdirSync(r.disk).filter((f) => f !== 'services'), []);
});

it('refuses to build when a service has no x-app-version label', () => {
  const r = repo(compose('1.1').replace(/    labels:\n      x-app-version: "1.1"\n  db/, '  db')); r.g('tag', '1.1');
  const b = r.build('1.1'); assert.notEqual(b.status, 0); assert.match(b.stderr, /check-compose failed/);
});

it('ALLOW_UNTAGGED=1 stamps 0.0-dev+<sha12>, which never wins an update compare', () => {
  const r = repo(); const sha = r.g('rev-parse', '--short=12', 'HEAD');
  const b = r.build('anything', { ALLOW_UNTAGGED: '1' }); assert.equal(b.status, 0, b.stderr);
  assert.match(b.stderr, /not a release/);
  const v = `0.0-dev+${sha}`; assert.match(v, DEV_VERSION);
  const doc = YAML.parse(readFileSync(join(r.disk, `apps/demo-${v}/compose.yaml`), 'utf8'));
  assert.equal(doc['x-app'].version, v); assert.deepEqual(checkComposeVersion(doc, v), []);
  // Engine rule (parseVersion: first number run): dev reads as [0, 0].
  for (const real of ['0.1', '1.0', '1.1-0.19.5', '5ab9f6428b7143c42feee29cc4b9bf950bab3b3e']) {
    assert.ok(compareVersions(v, real) < 0, `dev < ${real}`);
    assert.equal(updatePair('demo', `demo-${real}`, `demo-${v}`).ok, false, `dev never offered over ${real}`);
  }
  assert.equal(compareVersions(v, '0.0-dev+aaaaaaaaaaaa'), 0, 'dev vs dev is a tie, so NOT_NEWER');
  assert.equal(compareVersions(v, '0.0'), 0, 'a real 0.0 release would tie: never tag 0.0');
});

it('check-compose rule: label == x-app.version == tag', () => {
  const ok = YAML.parse(compose('1.1'));
  assert.deepEqual(checkComposeVersion(ok), []); assert.deepEqual(checkComposeVersion(ok, '1.1'), []);
  assert.match(checkComposeVersion(ok, '1.2')[0], /!= tag '1.2'/);
  const bad = YAML.parse(compose('1.1').replace('x-app-version: "1.1"\n  db', 'x-app-version: "1.0"\n  db'));
  assert.match(checkComposeVersion(bad)[0], /service web: label x-app-version '1.0' != x-app.version '1.1'/);
  const list = YAML.parse('x-app:\n  version: "1.1"\nservices:\n  a:\n    labels: ["x-app-version=1.1"]\n  b: {}\n');
  assert.deepEqual(checkComposeVersion(list), ['service b: label x-app-version missing']);
  assert.deepEqual(checkComposeVersion({ services: {} }), ['x-app.version missing']);
  assert.ok(RELEASE_TAG.test('1.1-0.19.5') && RELEASE_TAG.test('1.0') && !RELEASE_TAG.test('zimbabwe-2026-10-20'));
  const f = join(mkdtempSync(join(tmpdir(), 'cc-')), 'compose.yaml'); writeFileSync(f, compose('1.1'));
  assert.equal(spawnSync('node', [CHECK, '--tag', '1.1', f]).status, 0);
  const cli = spawnSync('node', [CHECK, '--tag', '1.2', f], { encoding: 'utf8' });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /!= tag/);
});
