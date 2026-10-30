#!/usr/bin/env node
// play-and-log.mjs — play a Kolibri video in Chrome on one laptop and log HTML5 video events (idea#159).
// No npm dependencies: drives Chrome over the DevTools protocol with Node's built-in fetch + WebSocket (Node >= 22).
//
//   node play-and-log.mjs --base http://happy-zebra.local:18080 --md5 <content md5> \
//     --quality 720p --laptop A --step L3 --tabs 1 --duration 180 [--start-at <epoch s>] \
//     [--url <full page url instead of base+md5>] [--chrome /usr/bin/google-chrome] [--headless] [--out ./i159-out]
//
// Writes <out>/<laptop>-<quality>-<step>-tab<n>.jsonl (one event per line, t = ms epoch)
// and <out>/<laptop>-<quality>-<step>.summary.json.
// Default is HEADED kiosk Chrome: headless/Chromium builds may lack H.264/AAC and give a false "error".
import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertLanUrl, contentUrl, streamMetrics, parseJsonl } from './lib.mjs';
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const need = k => { if (!args[k]) { console.error(`missing --${k}`); process.exit(2); } return args[k]; };

const quality = need('quality'), laptop = need('laptop');
const step = args.step || 'L1';
const tabs = Number(args.tabs || 1);
const duration = Number(args.duration || 180);
const out = args.out || './i159-out';
const chrome = args.chrome || process.env.CHROME || 'google-chrome';
const port = Number(args.port || 9333);
const url = assertLanUrl(args.url || contentUrl(need('base'), need('md5')));
mkdirSync(out, { recursive: true });

if (args['start-at']) {
  const wait = Number(args['start-at']) * 1000 - Date.now();
  if (wait > 0) { console.log(`waiting ${Math.round(wait / 1000)} s for synced start`); await sleep(wait); }
}

const profile = mkdtempSync(join(tmpdir(), 'i159-chrome-'));
const flags = [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-media-suspend',
  '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-features=Translate,MediaEngagementBypassAutoplayPolicies', '--password-store=basic',
  args.headless ? '--headless=new' : '--kiosk', 'about:blank',
];
const proc = spawn(chrome, flags, { stdio: 'ignore', env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' } });
const cleanup = () => { try { proc.kill('SIGTERM'); } catch {} setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1500); };
process.on('SIGINT', () => { cleanup(); process.exit(130); });

await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, 20000);

// Injected into each tab: listen to video events, sample quality every second, queue for Node to drain.
const INJECT = `(() => {
  if (window.__i159) return 'already';
  const q = window.__i159 = [];
  const v = document.querySelector('video');
  if (!v) return 'novideo';
  const push = (ev, x = {}) => q.push({ t: Date.now(), ev, ct: Math.round(v.currentTime * 100) / 100, ...x });
  for (const ev of ['playing', 'waiting', 'stalled', 'pause', 'ended', 'error', 'resize', 'seeking'])
    v.addEventListener(ev, () => push(ev, ev === 'error' ? { code: v.error && v.error.code, msg: v.error && v.error.message } : {}));
  setInterval(() => {
    const p = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {};
    push('quality', { videoWidth: v.videoWidth, videoHeight: v.videoHeight, src: v.currentSrc,
      droppedVideoFrames: p.droppedVideoFrames, totalVideoFrames: p.totalVideoFrames,
      buffered_ahead_s: v.buffered.length ? Math.round((v.buffered.end(v.buffered.length - 1) - v.currentTime) * 10) / 10 : 0,
      readyState: v.readyState });
  }, 1000);
  // Chrome's media viewer may autoplay before we attach: record that as the first 'playing'.
  if (!v.paused && v.readyState >= 3) push('playing', { late: true });
  v.muted = true; v.loop = true; v.play().catch(e => push('error', { msg: 'play(): ' + e.message }));
  return 'ok';
})()`;

const files = [];
const sessions = [];
for (let tab = 1; tab <= tabs; tab++) {
  const file = join(out, `${laptop}-${quality}-${step}-tab${tab}.jsonl`);
  files.push(file);
  const meta = { t: Date.now(), ev: 'start', laptop, quality, step, tab, url, duration, ua: null };
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const s = await cdp(target.webSocketDebuggerUrl);
  meta.ua = (await s.send('Runtime.evaluate', { expression: 'navigator.userAgent', returnByValue: true })).result.value;
  appendFileSync(file, JSON.stringify(meta) + '\n');
  await s.send('Page.navigate', { url });
  let r = 'novideo';
  const t0 = Date.now();
  while (r === 'novideo' && Date.now() - t0 < 30000) {
    await sleep(500);
    r = (await s.send('Runtime.evaluate', { expression: INJECT, returnByValue: true })).result?.value ?? 'novideo';
  }
  if (r === 'novideo') appendFileSync(file, JSON.stringify({ t: Date.now(), ev: 'error', msg: 'no <video> on page within 30 s' }) + '\n');
  sessions.push({ s, file });
}

const until = Date.now() + duration * 1000;
while (Date.now() < until) {
  await sleep(1000);
  for (const { s, file } of sessions) {
    try {
      const r = await s.send('Runtime.evaluate', { expression: '(window.__i159||[]).splice(0)', returnByValue: true });
      const evs = r.result?.value || [];
      if (evs.length) appendFileSync(file, evs.map(e => JSON.stringify(e)).join('\n') + '\n');
    } catch (e) { appendFileSync(file, JSON.stringify({ t: Date.now(), ev: 'error', msg: 'cdp: ' + e.message }) + '\n'); }
  }
}
for (const f of files) appendFileSync(f, JSON.stringify({ t: Date.now(), ev: 'end' }) + '\n');
cleanup();

const summary = files.map(f => ({ file: f, ...streamMetrics(parseJsonl(readFileSync(f, 'utf8'))) }));
writeFileSync(join(out, `${laptop}-${quality}-${step}.summary.json`), JSON.stringify({ laptop, quality, step, tabs, url, summary }, null, 2));
console.log(JSON.stringify(summary));
setTimeout(() => process.exit(0), 2000);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(fn, ms) {
  const t0 = Date.now();
  for (;;) { try { if (await fn()) return; } catch {} if (Date.now() - t0 > ms) throw new Error('Chrome did not start'); await sleep(300); }
}
function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } };
    ws.onerror = reject;
    ws.onopen = () => resolve({ send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }) });
  });
}
