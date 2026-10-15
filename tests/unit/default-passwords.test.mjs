// IDEA default password scheme: <account name>911! (Koen). No old/random seed passwords left.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = join(ROOT, 'tests/duration-tests/fixtures');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

it('no old seed passwords remain in tracked files', () => {
  const hits = execSync(`git -C "${ROOT}" grep -n -I -E "Grade5A!|NEXTCLOUD_ADMIN_PASSWORD=admin$|set_password\\(uname\\)$" -- . ':!tests/unit/default-passwords.test.mjs' || true`, { encoding: 'utf8' });
  assert.equal(hits.trim(), '');
});

it('Kolibri fixtures: teacher hint teacher911!; learners seeded as <name>911!', () => {
  for (const f of ['kolibri', 'kolibri-form3']) {
    const live = JSON.parse(readFileSync(join(FIX, f, 'content/CONTENT.live.json'), 'utf8'));
    assert.match(JSON.stringify(live), /"passwordHint":"teacher911!"/);
  }
  assert.match(read('tests/duration-tests/scripts/provision-khan-pack-lesson.py'), /u\.set_password\(uname \+ "911!"\)/);
});

it('Nextcloud sidecar: admin911!, every seeded account <name>911!, hints match', () => {
  const s = read('tests/duration-tests/scripts/post-dock-restore-running.sh');
  assert.match(s, /NEXTCLOUD_ADMIN_PASSWORD=admin911!/);
  const pairs = s.match(/for pair in ([^;]+); do/)[1].match(/"([^"]+)"/g).map((x) => x.slice(1, -1).split(':'));
  assert.ok(pairs.length >= 4);
  for (const [u, p] of pairs) assert.equal(p, u + '911!');
  for (const [, u, p] of s.matchAll(/"username": "([^"]+)"[^}]*"passwordHint": "([^"]+)"/g)) assert.equal(p, u + '911!');
  assert.match(read('tests/duration-tests/scripts/nc-drop-zone-request.py'), /"NC_DROP_PASS", "teacher911!"/);
});
