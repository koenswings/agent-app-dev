/**
 * Shared checks for the app-nextcloud Files Disk smoke (idea#137 / idea#431).
 * Used by tests/app-nextcloud/smoke.mjs and covered by lib/nextcloud-smoke-checks.test.mjs.
 * No Docker required.
 */
import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

/** Default HTTP poll window. Matches the Nextcloud compose healthcheck start_period of 300s. */
export const DEFAULT_HTTP_TIMEOUT_MS = 300_000;

/** Same window the original 1.0 smoke accepted (includes 200 and 302). */
export function isAcceptableHttpStatus(status) {
  return Number.isInteger(status) && status >= 200 && status < 500;
}

/**
 * True when compose mounts the Files Disk hook (10-idea-files.sh).
 *
 * Two layouts:
 * - file bind: compose mentions `10-idea-files.sh` (1.0 fixture)
 * - directory bind: compose mounts `./docker-entrypoint-hooks.d` onto
 *   `/docker-entrypoint-hooks.d`, and that hook file exists next to compose
 *   (1.4+ App bundle)
 */
export function composeMountsIdeaFilesHook(composeText, composeDir) {
  const text = String(composeText || '');
  if (/10-idea-files\.sh/.test(text)) {
    return { ok: true, via: 'file' };
  }
  const dirMount = /\.\/docker-entrypoint-hooks\.d:\/docker-entrypoint-hooks\.d/.test(text);
  const hookFile = resolve(composeDir, 'docker-entrypoint-hooks.d/before-starting/10-idea-files.sh');
  if (dirMount && existsSync(hookFile)) {
    return { ok: true, via: 'dir' };
  }
  return { ok: false, via: null };
}

/**
 * Locate the Nextcloud app folder under a fixture/bundle disk.
 * Prefers SMOKE_APP_REL, then apps/nextcloud-1.0, then a single apps/nextcloud-* tree.
 */
export function resolveNextcloudAppRel(fixturePath, envRel) {
  if (envRel) return String(envRel).replace(/\/+$/, '');
  const preferred = 'apps/nextcloud-1.0';
  if (existsSync(resolve(fixturePath, preferred, 'compose.yaml'))) return preferred;
  const appsDir = resolve(fixturePath, 'apps');
  if (!existsSync(appsDir)) {
    throw new Error(`cannot resolve nextcloud app folder: ${appsDir} is missing`);
  }
  const matches = readdirSync(appsDir)
    .filter((name) => name.startsWith('nextcloud-'))
    .filter((name) => existsSync(resolve(appsDir, name, 'compose.yaml')))
    .sort();
  if (matches.length === 1) return `apps/${matches[0]}`;
  throw new Error(
    `cannot resolve nextcloud app folder under ${appsDir} (found: ${matches.join(', ') || 'none'})`
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll GET url until an acceptable status arrives or timeoutMs elapses.
 * `fetch failed` / ECONNREFUSED is retried: docker-proxy can accept TCP before
 * Apache is listening, and occ can succeed during before-starting hooks
 * before the image entrypoint execs apache2-foreground.
 */
export async function waitForHttp(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? 2_000;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const acceptable = opts.acceptable ?? isAcceptableHttpStatus;
  const deadline = Date.now() + timeoutMs;
  let last = 'no attempt';
  while (Date.now() <= deadline) {
    try {
      const res = await fetchImpl(url, { redirect: 'manual' });
      if (acceptable(res.status)) return res;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e && e.message ? e.message : String(e);
    }
    const remain = deadline - Date.now();
    if (remain <= 0) break;
    await sleep(Math.min(intervalMs, remain));
  }
  throw new Error(`HTTP not ready at ${url} within ${timeoutMs}ms (${last})`);
}
