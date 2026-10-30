#!/usr/bin/env node
// sim-laptop.mjs — simulated laptop for the UNATTENDED e2e test (idea#159). Node 20/22 built-ins only.
// Acts out the player/preflight page protocol against runner.mjs (pull model: it opens every connection):
// SSE /events, POST /ping clock sync, 'start at T', paced video download, JSONL POST /results with retry,
// reconnect after a drop, thermal pause/resume, stop. It is NOT a browser: no decoding, no rendering.
//
//   node sim-laptop.mjs --runner http://127.0.0.1:3159 --laptop A [--tab 1] [--mode field|preflight]
//        [--skew-ms 0] [--rate 300000] [--drop-after-s 0] [--exit-after-s 600] [--pf-s 30] [--out sim-A.jsonl]
import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { clockOffset, timerDrift } from './lib.mjs';

export function parseArgs(argv) {
  const a = { mode: 'field', tab: '1', 'skew-ms': '0', rate: '300000', 'drop-after-s': '0', 'exit-after-s': '600', 'pf-s': '30' };
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? '1' : argv[++i];
  if (!a.runner || !a.laptop) throw new Error('--runner and --laptop are required');
  if (!['field', 'preflight'].includes(a.mode)) throw new Error('--mode field|preflight');
  return { runner: a.runner.replace(/\/+$/, ''), laptop: a.laptop, tab: Number(a.tab), mode: a.mode, skew: Number(a['skew-ms']), rate: Number(a.rate),
    dropAfter: Number(a['drop-after-s']), exitAfter: Number(a['exit-after-s']), pfS: Number(a['pf-s']), out: a.out || null };
}

// SSE parser: feed chunks, get {type, data} events.
export function sseParser(onEvent) {
  let buf = '';
  return chunk => { buf += chunk; let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2);
      const type = /^event: (.*)$/m.exec(blk)?.[1]; const data = /^data: (.*)$/m.exec(blk)?.[1];
      if (type) { let d = null; try { d = JSON.parse(data); } catch {} onEvent({ type, data: d }); } } };
}

export class SimLaptop {
  constructor(o) {
    Object.assign(this, o); this.id = `sim-${o.laptop}-${o.tab}-${process.pid}`; this.seq = 0; this.queue = []; this.offset = null;
    this.cur = null; this.paused = false; this.sse = null; this.dropped = false; this.done = false; this.received = []; this.timers = [];
  }
  now() { return Date.now() - this.skew; }                         // simulated laptop clock (wrong by -skew)
  note(ev, x = {}) { const e = { t: this.now(), ev, sim: true, ...x }; if (this.out) appendFileSync(this.out, JSON.stringify(e) + '\n'); return e; }
  push(ev, x = {}) { if (!this.cur) return; this.queue.push({ t: this.now(), seq: this.seq++, ev, ...x }); }
  req(method, path, body, base = this.runner) {
    return new Promise((res, rej) => { const u = new URL(path, base);
      const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, timeout: 10000 }, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => res({ code: s.statusCode, body: d })); });
      r.on('error', rej); r.on('timeout', () => r.destroy(new Error('timeout'))); if (body) r.write(body); r.end(); });
  }
  async sync() {
    const samples = [];
    for (let i = 0; i < 5; i++) { const t0 = this.now(); try { const { ts } = JSON.parse((await this.req('POST', '/ping', JSON.stringify({ id: this.id }))).body); samples.push({ t0, ts, t1: this.now() }); } catch {} }
    const o = clockOffset(samples); if (o) { this.offset = o.offset; await this.req('POST', '/ping', JSON.stringify({ id: this.id, samples })).catch(() => {}); }
    return o;
  }
  async flush(final = false) {
    if (!this.cur || !this.queue.length) return true; const batch = this.queue.splice(0); const c = this.cur;
    const q = new URLSearchParams({ id: this.id, laptop: this.laptop, tab: this.tab, quality: c.quality, step: c.step, offset: this.offset ?? '' });
    for (let i = 0; i < (final ? 5 : 3); i++) {
      try { const r = await this.req('POST', '/results?' + q, batch.map(e => JSON.stringify(e)).join('\n') + '\n'); if (r.code === 200) return true; } catch {}
      await sleep(300 * 2 ** i);
    }
    this.queue.unshift(...batch); return false;
  }
  connect() {
    return new Promise(resolve => {
      const q = new URLSearchParams({ id: this.id, laptop: this.mode === 'preflight' ? 'preflight-' + this.laptop : this.laptop, tab: this.tab });
      const u = new URL('/events?' + q, this.runner);
      const r = http.get({ host: u.hostname, port: u.port, path: u.pathname + u.search }, s => {
        s.setEncoding('utf8'); const feed = sseParser(e => this.onEvent(e, resolve)); s.on('data', feed);
        s.on('end', () => this.reconnect()); s.on('error', () => this.reconnect());
      });
      r.on('error', () => { this.sse = null; resolve(false); });
      this.sse = r;
    });
  }
  async reconnect() { if (this.done || this.reconnecting || this.mode === 'preflight') return; this.reconnecting = true; this.push('disconnect'); this.note('disconnect');
    for (let i = 0; !this.done; i++) { await sleep(2000); if (await this.connect()) { this.note('reconnected'); break; } if (i > 30) { this.note('gave-up'); this.done = true; } }
    this.reconnecting = false; }
  onEvent({ type, data }, resolve) {
    this.received.push(type); this.note('sse', { type });
    if (type === 'hello') { resolve?.(true); this.sync(); }
    if (type === 'start' && this.mode === 'field' && !(this.cur && this.cur.step === data.step && this.cur.quality === data.quality)) this.begin(data);
    if (type === 'stop') this.end(data?.reason);
    if (type === 'pause') { this.paused = true; this.push('thermal-pause', data || {}); }
    if (type === 'resume') { this.paused = false; this.push('thermal-resume', data || {}); }
  }
  begin(s) {
    this.cur = { ...s }; const localAt = this.offset === null ? s.at : s.at - this.offset;
    this.timers.push(setTimeout(async () => {
      this.push('start', { laptop: this.laptop, quality: s.quality, step: s.step, tab: this.tab, url: s.url, duration: s.duration, ua: 'sim-laptop', offset: this.offset });
      const until = Date.now() + s.duration * 1000; const h = Number(String(s.quality).replace(/\D/g, '')) || 0;
      this.timers.push(setInterval(() => this.push('quality', { videoWidth: Math.round(h * 16 / 9), videoHeight: h, droppedVideoFrames: 0, totalVideoFrames: 0, sim: true }), 1000));
      this.timers.push(setInterval(() => this.flush(), 5000));
      if (this.dropAfter > 0 && !this.dropped) this.timers.push(setTimeout(() => { this.dropped = true; this.sse?.destroy(); }, this.dropAfter * 1000));
      await this.stream(s.url, until);
      this.end();
    }, Math.max(0, localAt - this.now())));
  }
  // Paced download (low load): emit 'playing' on first bytes, 'waiting' when the read falls behind the pace.
  async stream(url, until) {
    let first = true, waiting = false;
    while (Date.now() < until && this.cur && !this.done) {
      if (this.paused) { await sleep(500); continue; }
      try {
        await new Promise((res, rej) => { const u = new URL(url);
          const r = http.get({ host: u.hostname, port: u.port, path: u.pathname }, s => {
            if (s.statusCode >= 400) { this.push('error', { code: s.statusCode }); s.resume(); return res(); }
            let t0 = Date.now(), got = 0;
            s.on('data', c => { got += c.length;
              if (first) { first = false; this.push('playing'); }
              if (waiting) { waiting = false; this.push('playing'); }
              const ahead = got / this.rate * 1000 - (Date.now() - t0);
              if (ahead > 0) { s.pause(); setTimeout(() => s.resume(), Math.min(ahead, 1000)); }
              if (Date.now() >= until || !this.cur || this.paused) { s.destroy(); res(); } });
            s.on('end', res); s.on('close', res); s.on('error', rej); });
          r.on('error', rej); });
      } catch (e) { if (!waiting) { waiting = true; this.push('waiting', { msg: e.message }); } await sleep(1000); }
    }
  }
  async end(reason) { if (!this.cur) return; this.push('end', reason ? { reason } : {}); this.timers.forEach(t => { clearTimeout(t); clearInterval(t); }); this.timers = [];
    await this.flush(true); this.note('step-end', { step: this.cur.step, reason }); this.cur = null; }

  // Preflight: same items as preflight.js, measured the way a Node client can (rAF/visibility are not applicable).
  async preflight() {
    const items = []; const item = (name, pass, detail) => items.push({ t: this.now(), seq: this.seq++, ev: 'item', laptop: this.laptop, name, pass, detail });
    const log = [{ t: this.now(), seq: this.seq++, ev: 'start', laptop: this.laptop, url: this.runner + '/preflight?laptop=' + this.laptop, ua: 'sim-laptop' }];
    item('page_loaded', (await this.req('GET', '/preflight').catch(() => ({ code: 0 }))).code === 200, { origin: this.runner, sim: true });
    let cfg = {}; try { cfg = JSON.parse((await this.req('GET', '/preflight-config')).body); item('fetch', true); } catch (e) { item('fetch', false, String(e)); }
    const other = (cfg.urls || []).find(u => { try { return new URL(u).origin !== new URL(this.runner).origin; } catch { return false; } });
    if (other) { try { const r = await this.req('POST', '/ping', '{}', other); item('other_url', r.code === 200, { url: other }); } catch (e) { item('other_url', false, { url: other, error: e.message }); } }
    else item('other_url', false, { error: 'no other URL configured' });
    item('events', !!(await Promise.race([this.connect(), sleep(10000).then(() => false)])));
    try { item('post', (await this.req('POST', '/ping', JSON.stringify({ id: this.id }))).code === 200); } catch (e) { item('post', false, e.message); }
    const ticks = []; const iv = setInterval(() => ticks.push(Date.now()), 1000);
    this.cur = { quality: 'pf', step: 'pf' }; let played = false;
    const s0 = this.queue.length; await this.stream(cfg.video || '', Date.now() + this.pfS * 1000).catch(() => {});
    played = this.queue.slice(s0).some(e => e.ev === 'playing'); const errs = this.queue.slice(s0).filter(e => e.ev === 'error').length;
    this.queue.length = s0; this.cur = null; clearInterval(iv);
    item('playback', played && errs === 0, { video: cfg.video || null, seconds: this.pfS, errors: errs });
    item('stayed_visible', true, { sim: 'not applicable to a Node client' });
    const d = timerDrift(ticks); item('no_throttle', d < 1500, { worst_timer_late_ms: d });
    item('no_frame_gaps', true, { sim: 'not applicable to a Node client' });
    item('fullscreen', false, { sim: 'not applicable' }); item('wake_lock', false, { sim: 'not applicable' });
    const all = [...log, ...items]; const pass = ['page_loaded', 'fetch', 'events', 'post', 'playback', 'no_throttle'].every(n => items.find(i => i.name === n)?.pass);
    all.push({ t: this.now(), seq: this.seq++, ev: 'verdict', pass, sim: true });
    const r = await this.req('POST', `/preflight-result?${new URLSearchParams({ id: this.id, laptop: this.laptop })}`, all.map(e => JSON.stringify(e)).join('\n') + '\n');
    this.note('preflight', { pass, code: r.code }); this.done = true; this.sse?.destroy(); return pass;
  }
  async run() {
    const deadline = Date.now() + this.exitAfter * 1000;
    while (!(await this.connect())) { if (Date.now() > deadline) { this.note('no-runner'); return 3; } await sleep(2000); }   // runner may start later
    if (this.mode === 'preflight') { this.sse?.destroy(); this.sse = null; return (await this.preflight()) ? 0 : 1; }
    while (!this.done && Date.now() < deadline) await sleep(1000);
    this.done = true; this.sse?.destroy(); return 0;
  }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const sim = new SimLaptop(parseArgs(process.argv.slice(2)));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { sim.done = true; await sim.end('sim exit'); process.exit(0); });
  sim.run().then(code => process.exit(code));
}
