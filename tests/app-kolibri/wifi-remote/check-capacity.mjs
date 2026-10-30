#!/usr/bin/env node
// check-capacity.mjs: verdicts and report for the capacity measurement (idea#159, CAPACITY-PLAN.md).
//   node check-capacity.mjs step <stepDir> <samples.jsonl>   -> <stepDir>/verdict.json, exit 0 SAFE / 1 not SAFE
//   node check-capacity.mjs report <outRoot>                 -> <outRoot>/REPORT.md (+ max safe N per quality)
// stepDir holds load.summary.json (sim-laptop --mode load), api.jsonl (api-probe) and health.json
// ({n, engineOnline, thermalPaused, aborted, nproc, retry}) written by capacity.sh.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonl } from './lib.mjs';
import { stepVerdict, maxSafeN, planningN, reportMarkdown, THRESHOLDS } from './capacity-lib.mjs';

const readJson = (p, d = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const readL = p => (existsSync(p) ? parseJsonl(readFileSync(p, 'utf8')) : []);

export function checkStep(dir, samplesFile) {
  const sum = readJson(join(dir, 'load.summary.json'), { streams: [], t0: 0, t1: 0 });
  const health = readJson(join(dir, 'health.json'), {});
  const n = health.n ?? sum.n ?? 0;
  const samples = readL(samplesFile).filter(s => s.t >= sum.t0 && s.t <= sum.t1 + 2000);
  const v = stepVerdict({ n, streams: sum.streams || [], api: readL(join(dir, 'api.jsonl')), samples, health, nproc: health.nproc || 4 }, THRESHOLDS);
  const out = { n, retry: !!health.retry, ...v };
  writeFileSync(join(dir, 'verdict.json'), JSON.stringify(out, null, 1));
  return out;
}

// outRoot/meta.json: {server, loadgen, image, port, started, ended, runtimeS, conditions, release, qualities:[{name,bps,prior}]}
// outRoot/<quality>/n<N>[-retry]/verdict.json. The retry verdict replaces the first attempt for that N.
export function buildReport(root) {
  const meta = readJson(join(root, 'meta.json'), {});
  const qualities = (meta.qualities || []).map(q => {
    const qd = join(root, q.name); const byN = new Map();
    if (existsSync(qd)) for (const d of readdirSync(qd).sort()) { const v = readJson(join(qd, d, 'verdict.json')); if (v) { const prev = byN.get(v.n); if (!prev || v.retry) byN.set(v.n, v); } }
    const steps = [...byN.values()].sort((a, b) => a.n - b.n);
    return { ...q, planningN: q.planningN ?? planningN(q.bps), steps, maxSafeN: maxSafeN(steps) };
  });
  const md = reportMarkdown({ meta, qualities });
  writeFileSync(join(root, 'REPORT.md'), md);
  writeFileSync(join(root, 'max-safe.json'), JSON.stringify(qualities.map(q => ({ quality: q.name, bps: q.bps, maxSafeN: q.maxSafeN, planningN: q.planningN, steps: q.steps.length })), null, 1));
  return { md, qualities };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'step') { const v = checkStep(a, b); console.log(`${v.safe ? 'SAFE' : 'NOT SAFE'} n=${v.n} ${v.fails.join('; ')}${v.warn.length ? ' (warn: ' + v.warn.join('; ') + ')' : ''}`); process.exit(v.safe ? 0 : 1); }
  else if (cmd === 'report') { const r = buildReport(a); for (const q of r.qualities) console.log(`${q.name}: max safe N ${q.maxSafeN} (planning ${q.planningN})`); }
  else { console.error('usage: check-capacity.mjs step <dir> <samples> | report <root>'); process.exit(2); }
}
