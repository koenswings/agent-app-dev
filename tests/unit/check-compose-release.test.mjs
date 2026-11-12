// check-compose --release (idea#375 U-10, idea#322, idea#446): ported from app-usage-dashboard's
// script/check-compose.mjs and applied to every service. Without --release nothing changes.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { YAML } from 'zx';
import { checkComposeRelease, checkComposeVersion, TAG_DIGEST_PIN } from '../../lib/check-compose.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK = join(ROOT, 'script/check-compose.mjs');
const D = 'a'.repeat(64), D2 = '0123456789abcdef'.repeat(4);
const svc = (name, image, extra = '') => `  ${name}:\n${image === null ? '' : `    image: ${image}\n`}${extra}    labels:\n      x-app-version: "1.5-31.0.1"\n`;
const compose = (services, xapp = '') => `x-app:\n  name: demo\n  version: "1.5-31.0.1"\n${xapp}services:\n${services}`;
const pinned = compose(svc('app', `koenswings/nextcloud:1.0-31.0.1@sha256:${D}`) + svc('db', `ghcr.io/koenswings/usage-dashboard-web:1.3@sha256:${D2}`));
const rel = (text) => checkComposeRelease(YAML.parse(text), text);
const file = (text) => { const f = join(mkdtempSync(join(tmpdir(), 'ccr-')), 'compose.yaml'); writeFileSync(f, text); return f; };
const cli = (...a) => spawnSync('node', [CHECK, ...a], { encoding: 'utf8' });

it('tag+digest pins on every service pass', () => {
  assert.deepEqual(rel(pinned), []);
  for (const ok of [`python:3.12-slim-bookworm@sha256:${D}`, `tailscale/tailscale:v1.88.3@sha256:${D}`,
    `ghcr.io/koenswings/usage-dashboard-web:1.2-ef05177@sha256:${D}`, `localhost:5000/x/y:1.0@sha256:${D}`]) assert.ok(TAG_DIGEST_PIN.test(ok), ok);
});

it('digest-only, tag-only, short digest and uppercase digest are refused (idea#322 saveName needs repo:tag@sha256)', () => {
  for (const bad of [`koenswings/nextcloud@sha256:${D}`, 'koenswings/nextcloud:1.0-31.0.1', 'mariadb:11.7',
    'koenswings/nextcloud:1.0@sha256:abc', `koenswings/nextcloud:1.0@sha256:${D.toUpperCase()}`]) {
    const errs = rel(compose(svc('app', bad)));
    assert.deepEqual(errs, [`release service app image must be <repo>:<tag>@sha256:<64-hex> (idea#322 tag+digest), got '${bad}'`], bad);
  }
});

it('no image and a build: block are refused', () => {
  assert.deepEqual(rel(compose(svc('app', null, '    build: .\n'))),
    ['release service app has no image:', 'release service app must drop the build: block']);
  assert.deepEqual(rel(compose(svc('app', `koenswings/x:1.0@sha256:${D}`, '    build:\n      context: .\n'))),
    ['release service app must drop the build: block']);
});

it('packaging placeholder anywhere in the file is refused (same patterns as the dashboard)', () => {
  for (const p of ['DIGEST_PLACEHOLDER', '<DIGEST>', 'SHORTSHA', 'replace_me_with_published_digest']) {
    const errs = rel(pinned + `# ${p}\n`);
    assert.equal(errs.length, 1, p); assert.match(errs[0], /^packaging placeholder still present/, p);
  }
});

it('x-app.backup.verify is required only when method is hook', () => {
  const hook = '  backup:\n    method: hook\n';
  assert.deepEqual(rel(compose(svc('app', `koenswings/x:1.0@sha256:${D}`), hook)),
    ['release: x-app.backup.verify (present/absent, idea#446) is required when method is hook']);
  assert.deepEqual(rel(compose(svc('app', `koenswings/x:1.0@sha256:${D}`), hook + '    verify:\n      present: [./compose.yaml]\n      absent: [keys]\n')), []);
  assert.deepEqual(rel(compose(svc('app', `koenswings/x:1.0@sha256:${D}`), '  backup:\n    method: stop\n')), []);
});

it('CLI without --release behaves as before: an unpinned image still passes, version rule unchanged', () => {
  const f = file(compose(svc('app', 'mariadb:11.7') + svc('web', null, '    build: .\n')));
  for (const args of [[f], ['--tag', '1.5-31.0.1', f], [f, '--tag', '1.5-31.0.1']]) {
    const r = cli(...args); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^ok   /);
  }
  const t = cli('--tag', '1.6', f); assert.equal(t.status, 1); assert.match(t.stderr, /x-app.version '1.5-31.0.1' != tag '1.6'/);
  assert.deepEqual(checkComposeVersion(YAML.parse(compose(svc('app', 'mariadb:11.7'))), '1.5-31.0.1'), []);
});

it('CLI --release: pinned compose ok in any argument order; unpinned fails with one FAIL line per problem', () => {
  const ok = file(pinned);
  for (const args of [['--release', '--tag', '1.5-31.0.1', ok], ['--tag', '1.5-31.0.1', '--release', ok], [ok, '--release']]) {
    const r = cli(...args); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, `ok   ${ok}\n`);
  }
  const badF = file(compose(svc('app', 'mariadb:11.7')));
  const r = cli('--release', '--tag', '1.5-31.0.1', badF);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, `FAIL ${badF}: release service app image must be <repo>:<tag>@sha256:<64-hex> (idea#322 tag+digest), got 'mariadb:11.7'\n`);
  const both = cli('--release', '--tag', '9.9', badF);
  assert.equal(both.stderr.trim().split('\n').length, 2, 'version and release problems are both reported');
});
