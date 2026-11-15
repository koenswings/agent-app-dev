import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  inspectHwRoundtripDisks,
  skipHwRoundtripIfMissing,
  loadIdea03RefusedIds,
  assertNotIdea03Stick,
  HW_ROUNDTRIP_MISSING_REASON,
} from './refuse-idea03-stick.mjs';

const VALID = {
  idea03: {
    usbSerial: '26A1EE83197F',
    diskSerial: '3813430-532011020',
    uuids: ['3E50-902A', '378383c9-0612-4c82-9c07-8c34d15253ba'],
    refuseSerials: ['AA202000000000004820'],
  },
};

function tmpJson(body) {
  const dir = mkdtempSync(join(tmpdir(), 'hw-refuse-'));
  const p = join(dir, 'hw-roundtrip-disks.json');
  writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
  return { dir, p };
}

describe('refuse-idea03-stick', () => {
  it('missing JSON is a native skip, not a pass or a fail', async (t) => {
    const path = '/no/such/hw-roundtrip-disks.json';
    const r = inspectHwRoundtripDisks(path);
    assert.equal(r.status, 'missing');
    assert.equal(r.reason, HW_ROUNDTRIP_MISSING_REASON);
    assert.match(r.reason, /hw-roundtrip-disks\.json missing/);

    let proceeded = false;
    await t.test('hardware stick check', (st) => {
      if (skipHwRoundtripIfMissing(st, path)) return;
      proceeded = true;
    });
    assert.equal(proceeded, false, 'skipHwRoundtripIfMissing must t.skip and return before proceeding');
  });

  it('fails closed when the JSON exists but is invalid', () => {
    const cases = [
      ['bad JSON', '{'],
      ['missing idea03', {}],
      ['idea03 is null', { idea03: null }],
      ['idea03 is an array', { idea03: [] }],
      ['uuids is not an array', { idea03: { diskSerial: 'x', uuids: 'nope' } }],
      ['refuseSerials is not an array', { idea03: { diskSerial: 'x', refuseSerials: 'nope' } }],
      ['no usable ids', { idea03: { note: 'empty' } }],
    ];
    for (const [label, body] of cases) {
      const { dir, p } = tmpJson(body);
      try {
        assert.throws(() => inspectHwRoundtripDisks(p), label);
        assert.throws(() => loadIdea03RefusedIds(p), label);
        assert.throws(() => assertNotIdea03Stick(['throwaway-serial'], p), label);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('valid JSON: inspect proceeds, loads refused IDs and blocks a match', (t) => {
    const { dir, p } = tmpJson(VALID);
    try {
      const r = inspectHwRoundtripDisks(p);
      assert.equal(r.status, 'ok');
      assert.equal(skipHwRoundtripIfMissing(t, p), false, 'must not skip a valid fixture');
      const { ids } = loadIdea03RefusedIds(p);
      assert.ok(ids.has('26A1EE83197F'));
      assert.ok(ids.has('3813430-532011020'));
      assert.ok(ids.has('3E50-902A'));
      assert.ok(ids.has('AA202000000000004820'));
      assert.throws(() => assertNotIdea03Stick(['26A1EE83197F'], p));
      assert.doesNotThrow(() => assertNotIdea03Stick(['throwaway-serial'], p));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
