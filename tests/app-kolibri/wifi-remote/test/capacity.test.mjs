import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlayBuffer, stepVerdict, maxSafeN, nextN, planningN, percentile, samplesSummary, apiSummary, THRESHOLDS } from '../capacity-lib.mjs';
import { runLoad } from '../load-streams.mjs';
import { parseArgs } from '../sim-laptop.mjs';
import { probe } from '../api-probe.mjs';
import { checkStep, buildReport } from '../check-capacity.mjs';

const here = p => fileURLToPath(new URL(`../${p}`, import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'i159-cap-'));

// Stand-in for Kolibri's /content/storage: a file with HTTP Range support. stallAfterMs/stallMs freeze the
// response mid-stream (server-side stall); rateBps caps the server's send rate (an overloaded server).
function contentServer({ size = 400000, stallAfterMs = 0, stallMs = 0, rateBps = 0, apiDelayMs = 0 } = {}) {
  const body = Buffer.alloc(size, 7); const t0 = Date.now(); let gets = 0;
  const s = http.createServer((q, r) => {
    if (q.url.startsWith('/api/') || q.url === '/') { return setTimeout(() => { r.writeHead(200, { 'content-type': 'application/json' }); r.end('{}'); }, apiDelayMs); }
    if (!q.url.endsWith('.mp4')) { r.writeHead(404); return r.end(); }
    gets++; const m = /bytes=(\d+)-/.exec(q.headers.range || ''); const start = m ? Number(m[1]) : 0;
    r.writeHead(m ? 206 : 200, { 'content-type': 'video/mp4', 'content-length': size - start, ...(m ? { 'content-range': `bytes ${start}-${size - 1}/${size}` } : {}) });
    let off = start; const chunk = 8192;
    const pump = () => {
      if (r.destroyed) return;
      const el = Date.now() - t0;
      if (stallMs && el > stallAfterMs && el < stallAfterMs + stallMs) return setTimeout(pump, 50);
      if (off >= size) return r.end();
      const n = Math.min(chunk, size - off); const ok = r.write(body.subarray(off, off + n)); off += n;
      const wait = rateBps ? (n * 8 * 1000) / rateBps : 0;
      if (wait) setTimeout(pump, wait); else if (ok) setImmediate(pump); else r.once('drain', pump);
    };
    pump();
  });
  return new Promise(res => s.listen(0, '127.0.0.1', () => res({ s, port: s.address().port, gets: () => gets })));
}

test('PlayBuffer: TTFF after the startup buffer, no stall while bytes keep up', () => {
  const pb = new PlayBuffer({ bps: 800000, t0: 0, startupS: 2 });          // 100 kB = 1 s of media
  pb.advance(500, 100000); assert.equal(pb.state, 'startup');
  pb.advance(900, 100000); assert.equal(pb.state, 'playing'); assert.equal(pb.ttffMs, 900);
  for (let t = 1900; t <= 10900; t += 1000) pb.advance(t, 100000);       // exactly real time
  const f = pb.finish(10900); assert.equal(f.stalls, 0); assert.equal(f.playRatio, 1); assert.equal(f.ttffMs, 900);
});

test('PlayBuffer: detects a stall, its length and rebuffers per minute', () => {
  const pb = new PlayBuffer({ bps: 800000, t0: 0, startupS: 2, resumeS: 1 });
  pb.advance(1000, 200000);                                                // 2 s media, playing at t=1 s
  pb.advance(3000);                                                        // buffer runs dry at t=3 s
  assert.equal(pb.state, 'stalled'); assert.equal(pb.stallStart, 3000);
  pb.advance(6500, 100000);                                                // 1 s arrives at 6.5 s -> resume
  assert.equal(pb.state, 'playing');
  const f = pb.finish(7000); assert.equal(f.stalls, 1); assert.equal(f.maxStallMs, 3500);
  assert.ok(f.playRatio < 0.5); assert.ok(f.rebufPerMin > 9);
});

test('PlayBuffer: an open stall at the end counts; pacing stops reading at aheadS', () => {
  const pb = new PlayBuffer({ bps: 800000, t0: 0, aheadS: 4 });
  pb.advance(100, 300000); assert.equal(pb.wantMore(), true);
  pb.advance(200, 200000); assert.equal(pb.wantMore(), false);             // 5 s buffered > aheadS
  const f = pb.finish(20000); assert.equal(f.stalls, 1); assert.ok(f.maxStallMs > 14000);
  assert.throws(() => new PlayBuffer({ bps: 0, t0: 0 }));
});

test('sim-laptop --mode load args', () => {
  assert.throws(() => parseArgs(['--mode', 'load', '--n', '4', '--bps', '1']));
  assert.throws(() => parseArgs(['--mode', 'load', '--url', 'http://x/a.mp4', '--n', '0', '--bps', '1']));
  const a = parseArgs(['--mode', 'load', '--url', 'http://x/a.mp4', '--n', '8', '--bps', '902541', '--hold-s', '60']);
  assert.deepEqual([a.mode, a.n, a.bps, a.holdS, a.rampS, a.aheadS, a.startupS], ['load', 8, 902541, 60, 15, 4, 2]);
});

test('runLoad: paced at the bitrate (not as fast as possible), loops via Range, no stalls on a healthy server', async () => {
  const srv = await contentServer({ size: 150000 }); const dir = tmp();
  const bps = 400000;                                                      // 50 kB/s; file loops every 3 s
  const sum = await runLoad({ url: `http://127.0.0.1:${srv.port}/content/storage/a/b/x.mp4`, n: 4, bps, rampS: 0.4, holdS: 4, out: join(dir, 'l.jsonl'), summary: join(dir, 's.json') });
  srv.s.close();
  assert.equal(sum.streams.length, 4);
  for (const st of sum.streams) {
    assert.equal(st.errors, 0); assert.equal(st.stalls, 0); assert.ok(st.ttffMs < 1000, `ttff ${st.ttffMs}`);
    const secs = (sum.t1 - sum.t0) / 1000; const mediaS = (st.bytes * 8) / bps;
    assert.ok(mediaS <= secs + 4 + 1, `paced: ${mediaS.toFixed(1)} s of media in ${secs.toFixed(1)} s`);   // <= elapsed + aheadS (+ one chunk)
    assert.ok(mediaS >= secs - 1, `kept up: ${mediaS.toFixed(1)} s`);
  }
  assert.ok(srv.gets() > 4, 'looped with new Range requests');
  assert.ok(existsSync(join(dir, 's.json')) && readFileSync(join(dir, 'l.jsonl'), 'utf8').includes('"ev":"ttff"'));
});

test('runLoad: a server-side stall is detected; a too-slow server fails the play ratio', async () => {
  const stall = await contentServer({ size: 2000000, stallAfterMs: 1500, stallMs: 5000, rateBps: 800000 });
  const a = await runLoad({ url: `http://127.0.0.1:${stall.port}/v.mp4`, n: 2, bps: 400000, rampS: 0.1, holdS: 7.5, aheadS: 2 });
  stall.s.close();
  for (const st of a.streams) { assert.ok(st.stalls >= 1, 'stall seen'); assert.ok(st.maxStallMs > 2000, `stall ${st.maxStallMs}`); }
  const slow = await contentServer({ size: 2000000, rateBps: 200000 });  // half the video bitrate
  const b = await runLoad({ url: `http://127.0.0.1:${slow.port}/v.mp4`, n: 1, bps: 400000, rampS: 0, holdS: 8 });
  slow.s.close();
  const v = stepVerdict({ n: 1, streams: b.streams, api: [{ status: 200, ms: 10 }], samples: [{ t: 1, temp: 50, throttled: '0x0' }] });
  assert.equal(v.safe, false); assert.ok(v.fails.some(f => f.startsWith('S3') || f.startsWith('S2') || f.startsWith('S1')), v.fails.join());
});

test('runLoad: HTTP errors are counted', async () => {
  const srv = await contentServer();
  const r = await runLoad({ url: `http://127.0.0.1:${srv.port}/missing.txt`, n: 1, bps: 400000, rampS: 0, holdS: 1.2 });
  srv.s.close(); assert.ok(r.streams[0].errors >= 1); assert.equal(r.streams[0].ttffMs, null);
});

test('api-probe: latency percentiles, slow API fails S4, errors counted', async () => {
  const fast = await contentServer(); const s1 = await probe({ base: `http://127.0.0.1:${fast.port}`, intervalMs: 100, durationS: 0.5 }); fast.s.close();
  assert.ok(s1.n >= 6); assert.equal(s1.errors, 0); assert.ok(s1.p95 < 200);
  const slow = await contentServer({ apiDelayMs: 1200 }); const s2 = await probe({ base: `http://127.0.0.1:${slow.port}`, paths: ['/api/public/info/'], intervalMs: 100, durationS: 1 }); slow.s.close();
  assert.ok(s2.p95 >= 1200);
  const s3 = await probe({ base: 'http://127.0.0.1:9', paths: ['/'], intervalMs: 100, durationS: 0.2 }); assert.ok(s3.errors >= 1);
});

const good = (n, x = {}) => Array.from({ length: n }, () => ({ ttffMs: 400, stalls: 0, maxStallMs: 0, rebufPerMin: 0, playRatio: 1, errors: 0, ...x }));
const samples = (x = {}) => [{ t: 0, temp: 55, throttled: '0x0', mem_avail_kb: 3e6, load1: 1, oom_kill: 0, k_restart: 0, k_running: true, cpu_busy: 0, cpu_total: 0, net_tx: 0, net_rx: 0, disk_rd: 0, ...x },
  { t: 10000, temp: 60, throttled: '0x0', mem_avail_kb: 2.9e6, load1: 2, oom_kill: 0, k_restart: 0, k_running: true, cpu_busy: 500, cpu_total: 4000, net_tx: 125e6, net_rx: 1e6, disk_rd: 2000, ...x }];
const api = Array.from({ length: 20 }, (_, i) => ({ status: 200, ms: 100 + i }));

test('stepVerdict: SAFE when every rule holds; each rule can fail the step', () => {
  const ok = stepVerdict({ n: 8, streams: good(8), api, samples: samples(), health: { engineOnline: true } });
  assert.equal(ok.safe, true, ok.fails.join()); assert.equal(ok.metrics.pi.txMbps, 100); assert.equal(ok.metrics.pi.cpuPct, 12.5);
  const f = (args, code) => { const v = stepVerdict({ n: 8, streams: good(8), api, samples: samples(), health: {}, ...args }); assert.equal(v.safe, false); assert.ok(v.fails.some(x => x.startsWith(code)), `${code}: ${v.fails}`); };
  f({ streams: good(8, { maxStallMs: 2500, stalls: 1, rebufPerMin: 0.5 }) }, 'S1');
  f({ streams: good(8, { stalls: 3, rebufPerMin: 1.5, maxStallMs: 300 }) }, 'S1');
  f({ streams: good(8, { playRatio: 0.95 }) }, 'S2');
  f({ streams: [...good(7), { ...good(1)[0], ttffMs: 5200 }] }, 'S3');
  f({ streams: good(8, { ttffMs: 3500 }) }, 'S3');
  f({ api: api.map(a => ({ ...a, ms: 1500 })) }, 'S4');
  f({ api: [...api, { status: 0, err: 'timeout', ms: 10000 }] }, 'S4');
  f({ streams: good(8, { errors: 1 }) }, 'S5');
  f({ streams: good(7) }, 'S5');
  f({ samples: samples({ temp: 75.2 }) }, 'S6');
  f({ samples: [...samples(), { t: 20000, temp: 60, throttled: '0x50000' }] }, 'S6');
  f({ health: { thermalPaused: true } }, 'S6');
  f({ samples: [samples()[0], { ...samples()[1], oom_kill: 1 }] }, 'S7');
  f({ samples: samples({ mem_avail_kb: 100 * 1024 }) }, 'S7');
  f({ samples: [samples()[0], { ...samples()[1], k_restart: 1 }] }, 'S8');
  f({ health: { engineOnline: false } }, 'S8');
  assert.equal(THRESHOLDS.ttffP95Ms, 3000); assert.equal(THRESHOLDS.apiP95Ms, 1000); assert.equal(THRESHOLDS.maxTempC, 75);
});

test('ramp logic: max safe N, extension past 128 only if 128 is SAFE, planning rule', () => {
  assert.equal(maxSafeN([{ n: 1, safe: true }, { n: 2, safe: true }, { n: 4, safe: false }, { n: 8, safe: true }]), 2);
  assert.equal(maxSafeN([]), 0);
  assert.equal(nextN([]), 1); assert.equal(nextN([{ n: 96, safe: true }]), 128);
  assert.equal(nextN([{ n: 128, safe: true }]), 160); assert.equal(nextN([{ n: 128, safe: false }]), null); assert.equal(nextN([{ n: 256, safe: true }]), null);
  assert.deepEqual([370489, 751877, 902541, 2133290].map(planningN), [64, 32, 32, 12]);   // the #159 planning numbers
  assert.equal(percentile([5, 1, 3, 2, 4], 95), 5); assert.equal(percentile([], 50), null);
  assert.deepEqual(apiSummary([{ status: 503, ms: 5 }]).errors, 1);
  assert.equal(samplesSummary([]).n, 0);
});

test('check-capacity: step verdict from files, retry replaces the first attempt, report table', () => {
  const root = tmp(); const t0 = 1000;
  const mk = (q, name, n, streams, health = {}) => { const d = join(root, q, name); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'load.summary.json'), JSON.stringify({ t0, t1: t0 + 10000, n, streams }));
    writeFileSync(join(d, 'api.jsonl'), api.map(a => JSON.stringify(a)).join('\n'));
    writeFileSync(join(d, 'health.json'), JSON.stringify({ n, engineOnline: true, nproc: 4, ...health })); return d; };
  const sf = join(root, 'samples.jsonl'); writeFileSync(sf, samples().map(s => JSON.stringify({ ...s, t: s.t + t0 })).join('\n'));
  assert.equal(checkStep(mk('720p', 'n1', 1, good(1)), sf).safe, true);
  assert.equal(checkStep(mk('720p', 'n2', 2, good(2, { maxStallMs: 4000, stalls: 1 })), sf).safe, false);
  assert.equal(checkStep(mk('720p', 'n2-retry', 2, good(2), { retry: true }), sf).safe, true);
  assert.equal(checkStep(mk('720p', 'n4', 4, good(3)), sf).safe, false);
  writeFileSync(join(root, 'meta.json'), JSON.stringify({ server: 'idea03', loadgen: 'idea04', image: 'img', port: 3190, conditions: { 'server RAM': '4096 MiB' }, release: { 'server: docker ps -a identical': 'PASS' }, qualities: [{ name: '720p', bps: 902541 }] }));
  const r = buildReport(root);
  assert.equal(r.qualities[0].maxSafeN, 2); assert.equal(r.qualities[0].planningN, 32);
  assert.match(r.md, /\| 720p \| 902541 \| 2 \| 32 \|/); assert.match(r.md, /below planning N/); assert.match(r.md, /less than the 8 GB kit Engines/);
  assert.match(r.md, /\| 720p \| 2 \| PASS \(retry\)/); assert.match(r.md, /docker ps -a identical \| PASS/);
});

test('pi-sampler.sh writes valid JSON lines and stops with kill <pid>', async () => {
  const d = tmp(); const out = join(d, 's.jsonl');
  const p = spawn('bash', [here('pi-sampler.sh'), out, 'no-such-container', '1'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(existsSync(out) && readFileSync(out, 'utf8').trim()); i++) await new Promise(r => setTimeout(r, 100));
  process.kill(p.pid, 'SIGTERM'); await new Promise(r => p.once('exit', r));
  const line = JSON.parse(readFileSync(out, 'utf8').trim().split('\n')[0]);
  for (const k of ['t', 'temp', 'throttled', 'cpu_busy', 'cpu_total', 'load1', 'mem_avail_kb', 'oom_kill', 'net_rx', 'disk_rd', 'k_restart', 'k_running']) assert.ok(k in line, k);
  assert.ok(line.mem_avail_kb > 0 && line.cpu_total > 0);
});

test('pi-sampler.sh reads threads + RSS from the process tree under the root pid (run-1 bug: threads 1, mem 0)', async () => {
  const d = tmp(); const out = join(d, 's.jsonl');
  const root = spawn('bash', ['-c', 'sleep 30 & sleep 30 & wait'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 300));
  const p = spawn('bash', [here('pi-sampler.sh'), out, 'no-such-container', '1', 'eth0', 'sda', String(root.pid)], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(existsSync(out) && readFileSync(out, 'utf8').trim()); i++) await new Promise(r => setTimeout(r, 100));
  process.kill(p.pid, 'SIGTERM'); await new Promise(r => p.once('exit', r)); process.kill(root.pid, 'SIGTERM');
  const line = JSON.parse(readFileSync(out, 'utf8').trim().split('\n')[0]);
  assert.equal(line.k_procs, 2); assert.equal(line.k_threads, 2); assert.ok(line.k_mem > 0, `k_mem ${line.k_mem}`); assert.ok(line.k_pid > 0);
  assert.ok('k_mem_docker' in line);
});

test('capacity.sh guards: refuses kit, production, golden and client hosts and SERVER = LOADGEN (no SSH)', () => {
  const run = env => spawnSync('bash', [here('capacity.sh')], { env: { ...process.env, CHECK_ONLY: '1', ...env }, encoding: 'utf8' });
  for (const bad of ['idea02', 'idea01', 'idea', 'wh', 'happy-zebra', 'pi@100.115.60.6', 'wizardly-hugle', 'idea05']) {
    const r = run({ SERVER: bad, LOADGEN: 'idea04' }); assert.equal(r.status, 2, `${bad}: ${r.stdout}`); assert.match(r.stdout, /REFUSED/);
    const r2 = run({ SERVER: 'idea03', LOADGEN: bad }); assert.equal(r2.status, 2, `${bad} as load host`);
  }
  assert.equal(run({ SERVER: 'idea03', LOADGEN: 'idea03' }).status, 2);
  assert.equal(run({ SERVER: 'idea03', LOADGEN: 'idea04', KPORT: '80' }).status, 2);
  const ok = run({ SERVER: 'idea03', LOADGEN: 'idea04' }); assert.equal(ok.status, 0); assert.match(ok.stdout, /allowed/);
});

test('capacity.sh DRY_RUN: full flow, scratch never under /disks, cd||exit nohup pattern, no forbidden commands', () => {
  const d = tmp(); const fx = join(d, 'fx'); mkdirSync(fx);
  writeFileSync(join(fx, 'manifest.json'), JSON.stringify([{ file: 'q_720p.mp4', md5: '99ad895daf5c1aeb216c5c2e7b8cfd3f', bitrate_bps: 902541 }]));
  const r = spawnSync('bash', [here('capacity.sh')], { env: { ...process.env, SERVER: 'idea03', LOADGEN: 'idea04', DRY_RUN: '1', OUT: join(d, 'out'), FIXTURES: fx, QUALITIES: '720p real' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const all = r.stdout.replace(/\\(.)/g, '$1'); const src = readFileSync(here('capacity.sh'), 'utf8') + readFileSync(here('pi-sampler.sh'), 'utf8');
  assert.doesNotMatch(src.replace(/^#.*$/gm, ''), /rm -rf|pkill|pgrep|pm2 (stop|restart|delete)|systemctl|systemd-run/);
  assert.doesNotMatch(all.split('\n').filter(l => !l.includes('REFUSED')).join('\n'), /\/disks/);   // only the path guard names /disks
  assert.match(all, /kid-scratch-cap-/); assert.match(all, /docker compose -p kid-cap-/); assert.match(all, /down -v/);
  assert.match(all, /cd \/tmp\/i159-cap-load \|\| exit 1; nohup/); assert.match(all, /cd \/tmp\/i159-cap \|\| exit 1; nohup bash pi-sampler.sh/);
  assert.match(all, /mv \/tmp\/i159-cap-load \/tmp\/i159-cap-load.quarantine-/);
  assert.match(all, /importchannel network c9d7f950ab6b5a1199e3d6c10d7f0103/);
  assert.match(all, /PASS server: docker images identical/); assert.match(all, /PASS loadgen: losetup identical/);
  assert.ok(existsSync(join(d, 'out', 'REPORT.md'))); assert.match(readFileSync(join(d, 'out', 'compose.yaml'), 'utf8'), /KOLIBRI_HTTP_PORT=3190/);
  // run 2: step test, both pools, real video as its own phase per pool, load-host limits, 4 h cap
  assert.match(all, /mode step \(48 50 52 56 60 64\), pools \[default 128\].*cap 14400s \+ real 2400s\/pool/);
  for (const pool of ['default', '128']) { assert.match(all, new RegExp(`step pool=${pool} 720p N=48`)); assert.match(all, new RegExp(`pool ${pool}: real channel video phase \\(own cap 2400s\\)`)); assert.ok(existsSync(join(d, 'out', `pool-${pool}`, 'REPORT.md'))); }
  const def = readFileSync(join(d, 'out', 'compose-default.yaml'), 'utf8'), big = readFileSync(join(d, 'out', 'compose-128.yaml'), 'utf8');
  assert.doesNotMatch(def, /THREAD_POOL|ulimits/); assert.match(big, /KOLIBRI_CHERRYPY_THREAD_POOL=128/); assert.match(big, /soft: 65536/);
  assert.match(all, /docker compose -p kid-cap-\S+ up -d --force-recreate/);
  assert.match(readFileSync(join(d, 'out', 'before-loadgen.txt'), 'utf8'), /## load-host limits/);
  assert.match(src, /ulimit -Sn.*ip_local_port_range/);
  assert.match(readFileSync(join(d, 'out', 'REPORT.md'), 'utf8'), /\[CherryPy pool 128\]/);
});

test('capacity.sh: global cap cannot skip the real phase; STEPS/THREAD_POOL configurable; bad THREAD_POOL refused', () => {
  const d = tmp(); const fx = join(d, 'fx'); mkdirSync(fx);
  writeFileSync(join(fx, 'manifest.json'), JSON.stringify([{ file: 'q_720p.mp4', md5: '99ad895daf5c1aeb216c5c2e7b8cfd3f', bitrate_bps: 902541 }]));
  const base = { ...process.env, SERVER: 'idea03', LOADGEN: 'idea04', DRY_RUN: '1', FIXTURES: fx, QUALITIES: '720p real' };
  const r = spawnSync('bash', [here('capacity.sh')], { env: { ...base, OUT: join(d, 'a'), CAP_S: '60', THREAD_POOL: '96', STEPS: '50 56' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /pool 96 720p: time cap \(global\) before N=50/); assert.doesNotMatch(r.stdout, /step pool=96 720p/);
  assert.match(r.stdout, /step pool=96 real N=50/); assert.match(r.stdout, /mode step \(50 56\), pools \[96\]/);
  const r2 = spawnSync('bash', [here('capacity.sh')], { env: { ...base, OUT: join(d, 'b'), REAL_CAP: '10', THREAD_POOL: 'default' }, encoding: 'utf8' });
  assert.match(r2.stdout, /REAL_CAP 10s reached before N=48/);
  assert.equal(spawnSync('bash', [here('capacity.sh')], { env: { ...base, CHECK_ONLY: '1', THREAD_POOL: 'big' }, encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync('bash', [here('capacity.sh')], { env: { ...base, CHECK_ONLY: '1', MODE: 'x' }, encoding: 'utf8' }).status, 2);
});
