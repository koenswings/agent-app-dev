// capacity-lib.mjs: pure logic for the Pi serving-capacity measurement (idea#159, CAPACITY-PLAN.md).
// Node 20/22/24 built-ins only. No I/O here, so everything is unit-testable on the box.

// Accepted thresholds: Steve, 30 Oct 2026 12:45 CET (#159), plus #26 "smooth stream" and #159 health rules.
export const THRESHOLDS = Object.freeze({
  maxStallMs: 2000,        // S1  no stall longer than 2 s (#26)
  maxRebufPerMin: 1,       // S1  at most 1 rebuffer per minute per stream (#26)
  minPlayRatio: 0.99,      // S2  >= 100% of bitrate delivered (1% timing tolerance)
  ttffP95Ms: 3000,         // S3  time to first frame p95 <= 3 s (Steve)
  ttffMaxMs: 5000,         // S3  and no stream above 5 s
  apiP95Ms: 1000,          // S4  concurrent non-video user p95 <= 1 s (Steve)
  maxTempC: 75,            // S6
  memFloorKiB: 150 * 1024, // S7  MemAvailable >= 150 MiB (#159)
  loadMult: 3,             // S9  warning only: loadavg1 <= 3 x nproc
});

export function percentile(values, p) {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[i];
}

// Player model for one stream. Media seconds = bytes * 8 / bps. Playback starts once startupS of media is
// buffered (that moment is TTFF), then the playhead advances in real time. A stall starts when the playhead
// catches up with the downloaded media and ends once resumeS is buffered again. The client keeps at most
// aheadS buffered (paced at the video bitrate, like a real player; not as fast as possible).
export class PlayBuffer {
  constructor({ bps, t0, startupS = 2, resumeS = 1, aheadS = 4 }) {
    if (!(bps > 0)) throw new Error('bps must be > 0');
    Object.assign(this, { bps, t0, startupS, resumeS, aheadS });
    this.last = t0; this.media = 0; this.playhead = 0; this.state = 'startup'; this.ttffMs = null;
    this.playStart = null; this.stallStart = null; this.stalls = []; this.bytes = 0;
  }
  advance(t, bytes = 0) {
    if (t < this.last) t = this.last;
    if (this.state === 'playing') {
      const ph = this.playhead + (t - this.last) / 1000;
      if (ph >= this.media) { this.stallStart = this.last + (this.media - this.playhead) * 1000; this.playhead = this.media; this.state = 'stalled'; }
      else this.playhead = ph;
    }
    this.last = t; this.bytes += bytes; this.media += (bytes * 8) / this.bps;
    if (this.state === 'startup' && this.media >= this.startupS) { this.state = 'playing'; this.ttffMs = t - this.t0; this.playStart = t; }
    else if (this.state === 'stalled' && this.media - this.playhead >= this.resumeS) { this.stalls.push(t - this.stallStart); this.state = 'playing'; this.stallStart = null; }
    return this;
  }
  buffer() { return this.media - this.playhead; }
  wantMore() { return this.buffer() < this.aheadS; }   // pacing: read only while the buffer is below aheadS
  finish(t) {
    this.advance(t);
    const open = this.state === 'stalled' ? t - this.stallStart : 0;
    const stalls = open > 0 ? [...this.stalls, open] : [...this.stalls];
    const playWinMs = this.playStart == null ? 0 : t - this.playStart;
    const stalledMs = stalls.reduce((a, b) => a + b, 0);
    return {
      ttffMs: this.ttffMs, bytes: this.bytes, stalls: stalls.length, maxStallMs: stalls.length ? Math.max(...stalls) : 0, stalledMs,
      rebufPerMin: playWinMs > 0 ? stalls.length / (playWinMs / 60000) : null,
      playRatio: playWinMs > 0 ? Math.max(0, (playWinMs - stalledMs) / playWinMs) : 0,
      mbps: playWinMs > 0 ? (this.bytes * 8) / (t - this.t0) / 1000 : 0,
    };
  }
}

// API probe events: {t, path, ms, status, err}
export function apiSummary(events) {
  const ms = events.filter(e => e.status && !e.err).map(e => e.ms);
  const bad = events.filter(e => e.err || !e.status || e.status >= 500);
  return { n: events.length, p50: percentile(ms, 50), p95: percentile(ms, 95), max: ms.length ? Math.max(...ms) : null, errors: bad.length };
}

// Sampler lines (pi-sampler.sh): {t,temp,throttled,mem_avail_kb,load1,oom_kill,cpu_busy,cpu_total,net_rx,net_tx,disk_rd,disk_wr,k_restart,k_running,k_cpu,k_mem,k_threads}
export function samplesSummary(samples) {
  const s = samples.filter(x => x && Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  if (!s.length) return { n: 0 };
  const f = s[0], l = s[s.length - 1], secs = Math.max(1, (l.t - f.t) / 1000);
  const num = k => s.map(x => Number(x[k])).filter(Number.isFinite);
  const max = k => (num(k).length ? Math.max(...num(k)) : null), min = k => (num(k).length ? Math.min(...num(k)) : null);
  const d = k => (Number.isFinite(+l[k]) && Number.isFinite(+f[k]) ? +l[k] - +f[k] : null);
  const cpuT = d('cpu_total');
  return {
    n: s.length, peakTempC: max('temp'), throttled: [...new Set(s.map(x => x.throttled).filter(Boolean))],
    minMemAvailKiB: min('mem_avail_kb'), maxLoad1: max('load1'), oomKills: d('oom_kill'), restarts: d('k_restart'),
    kolibriDown: s.some(x => x.k_running === false || x.k_running === 'false'),
    cpuPct: cpuT > 0 ? Math.round((1000 * d('cpu_busy')) / cpuT) / 10 : null,
    txMbps: d('net_tx') != null ? Math.round((d('net_tx') * 8) / secs / 1e4) / 100 : null,
    rxMbps: d('net_rx') != null ? Math.round((d('net_rx') * 8) / secs / 1e4) / 100 : null,
    diskReadMBps: d('disk_rd') != null ? Math.round((d('disk_rd') * 512) / secs / 1e4) / 100 : null,
    peakKolibriCpu: max('k_cpu'), peakKolibriMemMiB: max('k_mem'), peakThreads: max('k_threads'),
  };
}

// One ramp step. streams: PlayBuffer.finish() results (+errors); api: probe events; samples: sampler lines;
// health: {engineOnline, thermalPaused, aborted}. Returns {safe, fails[], warn[], metrics}.
export function stepVerdict({ n, streams, api = [], samples = [], health = {}, nproc = 4 }, th = THRESHOLDS) {
  const fails = [], warn = [];
  const ttff = streams.map(x => x.ttffMs);
  const m = {
    n, streams: streams.length, started: ttff.filter(x => x != null).length,
    ttffP95: percentile(ttff, 95), ttffMax: ttff.some(x => x == null) ? null : Math.max(...ttff),
    worstStallMs: Math.max(0, ...streams.map(x => x.maxStallMs || 0)), worstRebufPerMin: Math.max(0, ...streams.map(x => x.rebufPerMin || 0)),
    minPlayRatio: streams.length ? Math.min(...streams.map(x => x.playRatio ?? 0)) : 0, httpErrors: streams.reduce((a, x) => a + (x.errors || 0), 0),
    api: apiSummary(api), pi: samplesSummary(samples),
  };
  if (streams.length !== n) fails.push(`S5 ${streams.length}/${n} streams reported`);
  if (m.started < streams.length) fails.push(`S3 ${streams.length - m.started} stream(s) never started`);
  if (m.worstStallMs > th.maxStallMs) fails.push(`S1 stall ${m.worstStallMs} ms > ${th.maxStallMs}`);
  if (m.worstRebufPerMin > th.maxRebufPerMin) fails.push(`S1 ${m.worstRebufPerMin.toFixed(2)} rebuffers/min > ${th.maxRebufPerMin}`);
  if (m.minPlayRatio < th.minPlayRatio) fails.push(`S2 play ratio ${m.minPlayRatio.toFixed(3)} < ${th.minPlayRatio}`);
  if (m.ttffP95 == null || m.ttffP95 > th.ttffP95Ms) fails.push(`S3 TTFF p95 ${m.ttffP95} ms > ${th.ttffP95Ms}`);
  else if (m.ttffMax == null || m.ttffMax > th.ttffMaxMs) fails.push(`S3 TTFF max ${m.ttffMax} ms > ${th.ttffMaxMs}`);
  if (!m.api.n) fails.push('S4 no API probe samples');
  else { if (m.api.p95 > th.apiP95Ms) fails.push(`S4 API p95 ${m.api.p95} ms > ${th.apiP95Ms}`); if (m.api.errors) fails.push(`S4 ${m.api.errors} API error(s)`); }
  if (m.httpErrors) fails.push(`S5 ${m.httpErrors} video HTTP error(s)`);
  const p = m.pi;
  if (!p.n) fails.push('S6 no Pi samples');
  else {
    if (p.peakTempC >= th.maxTempC) fails.push(`S6 temp ${p.peakTempC} C >= ${th.maxTempC}`);
    if (p.throttled.some(x => x !== '0x0')) fails.push(`S6 throttled ${p.throttled.join(',')}`);
    if (p.oomKills > 0) fails.push(`S7 ${p.oomKills} OOM kill(s)`);
    if (p.minMemAvailKiB != null && p.minMemAvailKiB < th.memFloorKiB) fails.push(`S7 MemAvailable ${Math.round(p.minMemAvailKiB / 1024)} MiB < ${th.memFloorKiB / 1024}`);
    if (p.restarts > 0 || p.kolibriDown) fails.push('S8 Kolibri restarted or down');
    if (p.maxLoad1 > th.loadMult * nproc) warn.push(`S9 load ${p.maxLoad1} > ${th.loadMult}x${nproc}`);
  }
  if (health.thermalPaused) fails.push('S6 thermal pause during step');
  if (health.engineOnline === false) fails.push('S8 Engine not online');
  if (health.aborted) fails.push(`abort: ${health.aborted}`);
  if (m.minPlayRatio < 0.85) warn.push('old #159 rule (>=85% bitrate) also fails');
  return { safe: fails.length === 0, fails, warn, metrics: m };
}

// Ramp of {n, safe} (in order): highest N such that it and every lower step were SAFE.
export function maxSafeN(steps) {
  let best = 0;
  for (const s of [...steps].sort((a, b) => a.n - b.n)) { if (!s.safe) break; best = s.n; }
  return best;
}

// Ramp steps, extended past 128 only if 128 was SAFE (Steve).
export const BASE_NS = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128];
export const EXT_NS = [160, 192, 256];
export function nextN(done) {
  const last = done[done.length - 1];
  if (!last) return BASE_NS[0];
  if (!last.safe) return null;
  const seq = [...BASE_NS, ...EXT_NS], i = seq.indexOf(last.n);
  return i >= 0 && i + 1 < seq.length ? seq[i + 1] : null;
}

// Planning N rule from #159: 32 x 902541 / bps, snapped down to a ramp step.
export function planningN(bps) {
  const raw = (32 * 902541) / bps; const steps = [...BASE_NS].reverse();
  return steps.find(s => s <= raw) ?? 1;
}

export function reportMarkdown({ meta, qualities }) {
  const L = [];
  L.push(`# Kolibri serving capacity (idea#159): ${meta.server} server, ${meta.loadgen} load host`, '');
  L.push(`Run ${meta.started} → ${meta.ended} (${meta.runtimeS} s). Image \`${meta.image}\`, port ${meta.port}. ${meta.dry ? '**DRY RUN**' : ''}`, '');
  L.push('| Item | Value |', '|---|---|');
  for (const [k, v] of Object.entries(meta.conditions || {})) L.push(`| ${k} | ${v} |`);
  L.push('', `> RAM caveat: ${meta.server} has ${meta.conditions?.['server RAM'] || '?'}, less than the 8 GB kit Engines.`, '');
  L.push('## Max safe N per quality', '', '| Quality | Bitrate (bps) | Max safe N | Planning N | Pi 5 / 0.15.5 result (#159) | Differs? |', '|---|---:|---:|---:|---|---|');
  for (const q of qualities) {
    const ms = maxSafeN(q.steps); const top = q.steps.length && q.steps.every(s => s.safe);
    L.push(`| ${q.name} | ${q.bps} | ${top ? '≥' : ''}${ms} | ${q.planningN ?? '–'} | ${q.prior ?? '–'} | ${q.planningN != null && ms < q.planningN ? '**below planning N**' : 'no'} |`);
  }
  L.push('', '## PASS/FAIL per step', '', '| Quality | N | Result | TTFF p95 ms | worst stall ms | min play ratio | API p95 ms | peak °C | CPU % | tx Mbps | min MemAvail MiB | Fails |', '|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const q of qualities) for (const s of q.steps) {
    const m = s.metrics || {}; const p = m.pi || {};
    L.push(`| ${q.name} | ${s.n} | ${s.safe ? 'PASS' : 'FAIL'}${s.retry ? ' (retry)' : ''} | ${m.ttffP95 ?? '–'} | ${m.worstStallMs ?? '–'} | ${m.minPlayRatio != null ? m.minPlayRatio.toFixed(3) : '–'} | ${m.api?.p95 ?? '–'} | ${p.peakTempC ?? '–'} | ${p.cpuPct ?? '–'} | ${p.txMbps ?? '–'} | ${p.minMemAvailKiB != null ? Math.round(p.minMemAvailKiB / 1024) : '–'} | ${(s.fails || []).join('; ')} |`);
  }
  if (meta.release) { L.push('', '## Release checks', '', '| Check | Result |', '|---|---|'); for (const [k, v] of Object.entries(meta.release)) L.push(`| ${k} | ${v} |`); }
  return L.join('\n') + '\n';
}
