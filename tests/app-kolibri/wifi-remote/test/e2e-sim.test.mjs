import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimLaptop, parseArgs, sseParser } from '../sim-laptop.mjs';
import { checkField, checkThermal } from '../check-e2e.mjs';
import { parseJsonl } from '../lib.mjs';
import { loadStreams } from '../summarise.mjs';

const RUNNER = fileURLToPath(new URL('../runner.mjs', import.meta.url));
const E2E = fileURLToPath(new URL('../e2e-pi.sh', import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const req = (port, method, path, body) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port, method, path }, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => res({ code: s.statusCode, body: d })); }); r.on('error', rej); if (body) r.write(body); r.end(); });
const status = async port => JSON.parse((await req(port, 'GET', '/control/status')).body);
async function until(fn, ms = 8000) { const t0 = Date.now(); for (;;) { if (await fn()) return true; if (Date.now() - t0 > ms) return false; await sleep(100); } }

function videoServer() {   // stand-in for Kolibri: endless-ish mp4 bytes
  const s = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'video/mp4' }); let n = 0; const iv = setInterval(() => { if (n++ > 400 || r.destroyed) { clearInterval(iv); return r.end(); } r.write(Buffer.alloc(16384)); }, 20); r.on('close', () => clearInterval(iv)); });
  return new Promise(res => s.listen(0, '127.0.0.1', () => res(s)));
}
async function startRunner(env, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'i159-sim-')); const port = 3000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [RUNNER, '--dir', join(dir, 'i159'), '--port', String(port), ...extra], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => child.stdout.once('data', r));
  const stop = async () => { process.kill(Number(readFileSync(join(dir, 'i159', 'runner.pid'), 'utf8')), 'SIGTERM'); await new Promise(r => child.once('exit', r)); renameSync(join(dir, 'i159'), join(dir, 'i159.quarantine-test')); };
  return { dir, port, child, stop };
}

test('sim-laptop args and SSE parser', () => {
  assert.throws(() => parseArgs(['--laptop', 'A']));
  assert.throws(() => parseArgs(['--runner', 'http://x:1', '--laptop', 'A', '--mode', 'bogus']));
  const a = parseArgs(['--runner', 'http://127.0.0.1:3159/', '--laptop', 'B', '--skew-ms', '-2000', '--drop-after-s', '10']);
  assert.deepEqual([a.runner, a.laptop, a.tab, a.skew, a.dropAfter, a.mode], ['http://127.0.0.1:3159', 'B', 1, -2000, 10, 'field']);
  const got = []; const feed = sseParser(e => got.push(e));
  feed('retry: 2000\n\nevent: hel'); feed('lo\ndata: {"now":1}\n\nevent: start\ndata: {"at":5}\n\n');
  assert.deepEqual(got, [{ type: 'hello', data: { now: 1 } }, { type: 'start', data: { at: 5 } }]);
});

test('check-e2e: field and thermal checks fail on bad input', () => {
  const log = [{ ev: 'step', quality: 'sim', step: 'L1', laptops: ['A'], tabs: 1, at: 10000 }];
  const ok = [{ laptop: 'A', quality: 'sim', step: 'L1', tab: 1, events: [{ t: 10100, ev: 'start' }, { t: 10500, ev: 'playing' }, { t: 20000, ev: 'end' }] }];
  assert.equal(checkField(log, ok, ['A']).pass, true);
  assert.match(checkField(log, [{ ...ok[0], events: [{ t: 13000, ev: 'start' }, { t: 13500, ev: 'playing' }, { t: 20000, ev: 'end' }] }], ['A']).fails.join(), /clock not aligned/);
  assert.match(checkField(log, [], ['A']).fails.join(), /missing log A\/sim\/L1\/tab1/);
  assert.equal(checkThermal([{ ev: 'listen', testMode: true }, { ev: 'thermal-pause', tempC: 76 }, { ev: 'thermal-resume', tempC: 64 }, { ev: 'abort', throttled: '0x50000' }]).pass, true);
  assert.equal(checkThermal([{ ev: 'listen', testMode: false }, { ev: 'thermal-pause', tempC: 76 }]).pass, false);
});

test('temperature injection is test-mode only: env ignored without I159_TEST_MODE=1', async () => {
  const d = mkdtempSync(join(tmpdir(), 'i159-hot-')); const hot = join(d, 't'); writeFileSync(hot, '90000'); const thr = join(d, 'thr'); writeFileSync(thr, '0x50000');
  const r = await startRunner({ I159_TEST_MODE: '', I159_TEMP_FILE: hot, I159_THROTTLE_FILE: thr, I159_THERMAL_MS: '100' });
  try {
    await sleep(400); const s = await status(r.port);
    assert.equal(s.testMode, false); assert.equal(s.tempSource, '/sys/class/thermal/thermal_zone0/temp');
    assert.equal(s.paused, false); assert.notEqual(s.aborted, 'throttled=0x50000');
  } finally { await r.stop(); }
  const t = await startRunner({ I159_TEST_MODE: '1', I159_TEMP_FILE: hot, I159_THERMAL_MS: '100' });
  try { assert.ok(await until(async () => (await status(t.port)).paused)); assert.equal((await status(t.port)).tempSource, hot); } finally { await t.stop(); }
});

test('e2e on the box: 3 sim laptops (skewed clocks, one drop) + preflight sim + thermal stop, then cleanup', async () => {
  const vs = await videoServer(); const vport = vs.address().port;
  const d = mkdtempSync(join(tmpdir(), 'i159-th-')); const tf = join(d, 'temp'), thf = join(d, 'thr'); writeFileSync(tf, '50000'); writeFileSync(thf, '0x0');
  const r = await startRunner({ I159_TEST_MODE: '1', I159_TEMP_FILE: tf, I159_THROTTLE_FILE: thf, I159_THERMAL_MS: '100' },
    ['--pf-urls', 'http://127.0.0.1:1,http://localhost:1', '--pf-video', `http://127.0.0.1:${vport}/v.mp4`]);
  const base = `http://127.0.0.1:${r.port}`; const sims = [];
  try {
    // preflight sim -> PASS
    const pf = new SimLaptop({ ...parseArgs(['--runner', base, '--laptop', 'P', '--mode', 'preflight', '--pf-s', '2']) });
    assert.equal(await pf.run(), 0);
    const pr = JSON.parse((await req(r.port, 'GET', '/control/preflight')).body).results;
    assert.deepEqual(pr.map(x => `${x.laptop}:${x.pass}`), ['P:true']);
    // field: 3 sims, skews 0 / +3000 / -2000, B drops its event stream after 1 s
    for (const [l, skew, drop] of [['A', 0, 0], ['B', 3000, 1], ['C', -2000, 0]]) {
      const s = new SimLaptop(parseArgs(['--runner', base, '--laptop', l, '--skew-ms', String(skew), '--drop-after-s', String(drop), '--rate', '200000', '--exit-after-s', '30']));
      sims.push(s); s.run();
    }
    assert.ok(await until(async () => (await status(r.port)).players.filter(p => p.connected && p.offset !== null && !p.laptop.startsWith('preflight')).length === 3));
    const st = JSON.parse((await req(r.port, 'POST', '/control/start', JSON.stringify({ quality: 'sim', step: 'L3', md5: 'x', url: `http://127.0.0.1:${vport}/v.mp4`, laptops: ['A', 'B', 'C'], tabs: 1, duration: 4, leadMs: 500 }))).body);
    assert.equal(st.players, 3);
    assert.ok(await until(() => sims.every(s => s.received.filter(t => t === 'start').length >= 1 && !s.cur && s.queue.length === 0), 15000), 'all sims finished');
    const res = join(r.dir, 'i159');
    const c = checkField(parseJsonl(readFileSync(join(res, 'runner.log'), 'utf8')), loadStreams(join(res, 'results')), ['A', 'B', 'C'], 500);
    assert.equal(c.pass, true, c.fails.join('; '));
    assert.match(readFileSync(join(res, 'runner.log'), 'utf8'), /"ev":"reconnect"/);
    // thermal stop via the injected sources
    const t = sims[0];
    await req(r.port, 'POST', '/control/start', JSON.stringify({ quality: 'sim', step: 'TH', md5: 'x', url: `http://127.0.0.1:${vport}/v.mp4`, laptops: ['A'], tabs: 1, duration: 20, leadMs: 200 }));
    writeFileSync(tf, '76000'); assert.ok(await until(async () => (await status(r.port)).paused && t.paused));
    writeFileSync(tf, '64000'); assert.ok(await until(async () => !(await status(r.port)).paused && !t.paused));
    writeFileSync(thf, '0x50000'); assert.ok(await until(async () => (await status(r.port)).aborted === 'throttled=0x50000' && t.received.includes('stop')));
    assert.equal(checkThermal(parseJsonl(readFileSync(join(res, 'runner.log'), 'utf8'))).pass, true);
    // summarise.mjs works on the collected results
    const sm = spawnSync(process.execPath, [fileURLToPath(new URL('../summarise.mjs', import.meta.url)), join(res, 'results')], { encoding: 'utf8' });
    assert.equal(sm.status, 0); assert.match(sm.stdout, /\| sim \| L3 \| 3 \|/);
  } finally {
    for (const s of sims) { s.done = true; s.sse?.destroy(); }
    await r.stop(); vs.close();
  }
  const open = await new Promise(q => { const x = http.get({ host: '127.0.0.1', port: r.port, path: '/' }, () => q(true)); x.on('error', () => q(false)); });
  assert.equal(open, false); assert.equal(existsSync(join(r.dir, 'i159')), false); assert.ok(existsSync(join(r.dir, 'i159.quarantine-test')));
});

test('e2e-pi.sh allowlist: refuses kit, production, golden and client hosts before any SSH', () => {
  const g = (engine, extra = {}) => spawnSync('bash', [E2E], { env: { ...process.env, ENGINE: engine, CHECK_ONLY: '1', ...extra }, encoding: 'utf8' });
  for (const bad of ['happy-zebra', 'sunny-robin', 'kind-panda', 'pi@kind-panda.tail.ts.net', 'wh', 'idea', 'idea01', 'idea02', 'pi@100.115.60.6', '100.102.94.100', '100.96.98.10', '100.80.238.59', 'idea05']) {
    const r = g(bad); assert.equal(r.status, 2, bad); assert.match(r.stdout, /REFUSED/);
  }
  assert.equal(g('happy-zebra', { E2E_ALLOW: 'happy-zebra' }).status, 2, 'deny wins over allow');
  for (const ok of ['idea03', 'idea04', 'pi@idea04.tail.ts.net']) assert.equal(g(ok).status, 0, ok);
  assert.equal(g('idea05', { E2E_ALLOW: 'idea05' }).status, 0);
  const src = readFileSync(E2E, 'utf8').split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
  for (const bad of [/rm -rf/, /pkill/, /pgrep/, /systemd-run/, /pm2 (start|stop|restart|delete|save)/, /\s-J\s/]) assert.doesNotMatch(src, bad);
});
