/**
 * preflight-fixture-check.sh (idea#166 cover-all-6821ae1-kc3 FAIL@22): read-only
 * duration fixture preflight. Runs the real script against a fake `docker` and
 * `curl` (state JSON) and a real throwaway Kolibri-shaped SQLite DB.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(root, 'tests/duration-tests/scripts/preflight-fixture-check.sh');

const NC = 'nextcloud-grade5a-001-nextcloud-app-1';
const KOL = 'kolibri-grade5a-001-kolibri-1';
const KIWIX = 'kiwix-ideaa-001-kiwix-1';
const MNT = '/mnt/idea-files/grade-5a-files-durati';
const VIDEO = '4a1a1b923f6d59eba94c3f91f0011dd5';
const EXERCISE = '94a47ec7f30d5cd193f8ad08c42b6c2a';
const BOOK = 'duration_wikipedia_en_grade5a_stub_2026-10';
const LEARNERS = ['student01', 'student02', 'student03'];
const LEARNER_HOMES = LEARNERS.map((u) => `/var/www/html/data/${u}/files`);
const DAV = (u) => `http://127.0.0.1:61820/remote.php/dav/files/${u}/`;
const WARM = join(root, 'tests/duration-tests/scripts/warm-nextcloud-learners.sh');

const FAKE_DOCKER = `#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const s = JSON.parse(readFileSync(process.env.FAKE_STATE, 'utf8'));
const log = (x) => appendFileSync(process.env.FAKE_LOG, JSON.stringify(x) + '\\n');
let a = process.argv.slice(2);
log(a);
const out = (t, code = 0) => { if (t !== undefined && t !== null) process.stdout.write(typeof t === 'string' ? t + '\\n' : JSON.stringify(t) + '\\n'); process.exit(code); };
if (a[0] === 'ps') out(s.containers.join('\\n'));
if (a[0] === 'port') { const v = (s.ports || {})[a[1] + '/' + a[2]]; v ? out(v) : process.exit(1); }
if (a[0] === 'exec') {
  a = a.slice(1);
  if (a[0] === '-u') a = a.slice(2);
  const c = a[0]; a = a.slice(1);
  if (!s.containers.includes(c)) process.exit(1);
  if (a[0] === 'php' && a[1] === 'occ') {
    const key = a.slice(2).join(' ');
    if (!(key in s.occ)) process.exit(1);
    out(s.occ[key]);
  }
  if (a[0] === 'test') {
    const [flag, p] = [a[1], a[2]];
    const set = flag === '-d' ? s.dirs : flag === '-f' ? s.files : s.writable;
    process.exit((set || []).includes(p) ? 0 : 1);
  }
  if (a[0] === 'python') {
    const r = spawnSync('python3', a.slice(1), { env: { ...process.env, KOLIBRI_HOME: s.kolibriHome }, encoding: 'utf8' });
    process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status ?? 1);
  }
  if (a[0] === 'printenv') out((s.env || {})[a[1]], (s.env || {})[a[1]] ? 0 : 1);
  if (a[0] === 'ls') out((s.ls || {})[c + ':' + a[1]] || '', 0);
}
process.exit(1);
`;

const FAKE_CURL = `#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(process.env.FAKE_STATE, 'utf8'));
const a = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, JSON.stringify(['curl', ...a]) + '\\n');
const url = a[a.length - 1];
const r = (s.http || {})[url] || { code: '000', body: '' };
const wIdx = a.indexOf('-w');
if (wIdx >= 0) process.stdout.write(String(r.code));
else process.stdout.write(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
`;

function kolibriDb(dir, { lesson = true, learners = ['learner01', 'learner02', 'learner03'], videoAvailable = true } = {}) {
  const py = `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1] + "/db.sqlite3")
c.executescript("""
create table kolibriauth_collection(id text, name text, kind text, parent_id text);
create table kolibriauth_facilityuser(id text, username text, facility_id text);
create table kolibriauth_membership(id text, collection_id text, user_id text);
create table kolibriauth_role(id text, kind text, collection_id text, user_id text);
create table lessons_lesson(id text, title text, is_active bool, collection_id text);
create table content_contentnode(id text, kind text, available bool);
insert into kolibriauth_collection values('f1','Duration Tests Facility','facility',null);
insert into kolibriauth_collection values('c1','Grade 5A','classroom','f1');
insert into kolibriauth_facilityuser values('u0','teacher','f1');
insert into kolibriauth_role values('r0','coach','c1','u0');
""")
for i, u in enumerate(sys.argv[2].split(",") if sys.argv[2] else []):
    c.execute("insert into kolibriauth_facilityuser values(?,?, 'f1')", ("u%d" % (i + 1), u))
    c.execute("insert into kolibriauth_membership values(?, 'c1', ?)", ("m%d" % i, "u%d" % (i + 1)))
if sys.argv[3] == "1":
    c.execute("insert into lessons_lesson values('l1','Grade 5A Duration Lesson',1,'c1')")
c.execute("insert into content_contentnode values(?, 'video', ?)", ("${VIDEO}", int(sys.argv[4])))
c.execute("insert into content_contentnode values(?, 'exercise', 1)", ("${EXERCISE}",))
c.commit()
`;
  execFileSync('python3', ['-c', py, dir, learners.join(','), lesson ? '1' : '0', videoAvailable ? '1' : '0']);
}

const OCS_SHARES = (tokenShare = true) => ({
  ocs: { meta: { statuscode: 200 }, data: tokenShare ? [{ token: 'gradefoo', share_type: 0 }, { token: 'grade5adropzone', share_type: 3, permissions: 4, path: '/Grade 5A Files/Drop Zone/inbox' }] : [] },
});

function goodState(dir) {
  return {
    containers: [NC, KOL, KIWIX],
    ports: { [`${NC}/80/tcp`]: '0.0.0.0:61820', [`${KIWIX}/8080/tcp`]: '0.0.0.0:18380' },
    occ: {
      'status --output=json': { installed: true, versionstring: '31.0.1' },
      'user:list --output=json': { teacher: 'teacher', student01: 'student01', student02: 'student02', student03: 'student03' },
      'user:info teacher --output=json': { enabled: true },
      'user:info student01 --output=json': { enabled: true },
      'user:info student02 --output=json': { enabled: true },
      'user:info student03 --output=json': { enabled: true },
      'config:system:get datadirectory': '/var/www/html/data',
      'group:list --output=json': { admin: ['teacher'], 'Grade 5A': ['teacher', 'student01', 'student02', 'student03'] },
      'app:list --output=json': { enabled: { files_external: '1', files_sharing: '1', text: '1', viewer: '1' }, disabled: { firstrunwizard: '4' } },
      'files_external:list --output=json': [
        { mount_id: 1, mount_point: '/Grade 5A Files', configuration: { datadir: MNT }, options: { enable_sharing: true }, applicable_users: [], applicable_groups: ['Grade 5A'] },
        { mount_id: 3, mount_point: '/School Files', configuration: { datadir: '/mnt/idea-files/school-files-b' }, options: { enable_sharing: false }, applicable_users: [], applicable_groups: [] },
      ],
    },
    dirs: [MNT, `${MNT}/Class Materials`, `${MNT}/Drop Zone/inbox`, ...LEARNER_HOMES],
    files: [`${MNT}/Collab/Grade5A-collab-notes.md`],
    writable: [`${MNT}/Drop Zone/inbox`, `${MNT}/Collab/Grade5A-collab-notes.md`],
    kolibriHome: dir,
    env: { KOLIBRI_HTTP_PORT: '18080' },
    ls: { [`${KIWIX}:/data`]: `${BOOK}.zim` },
    http: {
      'http://127.0.0.1:61820/status.php': { code: 200, body: { installed: true } },
      'http://127.0.0.1:61820/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json': { code: 200, body: OCS_SHARES() },
      'http://127.0.0.1:61820/s/grade5adropzone': { code: 200, body: 'File drop' },
      'http://127.0.0.1:18080/': { code: 302 },
      'http://127.0.0.1:18380/': { code: 200 },
      [`http://127.0.0.1:18380/content/${BOOK}/Main_Page`]: { code: 200 },
      [`http://127.0.0.1:18380/search?books.name=${BOOK}&pattern=fraction`]: { code: 200, body: '<div>Results <b>1-4</b> of <b>4</b></div><a href="/content/x/Fraction">Fraction</a>' },
    },
  };
}

function run(state, args = [], mkdb = {}, script = SCRIPT) {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-'));
  kolibriDb(dir, mkdb);
  state.kolibriHome = dir;
  const statePath = join(dir, 'state.json');
  const logPath = join(dir, 'calls.log');
  writeFileSync(statePath, JSON.stringify(state));
  writeFileSync(logPath, '');
  for (const [n, body] of [['docker', FAKE_DOCKER], ['curl', FAKE_CURL]]) {
    writeFileSync(join(dir, n + '.mjs'), body);
    chmodSync(join(dir, n + '.mjs'), 0o755);
  }
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DOCKER: join(dir, 'docker.mjs'), CURL: join(dir, 'curl.mjs'), FAKE_STATE: statePath, FAKE_LOG: logPath },
  });
  const calls = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { code: r.status, out: r.stdout + r.stderr, calls };
}

const withState = (fn) => { const s = goodState(''); fn(s); return s; };

test('full kit fixture → PREFLIGHT PASS, exit 0', () => {
  const r = run(goodState(''));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PREFLIGHT PASS/);
  assert.match(r.out, /PASS\s+nc\.group\s+"Grade 5A" = teacher student01 student02 student03/);
  assert.match(r.out, /PASS\s+nc\.file_request\s+\/s\/grade5adropzone link, upload-only \(4\)/);
  assert.match(r.out, /PASS\s+kol\.lesson/);
  assert.match(r.out, /PASS\s+kiwix\.search\s+"fraction" → Results 1-4 of 4/);
  // Undocked Disk B mount is skipped, not failed.
  assert.match(r.out, /WARN\s+nc\.mount\s+id=3 \/School Files/);
});

test('kc3 WD state (teacher only, no group, no file request) → loud FAIL, exit 1', () => {
  const s = withState((s) => {
    s.occ['user:list --output=json'] = { teacher: 'teacher' };
    s.occ['group:list --output=json'] = { admin: ['teacher'] };
    s.http['http://127.0.0.1:61820/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json'].body = OCS_SHARES(false);
    s.http['http://127.0.0.1:61820/s/grade5adropzone'] = { code: 404, body: '' };
  });
  const r = run(s);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL\s+nc\.group\s+group "Grade 5A" missing/);
  for (const u of ['student01', 'student02', 'student03']) assert.match(r.out, new RegExp(`FAIL\\s+nc\\.user\\s+${u} missing`));
  assert.match(r.out, /FAIL\s+nc\.file_request\s+no share with token grade5adropzone/);
  assert.match(r.out, /PREFLIGHT FAIL — DO NOT LAUNCH THE WALK/);
});

test('this morning: enable_sharing=false + firstrunwizard on + read-only Collab → FAIL', () => {
  const s = withState((s) => {
    s.occ['files_external:list --output=json'][0].options.enable_sharing = false;
    s.occ['app:list --output=json'].enabled.firstrunwizard = '4';
    s.writable = [`${MNT}/Drop Zone/inbox`];
  });
  const r = run(s);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL\s+nc\.mount\.sharing\s+id=1 \/Grade 5A Files enable_sharing=false/);
  assert.match(r.out, /FAIL\s+nc\.firstrunwizard/);
  assert.match(r.out, /FAIL\s+nc\.collab\s+Collab\/Grade5A-collab-notes\.md not writable/);
});

test('applicable: All users passes by default, fails with --strict-applicable', () => {
  const s = withState((s) => { s.occ['files_external:list --output=json'][0].applicable_groups = []; });
  assert.equal(run(s).code, 0);
  const r = run(s, ['--strict-applicable']);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL\s+nc\.mount\.applicable/);
});

test('teacher OCS 401 → WARN + public link fallback', () => {
  const s = withState((s) => {
    s.http['http://127.0.0.1:61820/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json'].body = { ocs: { meta: { statuscode: 997 } } };
  });
  const r = run(s);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /WARN\s+nc\.file_request\s+teacher OCS read refused/);
  assert.match(r.out, /PASS\s+nc\.file_request\s+http:\/\/127\.0\.0\.1:61820\/s\/grade5adropzone → 200/);
});

test('Kolibri: missing lesson, learner03 and unavailable video → FAIL', () => {
  const r = run(goodState(''), ['--apps', 'kolibri'], { lesson: false, learners: ['learner01', 'learner02'], videoAvailable: false });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL\s+kol\.users\s+missing facility users: learner03/);
  assert.match(r.out, /FAIL\s+kol\.lesson\s+"Grade 5A Duration Lesson" missing/);
  assert.match(r.out, /FAIL\s+kol\.content\s+open_video node .* NOT available/);
  assert.doesNotMatch(r.out, /== Nextcloud/);
});

test('explicit --apps with no container → FAIL; auto with nothing → FAIL', () => {
  const s = withState((s) => { s.containers = [NC]; });
  const r = run(s, ['--apps', 'nextcloud,kiwix']);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL\s+kiwix\.container/);
  const s2 = withState((s) => { s.containers = []; });
  const r2 = run(s2);
  assert.equal(r2.code, 1);
  assert.match(r2.out, /FAIL\s+preflight\s+no duration App container/);
});

test('auto mode only checks Apps present on this host (idea03: NC + Kiwix)', () => {
  const s = withState((s) => { s.containers = [NC, KIWIX]; });
  const r = run(s);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /== Kolibri/);
});

test('read-only: only list/info/get occ verbs, docker exec/ps/port, HTTP GET', () => {
  const r = run(goodState(''));
  const OCC_RO = new Set(['config:system:get', 'status', 'user:list', 'user:info', 'group:list', 'app:list', 'config:app:get', 'files_external:list']);
  for (const c of r.calls) {
    if (c[0] === 'curl') {
      assert.ok(!c.some((x) => /^-(X|d|T|F)$|^--(data|request|upload-file|form)/.test(x)), `curl write flag: ${c.join(' ')}`);
      continue;
    }
    assert.ok(['ps', 'port', 'exec'].includes(c[0]), `docker verb ${c[0]}`);
    const i = c.indexOf('occ');
    if (i >= 0) assert.ok(OCC_RO.has(c[i + 1]), `occ write verb: ${c[i + 1]}`);
    if (c[0] === 'exec') {
      const cmd = c.slice(c[1] === '-u' ? 4 : 2);
      assert.ok(['php', 'test', 'python', 'printenv', 'ls'].includes(cmd[0]), `exec cmd ${cmd[0]}`);
      if (cmd[0] === 'python') assert.match(cmd[2], /query_only=ON/);
    }
  }
});

// kc4 (2026-11-16) FAIL@27 open_nextcloud_as_learner: learners exist but never
// logged in, so student01's first login built the home and the click timed out.
const kc4 = () => withState((s) => {
  s.dirs = s.dirs.filter((d) => !LEARNER_HOMES.includes(d));
  for (const u of LEARNERS) s.occ[`user:info ${u} --output=json`] = { enabled: true, last_seen: '1970-01-01T00:00:00+00:00' };
});

test('kc4 state (learners present, never logged in) → FAIL with warm-up hint; default stays read-only', () => {
  const r = run(kc4());
  assert.equal(r.code, 1, r.out);
  for (const u of LEARNERS) {
    assert.match(r.out, new RegExp(`FAIL\\s+nc\\.learner_home\\s+${u} never logged in / home not initialized`));
  }
  assert.match(r.out, /run warm-nextcloud-learners\.sh \(WebDAV PROPFIND warm-up\) or preflight --warm-learners/);
  assert.ok(!r.calls.some((c) => c[0] === 'curl' && c.includes('PROPFIND')), 'no PROPFIND without --warm-learners');
  assert.match(run(goodState('')).out, /PASS\s+nc\.learner_home\s+student03 home initialized/);
});

test('warm-nextcloud-learners.sh: PROPFIND Depth 0 as <u>:<u>911! per learner, 207 → exit 0', () => {
  const s = withState((s) => { for (const u of LEARNERS) s.http[DAV(u)] = { code: 207 }; });
  const r = run(s, ['--nc-container', NC], {}, WARM);
  assert.equal(r.code, 0, r.out);
  const props = r.calls.filter((c) => c[0] === 'curl');
  assert.equal(props.length, 3);
  for (const [i, u] of LEARNERS.entries()) {
    const c = props[i];
    assert.deepEqual(c.slice(c.indexOf('-u'), c.indexOf('-u') + 2), ['-u', `${u}:${u}911!`]);
    assert.ok(c.includes('PROPFIND') && c.includes('Depth: 0') && c[c.length - 1] === DAV(u), c.join(' '));
  }
  const s2 = withState((s) => { s.http[DAV('student01')] = { code: 207 }; s.http[DAV('student02')] = { code: 401 }; s.http[DAV('student03')] = { code: 207 }; });
  const r2 = run(s2, ['--nc-url', 'http://127.0.0.1:61820'], {}, WARM);
  assert.equal(r2.code, 1);
  assert.match(r2.out, /FAIL\s+warm\.learner\s+student02 PROPFIND → 401/);
});

test('preflight --warm-learners runs the warm-up first, then the read-only checks', () => {
  const s = kc4();
  for (const u of LEARNERS) s.http[DAV(u)] = { code: 207 };
  const r = run(s, ['--warm-learners', '--apps', 'nextcloud']);
  assert.match(r.out, /== warm-up \(NOT read-only, --warm-learners\)/);
  assert.match(r.out, /PASS\s+warm\.learner\s+student01 PROPFIND/);
  assert.equal(r.calls.filter((c) => c[0] === 'curl' && c.includes('PROPFIND')).length, 3);
  // The fake does not create homes, so the read-only check still reports them.
  assert.match(r.out, /FAIL\s+nc\.learner_home/);
});

test('shellcheck clean (when available)', { skip: spawnSync('shellcheck', ['--version']).status !== 0 }, () => {
  const r = spawnSync('shellcheck', [SCRIPT, WARM], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
});
