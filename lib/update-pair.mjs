// idea#76 / idea#351 updateApp: does a newer App bundle count as an update of an older one?
// Mirrors agent-engine-dev src/data/UpdateAppPolicy.ts parseVersion/compareVersions and the
// major rule (x-app.updatesFrom), so App PRs can check a release pair on the box. Pure, no I/O.
export const parseVersion = (raw) => {
  const m = String(raw ?? '').match(/(\d+(?:\.\d+)*)/);
  return m ? m[1].split('.').map(Number) : null;
};
export const compareVersions = (a, b) => {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
};
// appId = <name>-<version>; the name may itself contain "-" (kolibri-channel-builder).
export const splitAppId = (appId, name) =>
  appId.startsWith(name + '-') ? { name, version: appId.slice(name.length + 1) } : null;
const SHA = /^[0-9a-f]{7,40}$/;
/** { ok, major, reason } for old -> new, using the new bundle's x-app.updatesFrom. */
export function updatePair(name, oldAppId, newAppId, updatesFrom = []) {
  const o = splitAppId(oldAppId, name), n = splitAppId(newAppId, name);
  if (!o || !n) return { ok: false, reason: 'DIFFERENT_APP' };
  for (const v of [o.version, n.version]) if (SHA.test(v)) return { ok: false, reason: `VERSION_IS_COMMIT: ${v} has no release order` };
  const cmp = compareVersions(n.version, o.version);
  if (cmp === null || cmp <= 0) return { ok: false, reason: `NOT_NEWER: ${n.version} vs ${o.version}` };
  const om = parseVersion(o.version)[0], nm = parseVersion(n.version)[0];
  const major = om !== nm;
  if (major && !updatesFrom.includes(om)) return { ok: false, major, reason: `MAJOR_NOT_ALLOWED: ${om} not in updatesFrom` };
  return { ok: true, major };
}
