#!/usr/bin/env node
// runner.mjs — player-page runner for the Kolibri Wi-Fi field test (idea#159, option B).
// Runs on the school Engine as pi (nohup, outside pm2/systemd), Node 20/22 built-ins only, no npm.
// PULL MODEL (router REJECTs Engine->laptop): laptops open every connection. The page holds an SSE
// stream (GET /events) for commands, pings (POST /ping) for clock sync, and uploads JSONL (POST /results).
// The runner never dials a laptop. Control endpoints (/control/*) accept 127.0.0.1 only (driven over SSH).
//
//   node runner.mjs --dir /tmp/i159 [--port 3159] [--kolibri http://127.0.0.1:18080]
// env: I159_TEMP_FILE (default /sys/class/thermal/thermal_zone0/temp), I159_THROTTLE_FILE (test override for
//      `vcgencmd get_throttled`), I159_THERMAL_MS (poll, default 10000)
import http from 'node:http';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { clockOffset, scheduleStart, toEngineTime, mergeLog, streamFile, parseJsonl, thermalNext } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => { if (x.startsWith('--')) a.push([x.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? '1' : all[i + 1]]); return a; }, []));
const DIR = args.dir || '/tmp/i159';
const PORT = Number(args.port || 3159);
if (!(PORT >= 3000)) { console.error('port must be >= 3000'); process.exit(2); }
const HI = Number(args.hi || 75), LO = Number(args.lo || 65);
const RES = join(DIR, 'results'); mkdirSync(RES, { recursive: true });
const RUNLOG = join(DIR, 'runner.log');
const log = (ev, x = {}) => appendFileSync(RUNLOG, JSON.stringify({ t: Date.now(), ev, ...x }) + '\n');

const players = new Map();   // id -> {laptop, tab, res (SSE), offset, rtt, lastSeen}
let step = null;             // {quality, step, md5, url, laptops:[...], tabs, at, duration, synthN}
let paused = false, aborted = null, ramp = null;

function send(p, type, data) { try { p.res?.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} }
const broadcast = (type, data, filter = () => true) => { for (const p of players.values()) if (filter(p)) send(p, type, data); };
const inStep = p => step && step.laptops.includes(p.laptop) && p.tab <= step.tabs;

function body(req, limit = 8 << 20) {
  return new Promise((res, rej) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > limit) { rej(new Error('too big')); req.destroy(); } else c.push(d); }); req.on('end', () => res(Buffer.concat(c).toString('utf8'))); req.on('error', rej); });
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const local = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/player.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(readFileSync(join(HERE, 'player.html')));
    }
    if (req.method === 'GET' && u.pathname === '/player.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); return res.end(readFileSync(join(HERE, 'player.js')));
    }
    if (req.method === 'GET' && u.pathname === '/events') {        // SSE, opened BY the laptop
      const id = u.searchParams.get('id'), laptop = u.searchParams.get('laptop'), tab = Number(u.searchParams.get('tab') || 1);
      if (!id || !laptop) return json(res, 400, { error: 'id and laptop required' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      const old = players.get(id); const p = { ...(old || {}), id, laptop, tab, res, lastSeen: Date.now() };
      players.set(id, p); log(old ? 'reconnect' : 'connect', { id, laptop, tab, ip: req.socket.remoteAddress });
      send(p, 'hello', { now: Date.now(), paused });
      if (step && inStep(p) && Date.now() < step.at + step.duration * 1000) send(p, 'start', step);   // rejoin a running step
      const ka = setInterval(() => res.write(': ka\n\n'), 15000);
      req.on('close', () => { clearInterval(ka); if (players.get(id)?.res === res) { p.res = null; log('disconnect', { id, laptop, tab }); } });
      return;
    }
    if (req.method === 'POST' && u.pathname === '/ping') {
      const ts = Date.now(); const b = JSON.parse(await body(req, 4096) || '{}');
      const p = players.get(b.id);
      if (p && Array.isArray(b.samples)) { const o = clockOffset(b.samples); if (o) { p.offset = o.offset; p.rtt = o.rtt; } p.lastSeen = ts; }
      return json(res, 200, { ts });
    }
    if (req.method === 'POST' && u.pathname === '/results') {     // JSONL upload with ?id&laptop&tab&quality&step
      const q = Object.fromEntries(u.searchParams);
      const p = players.get(q.id); const offset = Number.isFinite(Number(q.offset)) && q.offset !== '' ? Number(q.offset) : p?.offset ?? 0;
      const evs = toEngineTime(parseJsonl(await body(req)), offset).map(e => ({ ...e, laptop: q.laptop, tab: Number(q.tab || 1) }));
      const f = join(RES, streamFile(q.laptop, q.quality, q.step, q.tab));
      const merged = mergeLog(existsSync(f) ? parseJsonl(readFileSync(f, 'utf8')) : [], evs);
      writeFileSync(f, merged.map(e => JSON.stringify(e)).join('\n') + '\n');
      if (p) p.lastSeen = Date.now();
      return json(res, 200, { ok: true, n: evs.length });
    }
    if (u.pathname.startsWith('/control/')) {
      if (!local(req)) return json(res, 403, { error: 'control is localhost only' });
      if (u.pathname === '/control/status') return json(res, 200, status());
      if (req.method === 'POST' && u.pathname === '/control/start') {
        if (aborted) return json(res, 409, { error: 'aborted: ' + aborted });
        const b = JSON.parse(await body(req));
        const at = scheduleStart(Date.now(), Number(b.leadMs ?? 5000), [...players.values()].map(p => p.rtt || 0));
        step = { quality: b.quality, step: b.step, md5: b.md5, url: b.url, laptops: b.laptops, tabs: Number(b.tabs || 1), duration: Number(b.duration || 180), at, synthN: Number(b.synthN || 0) };
        log('step', step); broadcast('start', step, inStep);
        if (step.synthN > 0 && b.rampCmd) startRamp(b.rampCmd, at);
        return json(res, 200, { at, players: [...players.values()].filter(inStep).length });
      }
      if (req.method === 'POST' && u.pathname === '/control/stop') { broadcast('stop', {}); stopRamp(); log('stop', { step: step?.step }); step = null; return json(res, 200, { ok: true }); }
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { log('error', { msg: e.message }); json(res, 400, { error: e.message }); }
});

function status() {
  return { now: Date.now(), port: PORT, paused, aborted, step,
    players: [...players.values()].map(p => ({ id: p.id, laptop: p.laptop, tab: p.tab, connected: !!p.res, offset: p.offset ?? null, rtt: p.rtt ?? null, lastSeen: p.lastSeen })) };
}

// Synthetic ramp: started by the runner so it can be paused with the players (SIGSTOP/SIGCONT).
function startRamp(cmd, at) {
  stopRamp();
  setTimeout(() => { if (!step) return; ramp = spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = join(DIR, `ramp-${step.quality}-${step.step}.log`); ramp.stdout.on('data', d => appendFileSync(out, d)); ramp.stderr.on('data', d => appendFileSync(out, d));
    if (paused) ramp.kill('SIGSTOP'); log('ramp-start', { pid: ramp.pid }); ramp.on('exit', () => { ramp = null; }); }, Math.max(0, at - Date.now()));
}
function stopRamp() { if (ramp) { try { ramp.kill('SIGCONT'); ramp.kill('SIGTERM'); } catch {} ramp = null; } }

// Thermal watch: pause >HI, resume <LO, abort if throttled != 0x0.
const TEMP_FILE = process.env.I159_TEMP_FILE || '/sys/class/thermal/thermal_zone0/temp';
function readTemp() { try { const v = Number(readFileSync(TEMP_FILE, 'utf8').trim()); return v > 1000 ? v / 1000 : v; } catch { return NaN; } }
function readThrottled(cb) {
  if (process.env.I159_THROTTLE_FILE) { try { return cb(readFileSync(process.env.I159_THROTTLE_FILE, 'utf8').trim()); } catch { return cb(null); } }
  execFile('vcgencmd', ['get_throttled'], { timeout: 5000 }, (e, out) => cb(e ? null : String(out).trim().replace(/^throttled=/, '')));
}
function thermalTick() {
  const t = readTemp(); const next = thermalNext(paused, t, HI, LO);
  if (next !== paused) { paused = next; log(paused ? 'thermal-pause' : 'thermal-resume', { tempC: t });
    broadcast(paused ? 'pause' : 'resume', { tempC: t }); if (ramp) ramp.kill(paused ? 'SIGSTOP' : 'SIGCONT'); }
  readThrottled(v => { if (v && v !== '0x0' && !aborted) { aborted = `throttled=${v}`; log('abort', { throttled: v, tempC: t }); broadcast('stop', { reason: aborted }); stopRamp(); step = null; } });
  appendFileSync(join(DIR, 'thermal.log'), JSON.stringify({ t: Date.now(), tempC: t, paused }) + '\n');
}
const thermal = setInterval(thermalTick, Number(process.env.I159_THERMAL_MS || 10000)); thermalTick();

function shutdown() { clearInterval(thermal); stopRamp(); broadcast('stop', { reason: 'runner exit' }); log('exit'); for (const p of players.values()) try { p.res?.end(); } catch {} server.close(); setTimeout(() => process.exit(0), 200).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
server.listen(PORT, '0.0.0.0', () => { writeFileSync(join(DIR, 'runner.pid'), String(process.pid)); log('listen', { port: PORT, pid: process.pid, node: process.version }); console.log(`i159 runner on :${PORT} pid ${process.pid}`); });
