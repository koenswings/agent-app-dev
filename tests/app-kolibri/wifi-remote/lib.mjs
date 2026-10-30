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
