import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timerDrift, frameGaps, preflightVerdict, preflightMarkdown, PREFLIGHT_REQUIRED } from '../lib.mjs';
import { loadStreams } from '../summarise.mjs';

const RUNNER = fileURLToPath(new URL('../runner.mjs', import.meta.url));
const SUMMARISE = fileURLToPath(new URL('../summarise.mjs', import.meta.url));
const allPass = (laptop = 'A') => [{ t: 1, ev: 'start', laptop, url: 'http://e.local:3159/preflight?laptop=A' },
  ...PREFLIGHT_REQUIRED.map((name, i) => ({ t: 2 + i, ev: 'item', laptop, name, pass: true })),
  { t: 50, ev: 'item', laptop, name: 'wake_lock', pass: false, detail: { state: 'denied: NotAllowedError', secure: false } }];

test('timer drift: worst lateness of a 1 s interval', () => {
  assert.equal(timerDrift([0, 1000, 2010, 3000]), 10);
  assert.equal(timerDrift([0, 1000, 61000]), 59000);   // hidden-tab throttling
  assert.equal(timerDrift([0]), 0);
});

test('rAF gaps over 1 s are counted', () => {
  assert.deepEqual(frameGaps([0, 16, 33, 50]), { gaps: 0, worst_ms: 0 });
  assert.deepEqual(frameGaps([0, 16, 5016, 5033, 7100]), { gaps: 2, worst_ms: 5000 });
});

test('verdict: all required pass -> PASS; wake lock is info only; missing or failed -> FAIL; last result wins', () => {
  const v = preflightVerdict(allPass());
  assert.equal(v.pass, true); assert.equal(v.laptop, 'A'); assert.match(v.url, /\.local/);
  assert.equal(preflightVerdict(allPass().filter(e => e.name !== 'events')).pass, false);
  const f = preflightVerdict([...allPass(), { t: 99, ev: 'item', name: 'no_throttle', pass: false, detail: { worst_timer_late_ms: 59000 } }]);
  assert.deepEqual(f.failed, ['no_throttle']);
  assert.match(preflightMarkdown(f), /# Preflight A: FAIL/);
  assert.match(preflightMarkdown(v), /\| wake_lock \(info\) \| FAIL \|/);
});

const req = (port, method, path, body, headers = {}) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, method, path, headers }, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => res({ code: s.statusCode, body: d, headers: s.headers })); });
  r.on('error', rej); if (body) r.write(body); r.end();
});

test('e2e preflight: runner serves /preflight, config, CORS ping, collects the result; summarise exit codes; cleanup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'i159-pf-'));
  const tempF = join(dir, 'temp'), thrF = join(dir, 'thr'); writeFileSync(tempF, '60000'); writeFileSync(thrF, '0x0');
  const port = 3000 + Math.floor(Math.random() * 20000);
  const urls = `http://e.local:${port},http://10.42.0.5:${port}`;
  const child = spawn(process.execPath, [RUNNER, '--dir', join(dir, 'i159'), '--port', String(port), '--pf-urls', urls, '--pf-video', 'http://e.local:18080/v.mp4'],
    { env: { ...process.env, I159_TEST_MODE: '1', I159_TEMP_FILE: tempF, I159_THROTTLE_FILE: thrF, I159_THERMAL_MS: '200' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => child.stdout.once('data', r));
  try {
    assert.match((await req(port, 'GET', '/preflight')).body, /Start check/);
    assert.match((await req(port, 'GET', '/preflight.js')).body, /requestAnimationFrame/);
    const cfg = JSON.parse((await req(port, 'GET', '/preflight-config')).body);
    assert.deepEqual(cfg, { urls: urls.split(','), video: 'http://e.local:18080/v.mp4' });
    const ping = await req(port, 'POST', '/ping', '{}', { origin: 'http://10.42.0.5:' + port });
    assert.equal(ping.headers['access-control-allow-origin'], '*');           // the other-URL probe can read it
    assert.equal((await req(port, 'OPTIONS', '/ping')).code, 204);
    // fake player uploads one passing and one failing laptop
    const jl = es => es.map(e => JSON.stringify(e)).join('\n');
    assert.equal(JSON.parse((await req(port, 'POST', '/preflight-result?id=x&laptop=A', jl(allPass('A')))).body).pass, true);
    const bad = [...allPass('B'), { t: 99, ev: 'item', laptop: 'B', name: 'stayed_visible', pass: false, detail: { hidden_events: 2 } }];
    assert.equal(JSON.parse((await req(port, 'POST', '/preflight-result?id=y&laptop=B', jl(bad))).body).pass, false);
    const ctl = JSON.parse((await req(port, 'GET', '/control/preflight')).body);
    assert.deepEqual(ctl.results.map(r => `${r.laptop}:${r.pass}`).sort(), ['A:true', 'B:false']);
    assert.match(readFileSync(join(dir, 'i159', 'runner.log'), 'utf8'), /"ev":"preflight","laptop":"A","pass":true/);
    // summarise --preflight: exit 1 with any FAIL, exit 0 when all pass; field summary ignores preflight files
    const res = join(dir, 'i159', 'results');
    let s = spawnSync(process.execPath, [SUMMARISE, '--preflight', res], { encoding: 'utf8' });
    assert.equal(s.status, 1); assert.match(s.stdout, /Preflight A: PASS/); assert.match(s.stdout, /Preflight B: FAIL/);
    const only = join(dir, 'onlyA'); mkdirSync(only); writeFileSync(join(only, 'preflight-A.jsonl'), readFileSync(join(res, 'preflight-A.jsonl')));
    assert.equal(spawnSync(process.execPath, [SUMMARISE, '--preflight', only]).status, 0);
    assert.equal(spawnSync(process.execPath, [SUMMARISE, '--preflight', mkdtempSync(join(tmpdir(), 'i159-empty-'))]).status, 1);
    assert.equal(loadStreams(res).length, 0);
  } finally {
    process.kill(Number(readFileSync(join(dir, 'i159', 'runner.pid'), 'utf8')), 'SIGTERM');
    await new Promise(r => child.once('exit', r));
    renameSync(join(dir, 'i159'), join(dir, 'i159.quarantine-test'));
  }
  const open = await new Promise(r => { const q = http.get({ host: '127.0.0.1', port, path: '/' }, () => r(true)); q.on('error', () => r(false)); });
  assert.equal(open, false); assert.equal(existsSync(join(dir, 'i159')), false);
});

test('preflight page documents its limits and uses the same thresholds', () => {
  const js = readFileSync(fileURLToPath(new URL('../preflight.js', import.meta.url)), 'utf8');
  assert.match(js, /CANNOT see: the real screen state/);
  for (const n of PREFLIGHT_REQUIRED) assert.match(js, new RegExp(`'${n}'`));
  assert.match(js, /g > 1000/); assert.match(js, /worst < 1500/);
});
