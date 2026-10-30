#!/usr/bin/env node
// check-e2e.mjs — checks for the unattended e2e test (idea#159). Pure functions + CLI, Node built-ins only.
//   node check-e2e.mjs field   RESULTS_DIR "A B C" [maxSkewMs=500]
//   node check-e2e.mjs thermal RUNNER_LOG
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonl, summarise } from './lib.mjs';
import { loadStreams } from './summarise.mjs';

// Every expected (laptop, step) stream is present, has start+playing+end, and its 'start' (Engine time) is
// within maxSkewMs of the runner's scheduled T for that step: proves the clock offsets were applied.
export function checkField(runnerLog, streams, laptopsPerStep, maxSkewMs = 500) {
  const fails = []; const steps = runnerLog.filter(e => e.ev === 'step');
  if (!steps.length) fails.push('no step in runner.log');
  for (const st of steps) {
    for (const lap of st.laptops) {
      for (let tab = 1; tab <= st.tabs; tab++) {
        const s = streams.find(x => x.laptop === lap && x.quality === st.quality && x.step === st.step && x.tab === tab);
        const k = `${lap}/${st.quality}/${st.step}/tab${tab}`;
        if (!s) { fails.push(`missing log ${k}`); continue; }
        const evs = new Set(s.events.map(e => e.ev));
        for (const need of ['start', 'playing', 'end']) if (!evs.has(need)) fails.push(`${k}: no '${need}'`);
        const start = s.events.find(e => e.ev === 'start');
        if (start && Math.abs(start.t - st.at) > maxSkewMs) fails.push(`${k}: start ${start.t - st.at} ms from T (clock not aligned)`);
      }
    }
  }
  const expected = laptopsPerStep ?? null;
  if (expected) for (const lap of expected) if (!streams.some(s => s.laptop === lap)) fails.push(`no stream at all for laptop ${lap}`);
  return { pass: !fails.length, fails, steps: steps.length, streams: streams.length };
}

// Thermal: pause logged after 'listen', then resume, then abort with a non-zero throttled value.
export function checkThermal(runnerLog) {
  const i = n => runnerLog.findIndex(e => e.ev === n);
  const fails = [];
  const listen = runnerLog.find(e => e.ev === 'listen');
  if (!listen?.testMode) fails.push('runner not in test mode');
  const p = i('thermal-pause'), r = i('thermal-resume'), a = i('abort');
  if (p < 0) fails.push('no thermal-pause'); else if (!(runnerLog[p].tempC > 75)) fails.push(`pause at ${runnerLog[p].tempC} C`);
  if (r < 0 || r < p) fails.push('no thermal-resume after pause'); else if (!(runnerLog[r].tempC < 65)) fails.push(`resume at ${runnerLog[r].tempC} C`);
  if (a < 0 || a < r) fails.push('no abort after resume'); else if (runnerLog[a].throttled === '0x0') fails.push('abort with 0x0');
  return { pass: !fails.length, fails };
}

function findFile(dir, name) { for (const n of readdirSync(dir)) { const p = join(dir, n); if (n === name) return p; if (statSync(p).isDirectory()) { const f = findFile(p, name); if (f) return f; } } return null; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, path, laps, skew] = process.argv.slice(2);
  let r;
  if (mode === 'field') {
    const rl = findFile(path, 'runner.log'); if (!rl) { console.log('FAIL field: no runner.log'); process.exit(1); }
    const streams = loadStreams(path);
    r = checkField(parseJsonl(readFileSync(rl, 'utf8')), streams, laps ? laps.split(/\s+/).filter(Boolean) : null, Number(skew || 500));
    try { const s = summarise(streams); r.summary_groups = s.groups.length; if (!s.groups.length) { r.pass = false; r.fails.push('summarise produced no groups'); } } catch (e) { r.pass = false; r.fails.push('summarise: ' + e.message); }
  } else if (mode === 'thermal') {
    r = existsSync(path) ? checkThermal(parseJsonl(readFileSync(path, 'utf8'))) : { pass: false, fails: ['no runner log'] };
  } else { console.error('usage: check-e2e.mjs field DIR "A B" | thermal RUNNER_LOG'); process.exit(2); }
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${mode}: ${JSON.stringify(r)}`);
  process.exit(r.pass ? 0 : 1);
}
