// preflight.js — 2-minute teacher check before the field run (idea#159). Pull model: this page opens every connection.
// What a page CAN see: which URL loaded, whether fetch/SSE/POST to the runner work, video playback, visibility,
// full screen, Wake Lock (needs a secure page, so expected to FAIL on plain http), timer drift, rAF gaps.
// What it CANNOT see: the real screen state. A display dim/blank by the desktop idle timer may not stop rAF,
// so 'no_frame_gaps' is a proxy; the teacher's own observation ("did the screen go dark?") is asked at the end.
(() => {
  const qs = new URLSearchParams(location.search), $ = id => document.getElementById(id), v = $('v');
  $('laptop').value = qs.get('laptop') || localStorage.i159laptop || '';
  const id = 'pf-' + Math.random().toString(36).slice(2);
  const DUR = Number(qs.get('s') || 120) * 1000;
  const log = []; let seq = 0;
  const push = (ev, x = {}) => log.push({ t: Date.now(), seq: seq++, ev, laptop: $('laptop').value, ...x });
  const item = (name, pass, detail) => { push('item', { name, pass, detail });
    const li = document.createElement('li'); li.className = pass ? 'ok' : 'bad'; li.textContent = `${pass ? 'PASS' : 'FAIL'}  ${name}${detail != null ? ': ' + JSON.stringify(detail) : ''}`; $('items').appendChild(li); };
  const st = s => { $('st').textContent = s; };

  async function upload() {
    const body = log.map(e => JSON.stringify(e)).join('\n') + '\n';
    for (let i = 0; i < 5; i++) { try { const r = await fetch(`/preflight-result?${new URLSearchParams({ id, laptop: $('laptop').value })}`, { method: 'POST', body }); if (r.ok) return true; } catch {} await new Promise(r => setTimeout(r, 500 * 2 ** i)); }
    return false;
  }
  async function run() {
    push('start', { url: location.href, ua: navigator.userAgent });
    item('page_loaded', true, { origin: location.origin, kind: /\.local(:|$)/.test(location.host) ? 'local' : 'ip' });
    let cfg = {};
    try { cfg = await (await fetch('/preflight-config')).json(); item('fetch', true, { to: location.origin }); } catch (e) { item('fetch', false, String(e)); }
    // the other URL (.local <-> 10.42.0.x): needs CORS on /ping; failure here is info, the loaded one is what counts
    const other = (cfg.urls || []).find(u => new URL(u).origin !== location.origin);
    if (other) { try { const r = await fetch(new URL('/ping', other), { method: 'POST', body: '{}' }); item('other_url', r.ok, { url: other, status: r.status }); }
      catch (e) { item('other_url', false, { url: other, error: String(e) }); } }
    else item('other_url', false, { error: 'no other URL configured' });
    // event stream
    await new Promise(res => { const es = new EventSource(`/events?${new URLSearchParams({ id, laptop: 'preflight-' + $('laptop').value, tab: 1 })}`);
      const to = setTimeout(() => { item('events', false, 'no hello within 10 s'); es.close(); res(); }, 10000);
      es.addEventListener('hello', () => { clearTimeout(to); item('events', true); es.close(); res(); }); });
    try { const r = await fetch('/ping', { method: 'POST', body: JSON.stringify({ id }) }); item('post', r.ok, { status: r.status }); } catch (e) { item('post', false, String(e)); }

    // ~2 min playback with visibility, full screen, wake lock, timer drift, rAF gaps
    let wl = 'unsupported'; try { if (navigator.wakeLock) { await navigator.wakeLock.request('screen'); wl = 'granted'; } } catch (e) { wl = 'denied: ' + e.name; }
    push('wake_lock', { state: wl, secure: window.isSecureContext });
    let hidden = 0, fsLost = 0, playing = 0, stalls = 0, errors = 0;
    document.addEventListener('visibilitychange', () => { push('visibility', { state: document.visibilityState }); if (document.hidden) hidden++; });
    document.addEventListener('fullscreenchange', () => { push('fullscreen', { on: !!document.fullscreenElement }); if (!document.fullscreenElement) fsLost++; });
    v.addEventListener('playing', () => { playing++; push('playing'); }); v.addEventListener('waiting', () => { stalls++; push('waiting'); });
    v.addEventListener('error', () => { errors++; push('error', { code: v.error && v.error.code }); });
    if (cfg.video) { v.src = cfg.video; v.play().catch(e => push('error', { msg: 'play(): ' + e.message })); }
    const ticks = [], frames = []; const t0 = performance.now();
    const iv = setInterval(() => ticks.push(performance.now()), 1000);
    const raf = t => { frames.push(t); if (t - t0 < DUR) requestAnimationFrame(raf); }; requestAnimationFrame(raf);
    const left = setInterval(() => { $('verdict').textContent = `Checking… ${Math.max(0, Math.round((DUR - (performance.now() - t0)) / 1000))} s`; }, 1000);
    await new Promise(r => setTimeout(r, DUR)); clearInterval(iv); clearInterval(left);
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {};
    item('playback', playing > 0 && errors === 0 && v.currentTime > DUR / 2000, { video: cfg.video || null, played_s: Math.round(v.currentTime), stalls, errors, dropped: q.droppedVideoFrames, total: q.totalVideoFrames });
    item('stayed_visible', hidden === 0, { hidden_events: hidden });
    let worst = 0; for (let i = 1; i < ticks.length; i++) worst = Math.max(worst, ticks[i] - ticks[i - 1] - 1000);
    item('no_throttle', worst < 1500, { worst_timer_late_ms: Math.round(worst), ticks: ticks.length });
    let gaps = 0, gmax = 0; for (let i = 1; i < frames.length; i++) { const g = frames[i] - frames[i - 1]; if (g > 1000) { gaps++; gmax = Math.max(gmax, g); } }
    item('no_frame_gaps', gaps === 0, { gaps, worst_gap_ms: Math.round(gmax), frames: frames.length, note: 'proxy: rAF stops when hidden/occluded/compositor off; a desktop dim may not show' });
    item('fullscreen', fsLost === 0 && !!document.fullscreenElement, { lost: fsLost });
    item('wake_lock', wl === 'granted', { state: wl, secure: window.isSecureContext, note: 'plain http is not a secure context, so FAIL is expected' });
    const req = ['page_loaded', 'fetch', 'events', 'post', 'playback', 'stayed_visible', 'no_throttle', 'no_frame_gaps'];
    const pass = req.every(n => log.some(e => e.ev === 'item' && e.name === n && e.pass));
    push('verdict', { pass });
    const up = await upload();
    $('verdict').textContent = (pass ? 'PASS' : 'FAIL') + (up ? '' : ' (upload failed: tell us)'); $('verdict').className = pass ? 'PASS' : 'FAIL';
    st('Done. Did the screen go dark or dim during the check? Tell us yes or no.'); v.pause();
  }
  $('go').onclick = async () => {
    localStorage.i159laptop = $('laptop').value; if (!$('laptop').value) { st('Type the laptop letter first.'); return; }
    $('go').disabled = true; try { await document.documentElement.requestFullscreen(); } catch {}
    run().catch(e => { push('error', { msg: String(e) }); upload(); $('verdict').textContent = 'FAIL'; $('verdict').className = 'FAIL'; });
  };
})();
