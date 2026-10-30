#!/usr/bin/env node
// summarise.mjs RESULTS_DIR — per-laptop and per-(quality, step) table from all *.jsonl under RESULTS_DIR (recursive).
// Writes RESULTS_DIR/summary.json and RESULTS_DIR/summary.md, prints the markdown.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseJsonl, summarise, markdown } from './lib.mjs';

export function loadStreams(dir) {
  const streams = [];
  const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.jsonl')) {
    const events = parseJsonl(readFileSync(p, 'utf8'));
    const meta = events.find(e => e.ev === 'start') || {};
    const m = basename(n, '.jsonl').match(/^(.+?)-(\d+p)-(.+)-tab(\d+)$/) || [];
    streams.push({ laptop: meta.laptop ?? m[1] ?? n, quality: meta.quality ?? m[2] ?? '?', step: meta.step ?? m[3] ?? '', tab: Number(meta.tab ?? m[4] ?? 1), events });
  } } };
  walk(dir);
  return streams;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: summarise.mjs RESULTS_DIR'); process.exit(2); }
  const s = summarise(loadStreams(dir));
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(s, null, 2));
  const md = markdown(s);
  writeFileSync(join(dir, 'summary.md'), md);
  process.stdout.write(md);
}
