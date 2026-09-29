import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadIdea03RefusedIds, assertNotIdea03Stick } from './refuse-idea03-stick.mjs';

describe('refuse-idea03-stick', () => {
  it('fail-closed when JSON missing', () => {
    assert.throws(() => loadIdea03RefusedIds('/no/such/hw-roundtrip-disks.json'));
  });

  it('loads refused IDs and blocks a match', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hw-refuse-'));
    const p = join(dir, 'hw-roundtrip-disks.json');
    writeFileSync(p, JSON.stringify({
      idea03: {
        usbSerial: '26A1EE83197F',
        diskSerial: '3813430-532011020',
        uuids: ['3E50-902A', '378383c9-0612-4c82-9c07-8c34d15253ba'],
        refuseSerials: ['AA202000000000004820'],
      },
    }));
    const { ids } = loadIdea03RefusedIds(p);
    assert.ok(ids.has('26A1EE83197F'));
    assert.throws(() => assertNotIdea03Stick(['26A1EE83197F'], p));
    assert.doesNotThrow(() => assertNotIdea03Stick(['throwaway-serial'], p));
    rmSync(dir, { recursive: true, force: true });
  });
});
