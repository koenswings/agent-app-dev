#!/usr/bin/env node
// Usage: node script/check-compose.mjs [--tag <release tag>] <compose.yaml>...  (exit 1 on any problem)
// Rule (idea#76): every service's x-app-version label == x-app.version, and == --tag when given.
import { readFileSync } from 'node:fs';
import { YAML } from 'zx';
import { checkComposeVersion } from '../lib/check-compose.mjs';
const a = process.argv.slice(2); let tag;
const i = a.indexOf('--tag'); if (i >= 0) { tag = a[i + 1]; a.splice(i, 2); }
let bad = 0;
for (const f of a) {
  const errs = checkComposeVersion(YAML.parse(readFileSync(f, 'utf8')), tag);
  for (const m of errs) console.error(`FAIL ${f}: ${m}`);
  if (errs.length) bad = 1; else console.log(`ok   ${f}`);
}
process.exit(bad);
