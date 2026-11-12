// build-app-disk-image.sh --disk-id: META.yaml diskId may be unquoted, "double" or 'single'
// quoted; quotes and surrounding whitespace are stripped and the whole value must match.
// The run stops before any image work: SFDISK points at a missing binary, so a matching
// diskId ends at "sfdisk not found" and a mismatch at the diskId refusal.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'script/build-app-disk-image.sh');
const COMPOSE = 'x-app:\n  name: nextcloud\n  version: "1.0"\nservices:\n  app:\n    image: koenswings/nextcloud:1.0-31\n  db:\n    image: "mariadb:11.7"\n';
const REST = 'isHardwareId: false\ndiskName: IDEA Disk\ncreated: 1793359200000\nlastDocked: 1793359200000\n';

function tree(diskIdLine) {
  const r = mkdtempSync(join(tmpdir(), 'disk-id-'));
  const t = join(r, 'tree');
  mkdirSync(join(t, 'apps/nextcloud-1.0'), { recursive: true });
  mkdirSync(join(t, 'instances/nc-001'), { recursive: true });
  mkdirSync(join(t, 'services'));
  writeFileSync(join(t, 'META.yaml'), `${diskIdLine}\n${REST}`);
  writeFileSync(join(t, 'apps/nextcloud-1.0/compose.yaml'), COMPOSE);
  writeFileSync(join(t, 'apps/nextcloud-1.0/SHA256SUMS'), 'x\n');
  writeFileSync(join(t, 'instances/nc-001/compose.yaml'), COMPOSE);
  for (const s of ['koenswings_nextcloud:1.0-31', 'mariadb:11.7']) writeFileSync(join(t, `services/${s}.tar`), 'tar');
  writeFileSync(join(r, 'hw.json'), '[]\n');
  return r;
}
function build(diskIdLine, diskId) {
  const r = tree(diskIdLine);
  return spawnSync('bash', [BUILD, '--tree', join(r, 'tree'), '--out', join(r, 'x.img'),
    '--uuid', '11111111-2222-3333-4444-555555555555', '--disk-id', diskId], {
    encoding: 'utf8',
    env: { ...process.env, SFDISK: join(r, 'no-sfdisk'), HW_ROUNDTRIP_DISKS_JSON: join(r, 'hw.json') },
  });
}
const accepted = (p) => {
  assert.doesNotMatch(p.stderr, /does not match --disk-id/, p.stderr);
  assert.match(p.stderr, /sfdisk not found/, p.stderr);
};
const refused = (p) => {
  assert.equal(p.status, 1);
  assert.match(p.stderr, /META\.yaml diskId .* does not match --disk-id/, p.stderr);
};

for (const [name, line] of [
  ['unquoted', 'diskId: diskb202610301247'],
  ['"double" quoted', 'diskId: "diskb202610301247"'],
  ["'single' quoted", "diskId: 'diskb202610301247'"],
  ['quoted with surrounding whitespace', 'diskId:   "diskb202610301247"   '],
  ['CRLF line end', "diskId: 'diskb202610301247'\r"],
]) {
  it(`accepts a ${name} META diskId`, () => accepted(build(line, 'diskb202610301247')));
}
it('refuses a mismatched diskId (unquoted and quoted)', () => {
  refused(build('diskId: diskb202610301247', 'diska202610301247'));
  refused(build('diskId: "diskb202610301247"', 'diska202610301247'));
  refused(build("diskId: 'diskb202610301247'", 'diska202610301247'));
});
it('refuses a prefix match (whole value only)', () => {
  refused(build('diskId: diskb202610301247-old', 'diskb202610301247'));
  refused(build('diskId: "diskb2026"', 'diskb202610301247'));
});
it('refuses mismatched or unbalanced quotes as part of the value', () => {
  refused(build('diskId: "diskb202610301247\'', 'diskb202610301247'));
  refused(build('diskId: "diskb202610301247', 'diskb202610301247'));
});
