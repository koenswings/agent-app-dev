// idea#76: x-app-version label == x-app.version (== the release tag when built from one). Pure, no I/O.
export const RELEASE_TAG = /^[0-9]+\.[0-9]+(-[A-Za-z0-9._]+)?$/;   // <major>.<minor>[-<upstream>]
export const DEV_VERSION = /^0\.0-dev\+[0-9a-f]{7,40}$/;           // ALLOW_UNTAGGED=1 builds only
const labelOf = (labels) => {
  if (Array.isArray(labels)) {
    const l = labels.map(String).find((x) => x.startsWith('x-app-version='));
    return l === undefined ? undefined : l.slice('x-app-version='.length);
  }
  return labels && typeof labels === 'object' && 'x-app-version' in labels ? String(labels['x-app-version']) : undefined;
};
/** Problems with the version wiring of a parsed compose; tag = the release tag it is built from, if any. */
export function checkComposeVersion(doc, tag) {
  const e = [];
  const v = doc?.['x-app']?.version;
  if (v === undefined || v === null || String(v) === '') return ['x-app.version missing'];
  const ver = String(v);
  if (tag !== undefined && ver !== tag) e.push(`x-app.version '${ver}' != tag '${tag}'`);
  const svcs = doc.services && typeof doc.services === 'object' ? Object.entries(doc.services) : [];
  if (!svcs.length) e.push('no services');
  for (const [name, s] of svcs) {
    const l = labelOf(s?.labels);
    if (l === undefined) e.push(`service ${name}: label x-app-version missing`);
    else if (l !== ver) e.push(`service ${name}: label x-app-version '${l}' != x-app.version '${ver}'`);
  }
  return e;
}
