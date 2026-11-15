/**
 * Refuse idea03's permanent hardware stick (idea#137 / #139).
 * Match by USB/disk serial or UUID from Engine script/hw-roundtrip-disks.json.
 *
 * If the file is missing, inspectHwRoundtripDisks() returns { status: 'missing', reason }
 * so the Nextcloud smoke can skip (issue #56). If the file exists but is invalid,
 * every entry point fails closed. Disk-image scripts keep their own fail-closed check.
 */
import { readFileSync, existsSync } from 'fs';

const DEFAULT_PATHS = [
  process.env.HW_ROUNDTRIP_DISKS_JSON,
  '/home/pi/idea/agents/agent-engine-dev/script/hw-roundtrip-disks.json',
].filter(Boolean);

export const HW_ROUNDTRIP_MISSING_REASON =
  'hw-roundtrip-disks.json missing — skipping hardware stick check (idea03 fixture is not set up on this host)';

function resolvedPath(jsonPath) {
  return jsonPath || DEFAULT_PATHS.find((p) => existsSync(p));
}

function loadExisting(path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`hw-roundtrip-disks.json is invalid in ${path}: ${e.message}`);
  }
  const e = data && data.idea03;
  if (!e || typeof e !== 'object' || Array.isArray(e)) {
    throw new Error(`idea03 entry missing or invalid in ${path}`);
  }
  if (e.uuids != null && !Array.isArray(e.uuids)) {
    throw new Error(`idea03.uuids must be an array in ${path}`);
  }
  if (e.refuseSerials != null && !Array.isArray(e.refuseSerials)) {
    throw new Error(`idea03.refuseSerials must be an array in ${path}`);
  }
  const ids = new Set([
    e.usbSerial,
    e.diskSerial,
    ...(e.uuids || []),
    ...(e.refuseSerials || []),
  ].filter((v) => v != null && String(v).trim() !== ''));
  if (ids.size === 0) {
    throw new Error(`idea03 entry in ${path} has no usbSerial, diskSerial, uuids or refuseSerials`);
  }
  return { path, ids, entry: e };
}

/** Classify the fixture file: missing (skip) or ok. Throws if the file exists but is invalid. */
export function inspectHwRoundtripDisks(jsonPath) {
  const path = resolvedPath(jsonPath);
  if (!path || !existsSync(path)) {
    return { status: 'missing', reason: HW_ROUNDTRIP_MISSING_REASON };
  }
  return { status: 'ok', ...loadExisting(path) };
}

/**
 * node:test helper. If the fixture file is missing, marks this test skipped and returns true.
 * If the file exists but is invalid, throws (fail closed). Otherwise returns false.
 */
export function skipHwRoundtripIfMissing(t, jsonPath) {
  const r = inspectHwRoundtripDisks(jsonPath);
  if (r.status === 'missing') {
    t.skip(r.reason);
    return true;
  }
  return false;
}

export function loadIdea03RefusedIds(jsonPath) {
  const r = inspectHwRoundtripDisks(jsonPath);
  if (r.status === 'missing') {
    throw new Error(
      'hw-roundtrip-disks.json missing — refuse closed (no fallback). ' +
      'Expected at agent-engine-dev/script/hw-roundtrip-disks.json'
    );
  }
  const { path, ids, entry } = r;
  return { path, ids, entry };
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
