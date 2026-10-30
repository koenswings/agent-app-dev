// idea#139 step 9: no files/ placeholder ships; every compose service image has its tar.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const CHECK = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'script/check-app-disk-tree.sh');
const COMPOSE = 'x-app:\n  name: nextcloud\nservices:\n  app:\n    image: koenswings/nextcloud:1.0-31\n  db:\n    image: "mariadb:11.7"\n';

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
