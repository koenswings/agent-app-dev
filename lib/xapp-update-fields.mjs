// x-app fields for updateApp (idea#351, agent-app-dev#23). Pure check, no I/O.
// healthCheck: {path, expect?}  healthTimeout: seconds  updatesFrom: [<major>...]
// migrationNote: string  snapshotExclude: [<path relative to the instance folder>...]
export function checkUpdateFields(xapp) {
  const e = [];
  if (!xapp || typeof xapp !== 'object') return ['x-app block missing'];
  const hc = xapp.healthCheck;
  if (!hc || typeof hc !== 'object') e.push('healthCheck missing');
  else {
    if (typeof hc.path !== 'string' || !hc.path.startsWith('/')) e.push('healthCheck.path must start with "/"');
    if (hc.expect !== undefined && (typeof hc.expect !== 'string' || hc.expect === '')) e.push('healthCheck.expect must be a non-empty string when set');
    for (const k of Object.keys(hc)) if (!['path', 'expect'].includes(k)) e.push(`healthCheck.${k} is not a known field`);
  }
  if (!Number.isInteger(xapp.healthTimeout) || xapp.healthTimeout < 60 || xapp.healthTimeout > 7200)
    e.push('healthTimeout must be whole seconds between 60 and 7200');
  if (!Array.isArray(xapp.updatesFrom) || !xapp.updatesFrom.every((m) => Number.isInteger(m) && m >= 0))
    e.push('updatesFrom must be a list of major version numbers');
  if (typeof xapp.migrationNote !== 'string') e.push('migrationNote must be a string');
  if (!Array.isArray(xapp.snapshotExclude)) e.push('snapshotExclude must be a list');
  else for (const p of xapp.snapshotExclude)
    if (typeof p !== 'string' || !p || p.startsWith('/') || p.split('/').includes('..') || !(p === 'data' || p.startsWith('data/')))
      e.push(`snapshotExclude '${p}' must be a path under data/ (relative, no "..")`);
  return e;
}
