#!/usr/bin/env node
// Usage: node script/check-compose.mjs [--tag <release tag>] [--release] <compose.yaml>...  (exit 1 on any problem)
// Rule (idea#76): every service's x-app-version label == x-app.version, and == --tag when given.
// --release (idea#375 U-10, same rules as app-usage-dashboard's copy, applied to every service):
//   every image pinned repo:<tag>@sha256:<64 hex> (idea#322), no build: block, no packaging placeholder,
//   and x-app.backup.verify required when x-app.backup.method is hook (idea#446).
import { readFileSync } from 'node:fs';
import { YAML } from 'zx';
import { checkComposeVersion, checkComposeRelease } from '../lib/check-compose.mjs';
const a = process.argv.slice(2); let tag; let release = false; const files = [];
for (let i = 0; i < a.length; i++) {
  if (a[i] === '--tag') { tag = a[++i]; continue; }
  if (a[i] === '--release') { release = true; continue; }
  files.push(a[i]);
}
let bad = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8'); const doc = YAML.parse(text);
  const errs = checkComposeVersion(doc, tag);
  if (release) errs.push(...checkComposeRelease(doc, text));
  for (const m of errs) console.error(`FAIL ${f}: ${m}`);
  if (errs.length) bad = 1; else console.log(`ok   ${f}`);
}
process.exit(bad);
