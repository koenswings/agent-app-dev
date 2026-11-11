// Unit tests for nextcloud-smoke-checks.mjs — run with: node --test lib/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  isAcceptableHttpStatus,
  composeMountsIdeaFilesHook,
  resolveNextcloudAppRel,
  waitForHttp,
} from './nextcloud-smoke-checks.mjs';

const FILE_BIND = `
services:
  nextcloud-app:
    volumes:
      - ./idea-files-entrypoint.sh:/idea-files-entrypoint.sh:ro
      - ./docker-entrypoint-hooks.d/before-starting/10-idea-files.sh:/docker-entrypoint-hooks.d/before-starting/10-idea-files.sh:ro
    ports:
      - \${port}:80
`;

const DIR_BIND = `
services:
  nextcloud-app:
    volumes:
      - ./idea-files-entrypoint.sh:/idea-files-entrypoint.sh:ro
      - ./docker-entrypoint-hooks.d:/docker-entrypoint-hooks.d:ro
    ports:
      - \${port}:80
`;

function withDir(fn) {
  const root = mkdtempSync(join(tmpdir(), 'nc-smoke-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeHook(root) {
  const hookDir = join(root, 'docker-entrypoint-hooks.d', 'before-starting');
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(join(hookDir, '10-idea-files.sh'), '#!/bin/sh\n');
}

test('isAcceptableHttpStatus matches the 1.0 smoke window (200-499)', () => {
  assert.equal(isAcceptableHttpStatus(200), true);
  assert.equal(isAcceptableHttpStatus(302), true);
  assert.equal(isAcceptableHttpStatus(404), true);
  assert.equal(isAcceptableHttpStatus(499), true);
  assert.equal(isAcceptableHttpStatus(199), false);
  assert.equal(isAcceptableHttpStatus(500), false);
  assert.equal(isAcceptableHttpStatus(502), false);
});

test('composeMountsIdeaFilesHook accepts a 1.0-style file bind', () => {
  const r = composeMountsIdeaFilesHook(FILE_BIND, '/no/such/dir');
  assert.equal(r.ok, true);
  assert.equal(r.via, 'file');
});

test('composeMountsIdeaFilesHook accepts a directory bind when the hook file is present', () => {
  withDir((root) => {
    writeHook(root);
    const r = composeMountsIdeaFilesHook(DIR_BIND, root);
    assert.equal(r.ok, true);
    assert.equal(r.via, 'dir');
  });
});

test('composeMountsIdeaFilesHook rejects a directory bind when the hook file is missing', () => {
  withDir((root) => {
    const r = composeMountsIdeaFilesHook(DIR_BIND, root);
    assert.equal(r.ok, false);
    assert.equal(r.via, null);
  });
});

test('composeMountsIdeaFilesHook rejects compose with neither layout', () => {
  const r = composeMountsIdeaFilesHook('services:\n  nextcloud-app:\n    image: x\n', '/tmp');
  assert.equal(r.ok, false);
});

test('resolveNextcloudAppRel prefers SMOKE_APP_REL then nextcloud-1.0 then a single nextcloud-* tree', () => {
  withDir((root) => {
    assert.equal(resolveNextcloudAppRel(root, 'apps/nextcloud-1.4-31.0.1'), 'apps/nextcloud-1.4-31.0.1');
    mkdirSync(join(root, 'apps', 'nextcloud-1.0'), { recursive: true });
    writeFileSync(join(root, 'apps', 'nextcloud-1.0', 'compose.yaml'), 'x-app:\n  name: nextcloud\n');
    assert.equal(resolveNextcloudAppRel(root), 'apps/nextcloud-1.0');
  });
  withDir((root) => {
    mkdirSync(join(root, 'apps', 'nextcloud-1.4-31.0.1'), { recursive: true });
    writeFileSync(join(root, 'apps', 'nextcloud-1.4-31.0.1', 'compose.yaml'), 'x-app:\n  name: nextcloud\n');
    assert.equal(resolveNextcloudAppRel(root), 'apps/nextcloud-1.4-31.0.1');
  });
});

test('waitForHttp retries fetch failures then accepts 302', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) throw new Error('fetch failed');
    return { status: 302 };
  };
  const res = await waitForHttp('http://127.0.0.1:56330/', {
    timeoutMs: 1000,
    intervalMs: 1,
    fetchImpl,
  });
  assert.equal(res.status, 302);
  assert.equal(calls, 3);
});

test('waitForHttp times out with the last error when the server never answers', async () => {
  const fetchImpl = async () => {
    throw new Error('fetch failed');
  };
  await assert.rejects(
    () => waitForHttp('http://127.0.0.1:56330/', { timeoutMs: 30, intervalMs: 5, fetchImpl }),
    /HTTP not ready at http:\/\/127.0.0.1:56330\/ within 30ms \(fetch failed\)/
  );
});
