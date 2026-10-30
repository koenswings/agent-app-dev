// idea#139/#76: stage-files-disk-b.sh defaults to the app-nextcloud release tag 1.2-31.0.1.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const STAGE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'script/stage-files-disk-b.sh');
const V = '1.2-31.0.1';
const compose = `x-app:\n  name: nextcloud\n  version: "${V}"\n  instanceName: nextcloud\nservices:\n  nextcloud-app:\n    image: koenswings/nextcloud:1.0-31.0.1\n    labels:\n      x-app-version: "${V}"\n`;
function setup(tag) {
  const d = mkdtempSync(join(tmpdir(), 'diskb-')), app = join(d, 'app'), bin = join(d, 'bin');
  mkdirSync(app); mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\n[ "$1" = save ] && printf tar\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(app, 'compose.yaml'), compose);
  const g = (...a) => execFileSync('git', ['-C', app, ...a], { stdio: 'pipe' });
  g('init', '-q'); g('add', '.'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x');
  if (tag) g('tag', tag);
  const tree = join(d, 'tree');
  const r = spawnSync('bash', [STAGE, '--app-dir', app, '--tree', tree, '--disk-id', 'TESTB'], { env: { ...process.env, DOCKER: join(bin, 'docker') }, encoding: 'utf8' });
  return { r, tree };
}
it('default --ref is the 1.2-31.0.1 tag and the tree check passes', () => {
  const { r, tree } = setup(V); assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /check-app-disk-tree: PASS/);
  const c = readFileSync(join(tree, 'instances/nextcloud-files-b-001/compose.yaml'), 'utf8');
  assert.match(c, /^  version: "1\.2-31\.0\.1"$/m); assert.match(c, /x-app-version: "1\.2-31\.0\.1"/);
  assert.ok(existsSync(join(tree, `apps/nextcloud-${V}/SHA256SUMS`)));
});
it('refuses a checkout without that tag', () => {
  const { r } = setup('1.0'); assert.notEqual(r.status, 0); assert.match(r.stderr, /not a git tag/);
});
