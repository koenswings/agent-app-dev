import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { streamMetrics, parseJsonl, summarise, assertLanUrl, contentUrl, markdown } from '../lib.mjs';
import { loadStreams } from '../summarise.mjs';

const FIX = fileURLToPath(new URL('../fixtures/results', import.meta.url));

test('parseJsonl skips blank and torn lines', () => {
  assert.equal(parseJsonl('{"a":1}\n\nnope\n{"b":2}').length, 2);
});

test('startup wait is not a rebuffer; one short stall is smooth', () => {
  const [a] = loadStreams(FIX).filter(s => s.laptop === 'A' && s.quality === '720p');
  const m = streamMetrics(a.events);
  assert.equal(m.startup_s, 1.2);
  assert.equal(m.stalls, 1);
  assert.equal(m.stall_total_s, 1.5);
  assert.equal(m.dropped_frames, 3);
  assert.equal(m.resolution, '1280x720');
  assert.equal(m.smooth, true);
});

test('waiting+stalled pair counts once; stall >2 s is not smooth', () => {
  const [b] = loadStreams(FIX).filter(s => s.laptop === 'B');
  const m = streamMetrics(b.events);
  assert.equal(m.stalls, 3);
  assert.equal(m.stall_max_s, 4);
  assert.equal(m.stall_total_s, 5.5);
  assert.equal(m.smooth, false);
});

test('too many rebuffers per minute is not smooth', () => {
  const ev = [{ t: 0, ev: 'playing' }];
  for (let i = 1; i <= 4; i++) ev.push({ t: i * 10000, ev: 'waiting' }, { t: i * 10000 + 300, ev: 'playing' });
  ev.push({ t: 60000, ev: 'end' });
  const m = streamMetrics(ev);
  assert.equal(m.rebuffers_per_min, 4);
  assert.equal(m.smooth, false);
});

test('still stalled at end is counted; resolution drop and errors fail', () => {
  const m = streamMetrics([{ t: 0, ev: 'playing' }, { t: 1000, ev: 'quality', videoWidth: 1920, videoHeight: 1080 },
    { t: 2000, ev: 'quality', videoWidth: 1280, videoHeight: 720 }, { t: 50000, ev: 'waiting' }, { t: 60000, ev: 'end' }]);
  assert.equal(m.stall_max_s, 10);
  assert.equal(m.resolution_dropped, true);
  assert.equal(m.smooth, false);
  assert.equal(streamMetrics([{ t: 0, ev: 'error' }]).played, false);
});

test('summarise groups per quality and step, in quality order', () => {
  const s = summarise(loadStreams(FIX));
  assert.deepEqual(s.groups.map(g => `${g.quality}/${g.step}/${g.streams}/${g.all_smooth}`), ['360p/L1/1/true', '720p/L2/2/false']);
  const g = s.groups[1];
  assert.equal(g.stalls, 4); assert.equal(g.stall_total_s, 7); assert.equal(g.worst_rebuffers_per_min, 1); assert.equal(g.dropped_frames, 43);
  assert.match(markdown(s), /\| B \| 720p \| L2 \| 1 \| NO \|/);
});

test('LAN guard refuses Tailscale addresses', () => {
  assert.throws(() => assertLanUrl('http://100.101.5.6:18080/x'));
  assert.throws(() => assertLanUrl('http://idea04.tail1234.ts.net/x'));
  assert.ok(assertLanUrl('http://happy-zebra.local:18080/x'));
  assert.ok(assertLanUrl('http://10.42.2.10:18080/x'));
  assert.ok(assertLanUrl('http://100.200.0.1/x')); // outside 100.64/10
  assert.equal(contentUrl('http://p.local:18080/', 'abcdef0123456789abcdef0123456789'),
    'http://p.local:18080/content/storage/a/b/abcdef0123456789abcdef0123456789.mp4');
});
