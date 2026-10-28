#!/usr/bin/env node
// Usage: node script/check-xapp-update-fields.mjs <compose.yaml>...  (exit 1 on any problem)
import { readFileSync } from 'node:fs';
import { YAML } from 'zx';
import { checkUpdateFields } from '../lib/xapp-update-fields.mjs';
let bad = 0;
for (const f of process.argv.slice(2)) {
  const errs = checkUpdateFields(YAML.parse(readFileSync(f, 'utf8'))['x-app']);
  for (const m of errs) console.error(`FAIL ${f}: ${m}`);
  if (errs.length) bad = 1; else console.log(`ok   ${f}`);
}
process.exit(bad);
