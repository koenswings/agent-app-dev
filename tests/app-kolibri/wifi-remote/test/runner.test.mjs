import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clockOffset, scheduleStart, toEngineTime, mergeLog, streamFile, thermalNext, parseJsonl, streamMetrics } from '../lib.mjs';

const RUNNER = fileURLToPath(new URL('../runner.mjs', import.meta.url));

test('clock offset uses the fastest round trip', () => {
  const o = clockOffset([{ t0: 1000, ts: 6100, t1: 1200 }, { t0: 2000, ts: 7020, t1: 2040 }, { t0: 3000, ts: NaN, t1: 3001 }]);
  assert.deepEqual(o, { offset: 5000, rtt: 40, n: 2 });
  assert.equal(clockOffset([]), null);
});

test('start is scheduled on a whole second, after the lead and 3x the slowest rtt', () => {
  assert.equal(scheduleStart(10_200, 5000), 16_000);
  assert.equal(scheduleStart(10_000, 5000), 15_000);
  assert.equal(scheduleStart(10_000, 1000, [40, 2500]), 18_000);
});

test('log merge converts to Engine time, dedupes retries by seq, sorts', () => {
  const a = toEngineTime([{ t: 100, seq: 0, ev: 'start' }, { t: 300, seq: 2, ev: 'playing' }, { bad: 1 }], 1000);
  assert.deepEqual(a.map(e => [e.t, e.t_page]), [[1100, 100], [1300, 300]]);
  const retry = toEngineTime([{ t: 300, seq: 2, ev: 'playing' }, { t: 200, seq: 1, ev: 'waiting' }], 1000);
  const m = mergeLog(a, retry);
  assert.deepEqual(m.map(e => e.seq), [0, 1, 2]);
  assert.equal(streamFile('A', '720p', 'L2', 3), 'A-720p-L2-tab3.jsonl');
  assert.equal(streamFile('../x', '720p', 'L2', 'z'), '___x-720p-L2-tab1.jsonl');
});

test('thermal hysteresis: pause >75, stay paused until <65', () => {
  assert.equal(thermalNext(false, 75), false);
  assert.equal(thermalNext(false, 75.1), true);
  assert.equal(thermalNext(true, 66), true);
  assert.equal(thermalNext(true, 64.9), false);
  assert.equal(thermalNext(true, NaN), true);
});

// ---- local end-to-end: real runner.mjs, fake player client (pull model: client opens every connection) ----
const req = (port, method, path, body) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, method, path }, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => res({ code: s.statusCode, body: d })); });
  r.on('error', rej); if (body) r.write(body); r.end();
});
function sse(port, path) {
  const events = []; let resolveNext = null; let buf = '';
  const r = http.get({ host: '127.0.0.1', port, path }, s => s.on('data', c => { buf += c; let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2);
      const type = /^event: (.*)$/m.exec(blk)?.[1]; const data = /^data: (.*)$/m.exec(blk)?.[1];
      if (type) { events.push({ type, data: JSON.parse(data) }); resolveNext?.(); } } }));
  const wait = async (type, ms = 5000) => { const t0 = Date.now(); for (;;) { const e = events.find(x => x.type === type); if (e) return e.data; if (Date.now() - t0 > ms) throw new Error('no ' + type); await new Promise(r => { resolveNext = r; setTimeout(r, 50); }); } };
  return { events, wait, close: () => r.destroy() };
}
const portOpen = port => new Promise(res => { const r = http.get({ host: '127.0.0.1', port, path: '/' }, () => res(true)); r.on('error', () => res(false)); });

test('e2e: runner serves page, syncs clock, starts at T, collects JSONL, pauses on heat, aborts on throttle, cleans up', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'i159-e2e-'));
  const tempF = join(dir, 'temp'), thrF = join(dir, 'thr'); writeFileSync(tempF, '60000'); writeFileSync(thrF, '0x0');
  const port = 3000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [RUNNER, '--dir', join(dir, 'i159'), '--port', String(port)],
    { env: { ...process.env, I159_TEMP_FILE: tempF, I159_THROTTLE_FILE: thrF, I159_THERMAL_MS: '100' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => child.stdout.once('data', r));
  try {
    assert.match((await req(port, 'GET', '/')).body, /Start/);
    assert.match((await req(port, 'GET', '/player.js')).body, /EventSource/);
    const c = sse(port, '/events?id=p1&laptop=A&tab=1');
    await c.wait('hello');
    // clock: pretend this page is 2000 ms behind the Engine
    const samples = [];
    for (let i = 0; i < 3; i++) { const t0 = Date.now() - 2000; const { ts } = JSON.parse((await req(port, 'POST', '/ping', JSON.stringify({ id: 'p1' }))).body); samples.push({ t0, ts, t1: Date.now() - 2000 }); }
    await req(port, 'POST', '/ping', JSON.stringify({ id: 'p1', samples }));
    const st0 = JSON.parse((await req(port, 'GET', '/control/status')).body);
    assert.ok(Math.abs(st0.players[0].offset - 2000) < 50, `offset ${st0.players[0].offset}`);
    // start at T
    const started = JSON.parse((await req(port, 'POST', '/control/start', JSON.stringify({ quality: '720p', step: 'L1', md5: 'x', url: 'http://k.local/v.mp4', laptops: ['A'], tabs: 1, duration: 2, leadMs: 300 }))).body);
    assert.equal(started.players, 1); assert.equal(started.at % 1000, 0);
    const s = await c.wait('start'); assert.equal(s.at, started.at);
    // upload page-clock JSONL twice (retry) -> one merged Engine-time file
    const T = s.at - 2000;
    const jl = [{ t: T, seq: 0, ev: 'start', laptop: 'A', quality: '720p', step: 'L1', tab: 1 }, { t: T + 1200, seq: 1, ev: 'playing' },
      { t: T + 2000, seq: 2, ev: 'quality', videoWidth: 1280, videoHeight: 720, droppedVideoFrames: 1, totalVideoFrames: 50 }, { t: T + 3000, seq: 3, ev: 'end' }].map(e => JSON.stringify(e)).join('\n');
    const qs = 'id=p1&laptop=A&tab=1&quality=720p&step=L1';
    assert.equal((await req(port, 'POST', '/results?' + qs, jl)).code, 200);
    assert.equal((await req(port, 'POST', '/results?' + qs, jl)).code, 200);
    const f = join(dir, 'i159', 'results', 'A-720p-L1-tab1.jsonl');
    const evs = parseJsonl(readFileSync(f, 'utf8'));
    assert.equal(evs.length, 4);
    assert.ok(Math.abs(evs[0].t - s.at) < 50, 'Engine timestamps');
    const m = streamMetrics(evs); assert.equal(m.startup_s, 1.2); assert.equal(m.resolution, '1280x720');
    // reconnect: same id rejoins the running step
    c.close(); const c2 = sse(port, '/events?id=p1&laptop=A&tab=1'); await c2.wait('hello');
    // heat -> pause, cool -> resume
    writeFileSync(tempF, '80000'); await c2.wait('pause');
    writeFileSync(tempF, '64000'); await c2.wait('resume');
    // throttled -> abort, start refused
    writeFileSync(thrF, '0x50000'); await c2.wait('stop');
    assert.equal((await req(port, 'POST', '/control/start', '{}')).code, 409);
    const log = readFileSync(join(dir, 'i159', 'runner.log'), 'utf8');
    for (const k of ['connect', 'reconnect', 'step', 'thermal-pause', 'thermal-resume', 'abort']) assert.match(log, new RegExp(`"ev":"${k}"`));
    c2.close();
  } finally {
    // cleanup the way run-remote.sh does: kill the pid from the pid file, quarantine the dir (no rm -rf)
    const pid = Number(readFileSync(join(dir, 'i159', 'runner.pid'), 'utf8'));
    assert.equal(pid, child.pid);
    process.kill(pid, 'SIGTERM');
    await new Promise(r => child.once('exit', r));
    renameSync(join(dir, 'i159'), join(dir, 'i159.quarantine-test'));
  }
  assert.equal(await portOpen(port), false, 'port closed');
  assert.throws(() => process.kill(child.pid, 0), 'pid gone');
  assert.equal(existsSync(join(dir, 'i159')), false);
  assert.ok(readdirSync(dir).includes('i159.quarantine-test'));
});

test('control endpoints refuse non-local callers (code path)', () => {
  assert.match(readFileSync(RUNNER, 'utf8'), /control is localhost only/);
  assert.doesNotMatch(readFileSync(RUNNER, 'utf8'), /http\.request\(|net\.connect\(/, 'runner never dials out to laptops');
});

test('run-remote.sh follows the Ops cleanup rules', () => {
  const s = readFileSync(fileURLToPath(new URL('../run-remote.sh', import.meta.url)), 'utf8').split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
  for (const bad of [/rm -rf/, /pkill/, /pgrep/, /systemd-run/, /pm2 (start|stop|restart|delete|save)/, /\s-J\s/]) assert.doesNotMatch(s, bad);
  for (const good of [/nohup/, /kill \\\$\(cat \$R\/runner\.pid\)/, /mv \$R \$Q/, /pm2 jlist/, /get_throttled/, /PORT" -ge 3000/]) assert.match(s, good);
});
