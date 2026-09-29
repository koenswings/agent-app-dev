/**
 * Unit tests for 10-idea-files.sh against fake-occ.mjs.
 * Proves: create missing; keep admin; delete only own missing folders;
 * idempotent second run; skip when root missing; never delete files on disk.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync,
  readFileSync, existsSync, readdirSync, cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = join(__dirname, '../fixtures/idea-files/docker-entrypoint-hooks.d/before-starting/10-idea-files.sh');
const FAKE_OCC = join(__dirname, 'fake-occ.mjs');

let root;
let filesRoot;
let statePath;

function loadState() {
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

function saveState(s) {
  writeFileSync(statePath, JSON.stringify(s, null, 2) + '\n');
}

function runHook(extraEnv = {}) {
  const r = spawnSync('sh', [HOOK], {
    env: {
      ...process.env,
      IDEA_FILES_ROOT: filesRoot,
      IDEA_FILES_JSON: '.idea-files.json',
      OCC: FAKE_OCC,
      FAKE_OCC_STATE: statePath,
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  return r;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'idea-files-hook-'));
  filesRoot = join(root, 'mnt-idea-files');
  statePath = join(root, 'occ-state.json');
  mkdirSync(filesRoot);
  saveState({
    ready: true,
    filesExternalEnabled: false,
    storages: [],
    nextId: 1,
    calls: [],
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('10-idea-files.sh reconcile', () => {
  it('skips successfully when /mnt/idea-files is absent', () => {
    rmSync(filesRoot, { recursive: true, force: true });
    const r = runHook();
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /absent/);
  });

  it('fail-closed when occ is not ready (nothing deleted)', () => {
    const folder = join(filesRoot, 'school-files-3f9a2c');
    mkdirSync(folder);
    writeFileSync(join(folder, 'keep-me.txt'), 'safe');
    saveState({
      ready: false,
      filesExternalEnabled: true,
      storages: [{ id: 9, mountPoint: 'School Files', datadir: folder, options: { idea_files: 1 } }],
      nextId: 10,
      calls: [],
    });
    const r = runHook({ FAKE_OCC_NOT_READY: '1' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /occ not ready/);
    assert.equal(loadState().storages.length, 1);
    assert.ok(existsSync(join(folder, 'keep-me.txt')));
  });

  it('creates missing storage with display name from .idea-files.json and marks idea_files', () => {
    const folder = join(filesRoot, 'school-files-3f9a2c');
    mkdirSync(folder);
    writeFileSync(join(folder, 'lesson.pdf'), 'pdf');
    writeFileSync(join(filesRoot, '.idea-files.json'), JSON.stringify({
      'school-files-3f9a2c': 'School Files',
    }));
    const r = runHook();
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const st = loadState();
    assert.equal(st.filesExternalEnabled, true);
    assert.equal(st.storages.length, 1);
    const s = st.storages[0];
    assert.equal(s.mountPoint, 'School Files');
    assert.equal(s.datadir, folder);
    assert.equal(s.options.idea_files, 1);
    assert.equal(s.options.filesystem_check_changes, 1);
    assert.ok(existsSync(join(folder, 'lesson.pdf')), 'must never delete files on disk');
  });

  it('keeps admin storages even when datadir is under /mnt/idea-files', () => {
    const folder = join(filesRoot, 'school-files-3f9a2c');
    mkdirSync(folder);
    // Admin storage: same datadir, NO idea_files marker
    saveState({
      ready: true,
      filesExternalEnabled: true,
      storages: [{
        id: 5,
        mountPoint: 'Admin Hand Made',
        datadir: folder,
        options: { filesystem_check_changes: 0 },
      }],
      nextId: 6,
      calls: [],
    });
    // Remove the folder so a naive hook might delete — but admin must stay
    rmSync(folder, { recursive: true, force: true });
    const r = runHook();
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const st = loadState();
    assert.equal(st.storages.length, 1);
    assert.equal(st.storages[0].id, 5);
    assert.equal(st.storages[0].mountPoint, 'Admin Hand Made');
  });

  it('deletes only own storages whose folder is gone (config only)', () => {
    const gone = join(filesRoot, 'gone-files-dead01');
    const stay = join(filesRoot, 'stay-files-alive1');
    mkdirSync(stay);
    writeFileSync(join(stay, 'note.txt'), 'keep');
    // gone folder intentionally absent
    saveState({
      ready: true,
      filesExternalEnabled: true,
      storages: [
        { id: 1, mountPoint: 'Gone', datadir: gone, options: { idea_files: 1 } },
        { id: 2, mountPoint: 'Stay', datadir: stay, options: { idea_files: 1 } },
        { id: 3, mountPoint: 'Admin', datadir: join(filesRoot, 'admin-missing'), options: {} },
      ],
      nextId: 4,
      calls: [],
    });
    const r = runHook();
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const st = loadState();
    const ids = st.storages.map(s => s.id).sort();
    assert.deepEqual(ids, [2, 3]); // own gone deleted; own stay kept; admin kept
    assert.ok(existsSync(join(stay, 'note.txt')), 'files on disk untouched');
  });

  it('second run is idempotent (no duplicate creates)', () => {
    const folder = join(filesRoot, 'school-files-3f9a2c');
    mkdirSync(folder);
    writeFileSync(join(filesRoot, '.idea-files.json'), JSON.stringify({
      'school-files-3f9a2c': 'School Files',
    }));
    const r1 = runHook();
    assert.equal(r1.status, 0, r1.stderr + r1.stdout);
    const r2 = runHook();
    assert.equal(r2.status, 0, r2.stderr + r2.stdout);
    const st = loadState();
    assert.equal(st.storages.length, 1);
    const creates = st.calls.filter(c => c[0] === 'files_external:create');
    assert.equal(creates.length, 1);
  });

  it('uses folder basename when display name JSON is missing', () => {
    const folder = join(filesRoot, 'school-files-3f9a2c');
    mkdirSync(folder);
    const r = runHook();
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(loadState().storages[0].mountPoint, 'school-files-3f9a2c');
  });

  it('ignores .idea-files.json when iterating folders', () => {
    writeFileSync(join(filesRoot, '.idea-files.json'), '{"x":"y"}');
    // no directories
    const r = runHook();
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(loadState().storages.length, 0);
  });
});
