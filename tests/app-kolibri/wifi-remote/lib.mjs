// Pure helpers for the remote Wi-Fi field test (idea#159). No dependencies; unit-tested with node --test.

// Thresholds kept from WIFI-FIELD-TEST.md §3 (smooth stream).
export const MAX_STALL_S = 2;
export const MAX_REBUFFERS_PER_MIN = 1;

const TAILSCALE_V4 = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./; // 100.64.0.0/10

// Laptop -> Pi traffic must cross the school Wi-Fi under test, never the tailnet.
export function assertLanUrl(url) {
  const u = new URL(url);
  const h = u.hostname;
  if (TAILSCALE_V4.test(h) || h.endsWith('.ts.net') || h.startsWith('fd7a:115c:a1e0')) {
    throw new Error(`refusing Tailscale address ${h}: use http://<sticker>.local or the LAN IP`);
  }
  return u.toString();
}

// Kolibri content URL from an MD5 (same layout as kolibri_stream_loadtest.py).
export function contentUrl(base, md5, ext = 'mp4') {
  if (!/^[0-9a-f]{32}$/.test(md5)) throw new Error(`bad md5 ${md5}`);
  return `${base.replace(/\/+$/, '')}/content/storage/${md5[0]}/${md5[1]}/${md5}.${ext}`;
}

export function parseJsonl(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip torn last line */ }
  }
  return out;
}

// Turn a time-ordered event list for ONE stream into metrics.
// Events: {t: ms epoch, ev: 'start'|'playing'|'waiting'|'stalled'|'quality'|'error'|'end', ...}
// A stall = from 'waiting' (or 'stalled') while playing, to the next 'playing'.
// The first wait before the first 'playing' is startup, not a rebuffer.
export function streamMetrics(events) {
  const ev = [...events].sort((a, b) => a.t - b.t);
  let started = null, firstPlay = null, end = null, stallStart = null;
  const stalls = [];
  let last = null, errors = 0, maxW = 0, maxH = 0, minH = Infinity;
  for (const e of ev) {
    if (e.ev === 'start' && started === null) started = e.t;
    if (e.ev === 'playing') {
      if (firstPlay === null) firstPlay = e.t;
      else if (stallStart !== null) stalls.push((e.t - stallStart) / 1000);
      stallStart = null;
    }
    if ((e.ev === 'waiting' || e.ev === 'stalled') && firstPlay !== null && stallStart === null) stallStart = e.t;
    if (e.ev === 'error') errors++;
    if (e.ev === 'quality') {
      last = e;
      if (e.videoHeight) { maxH = Math.max(maxH, e.videoHeight); minH = Math.min(minH, e.videoHeight); maxW = Math.max(maxW, e.videoWidth || 0); }
    }
    if (e.ev === 'end') end = e.t;
  }
  if (end === null && ev.length) end = ev[ev.length - 1].t;
  if (stallStart !== null && end !== null) stalls.push((end - stallStart) / 1000); // still stalled at end
  const watchedS = firstPlay !== null && end !== null ? (end - firstPlay) / 1000 : 0;
  const minutes = watchedS / 60;
  const rebuffers = stalls.length;
  const m = {
    startup_s: started !== null && firstPlay !== null ? (firstPlay - started) / 1000 : null,
    watched_s: round(watchedS),
    stalls: rebuffers,
    stall_total_s: round(stalls.reduce((a, b) => a + b, 0)),
    stall_max_s: round(stalls.length ? Math.max(...stalls) : 0),
    rebuffers_per_min: minutes > 0 ? round(rebuffers / minutes) : null,
    dropped_frames: last?.droppedVideoFrames ?? null,
    total_frames: last?.totalVideoFrames ?? null,
    resolution: maxH ? `${maxW}x${maxH}` : null,
    resolution_dropped: maxH && minH < maxH,
    errors,
    played: firstPlay !== null,
  };
  m.smooth = m.played && errors === 0 && m.stall_max_s <= MAX_STALL_S &&
    (m.rebuffers_per_min ?? 0) <= MAX_REBUFFERS_PER_MIN && !m.resolution_dropped;
  return m;
}

function round(x) { return Math.round(x * 100) / 100; }

// rows: [{laptop, quality, step, tab, events}] -> per-stream rows + per (quality, step) summary.
export function summarise(streams) {
  const rows = streams.map(s => ({ laptop: s.laptop, quality: s.quality, step: s.step ?? '', tab: s.tab ?? 1, ...streamMetrics(s.events) }));
  rows.sort((a, b) => cmp(a.quality, b.quality) || cmp(a.step, b.step) || cmp(a.laptop, b.laptop) || a.tab - b.tab);
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.quality}\u0000${r.step}`;
    if (!groups.has(k)) groups.set(k, { quality: r.quality, step: r.step, streams: 0, all_smooth: true, stalls: 0, stall_total_s: 0, worst_rebuffers_per_min: 0, dropped_frames: 0 });
    const g = groups.get(k);
    g.streams++; g.all_smooth &&= r.smooth; g.stalls += r.stalls;
    g.stall_total_s = round(g.stall_total_s + r.stall_total_s);
    g.worst_rebuffers_per_min = Math.max(g.worst_rebuffers_per_min, r.rebuffers_per_min ?? 0);
    g.dropped_frames += r.dropped_frames ?? 0;
  }
  return { rows, groups: [...groups.values()] };
}

const QORDER = ['360p', '480p', '720p', '1080p'];
function cmp(a, b) {
  const ia = QORDER.indexOf(a), ib = QORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function markdown({ rows, groups }) {
  const L = ['| Laptop | Quality | Step | Tab | Smooth | Stalls | Stall total s | Max stall s | Rebuf/min | Dropped/Total frames | Resolution | Startup s |',
    '|---|---|---|---:|---|---:|---:|---:|---:|---|---|---:|'];
  for (const r of rows) L.push(`| ${r.laptop} | ${r.quality} | ${r.step} | ${r.tab} | ${r.smooth ? 'yes' : 'NO'} | ${r.stalls} | ${r.stall_total_s} | ${r.stall_max_s} | ${r.rebuffers_per_min ?? '-'} | ${r.dropped_frames ?? '-'}/${r.total_frames ?? '-'} | ${r.resolution ?? '-'} | ${r.startup_s ?? '-'} |`);
  L.push('', '| Quality | Step | Streams | All smooth | Stalls | Stall total s | Worst rebuf/min | Dropped frames |', '|---|---|---:|---|---:|---:|---:|---:|');
  for (const g of groups) L.push(`| ${g.quality} | ${g.step} | ${g.streams} | ${g.all_smooth ? 'yes' : 'NO'} | ${g.stalls} | ${g.stall_total_s} | ${g.worst_rebuffers_per_min} | ${g.dropped_frames} |`);
  return L.join('\n') + '\n';
}

// ---- Player-page mode (idea#159, option B): pure helpers shared by runner.mjs and the tests ----

// NTP-style offset from ping samples [{t0, ts, t1}] (t0/t1 page clock, ts Engine clock).
// Uses the sample with the smallest round trip. engine_time = page_time + offset.
export function clockOffset(samples) {
  const ok = samples.filter(s => [s.t0, s.ts, s.t1].every(Number.isFinite) && s.t1 >= s.t0);
  if (!ok.length) return null;
  const best = ok.reduce((a, b) => (b.t1 - b.t0 < a.t1 - a.t0 ? b : a));
  return { offset: Math.round(best.ts - (best.t0 + best.t1) / 2), rtt: best.t1 - best.t0, n: ok.length };
}

// Engine start time T: now + lead, rounded up to a whole second, and late enough for the slowest round trip.
export function scheduleStart(nowMs, leadMs = 5000, rtts = []) {
  const lead = Math.max(leadMs, 3 * Math.max(0, ...rtts));
  return Math.ceil((nowMs + lead) / 1000) * 1000;
}

// Page-clock events -> Engine-clock events in the lib format ({t, ev, ...}); keeps the page time as t_page.
export function toEngineTime(events, offset) {
  return events.filter(e => e && Number.isFinite(e.t) && typeof e.ev === 'string')
    .map(e => ({ ...e, t_page: e.t, t: e.t + (offset ?? 0) }));
}

// Merge uploads for one stream: dedupe by seq (retries resend), sort by Engine time.
export function mergeLog(existing, incoming) {
  const seen = new Set(existing.map(e => e.seq).filter(s => s !== undefined));
  const out = [...existing];
  for (const e of incoming) { if (e.seq !== undefined && seen.has(e.seq)) continue; if (e.seq !== undefined) seen.add(e.seq); out.push(e); }
  return out.sort((a, b) => a.t - b.t || (a.seq ?? 0) - (b.seq ?? 0));
}

export function streamFile(laptop, quality, step, tab) {
  const safe = s => String(s).replace(/[^A-Za-z0-9_]/g, '_');
  return `${safe(laptop)}-${safe(quality)}-${safe(step)}-tab${Number(tab) || 1}.jsonl`;
}

// Thermal state machine: pause above hi, resume below lo (hysteresis).
export function thermalNext(paused, tempC, hi = 75, lo = 65) {
  if (!Number.isFinite(tempC)) return paused;
  if (!paused && tempC > hi) return true;
  if (paused && tempC < lo) return false;
  return paused;
}

// ---- Teacher preflight (idea#159): ~2 min on one laptop before the field run ----
// Required items must all pass; info items are reported but do not decide the verdict.
export const PREFLIGHT_REQUIRED = ['page_loaded', 'fetch', 'events', 'post', 'playback', 'stayed_visible', 'no_throttle', 'no_frame_gaps'];
export const PREFLIGHT_INFO = ['other_url', 'fullscreen', 'wake_lock'];

// Timer drift: worst lateness of a 1 s interval (ms). Chrome throttles hidden tabs to >=1 s (often 60 s).
export function timerDrift(ticksMs, periodMs = 1000) {
  let worst = 0;
  for (let i = 1; i < ticksMs.length; i++) worst = Math.max(worst, ticksMs[i] - ticksMs[i - 1] - periodMs);
  return Math.round(worst);
}

// requestAnimationFrame gaps: rAF stops when the tab is hidden or the compositor stops drawing (minimised,
// occluded, display off). It does NOT reliably stop for a screensaver dim/blank on Wayland, so this is a proxy.
export function frameGaps(frameMs, gapMs = 1000) {
  const gaps = [];
  for (let i = 1; i < frameMs.length; i++) if (frameMs[i] - frameMs[i - 1] > gapMs) gaps.push(Math.round(frameMs[i] - frameMs[i - 1]));
  return { gaps: gaps.length, worst_ms: gaps.length ? Math.max(...gaps) : 0 };
}

// events: preflight JSONL ({ev:'item', name, pass, detail}, ...). Last result per item wins.
export function preflightVerdict(events) {
  const items = {};
  for (const e of events) if (e.ev === 'item' && e.name) items[e.name] = { pass: !!e.pass, detail: e.detail ?? null };
  const missing = PREFLIGHT_REQUIRED.filter(n => !(n in items));
  const failed = PREFLIGHT_REQUIRED.filter(n => items[n] && !items[n].pass);
  const laptop = events.find(e => e.laptop)?.laptop ?? null;
  const url = events.find(e => e.ev === 'start')?.url ?? null;
  return { laptop, url, pass: !missing.length && !failed.length, failed, missing, items };
}

export function preflightMarkdown(v) {
  const L = [`# Preflight ${v.laptop ?? '?'}: ${v.pass ? 'PASS' : 'FAIL'}`, '', `Loaded: ${v.url ?? '-'}`, '', '| Item | Result | Detail |', '|---|---|---|'];
  for (const n of [...PREFLIGHT_REQUIRED, ...PREFLIGHT_INFO]) {
    const i = v.items[n];
    L.push(`| ${n}${PREFLIGHT_INFO.includes(n) ? ' (info)' : ''} | ${i ? (i.pass ? 'PASS' : 'FAIL') : 'missing'} | ${i?.detail != null ? JSON.stringify(i.detail).replace(/\|/g, '/') : ''} |`);
  }
  return L.join('\n') + '\n';
}
