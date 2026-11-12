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

// idea#375 U-10 / idea#322 / idea#446: `check-compose --release`, ported from app-usage-dashboard
// script/check-compose.mjs. The dashboard checks only its web service against its ghcr repo; here the
// same rules apply to every service of any App:
//  - no packaging placeholder (DIGEST_PLACEHOLDER, SHORTSHA, <DIGEST>, REPLACE_ME_WITH_PUBLISHED_DIGEST)
//  - each service has an image: pinned as repo:<tag>@sha256:<64 hex> (Engine idea#322 saveName() rejects a
//    digest-only pin, so repo@sha256:digest is refused) and no build: block
//  - x-app.backup.verify (present/absent, idea#446) is required when x-app.backup.method is hook
export const PLACEHOLDER_RE = /DIGEST_PLACEHOLDER|<DIGEST>|SHORTSHA|REPLACE_ME_WITH_PUBLISHED_DIGEST/i;
export const TAG_DIGEST_PIN = /^(?:[a-z0-9.-]+(?::[0-9]+)?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*:[A-Za-z0-9_][A-Za-z0-9._-]{0,127}@sha256:[0-9a-f]{64}$/;
/** Release-only problems of a parsed compose; text = the raw file (for placeholders in comments too). */
export function checkComposeRelease(doc, text = '') {
  const e = [];
  if (PLACEHOLDER_RE.test(text)) {
    e.push('packaging placeholder still present (DIGEST_PLACEHOLDER, SHORTSHA, or <DIGEST>); fill it in before a release');
  }
  const svcs = doc?.services && typeof doc.services === 'object' ? Object.entries(doc.services) : [];
  for (const [name, s] of svcs) {
    const image = s?.image === undefined || s?.image === null ? '' : String(s.image).trim();
    if (!image) e.push(`release service ${name} has no image:`);
    else if (!TAG_DIGEST_PIN.test(image)) {
      e.push(`release service ${name} image must be <repo>:<tag>@sha256:<64-hex> (idea#322 tag+digest), got '${image}'`);
    }
    if (s && typeof s === 'object' && 'build' in s) e.push(`release service ${name} must drop the build: block`);
  }
  const backup = doc?.['x-app']?.backup;
  if (backup && typeof backup === 'object' && String(backup.method) === 'hook' && !('verify' in backup)) {
    e.push('release: x-app.backup.verify (present/absent, idea#446) is required when method is hook');
  }
  return e;
}
