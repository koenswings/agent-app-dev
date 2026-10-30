// player.js — runs in the laptop's normal Chrome. Pull model: this page opens every connection to the runner.
(() => {
  const qs = new URLSearchParams(location.search), $ = id => document.getElementById(id), v = $('v');
  $('laptop').value = qs.get('laptop') || localStorage.i159laptop || ''; $('tab').value = qs.get('tab') || '1';
  const id = sessionStorage.i159id || (sessionStorage.i159id = Math.random().toString(36).slice(2));
  let es = null, offset = null, cur = null, queue = [], seq = Number(sessionStorage.i159seq || 0), timers = [];
  const st = s => { $('st').textContent = s; };
  const push = (ev, x = {}) => { if (!cur) return; queue.push({ t: Date.now(), seq: seq++, ev, ct: Math.round(v.currentTime * 100) / 100, ...x }); sessionStorage.i159seq = seq; };

  async function sync() {   // 5 pings, keep the fastest round trip; the server computes and stores the offset too
    const samples = [];
    for (let i = 0; i < 5; i++) { const t0 = Date.now(); try { const r = await fetch('/ping', { method: 'POST', body: JSON.stringify({ id }) }); const { ts } = await r.json(); samples.push({ t0, ts, t1: Date.now() }); } catch {} }
    if (samples.length) { const b = samples.reduce((a, s) => (s.t1 - s.t0 < a.t1 - a.t0 ? s : a)); offset = Math.round(b.ts - (b.t0 + b.t1) / 2);
      fetch('/ping', { method: 'POST', body: JSON.stringify({ id, samples }) }).catch(() => {}); }
  }
  async function flush(final = false) {   // JSONL POST with retry; failed batches stay queued
    if (!cur || !queue.length) return; const batch = queue.splice(0); const c = cur;
    const url = `/results?${new URLSearchParams({ id, laptop: c.laptop, tab: c.tab, quality: c.quality, step: c.step, offset: offset ?? '' })}`;
    for (let i = 0; i < (final ? 5 : 3); i++) {
      try { const r = await fetch(url, { method: 'POST', body: batch.map(e => JSON.stringify(e)).join('\n') + '\n', keepalive: final }); if (r.ok) return; } catch {}
      await new Promise(r => setTimeout(r, 500 * 2 ** i));
    }
    queue.unshift(...batch);
  }
  // Event-loop lag + long tasks (no /proc on the laptop: these stand in for CPU load).
  let lagMax = 0, longTasks = 0, longMs = 0, last = performance.now();
  setInterval(() => { const n = performance.now(); lagMax = Math.max(lagMax, n - last - 200); last = n; }, 200);
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) { longTasks++; longMs += e.duration; } }).observe({ type: 'longtask', buffered: true }); } catch {}

  for (const ev of ['playing', 'waiting', 'stalled', 'pause', 'ended', 'error', 'resize', 'seeking'])
    v.addEventListener(ev, () => push(ev, ev === 'error' ? { code: v.error && v.error.code, msg: v.error && v.error.message } : {}));
  document.addEventListener('visibilitychange', () => push('visibility', { state: document.visibilityState }));
  document.addEventListener('fullscreenchange', () => push('fullscreen', { on: !!document.fullscreenElement }));

  function sample() {
    const p = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {}, c = navigator.connection || {}, m = performance.memory || {};
    push('quality', { videoWidth: v.videoWidth, videoHeight: v.videoHeight, droppedVideoFrames: p.droppedVideoFrames, totalVideoFrames: p.totalVideoFrames,
      buffered_ahead_s: v.buffered.length ? Math.round((v.buffered.end(v.buffered.length - 1) - v.currentTime) * 10) / 10 : 0, readyState: v.readyState,
      lag_max_ms: Math.round(lagMax), long_tasks: longTasks, long_ms: Math.round(longMs), visible: document.visibilityState,
      net_type: c.effectiveType, downlink: c.downlink, net_rtt: c.rtt, heap_mb: m.usedJSHeapSize ? Math.round(m.usedJSHeapSize / 1048576) : undefined });
    lagMax = 0;
  }
  function begin(s) {
    cur = { ...s, laptop: $('laptop').value, tab: Number($('tab').value) };
    const local = offset === null ? s.at : s.at - offset;           // Engine T -> this page's clock
    st(`${s.quality} ${s.step}: starting in ${Math.max(0, Math.round((local - Date.now()) / 1000))} s`);
    timers.push(setTimeout(() => {
      push('start', { laptop: cur.laptop, quality: s.quality, step: s.step, tab: cur.tab, url: s.url, duration: s.duration, ua: navigator.userAgent, offset });
      v.src = s.url; v.loop = true; v.muted = true; v.play().catch(e => push('error', { msg: 'play(): ' + e.message }));
      timers.push(setInterval(sample, 1000), setInterval(() => flush(), 5000));
      timers.push(setTimeout(() => end(), s.duration * 1000));
      st(`${s.quality} ${s.step}: playing. Keep this tab in front.`);
    }, Math.max(0, local - Date.now())));
  }
  async function end(reason) { if (!cur) return; push('end', reason ? { reason } : {}); timers.forEach(t => { clearTimeout(t); clearInterval(t); }); timers = [];
    v.pause(); v.removeAttribute('src'); v.load(); await flush(true); cur = null; st('Done. Leave this tab open for the next step.'); }

  function connect() {
    es = new EventSource(`/events?${new URLSearchParams({ id, laptop: $('laptop').value, tab: $('tab').value })}`);
    es.addEventListener('hello', () => { if (!cur) st('Connected. Waiting for the next step. Keep this tab in front.'); sync(); });
    es.addEventListener('start', e => { const s = JSON.parse(e.data); if (!cur || cur.step !== s.step || cur.quality !== s.quality) begin(s); });
    es.addEventListener('stop', e => end(JSON.parse(e.data).reason));
    es.addEventListener('pause', e => { push('thermal-pause', JSON.parse(e.data)); v.pause(); st('Paused by the server (it is hot). Keep this tab open.'); });
    es.addEventListener('resume', e => { push('thermal-resume', JSON.parse(e.data)); if (cur) v.play().catch(() => {}); });
    es.onerror = () => { if (cur) push('disconnect'); };            // EventSource reconnects by itself (retry: 2000)
    setInterval(sync, 60000);
  }
  $('go').onclick = async () => {    // the user gesture: unlocks play-with-sound rules, fullscreen, and starts the connection
    localStorage.i159laptop = $('laptop').value; if (!$('laptop').value) { st('Type the laptop letter first.'); return; }
    try { await document.documentElement.requestFullscreen(); } catch {}
    try { await navigator.wakeLock?.request('screen'); } catch {}       // only works on https/localhost; plain http: no-op
    $('go').disabled = true; if (!es) connect();
  };
  window.addEventListener('pagehide', () => flush(true));
})();
