import { it } from 'node:test';
import assert from 'node:assert/strict';
import { checkUpdateFields } from './xapp-update-fields.mjs';
const ok = { healthCheck: { path: '/status.php', expect: '"maintenance":false' }, healthTimeout: 600, updatesFrom: [], migrationNote: '', snapshotExclude: ['data/kolibri/content'] };
it('accepts a complete block', () => assert.deepEqual(checkUpdateFields(ok), []));
it('expect is optional', () => assert.deepEqual(checkUpdateFields({ ...ok, healthCheck: { path: '/' } }), []));
it('rejects missing or malformed fields', () => {
  assert.ok(checkUpdateFields({}).length >= 5);
  assert.ok(checkUpdateFields({ ...ok, healthCheck: { path: 'x' } }).length);
  assert.ok(checkUpdateFields({ ...ok, healthTimeout: '10m' }).length);
  assert.ok(checkUpdateFields({ ...ok, updatesFrom: ['1'] }).length);
  for (const p of ['/data', 'data/../x', '.env', 'compose.yaml']) assert.ok(checkUpdateFields({ ...ok, snapshotExclude: [p] }).length, p);
});
