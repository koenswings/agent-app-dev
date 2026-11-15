#!/usr/bin/env node
// Usage: node script/check-compose.mjs [--tag <release tag>] [--release] [--base <compose.yaml> | --base-ref <git ref>] <compose.yaml>...  (exit 1 on any problem)
// Rule (idea#76): every service's x-app-version label == x-app.version, and == --tag when given.
// --release (idea#375 U-10, same rules as app-usage-dashboard's copy, applied to every service):
//   every image pinned repo:<tag>@sha256:<64 hex> (idea#322), no build: block, no packaging placeholder,
//   and x-app.backup.verify required when x-app.backup.method is hook (idea#446).
// --base <compose.yaml> | --base-ref <git ref> (idea#403, Steve): compare with the previous release or a PR's
//   base; a stateful service image (MariaDB/MySQL/Mongo X.Y, Postgres/Redis X) that moves to a new series needs
//   an App major bump (the Engine only requires a Backup Disk backup before an App major update).
// Always (idea#403): x-app.backup structure, matching the Engine (method stop|hook|none, hook lists,
//   step services in compose, path lists without globs); see docs/backup-hook.md.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, basename } from 'node:path';
import { YAML } from 'zx';
import { checkComposeVersion, checkComposeRelease, checkComposeBackup, checkStatefulMajor } from '../lib/check-compose.mjs';
const a = process.argv.slice(2); let tag; let release = false; let base; let baseRef; const files = [];
for (let i = 0; i < a.length; i++) {
  if (a[i] === '--tag') { tag = a[++i]; continue; }
  if (a[i] === '--release') { release = true; continue; }
  if (a[i] === '--base') { base = a[++i]; continue; }
  if (a[i] === '--base-ref') { baseRef = a[++i]; continue; }
  files.push(a[i]);
}
let bad = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8'); const doc = YAML.parse(text);
  const errs = [...checkComposeVersion(doc, tag), ...checkComposeBackup(doc)];
  if (release) errs.push(...checkComposeRelease(doc, text));
  if (base !== undefined || baseRef !== undefined) {
    let baseText = null;
    if (base !== undefined) baseText = readFileSync(base, 'utf8');
    else {
      const g = spawnSync('git', ['-C', dirname(f), 'show', `${baseRef}:./${basename(f)}`], { encoding: 'utf8' });
      if (g.status === 0) baseText = g.stdout;
      else console.log(`note ${f}: no ${basename(f)} at ${baseRef} (new App?), stateful-image check skipped`);
    }
    if (baseText !== null) errs.push(...checkStatefulMajor(YAML.parse(baseText), doc));
  }
  for (const m of errs) console.error(`FAIL ${f}: ${m}`);
  if (errs.length) bad = 1; else console.log(`ok   ${f}`);
}
process.exit(bad);
