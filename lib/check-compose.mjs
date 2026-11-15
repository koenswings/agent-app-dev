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
