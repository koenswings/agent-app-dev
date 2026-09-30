/**
 * Structure checks for duration-tests App fixtures (idea#166).
 * No Pi / Engine / Docker required — asserts versioned trees have the
 * files Axle / Pixel walkers need to reference.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../duration-tests');
const FIX = join(ROOT, 'fixtures');

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function mustExist(abs, label) {
  assert.ok(existsSync(abs), `missing ${label}: ${abs}`);
}

describe('duration-tests fixtures (idea#166)', () => {
  it('pack root docs exist', () => {
    mustExist(join(ROOT, 'README.md'), 'README');
    mustExist(join(ROOT, 'walker-ref.yaml'), 'walker-ref.yaml');
  });

  it('kolibri App Disk tree has META + apps + instance + content catalogue', () => {
    const k = join(FIX, 'kolibri');
    mustExist(join(k, 'META.yaml'), 'kolibri META');
    mustExist(join(k, 'apps/kolibri-1.0/compose.yaml'), 'kolibri app compose');
    mustExist(join(k, 'instances/kolibri-grade5a-001/compose.yaml'), 'kolibri instance compose');
    mustExist(join(k, 'instances/kolibri-grade5a-001/.env'), 'kolibri instance .env');
    mustExist(join(k, 'content/CONTENT.yaml'), 'kolibri CONTENT.yaml');
    mustExist(join(k, 'content/seed-notes.md'), 'kolibri seed-notes');

    const meta = readFileSync(join(k, 'META.yaml'), 'utf8');
    assert.match(meta, /diskId:\s*duration-kolibri-grade5a-001/);

    const content = readFileSync(join(k, 'content/CONTENT.yaml'), 'utf8');
    assert.match(content, /logicalId:\s*class-grade5a/);
    assert.match(content, /logicalId:\s*video-grade5a-01/);
    assert.match(content, /logicalId:\s*exercise-grade5a-01/);
    assert.match(content, /walkerAction:\s*Open video/);
    assert.match(content, /walkerAction:\s*Open exercise/);

    const compose = readFileSync(join(k, 'apps/kolibri-1.0/compose.yaml'), 'utf8');
    assert.match(compose, /name:\s*kolibri/);
    assert.match(compose, /koenswings\/kolibri:1\.0-0\.15\.5-dev/);
    assert.doesNotMatch(compose, /password\s*[:=]\s*['"]?(?!\$\{)[^'"\s]+/i);
  });

  it('nextcloud App+Files Disk tree has META, FILES, filesMount, preload folders', () => {
    const n = join(FIX, 'nextcloud');
    mustExist(join(n, 'META.yaml'), 'nextcloud META');
    mustExist(join(n, 'FILES.yaml'), 'nextcloud FILES');
    mustExist(join(n, 'CONTENT.yaml'), 'nextcloud CONTENT');
    mustExist(join(n, 'apps/nextcloud-1.0/compose.yaml'), 'nextcloud app compose');
    mustExist(join(n, 'apps/nextcloud-1.0/idea-files-entrypoint.sh'), 'idea-files entrypoint');
    mustExist(
      join(n, 'apps/nextcloud-1.0/docker-entrypoint-hooks.d/before-starting/10-idea-files.sh'),
      'idea-files hook',
    );
    mustExist(join(n, 'instances/nextcloud-grade5a-001/compose.yaml'), 'nextcloud instance compose');
    mustExist(join(n, 'instances/nextcloud-grade5a-001/.env'), 'nextcloud instance .env');

    mustExist(join(n, 'files/Class Materials/welcome.txt'), 'Class Materials');
    mustExist(join(n, 'files/Drop Zone/README.md'), 'Drop Zone');
    mustExist(join(n, 'files/Collab/Grade5A-collab-notes.md'), 'collab stub');

    const meta = readFileSync(join(n, 'META.yaml'), 'utf8');
    assert.match(meta, /diskId:\s*duration-nextcloud-grade5a-001/);

    const compose = readFileSync(join(n, 'apps/nextcloud-1.0/compose.yaml'), 'utf8');
    assert.match(compose, /filesMount:/);
    assert.match(compose, /koenswings\/nextcloud:1\.0-31\.0\.1/);
    // Collabora deferred — placeholder collab doc only (no code service image)
    assert.doesNotMatch(compose, /image:\s*koenswings\/nextcloud-code/);
    assert.doesNotMatch(compose, /^\s*code:\s*$/m);

    const content = readFileSync(join(n, 'CONTENT.yaml'), 'utf8');
    assert.match(content, /name:\s*Grade 5A/);
    assert.match(content, /folder-drop-grade5a/);
    assert.match(content, /collab-grade5a-01/);
    assert.match(content, /placeholder-doc/);
  });

  it('kiwix is explicitly deferred (Phase 3 / optional)', () => {
    const readme = readFileSync(join(FIX, 'kiwix/README.md'), 'utf8');
    assert.match(readme, /Phase 3|optional|omit from Phase 1/i);
    // No App Disk tree shipped yet
    assert.equal(existsSync(join(FIX, 'kiwix/META.yaml')), false);
  });

  it('walker-ref.yaml points at stable diskIds and notes #159 vs browser watchers', () => {
    const ref = read('walker-ref.yaml');
    assert.match(ref, /duration-kolibri-grade5a-001/);
    assert.match(ref, /duration-nextcloud-grade5a-001/);
    assert.match(ref, /video-grade5a-01/);
    assert.match(ref, /folder-drop-grade5a/);
    assert.match(ref, /idea#159/);
    assert.match(ref, /kiwix:[\s\S]*included:\s*false/);
  });

  it('README documents paths and Design Review gates', () => {
    const md = read('README.md');
    assert.match(md, /duration-kolibri-grade5a-001/);
    assert.match(md, /duration-nextcloud-grade5a-001/);
    assert.match(md, /Versioned App fixtures/);
    assert.match(md, /idea#159/);
    assert.match(md, /Class-instance selectors/);
  });

  it('fixture trees contain only expected top-level packs', () => {
    const packs = readdirSync(FIX).filter((n) => statSync(join(FIX, n)).isDirectory()).sort();
    assert.deepEqual(packs, ['kiwix', 'kolibri', 'nextcloud']);
  });
});
