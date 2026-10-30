// idea#139 step 9: no files/ placeholder ships; every compose service image has its tar.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const CHECK = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'script/check-app-disk-tree.sh');
const COMPOSE = 'x-app:\n  name: nextcloud\n  version: "1.0"\nservices:\n  app:\n    image: koenswings/nextcloud:1.0-31\n  db:\n    image: "mariadb:11.7"\n';

function tree({ files, filesYaml = false, tars = true, sums = true } = {}) {
  const r = mkdtempSync(join(tmpdir(), 'disk-'));
  mkdirSync(join(r, 'apps/nextcloud-1.0'), { recursive: true });
  mkdirSync(join(r, 'instances/nc-001'), { recursive: true });
  mkdirSync(join(r, 'services'));
  writeFileSync(join(r, 'META.yaml'), 'diskId: x\n');
  writeFileSync(join(r, 'apps/nextcloud-1.0/compose.yaml'), COMPOSE);
  writeFileSync(join(r, 'instances/nc-001/compose.yaml'), COMPOSE);
  if (sums) writeFileSync(join(r, 'apps/nextcloud-1.0/SHA256SUMS'), 'x\n');
  if (tars) for (const t of ['koenswings_nextcloud:1.0-31', 'mariadb:11.7']) writeFileSync(join(r, `services/${t}.tar`), 'tar');
  if (filesYaml) writeFileSync(join(r, 'FILES.yaml'), 'name: S\n');
  for (const f of files ?? []) { mkdirSync(dirname(join(r, f)), { recursive: true }); writeFileSync(join(r, f), ''); }
  return r;
}
const run = (r) => spawnSync('bash', [CHECK, r], { encoding: 'utf8' });

it('passes a clean App-only tree with all tars', () => {
  const p = run(tree()); assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /koenswings\/nextcloud:1.0-31 -> services\/koenswings_nextcloud:1.0-31.tar/);
});
for (const ph of ['files/.gitkeep', 'files/.keep', 'files/Drop Zone/.gitkeep', 'files/.placeholder']) {
  it(`fails on ${ph}`, () => {
    const p = run(tree({ files: [ph], filesYaml: true })); assert.equal(p.status, 1);
    assert.match(p.stderr, /placeholder ships under files\//);
  });
}
it('fails on files/ on an App-only disk', () => {
  const p = run(tree({ files: ['files/hello.txt'] })); assert.equal(p.status, 1);
  assert.match(p.stderr, /App-only disk/);
});
it('allows real files on a Files disk', () => {
  assert.equal(run(tree({ files: ['files/hello.txt'], filesYaml: true })).status, 0);
});
it('fails when a service tar is missing', () => {
  const p = run(tree({ tars: false })); assert.equal(p.status, 1);
  assert.match(p.stderr, /image koenswings\/nextcloud:1.0-31 has no tar at services\/koenswings_nextcloud:1.0-31.tar/);
});
it('fails when SHA256SUMS is missing', () => {
  assert.match(run(tree({ sums: false })).stderr, /no SHA256SUMS/);
});

// idea#139: App folder <-> x-app.version, instance -> existing apps/ folder
const XAPP = (v) => `x-app:\n  name: nextcloud\n  version: "${v}"\nservices:\n  app:\n    image: koenswings/nextcloud:1.0-31\n  db:\n    image: "mariadb:11.7"\n`;
function vtree(appV, instV) {
  const r = tree();
  writeFileSync(join(r, 'apps/nextcloud-1.0/compose.yaml'), XAPP(appV));
  writeFileSync(join(r, 'instances/nc-001/compose.yaml'), XAPP(instV));
  return r;
}
it('passes when app folder, app compose and instance agree', () => {
  const p = run(vtree('1.0', '1.0')); assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /instances\/nc-001 instanceOf nextcloud-1.0 exists/);
});
it('fails an instance pointing at a missing app (1.0-smoke)', () => {
  const p = run(vtree('1.0', '1.0-smoke')); assert.equal(p.status, 1);
  assert.match(p.stderr, /instances\/nc-001\/compose.yaml x-app is nextcloud-1.0-smoke but apps\/nextcloud-1.0-smoke does not exist/);
});
it('fails an app folder whose compose version differs', () => {
  const p = run(vtree('1.0-smoke', '1.0')); assert.equal(p.status, 1);
  assert.match(p.stderr, /apps\/nextcloud-1.0\/compose.yaml x-app is nextcloud-1.0-smoke/);
});
it('the app-nextcloud smoke fixture agrees with itself', () => {
  const fx = join(dirname(CHECK), '..', 'tests/app-nextcloud/fixture');
  const p = spawnSync('bash', ['-c', `bash ${CHECK} ${fx} 2>&1 | grep -E "x-app|instanceOf"`], { encoding: 'utf8' });
  assert.doesNotMatch(p.stdout, /FAIL/); assert.match(p.stdout, /instanceOf nextcloud-1.0 exists/);
});
