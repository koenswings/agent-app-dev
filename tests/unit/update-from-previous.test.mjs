// idea#76 / idea#351: box half of "update from previous release". Two releases of one App on one
// disk root: both bundles verify, the new release never overwrites the old one's tars, and the
// Engine's version rule offers old -> new. The real-data run on a Pi follows separately.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { updatePair, compareVersions } from '../../lib/update-pair.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD = join(ROOT, 'script/build-app-bundle.sh'), VERIFY = join(ROOT, 'script/verify-app-bundle.sh');
const compose = (v, tag) => `x-app:\n  name: demo\n  version: ${v}\nservices:\n  web:\n    image: koenswings/demo-web:${tag}\n    labels:\n      x-app-version: "${v}"\n  db:\n    image: "mariadb:11.7"\n    labels:\n      x-app-version: "${v}"\n`;

function twoReleases() {
  const d = mkdtempSync(join(tmpdir(), 'upd-')), app = join(d, 'app'), disk = join(d, 'disk'), bin = join(d, 'bin');
  for (const p of [app, disk, bin]) mkdirSync(p);
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\n[ "$1" = save ] && printf 'tar-of-%s' "$2"\nexit 0\n`, { mode: 0o755 });
  const env = { ...process.env, DOCKER: join(bin, 'docker') };
  const g = (...a) => execFileSync('git', ['-C', app, ...a], { stdio: 'pipe' });
  g('init', '-q');
  const release = (v, tag) => {
    writeFileSync(join(app, 'compose.yaml'), compose(v, tag)); g('add', '.');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', v); g('tag', v);
    const r = spawnSync('bash', [BUILD, '--app-dir', app, '--disk-root', disk, '--ref', v], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  return { disk, release };
}

it('old and new release sit side by side, both verify, old tars untouched', () => {
  const { disk, release } = twoReleases();
  release('1.0', '1.0-3.4');
  const oldTar = join(disk, 'services/koenswings_demo-web:1.0-3.4.tar'), before = statSync(oldTar).mtimeMs;
  release('1.1', '1.1-3.5');
  for (const id of ['demo-1.0', 'demo-1.1']) {
    const v = spawnSync('bash', [VERIFY, disk, id], { encoding: 'utf8' }); assert.equal(v.status, 0, v.stderr);
  }
  assert.equal(readFileSync(oldTar, 'utf8'), 'tar-of-koenswings/demo-web:1.0-3.4');
  assert.equal(statSync(oldTar).mtimeMs, before, 'old tar never rewritten');
  assert.match(readFileSync(join(disk, 'apps/demo-1.1/SHA256SUMS'), 'utf8'), /services\/mariadb:11\.7\.tar/, 'shared tar still listed');
  assert.deepEqual(updatePair('demo', 'demo-1.0', 'demo-1.1'), { ok: true, major: false });
});

it('Engine version rule: minor yes, same/older no, major only via updatesFrom', () => {
  assert.equal(compareVersions('1.10', '1.9') > 0, true);
  assert.equal(updatePair('demo', 'demo-1.1', 'demo-1.1').reason.split(':')[0], 'NOT_NEWER');
  assert.equal(updatePair('demo', 'demo-1.1', 'demo-1.0').ok, false);
  assert.equal(updatePair('demo', 'demo-1.4', 'demo-2.0').reason.split(':')[0], 'MAJOR_NOT_ALLOWED');
  assert.deepEqual(updatePair('demo', 'demo-1.4', 'demo-2.0', [1]), { ok: true, major: true });
  assert.equal(updatePair('demo', 'other-1.0', 'demo-1.1').reason, 'DIFFERENT_APP');
  assert.deepEqual(updatePair('kolibri-channel-builder', 'kolibri-channel-builder-1.0', 'kolibri-channel-builder-1.1'), { ok: true, major: false });
  assert.deepEqual(updatePair('kolibri', 'kolibri-1.0-0.15.5', 'kolibri-1.1-0.19.5'), { ok: true, major: false });
});

it('a bundle built from a commit ref has no release order', () => {
  assert.match(updatePair('kolibri', 'kolibri-5ab9f6428b7143c42feee29cc4b9bf950bab3b3e', 'kolibri-1.1').reason, /^VERSION_IS_COMMIT/);
  assert.match(updatePair('kolibri', 'kolibri-1.0', 'kolibri-b8ad438').reason, /^VERSION_IS_COMMIT/);
});
