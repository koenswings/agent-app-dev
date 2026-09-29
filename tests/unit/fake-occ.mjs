#!/usr/bin/env node
/**
 * Fake Nextcloud `occ` for idea-files hook unit tests.
 * State file: $FAKE_OCC_STATE (JSON).
 * Never deletes or touches any real files under IDEA_FILES_ROOT.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const statePath = process.env.FAKE_OCC_STATE;
if (!statePath) {
  console.error('FAKE_OCC_STATE required');
  process.exit(2);
}

function load() {
  if (!existsSync(statePath)) {
    return {
      ready: true,
      filesExternalEnabled: false,
      storages: [],
      nextId: 1,
      calls: [],
    };
  }
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

function save(s) {
  writeFileSync(statePath, JSON.stringify(s, null, 2) + '\n');
}

const args = process.argv.slice(2);
const state = load();
state.calls.push(args);
save(state);

const failClosed = process.env.FAKE_OCC_NOT_READY === '1';

if (args[0] === 'status') {
  if (failClosed || state.ready === false) process.exit(1);
  process.exit(0);
}

if (args[0] === 'app:enable' && args[1] === 'files_external') {
  state.filesExternalEnabled = true;
  save(state);
  process.exit(0);
}

if (args[0] === 'files_external:list') {
  if (!state.filesExternalEnabled && process.env.FAKE_OCC_REQUIRE_ENABLE === '1') {
    process.exit(1);
  }
  const outJson = args.includes('--output=json');
  if (outJson) {
    const mapped = state.storages.map(s => ({
      mount_id: s.id,
      mount_point: '/' + s.mountPoint,
      storage: '\\OC\\Files\\Storage\\Local',
      authentication_type: 'null::null',
      configuration: { datadir: s.datadir },
      options: { ...(s.options || {}) },
    }));
    process.stdout.write(JSON.stringify(mapped));
  }
  process.exit(0);
}

if (args[0] === 'files_external:create') {
  // create <mount_point> local null::null -c datadir=... [--output=json]
  const mountPoint = args[1];
  let datadir = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' && args[i + 1]?.startsWith('datadir=')) {
      datadir = args[i + 1].slice('datadir='.length);
    } else if (args[i]?.startsWith('datadir=')) {
      datadir = args[i].slice('datadir='.length);
    }
  }
  // Idempotent guard: refuse duplicate datadir (real occ would create a second; hook should not call)
  if (state.storages.some(s => s.datadir === datadir)) {
    console.error('duplicate datadir');
    process.exit(1);
  }
  const id = state.nextId++;
  state.storages.push({
    id,
    mountPoint,
    datadir,
    options: {},
  });
  save(state);
  if (args.includes('--output=json')) process.stdout.write(String(id));
  process.exit(0);
}

if (args[0] === 'files_external:option') {
  // option <id> <key> <value>  OR  option <id> set <key> <value>
  const id = Number(args[1]);
  let key, val;
  if (args[2] === 'set') {
    key = args[3];
    val = args[4];
  } else {
    key = args[2];
    val = args[3];
  }
  const s = state.storages.find(x => x.id === id);
  if (!s) process.exit(1);
  s.options = s.options || {};
  // Coerce known numeric-ish
  if (val === '1' || val === 'true') s.options[key] = key === 'idea_files' ? 1 : 1;
  else s.options[key] = val;
  save(state);
  process.exit(0);
}

if (args[0] === 'files_external:delete') {
  // delete [-y|--yes] <id>
  const idArg = args.find(a => /^\d+$/.test(a));
  const id = Number(idArg);
  const before = state.storages.length;
  state.storages = state.storages.filter(s => s.id !== id);
  // Record that we only removed config — never files. Tests assert disk untouched.
  state.lastDelete = { id, removed: before !== state.storages.length };
  save(state);
  process.exit(state.lastDelete.removed ? 0 : 1);
}

console.error('fake-occ: unknown command', args.join(' '));
process.exit(2);
