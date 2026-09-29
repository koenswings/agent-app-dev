#!/usr/bin/env node
/**
 * Disk A (erase-test) fixture structure check for idea#138.
 * Full Engine harness boot is optional; image validation covers packed .img.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixture');
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
const ok = (m) => console.log('OK:', m);

const meta = readFileSync(join(root, 'META.yaml'), 'utf8');
if (!/diskId:\s*\S+/.test(meta)) fail('META.yaml missing diskId');
ok('META.yaml present');

const appCompose = readFileSync(join(root, 'apps/erase-test-1.0/compose.yaml'), 'utf8');
if (!/erase-seed-data:/.test(appCompose)) fail('named volume erase-seed-data missing');
if (!/healthcheck:/.test(appCompose)) fail('healthcheck missing');
if (!/nginx:alpine/.test(appCompose)) fail('expected nginx:alpine image');
if (!/\$\{port\}:80/.test(appCompose) && !/"\$\{port\}:80"/.test(appCompose)) fail('port mapping missing');
ok('app compose: named volume + healthcheck + nginx');

const env = readFileSync(join(root, 'instances/erase-test-001/.env'), 'utf8');
const port = Number((env.match(/^port=(\d+)/m) || [])[1]);
if (!(port >= 3000)) fail(`port ${port} < 3000`);
ok(`instance port=${port} >= 3000`);

if (!existsSync(join(root, 'instances/erase-test-001/seed-volume.sh'))) fail('seed-volume.sh missing');
if (!existsSync(join(root, 'instances/erase-test-001/compose.yaml'))) fail('instance compose missing');
ok('instance tree complete');
console.log('erase-test fixture structure: PASS');
