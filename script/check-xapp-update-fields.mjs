#!/usr/bin/env node
// Usage: node script/check-xapp-update-fields.mjs <compose.yaml>...  (exit 1 on any problem)
// Checks the idea#351 updateApp fields (healthCheck, healthTimeout, updatesFrom, migrationNote,
// snapshotExclude) and, when present, the gap-12 x-app.update block (same checks as check-compose).
import { readFileSync } from 'node:fs';
import { YAML } from 'zx';
import { checkUpdateFields } from '../lib/xapp-update-fields.mjs';
import { checkComposeUpdate } from '../lib/check-compose.mjs';
let bad = 0;
for (const f of process.argv.slice(2)) {
  const doc = YAML.parse(readFileSync(f, 'utf8'));
  const errs = [...checkUpdateFields(doc?.['x-app']), ...checkComposeUpdate(doc)];
  for (const m of errs) console.error(`FAIL ${f}: ${m}`);
  if (errs.length) bad = 1; else console.log(`ok   ${f}`);
}
process.exit(bad);
