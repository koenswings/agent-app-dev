/**
 * Refuse idea03's permanent hardware stick (idea#137 / #139).
 * Match by USB/disk serial or UUID from Engine script/hw-roundtrip-disks.json.
 * Fail closed if that file is missing — never by device name alone.
 */
import { readFileSync, existsSync } from 'fs';

const DEFAULT_PATHS = [
  process.env.HW_ROUNDTRIP_DISKS_JSON,
  '/home/pi/idea/agents/agent-engine-dev/script/hw-roundtrip-disks.json',
].filter(Boolean);

export function loadIdea03RefusedIds(jsonPath) {
  const path = jsonPath || DEFAULT_PATHS.find(p => existsSync(p));
  if (!path || !existsSync(path)) {
    throw new Error(
      'hw-roundtrip-disks.json missing — refuse closed (no fallback). ' +
      'Expected at agent-engine-dev/script/hw-roundtrip-disks.json'
    );
  }
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const e = data.idea03;
  if (!e) throw new Error(`idea03 entry missing in ${path}`);
  const ids = new Set([
    e.usbSerial,
    e.diskSerial,
    ...(e.uuids || []),
    ...(e.refuseSerials || []),
  ].filter(Boolean));
  return { path, ids, entry: e };
}

/** Throw if any of the given lsblk/udevadm identity strings matches a refused ID. */
export function assertNotIdea03Stick(identityStrings, jsonPath) {
  const { ids, path } = loadIdea03RefusedIds(jsonPath);
  const hit = (identityStrings || []).filter(Boolean).find(s => ids.has(String(s)));
  if (hit) {
    throw new Error(
      `Refusing idea03 hardware stick (matched ${hit} from ${path}). ` +
      'Use a throwaway fixture device; never undock or wipe that stick.'
    );
  }
}
