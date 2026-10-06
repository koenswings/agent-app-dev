/**
 * nc-drop-zone-request.py against a fake Nextcloud OCS share API (idea#166 Prefer A).
 * Reproduces the 2026-10-05 idea01 state: link share id 1 on the external mount
 * root "/Drop Zone", permissions 31, token "grade5a-drop-zone" (hyphen breaks
 * NC 31.0.1 public DAV). Expected: that share is deleted, a permissions-4 link
 * lives on "/Drop Zone/inbox" with the upload-safe token "grade5adropzone".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../duration-tests/scripts/nc-drop-zone-request.py');
const API = '/ocs/v2.php/apps/files_sharing/api/v1/shares';
const AUTH = 'Basic ' + Buffer.from('teacher:TeacherGrade5A!').toString('base64');

function fakeOcs(initial) {
  const state = { shares: initial.map((s) => ({ ...s })), nextId: 1 + Math.max(0, ...initial.map((s) => +s.id)), calls: [] };
  const ocs = (res, code, data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ocs: { meta: { statuscode: code, message: '' }, data } }));
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const form = Object.fromEntries(new URLSearchParams(body));
      state.calls.push([req.method, u.pathname, form]);
      if (req.headers.authorization !== AUTH || req.headers['ocs-apirequest'] !== 'true') return ocs(res, 997, null, 401);
      const m = u.pathname.match(new RegExp(`^${API}(?:/(\\d+))?$`));
      if (!m) return ocs(res, 404, null, 404);
      const share = m[1] && state.shares.find((s) => s.id === m[1]);
      if (req.method === 'GET' && !m[1]) {
        const p = u.searchParams.get('path');
        return ocs(res, 200, state.shares.filter((s) => !p || s.path === p));
      }
      if (req.method === 'POST' && !m[1]) {
        const s = { id: String(state.nextId++), share_type: +form.shareType, path: form.path, item_type: 'folder',
          permissions: +form.permissions, token: `rnd${state.nextId}Ab9`, label: form.label };
        state.shares.push(s);
        return ocs(res, 200, s);
      }
      if (!share) return ocs(res, 404, null, 404);
      if (req.method === 'DELETE') {
        state.shares = state.shares.filter((s) => s !== share);
        return ocs(res, 200, []);
      }
      if (req.method === 'PUT') {
        if ('token' in form) {
          // ShareAPIController::validateToken (NC31): /^[a-z0-9-]+$/i, unique
          if (!/^[a-z0-9-]+$/i.test(form.token) || state.shares.some((s) => s !== share && s.token === form.token)) {
            return ocs(res, 400, null, 400);
          }
          share.token = form.token;
        }
        if ('permissions' in form) share.permissions = +form.permissions;
        return ocs(res, 200, share);
      }
      return ocs(res, 405, null, 405);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` })));
}

function run(url, ...args) {
  return new Promise((resolve) => {
    const p = spawn('python3', [SCRIPT, url, ...args], { env: { ...process.env, PYTHONWARNINGS: 'error' } });
    let out = '';
    let err = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (err += c));
    p.on('close', (code) => resolve({ code, out, err, json: out.trim() ? JSON.parse(out.trim().split('\n').pop()) : null }));
  });
}

const MOUNT_ROOT_SHARE = { id: '1', share_type: 3, path: '/Drop Zone', item_type: 'folder', permissions: 31,
  token: 'grade5a-drop-zone', label: 'Grade 5A Drop Zone' };
const mutations = (calls) => calls.filter(([m]) => m !== 'GET');

describe('nc-drop-zone-request.py (fake OCS)', () => {
  it('replaces the mount-root share with a permissions-4 inbox link + upload-safe token, idempotently', async () => {
    const { server, state, url } = await fakeOcs([MOUNT_ROOT_SHARE]);
    try {
      const r = await run(url);
      assert.equal(r.code, 0, r.err + r.out);
      assert.equal(r.json.ok, true);
      assert.deepEqual(r.json.deleted.map((d) => [d.id, d.path, d.permissions]), [['1', '/Drop Zone', 31]]);
      assert.equal(r.json.path, '/Drop Zone/inbox');
      assert.equal(r.json.token, 'grade5adropzone');
      assert.equal(r.json.customToken, true);
      assert.equal(r.json.uploadSafeToken, true);
      assert.equal(r.json.permissions, 4);
      assert.equal(state.shares.length, 1);
      assert.deepEqual(
        [state.shares[0].path, state.shares[0].share_type, state.shares[0].permissions, state.shares[0].token],
        ['/Drop Zone/inbox', 3, 4, 'grade5adropzone'],
      );
      const post = state.calls.find(([m]) => m === 'POST');
      assert.equal(post[2].publicUpload, 'true');
      assert.equal(post[2].label, 'Grade 5A Drop Zone');
      // DELETE of the mount-root share happens before the create
      const order = mutations(state.calls).map(([m]) => m);
      assert.deepEqual(order, ['DELETE', 'POST', 'PUT']);

      const before = state.calls.length;
      const r2 = await run(url);
      assert.equal(r2.code, 0, r2.err);
      assert.equal(r2.json.created, false);
      assert.deepEqual(r2.json.deleted, []);
      assert.deepEqual(mutations(state.calls.slice(before)), [], 'second run makes no changes');
    } finally {
      server.close();
    }
  });

  it('forces permissions 4 on an existing inbox link and moves the token onto it', async () => {
    const inbox = { id: '7', share_type: 3, path: '/Drop Zone/inbox', item_type: 'folder', permissions: 31, token: 'grade5a-drop-zone' };
    const { server, state, url } = await fakeOcs([inbox]);
    try {
      const r = await run(url, 'grade5adropzone', '/Drop Zone/inbox', '/Drop Zone');
      assert.equal(r.code, 0, r.err);
      assert.equal(r.json.id, '7');
      assert.equal(state.shares[0].permissions, 4);
      assert.equal(state.shares[0].token, 'grade5adropzone');
    } finally {
      server.close();
    }
  });

  it('refuses a hyphenated custom token (NC 31.0.1 public DAV cuts it) and keeps the server token', async () => {
    const { server, state, url } = await fakeOcs([MOUNT_ROOT_SHARE]);
    try {
      const r = await run(url, 'grade5a-drop-zone');
      assert.equal(r.code, 0, r.err);
      assert.match(r.err, /WARN: custom token 'grade5a-drop-zone'/);
      assert.equal(r.json.customToken, false);
      assert.equal(r.json.uploadSafeToken, true);
      assert.notEqual(r.json.token, 'grade5a-drop-zone');
      assert.equal(state.shares.length, 1);
      assert.equal(state.shares[0].path, '/Drop Zone/inbox');
    } finally {
      server.close();
    }
  });

  it('exits 1 with JSON error when OCS rejects the credentials', async () => {
    const { server, url } = await fakeOcs([]);
    try {
      const p = spawn('python3', [SCRIPT, url], { env: { ...process.env, NC_DROP_PASS: 'wrong' } });
      let out = '';
      p.stdout.on('data', (c) => (out += c));
      const code = await new Promise((resolve) => p.on('close', resolve));
      assert.equal(code, 1);
      assert.equal(JSON.parse(out).ok, false);
    } finally {
      server.close();
    }
  });
});
