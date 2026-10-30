#!/usr/bin/env node
// api-probe.mjs: one concurrent non-video Kolibri user (S4 in CAPACITY-PLAN.md). idea#159. Built-ins only.
// Every --interval-ms it GETs each path in turn (10 s timeout) and logs {t, path, ms, status, err} as JSONL.
//   node api-probe.mjs --base http://192.168.0.228:3190 [--paths /api/public/info/,/api/public/v1/channels/,/]
//        [--interval-ms 2000] [--duration-s 135] [--out api.jsonl]
import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { apiSummary } from './capacity-lib.mjs';

export const DEFAULT_PATHS = ['/api/public/info/', '/api/public/v1/channels/', '/'];

export function timedGet(base, path, timeoutMs = 10000) {
  const t = Date.now(), u = new URL(path, base);
  return new Promise(res => {
    const done = x => res({ t, path, ms: Date.now() - t, ...x });
    const r = http.get({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, agent: false }, s => { s.resume(); s.on('end', () => done({ status: s.statusCode })); s.on('error', e => done({ status: 0, err: e.code || e.message })); });
    r.setTimeout(timeoutMs, () => { r.destroy(new Error('timeout')); });
    r.on('error', e => done({ status: 0, err: e.message === 'timeout' ? 'timeout' : e.code || e.message }));
  });
}

export async function probe({ base, paths = DEFAULT_PATHS, intervalMs = 2000, durationS = 135, out = null, timeoutMs = 10000 }) {
  const end = Date.now() + durationS * 1000, events = [];
  while (Date.now() < end) {
    const tick = Date.now();
    for (const p of paths) { const e = await timedGet(base, p, timeoutMs); events.push(e); if (out) appendFileSync(out, JSON.stringify(e) + '\n'); }
    await new Promise(r => setTimeout(r, Math.max(0, intervalMs - (Date.now() - tick))));
  }
  return apiSummary(events);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 2) a[v[i].replace(/^--/, '')] = v[i + 1];
  if (!a.base) { console.error('--base required'); process.exit(2); }
  probe({ base: a.base, paths: a.paths ? a.paths.split(',') : DEFAULT_PATHS, intervalMs: Number(a['interval-ms'] || 2000), durationS: Number(a['duration-s'] || 135), out: a.out || null })
    .then(s => { console.log(JSON.stringify(s)); process.exit(0); });
}
