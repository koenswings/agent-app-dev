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
// The Engine's rule for an unversioned App version, copied verbatim from agent-engine-dev
// src/data/Version.ts isUnversioned (main 721f0fa). An unversioned version sorts as 0.0: it is never
// offered as an update target and never counts as a major change, so a release must not use one
// (e.g. `1.1-2024.12.03`, DATE_RE; a SHA token; a leading number >= 1000). Keep in sync with Version.ts.
export const ENGINE_DATE_RE = /(^|[^0-9])\d{4}[-._]\d{1,2}[-._]\d{1,2}([^0-9]|$)/;
export const ENGINE_SHA_TOKEN_RE = /^g?[0-9a-f]{7,40}$/i;
export const engineIsUnversioned = (raw) => {
  const s = String(raw ?? '').trim();
  const m = s.match(/(\d+(?:\.\d+)*)/);
  if (!m) return true;
  if (ENGINE_DATE_RE.test(s)) return true;
  for (const tok of s.split(/[^0-9A-Za-z]+/)) {
    if (!tok) continue;
    if (ENGINE_SHA_TOKEN_RE.test(tok) && /[a-f]/i.test(tok.replace(/^g/i, ''))) return true;
    if (/^\d{7,}$/.test(tok)) return true;
  }
  return Number(m[1].split('.')[0]) >= 1000;
};

/** Problems with the version wiring of a parsed compose; tag = the release tag it is built from, if any. */
export function checkComposeVersion(doc, tag) {
  const e = [];
  const v = doc?.['x-app']?.version;
  if (v === undefined || v === null || String(v) === '') return ['x-app.version missing'];
  const ver = String(v);
  if (tag !== undefined && ver !== tag) e.push(`x-app.version '${ver}' != tag '${tag}'`);
  // ALLOW_UNTAGGED dev bundles (0.0-dev+<sha>) are unversioned on purpose (never offered as an update).
  if (!DEV_VERSION.test(ver) && engineIsUnversioned(ver))
    e.push(`x-app.version '${ver}' reads as unversioned to the Engine (Version.ts: date-shaped, SHA token, or leading number >= 1000); use <major>.<minor>[-<upstream>] without a date, e.g. '${(/^[0-9]+\.[0-9]+/.exec(ver) ?? ['1.0'])[0]}'`);
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

// idea#403: x-app.backup structure, matching the Engine parser (agent-engine-dev#404, on top of #325/#443/#446):
//  - method: stop (default) | hook | none. `live` is not implemented in the Engine (fails closed there).
//  - hook: preHook required; preHook/postHook are one {service, command, user?} mapping or an ordered,
//    non-empty list of them; every step's service must be a compose service; command is one string
//    (a single argv word, no shell) or a non-empty list of strings; user is a uid or a username.
//  - fallback: stop|fail; hookTimeout: integer seconds 1..86400.
//  - exclude / hookExclude / verify.present / verify.absent: lists of instance-relative paths, no globs,
//    no absolute path, no '.' or '..' component, no leading '-' (same rules as the Engine's normalizer).
//  - Stricter than the Engine (which ignores them): preHook, postHook and hookExclude are refused with
//    method stop or none, since they would never run or apply.
// Applied with and without --release. verify-for-hook stays a --release rule (checkComposeRelease).
const SERVICE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const USER_TOKEN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const PATH_TOKEN = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/;
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pathProblem = (raw) => {
  if (typeof raw !== 'string') return 'must be a string';
  let p = raw.trim();
  if (!p) return 'is empty';
  if (p.startsWith('-')) return 'looks like an option';
  if (p.startsWith('/')) return 'is absolute';
  while (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/\/+$/, '');
  if (!p || p.includes('//')) return 'is not a clean relative path';
  if (p.split('/').some((c) => c === '' || c === '.' || c === '..')) return "has a '.' or '..' component";
  if (/[*?[\]]/.test(p)) return 'is a glob (globs are not allowed)';
  if (!PATH_TOKEN.test(p)) return 'has unsupported characters';
  return null;
};
const checkPathList = (e, v, field) => {
  if (v === undefined || v === null) return;
  if (!Array.isArray(v)) { e.push(`x-app.backup.${field} must be a list of paths`); return; }
  for (const item of v) { const why = pathProblem(item); if (why) e.push(`x-app.backup.${field} entry '${item}' ${why}`); }
};
const checkStep = (e, step, name, services) => {
  if (!isMap(step)) { e.push(`x-app.backup.${name} must be a mapping {service, command, user?}`); return; }
  const { service, command, user } = step;
  if (typeof service !== 'string' || !service) e.push(`x-app.backup.${name}.service is required`);
  else if (service.startsWith('-') || service.includes('..') || !SERVICE_TOKEN.test(service)) e.push(`x-app.backup.${name}.service '${service}' is not a compose service name`);
  else if (!services.has(service)) e.push(`x-app.backup.${name}.service '${service}' is not a service in this compose`);
  const word = (w) => typeof w === 'string' && w !== '' && !w.includes('\0') && !/[\n\r]/.test(w);
  if (typeof command === 'string') { if (!word(command)) e.push(`x-app.backup.${name}.command is empty or has a newline`); }
  else if (Array.isArray(command)) { if (!command.length || !command.every(word)) e.push(`x-app.backup.${name}.command must be a non-empty list of non-empty strings`); }
  else e.push(`x-app.backup.${name}.command must be a string or a list of strings`);
  if (user !== undefined && user !== null && user !== '') {
    const u = typeof user === 'number' && Number.isInteger(user) ? String(user) : user;
    if (typeof u !== 'string' || u.startsWith('-') || u.includes('..') || !USER_TOKEN.test(u)) e.push(`x-app.backup.${name}.user '${user}' is not a uid or username`);
  }
  for (const k of Object.keys(step)) if (!['service', 'command', 'user'].includes(k)) e.push(`x-app.backup.${name} has unknown key '${k}'`);
};
const checkHookList = (e, raw, which, services) => {
  if (raw === undefined || raw === null) return;
  if (!Array.isArray(raw)) { checkStep(e, raw, which, services); return; }
  if (!raw.length) { e.push(`x-app.backup.${which} is an empty list`); return; }
  raw.forEach((s, i) => checkStep(e, s, `${which}[${i}]`, services));
};
/** Problems with x-app.backup in a parsed compose ([] when absent or valid). */
export function checkComposeBackup(doc) {
  const e = [];
  const xapp = doc?.['x-app'];
  if (!isMap(xapp) || xapp.backup === undefined || xapp.backup === null) return e;
  const b = xapp.backup;
  if (!isMap(b)) return ['x-app.backup must be a mapping'];
  const services = new Set(isMap(doc.services) ? Object.keys(doc.services) : []);
  const method = b.method === undefined || b.method === null ? 'stop' : b.method;
  if (method === 'live') e.push("x-app.backup.method 'live' is not implemented by the Engine (use stop, hook or none)");
  else if (!['stop', 'hook', 'none'].includes(method)) e.push(`x-app.backup.method '${method}' is not allowed (use stop, hook or none)`);
  if (b.fallback !== undefined && b.fallback !== null && !['stop', 'fail'].includes(b.fallback)) e.push(`x-app.backup.fallback '${b.fallback}' is not allowed (use stop or fail)`);
  if (b.hookTimeout !== undefined && b.hookTimeout !== null) {
    const n = typeof b.hookTimeout === 'number' ? b.hookTimeout : Number(b.hookTimeout);
    if (!Number.isInteger(n) || n < 1 || n > 86400) e.push('x-app.backup.hookTimeout must be a positive integer number of seconds (max 86400)');
  }
  checkHookList(e, b.preHook, 'preHook', services);
  checkHookList(e, b.postHook, 'postHook', services);
  if (method === 'hook' && (b.preHook === undefined || b.preHook === null)) e.push("x-app.backup.method is 'hook' but preHook is missing");
  if (method === 'stop' || method === 'none') {
    for (const k of ['preHook', 'postHook', 'hookExclude']) {
      if (b[k] !== undefined && b[k] !== null) e.push(`x-app.backup.${k} is only used with method hook (method is ${method})`);
    }
  }
  checkPathList(e, b.exclude, 'exclude');
  checkPathList(e, b.hookExclude, 'hookExclude');
  if (b.verify !== undefined && b.verify !== null) {
    if (!isMap(b.verify)) e.push('x-app.backup.verify must be a mapping {present, absent}');
    else { checkPathList(e, b.verify.present, 'verify.present'); checkPathList(e, b.verify.absent, 'verify.absent'); }
  }
  return e;
}

// Gap 12 / Axle addendum (2026-11-15): x-app.update structure. Applied with and without --release.
// prepare, verify, work and settle are optional (a missing x-app.update is valid; unknown x-app
// keys stay allowed). When a stage is present:
//  - prepare, verify, work: { service, command, timeout, user? }
//  - settle: { service, command, interval, timeout, user? }
//  - timeout and interval are positive integer seconds, 1..86400; Check refuses if they are missing
//  - settle interval must not be greater than timeout
//  - service must be a compose service; command is one absolute path (not a list, no sh -c)
//  - user, if present, is a uid or username (same shape as x-app.backup hook steps)
const UPDATE_STAGES = ['prepare', 'verify', 'work', 'settle'];
const UPDATE_SECS_MAX = 86400;
const parseSecs = (raw) => {
  if (raw === undefined || raw === null) return { why: 'is required' };
  // Accept a YAML integer or a digits-only string only. Number(true) === 1 and
  // Number([600]) === 600, so booleans, lists, and strings like "600.0" must
  // be refused before the 1..86400 check (Axle should-fix on agent-app-dev#60).
  let n;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\d+$/.test(raw)) n = Number(raw);
  else return { why: 'must be a positive integer number of seconds (max 86400)' };
  if (!Number.isInteger(n) || n < 1 || n > UPDATE_SECS_MAX) return { why: 'must be a positive integer number of seconds (max 86400)' };
  return { n };
};
const checkUpdateStage = (e, stage, name, services) => {
  const settle = name === 'settle';
  const shape = settle
    ? 'a mapping {service, command, interval, timeout, user?}'
    : 'a mapping {service, command, timeout, user?}';
  if (!isMap(stage)) { e.push(`x-app.update.${name} must be ${shape}`); return; }
  const { service, command, user, timeout, interval } = stage;
  if (typeof service !== 'string' || !service) e.push(`x-app.update.${name}.service is required`);
  else if (service.startsWith('-') || service.includes('..') || !SERVICE_TOKEN.test(service)) e.push(`x-app.update.${name}.service '${service}' is not a compose service name`);
  else if (!services.has(service)) e.push(`x-app.update.${name}.service '${service}' is not a service in this compose`);
  if (typeof command !== 'string' || !command || command.includes('\0') || /[\n\r]/.test(command) || command.startsWith('-')) {
    e.push(`x-app.update.${name}.command must be an absolute path`);
  } else if (!command.startsWith('/') || /\s/.test(command)) {
    e.push(`x-app.update.${name}.command '${command}' must be an absolute path`);
  }
  const t = parseSecs(timeout);
  if (t.why) e.push(`x-app.update.${name}.timeout ${t.why}`);
  if (settle) {
    const i = parseSecs(interval);
    if (i.why) e.push(`x-app.update.${name}.interval ${i.why}`);
    else if (t.n !== undefined && i.n > t.n) e.push(`x-app.update.${name}.interval ${i.n} is greater than timeout ${t.n}`);
  }
  if (user !== undefined && user !== null && user !== '') {
    const u = typeof user === 'number' && Number.isInteger(user) ? String(user) : user;
    if (typeof u !== 'string' || u.startsWith('-') || u.includes('..') || !USER_TOKEN.test(u)) e.push(`x-app.update.${name}.user '${user}' is not a uid or username`);
  }
  const allowed = settle ? ['service', 'command', 'user', 'timeout', 'interval'] : ['service', 'command', 'user', 'timeout'];
  for (const k of Object.keys(stage)) if (!allowed.includes(k)) e.push(`x-app.update.${name} has unknown key '${k}'`);
};
/** Problems with x-app.update in a parsed compose ([] when absent or valid). */
export function checkComposeUpdate(doc) {
  const e = [];
  const xapp = doc?.['x-app'];
  if (!isMap(xapp) || xapp.update === undefined || xapp.update === null) return e;
  const u = xapp.update;
  if (!isMap(u)) return ['x-app.update must be a mapping'];
  const services = new Set(isMap(doc.services) ? Object.keys(doc.services) : []);
  for (const k of Object.keys(u)) {
    if (!UPDATE_STAGES.includes(k)) e.push(`x-app.update has unknown key '${k}'`);
  }
  for (const name of UPDATE_STAGES) {
    if (u[name] === undefined || u[name] === null) continue;
    checkUpdateStage(e, u[name], name, services);
  }
  return e;
}


// ── Stateful image upgrades need an App major (idea#403, Steve's rule) ──────────────────────
// A new database series rewrites its data files on the first start (mariadb-upgrade, the MySQL data
// dictionary, pg_upgrade, Mongo feature compatibility, the Redis RDB format) and cannot go back. The
// Engine only requires a Backup Disk backup before an App *major* update (backupIsDue), so a release
// that moves a stateful service image to a new series must also bump the App major. Compared with a
// base compose (the previous release, or the base ref of a PR):
// `check-compose --base <file>` / `--base-ref <ref>`. See docs/app-bundle-integrity.md.
// Series (v = [X, Y, Z]): MariaDB, Mongo, Redis, Valkey, KeyDB = X.Y; MySQL/Percona = X.Y, except
// 8.0 = 8.0.Z (each 8.0 patch upgrades the data dictionary in place); Postgres = X from 10, X.Y before.
// Redis-like images count only when the service has a volume.
const xy = (v) => (v[1] === undefined ? null : `${v[0]}.${v[1]}`);
export const STATEFUL_IMAGES = [
  { kind: 'mysql', re: /(^|[-_])(mariadb)($|[-_])/, series: xy },
  { kind: 'mysql', re: /(^|[-_])(mysql|percona)($|[-_])/,
    series: (v) => (v[0] === 8 && v[1] === 0 ? (v[2] === undefined ? null : `8.0.${v[2]}`) : xy(v)) },
  { kind: 'mongo', re: /(^|[-_])(mongo|mongodb)($|[-_])/, series: xy },
  { kind: 'postgres', re: /(^|[-_])(postgres|postgresql|postgis|timescaledb)($|[-_])/,
    series: (v) => (v[0] >= 10 ? String(v[0]) : xy(v)) },
  { kind: 'redis', re: /(^|[-_])(redis|valkey|keydb)($|[-_])/, series: xy, needsVolume: true },
];

/** {repo, tag} of an image ref (digest dropped; registry kept in repo). */
export const splitImage = (image) => {
  const s = String(image ?? '').split('@')[0];
  const slash = s.lastIndexOf('/'), colon = s.lastIndexOf(':');
  return colon > slash ? { repo: s.slice(0, colon), tag: s.slice(colon + 1) } : { repo: s, tag: '' };
};

/** Stateful kind of a compose service ({kind, product, series}), or null. */
export const statefulKind = (service) => {
  if (!isMap(service) || typeof service.image !== 'string') return null;
  const name = splitImage(service.image).repo.split('/').pop().toLowerCase();
  const hit = STATEFUL_IMAGES.find((k) => k.re.test(name));
  if (!hit) return null;
  if (hit.needsVolume && !(Array.isArray(service.volumes) && service.volumes.length)) return null;
  return { ...hit, product: hit.re.exec(name)[2] };
};

const IDEA_RETAG = /(^|\/)koenswings\//;            // docker.io/koenswings/… and ghcr.io/koenswings/…
const DATE_TAG = /^(19|20)[0-9]{2}[.-]?[0-9]{2}([.-]?[0-9]{2})?([^0-9]|$)/;
const versionParts = (t) => { const m = /^v?([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?/.exec(String(t ?? '')); return m ? m.slice(1).map((x) => (x === undefined ? undefined : Number(x))) : null; };
const unwrapRetag = (t) => { const m = /^[0-9]+\.[0-9]+-(.+)$/.exec(String(t ?? '')); return m ? m[1] : null; };

/** Image repo normalised for comparison: lowercase, no docker.io/library prefix, IDEA retags as koenswings/<x>. */
export const normRepo = (repo) => {
  let r = String(repo ?? '').split('@')[0].toLowerCase().replace(/^(docker\.io|index\.docker\.io)\//, '').replace(/^library\//, '');
  const m = /(^|\/)koenswings\/(.+)$/.exec(r);
  if (m) r = `koenswings/${m[2]}`;
  return r;
};

/**
 * app.yaml service entry for a compose service, or null. Matched by name, else by image repo; an entry
 * that names an `image` is used only when that image is the compose repo (normRepo), otherwise null so
 * the check fails closed (an entry describing another image must not lend it its version).
 */
const appYamlEntry = (appYaml, svcName, repo) => {
  const list = [appYaml?.services, appYaml?.images].find(Array.isArray) ?? [];
  const want = normRepo(repo);
  const e = list.find((x) => isMap(x) && x.name === svcName) ?? list.find((x) => isMap(x) && typeof x.image === 'string' && normRepo(splitImage(x.image).repo) === want) ?? null;
  if (e && typeof e.image === 'string' && normRepo(splitImage(e.image).repo) !== want) return null;
  return e;
};

/**
 * Upstream version of a service image: the tag, with IDEA retags `koenswings/<x>:<idea>.<n>-<upstream>`
 * unwrapped. A retag whose upstream part is a date (`1.0-2024.12.03`) or unreadable is read from the
 * `upstream_tag` of the App's app.yaml services[] entry for that image (no other fallback: for a date
 * retag `current_version` is the date tag itself). Null if unknown, which fails closed.
 */
export const upstreamVersion = (image, { appYaml, service } = {}) => {
  const { repo, tag } = splitImage(image);
  if (!IDEA_RETAG.test(repo)) return tag;
  const up = unwrapRetag(tag) ?? tag;
  if (!DATE_TAG.test(up) && versionParts(up)) return up;
  const c = appYamlEntry(appYaml, service, repo)?.upstream_tag;
  return c != null && !DATE_TAG.test(String(c)) && versionParts(c) ? String(c) : null;
};

/** Upstream series of a service image for a stateful kind ('11.7', '16', '8.0.36', ...), or null. */
export const imageSeries = (image, kind, ctx) => {
  const v = versionParts(upstreamVersion(image, ctx));
  return v ? kind.series(v) : null;
};

const appMajor = (doc) => { const m = /^([0-9]+)\./.exec(String(doc?.['x-app']?.version ?? '')); return m ? Number(m[1]) : null; };
const cmpSeries = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return Math.sign(d); } return 0; };

/**
 * Errors for stateful service images that change series versus `baseDoc` without an App major bump.
 * Services are compared by name; a stateful service removed from the base and one added in `doc`
 * of the same kind are paired as a rename (more than one of a kind on either side = ambiguous,
 * which needs an App major). `opts.baseAppYaml` / `opts.appYaml` (parsed app.yaml) resolve date retags.
 */
export const checkStatefulMajor = (baseDoc, doc, opts = {}) => {
  const e = [];
  const baseSvcs = isMap(baseDoc?.services) ? baseDoc.services : {};
  const svcs = isMap(doc?.services) ? doc.services : {};
  const oldMajor = appMajor(baseDoc), newMajor = appMajor(doc);
  const majorBumped = oldMajor !== null && newMajor !== null && newMajor > oldMajor;
  const vFrom = baseDoc?.['x-app']?.version, vTo = doc?.['x-app']?.version;
  const pairs = Object.keys(svcs).filter((n) => isMap(baseSvcs[n])).map((n) => [n, n]);
  // Renames: removed vs added stateful services, grouped by kind.
  const removed = Object.keys(baseSvcs).filter((n) => !(n in svcs) && statefulKind(baseSvcs[n]));
  const added = Object.keys(svcs).filter((n) => !(n in baseSvcs) && statefulKind(svcs[n]));
  for (const kind of new Set(removed.map((n) => statefulKind(baseSvcs[n]).kind))) {
    const r = removed.filter((n) => statefulKind(baseSvcs[n]).kind === kind);
    const a = added.filter((n) => statefulKind(svcs[n]).kind === kind);
    if (!a.length) continue;
    if (r.length === 1 && a.length === 1) pairs.push([r[0], a[0]]);
    else if (!majorBumped) e.push(`stateful ${kind} services ${r.join(', ')} removed and ${a.join(', ')} added: cannot pair the rename; bump the App major (x-app.version ${vFrom} -> ${vTo}) so the Engine backs up first`);
  }
  for (const [oldName, name] of pairs) {
    const was = baseSvcs[oldName], svc = svcs[name];
    if (was.image === svc?.image) continue;
    const kindNew = statefulKind(svc), kindOld = statefulKind(was);
    if (!kindNew && !kindOld) continue;
    const label = oldName === name ? `service ${name}` : `service ${oldName} (renamed ${name})`;
    const where = `${label}: stateful image ${splitImage(was.image).repo}:${splitImage(was.image).tag} -> ${splitImage(svc.image).repo}:${splitImage(svc.image).tag}`;
    if (!kindNew || !kindOld || kindNew.product !== kindOld.product) {
      if (!majorBumped) e.push(`${where} changes the database engine; bump the App major (x-app.version ${vFrom} -> ${vTo}) so the Engine backs up first`);
      continue;
    }
    const from = imageSeries(was.image, kindOld, { appYaml: opts.baseAppYaml, service: oldName });
    const to = imageSeries(svc.image, kindNew, { appYaml: opts.appYaml, service: name });
    if (from === null || to === null) {
      if (!majorBumped) e.push(`${where}: cannot read the ${kindNew.product} series from the tag or app.yaml; bump the App major or use a versioned tag`);
      continue;
    }
    const c = cmpSeries(to, from);
    if (c < 0) e.push(`${where} goes back from ${kindNew.product} ${from} to ${to}; a database series cannot be downgraded`);
    else if (c > 0 && !majorBumped) e.push(`${where} moves ${kindNew.product} ${from} -> ${to} without an App major bump (x-app.version ${vFrom} -> ${vTo}); bump the App major so updateApp requires a Backup Disk backup first`);
  }
  return e;
};

// ── E3: a Nextcloud App must keep config/ and custom_apps/ in the pre-update snapshot ─────────
// updateApp's rollback (agent-engine-dev main fac5b1a, src/data/UpdateApp.ts rollBack ->
// restoreSnapshot -> script/build_image_assets/idea-app-data restore-snapshot) puts the instance
// folder back in place from .pre-update/<id> with rsync --delete. Only the excluded paths
// (x-app.backup.exclude ∪ x-app.snapshotExclude, recorded in the snapshot's EXCLUDE) are left
// alone. If Nextcloud's config/ or custom_apps/ were excluded, a rollback would keep the newer
// config.php (new 'version', appstoreenabled=false) and custom_apps/.idea-update-state/ next to
// the old code. So for a Nextcloud App, an entry of either list fails when it is one of those
// folders, a path inside one, or an ancestor of one (data/nextcloud, data, '.').
// - Nextcloud App: x-app.name 'nextcloud', or a service whose image repo's last part is exactly
//   'nextcloud' (nextcloud:31-apache, koenswings/nextcloud:…), the same by-repo-name matching as
//   STATEFUL_IMAGES. nextcloud-code / nextcloud-mariadb do not count.
// - Protected folders: data/nextcloud/config and data/nextcloud/custom_apps (app-nextcloud binds
//   ./data/nextcloud:/var/www/html), plus <src>/config and <src>/custom_apps for every relative
//   bind of a Nextcloud service onto /var/www/html, and <src> of a bind onto
//   /var/www/html/config or /var/www/html/custom_apps.
// - Entries are normalised like the Engine (backupExclude.ts normalizeBackupExclude): trimmed,
//   leading './' and trailing '/' dropped, a bare name other than 'data' (and not starting with '.')
//   means data/<name>. '.', '' and a path that climbs above the instance folder count as the
//   instance folder. Conservative on globs (which the Engine refuses anyway): a pattern fails when
//   it could match a protected folder, a path inside it or an ancestor; '**' matches any depth.
const NC_HTML = '/var/www/html';
const NC_DEFAULT_BASE = 'data/nextcloud';
const NC_PROTECTED = ['config', 'custom_apps'];
const isNextcloudImage = (image) => typeof image === 'string' && normRepo(splitImage(image).repo).split('/').pop() === 'nextcloud';
/** True for a Nextcloud App (x-app.name or a nextcloud image). */
export const isNextcloudApp = (doc) => {
  const name = doc?.['x-app']?.name;
  if (typeof name === 'string' && name.trim().toLowerCase() === 'nextcloud') return true;
  return isMap(doc?.services) && Object.values(doc.services).some((s) => isMap(s) && isNextcloudImage(s.image));
};
/** Lexical instance-relative segments ([] = the instance folder itself); '..' above the root -> []. */
const relSegments = (raw) => {
  const out = [];
  for (const c of String(raw).trim().split('/')) {
    if (c === '' || c === '.') continue;
    if (c === '..') { if (!out.length) return []; out.pop(); continue; }
    out.push(c);
  }
  return out;
};
const bindOf = (v) => {
  if (typeof v === 'string') {
    const [src, target] = v.split(':');
    return target === undefined ? null : { src, target };
  }
  if (isMap(v) && typeof v.source === 'string' && typeof v.target === 'string' && (v.type === undefined || v.type === 'bind')) return { src: v.source, target: v.target };
  return null;
};
/** Instance-relative folders of Nextcloud's config/ and custom_apps/ for this compose. */
export const nextcloudProtectedPaths = (doc) => {
  const out = new Set(NC_PROTECTED.map((d) => `${NC_DEFAULT_BASE}/${d}`));
  const svcs = isMap(doc?.services) ? Object.values(doc.services) : [];
  for (const s of svcs) {
    if (!isMap(s) || !isNextcloudImage(s.image) || !Array.isArray(s.volumes)) continue;
    for (const v of s.volumes) {
      const b = bindOf(v);
      if (!b || !/^\.\.?(\/|$)/.test(b.src.trim())) continue;      // relative binds only (no named volume, no host path)
      const src = relSegments(b.src).join('/');
      const target = b.target.trim().replace(/\/+$/, '');
      if (!src) continue;
      if (target === NC_HTML) for (const d of NC_PROTECTED) out.add(`${src}/${d}`);
      else if (NC_PROTECTED.some((d) => target === `${NC_HTML}/${d}`)) out.add(src);
    }
  }
  return [...out];
};
const GLOB_CHARS = /[*?[\]]/;
/** RegExp for one glob segment, or null when it cannot be read (treated as matching anything). */
const segmentRe = (seg) => {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = seg.indexOf(']', i + 2);
      if (end < 0) return null;
      let cls = seg.slice(i + 1, end);
      if (cls.startsWith('!')) cls = `^${cls.slice(1)}`;
      re += `[${cls.replace(/\\/g, '\\\\')}]`;
      i = end;
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  try { return new RegExp(`^${re}$`); } catch { return null; }
};
/** 'equal' | 'inside' | 'ancestor' when pattern segments P could cover protected segments Q, else null. */
const coverage = (P, Q) => {
  const k = Math.min(P.length, Q.length);
  for (let i = 0; i < k; i++) {
    if (P[i] === '**') return 'ancestor';
    if (GLOB_CHARS.test(P[i])) { const re = segmentRe(P[i]); if (re && !re.test(Q[i])) return null; }
    else if (P[i] !== Q[i]) return null;
  }
  if (P.length === Q.length) return 'equal';
  return P.length > Q.length ? 'inside' : 'ancestor';
};
/** Problems with x-app.backup.exclude / x-app.snapshotExclude for a Nextcloud App ([] otherwise). */
export function checkNextcloudRollbackPaths(doc) {
  const e = [];
  const xapp = doc?.['x-app'];
  if (!isMap(xapp) || !isNextcloudApp(doc)) return e;
  const protectedPaths = nextcloudProtectedPaths(doc);
  const lists = [['x-app.backup.exclude', isMap(xapp.backup) ? xapp.backup.exclude : undefined], ['x-app.snapshotExclude', xapp.snapshotExclude]];
  for (const [key, list] of lists) {
    if (!Array.isArray(list)) continue;                               // shape errors: checkComposeBackup / the Engine
    for (const raw of list) {
      if (typeof raw !== 'string') continue;
      const segs = relSegments(raw);
      const glob = GLOB_CHARS.test(raw);
      // The Engine reads a bare name as data/<name>; for a glob check both readings.
      const forms = segs.length === 1 && segs[0] !== 'data' && !segs[0].startsWith('.')
        ? (glob ? [segs, ['data', ...segs]] : [['data', ...segs]]) : [segs];
      let hit = null;
      for (const Q of protectedPaths) {
        for (const P of forms) { const c = coverage(P, Q.split('/')); if (c) { hit = { q: Q, c, p: P.join('/') || '.' }; break; } }
        if (hit) break;
      }
      if (!hit) continue;
      const what = glob ? `could match ${hit.c === 'ancestor' ? 'an ancestor of' : hit.c === 'inside' ? 'a path inside' : ''} ${hit.q}`.replace(/  +/g, ' ')
        : hit.c === 'equal' ? `is ${hit.q}` : hit.c === 'inside' ? `(${hit.p}) is inside ${hit.q}` : `(${hit.p}) contains ${hit.q}`;
      e.push(`${key} entry '${raw}' ${what}: a Nextcloud App must not exclude config/ or custom_apps/ from the backup or the pre-update snapshot, since an updateApp rollback (restore-snapshot, rsync --delete) would then keep the newer config.php or custom_apps/.idea-update-state/ (E3)`);
    }
  }
  return e;
}
