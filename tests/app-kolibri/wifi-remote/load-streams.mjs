// load-streams.mjs: N paced video streams in one Node process (sim-laptop.mjs --mode load). idea#159.
// Each stream behaves like a player: HTTP Range GETs of the Kolibri content URL, reading only while its
// buffer is below aheadS seconds (paced at the video bitrate, not as fast as possible), looping the file
// for the whole hold. Player model + stall/TTFF accounting: PlayBuffer in capacity-lib.mjs.
import http from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
import { PlayBuffer } from './capacity-lib.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class LoadStream {
  constructor(i, o) { Object.assign(this, { i, o }); this.errors = 0; this.errLog = []; this.req = null; this.res = null; this.stopped = false; }
  log(ev, x = {}) { if (this.o.out) appendFileSync(this.o.out, JSON.stringify({ t: Date.now(), i: this.i, ev, ...x }) + '\n'); }
  fail(msg) { this.errors++; if (this.errLog.length < 20) this.errLog.push(msg); this.log('error', { msg }); }
  get(offset) {
    return new Promise(resolve => {
      const u = new URL(this.o.url);
      const req = http.get({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, agent: this.o.agent, headers: { Range: `bytes=${offset}-` } }, res => {
        this.res = res;
        if (res.statusCode >= 400) { this.fail(`HTTP ${res.statusCode}`); res.resume(); return res.on('end', () => resolve({ ok: false })); }
        const cr = /\/(\d+)$/.exec(res.headers['content-range'] || ''); const size = cr ? Number(cr[1]) : Number(res.headers['content-length'] || 0);
        let got = 0;
        res.on('data', c => { got += c.length; this.pb.advance(Date.now(), c.length); if (!this.pb.wantMore()) res.pause(); });
        res.on('end', () => resolve({ ok: true, got, size, restart: res.statusCode === 200 }));
        res.on('error', e => { if (!this.stopped) this.fail(`res ${e.code || e.message}`); resolve({ ok: false }); });
      });
      req.setTimeout(this.o.timeoutMs, () => { this.fail('timeout'); req.destroy(); });
      req.on('error', e => { if (!this.stopped) this.fail(`req ${e.code || e.message}`); resolve({ ok: false }); });
      this.req = req;
    });
  }
  async run(endAt) {
    const o = this.o; this.pb = new PlayBuffer({ bps: o.bps, t0: Date.now(), startupS: o.startupS, resumeS: o.resumeS, aheadS: o.aheadS });
    let lastLog = 0, ttffLogged = false;
    const tick = setInterval(() => {
      const t = Date.now(); this.pb.advance(t);
      if (this.res?.isPaused() && this.pb.wantMore()) this.res.resume();
      if (!ttffLogged && this.pb.ttffMs != null) { ttffLogged = true; this.log('ttff', { ms: this.pb.ttffMs }); }
      if (t - lastLog >= 1000) { lastLog = t; this.log('s', { bytes: this.pb.bytes, buf: +this.pb.buffer().toFixed(2), st: this.pb.state }); }
    }, o.tickMs);
    const done = sleep(Math.max(0, endAt - Date.now())).then(() => 'end');
    let offset = 0;
    while (Date.now() < endAt) {
      const r = await Promise.race([this.get(offset), done]);
      if (r === 'end') break;
      if (!r.ok) { await Promise.race([sleep(500), done]); continue; }
      offset = r.restart ? r.got : offset + r.got;
      if (r.size && offset >= r.size) offset = 0;          // loop the file for the whole hold
    }
    this.stopped = true; clearInterval(tick); this.req?.destroy();
    const s = { i: this.i, ...this.pb.finish(Math.min(Date.now(), endAt)), errors: this.errors, errLog: this.errLog };
    this.log('end', s); return s;
  }
}

// runLoad: n streams, staggered evenly over rampS, all measured until start + rampS + holdS.
export async function runLoad(o) {
  const opts = { startupS: 2, resumeS: 1, aheadS: 4, tickMs: 100, timeoutMs: 10000, rampS: 15, holdS: 120, ...o };
  opts.agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
  const t0 = Date.now(), endAt = t0 + (opts.rampS + opts.holdS) * 1000;
  const streams = Array.from({ length: opts.n }, (_, i) => new LoadStream(i, opts));
  if (opts.out) appendFileSync(opts.out, JSON.stringify({ t: t0, ev: 'load-start', n: opts.n, bps: opts.bps, url: opts.url, rampS: opts.rampS, holdS: opts.holdS, aheadS: opts.aheadS, pid: process.pid }) + '\n');
  const results = await Promise.all(streams.map(async (s, i) => { await sleep((i * opts.rampS * 1000) / opts.n); return s.run(endAt); }));
  opts.agent.destroy();
  const summary = { t0, t1: Date.now(), n: opts.n, bps: opts.bps, url: opts.url, rampS: opts.rampS, holdS: opts.holdS, streams: results };
  if (opts.summary) writeFileSync(opts.summary, JSON.stringify(summary, null, 1));
  return summary;
}
