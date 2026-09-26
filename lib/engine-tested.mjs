/**
 * engine-tested.mjs — record which Engine build an App was last tested against.
 *
 * After a PASSING harness run only, the harness calls recordEngineTested() to
 * write this block into the tested App's app.yaml (koenswings/idea#96):
 *
 *   compatibility:
 *     engine_tested:
 *       commit: "<short sha>"   # git -C $ENGINE_CWD rev-parse --short HEAD
 *       version: "1.0"          # "version" from $ENGINE_CWD/package.json
 *       date: "YYYY-MM-DD"
 *
 * The edit is a minimal line-based rewrite of the compatibility.engine_tested
 * entry only, so every other key, engine_min and all comments are preserved.
 * No YAML dependency is needed. This module has no side effects on import and
 * is unit-testable without an Engine.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';

/** Local date as YYYY-MM-DD. */
export function isoDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Read the Engine short commit + package.json version from an Engine checkout. */
export function getEngineInfo(engineCwd, now = new Date()) {
  const commit = execFileSync('git', ['-C', engineCwd, 'rev-parse', '--short', 'HEAD'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (!/^[0-9a-f]{4,40}$/.test(commit)) {
    throw new Error(`Unexpected Engine commit from ${engineCwd}: "${commit}"`);
  }
  const pkg = JSON.parse(readFileSync(join(engineCwd, 'package.json'), 'utf8'));
  if (pkg.version === undefined || pkg.version === null || pkg.version === '') {
    throw new Error(`No "version" in ${join(engineCwd, 'package.json')}`);
  }
  return { commit, version: String(pkg.version), date: isoDate(now) };
}

const indentOf = (line) => line.match(/^ */)[0].length;
const isBlank = (line) => line.trim() === '';

/**
 * Return app.yaml text with compatibility.engine_tested replaced by {commit, version, date}.
 * Pure function: no I/O.
 */
export function setEngineTested(text, { commit, version, date }) {
  const q = (v) => JSON.stringify(String(v)); // JSON strings are valid double-quoted YAML scalars
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const hadTrailingNewline = lines.length > 0 && lines[lines.length - 1] === '';
  if (hadTrailingNewline) lines.pop();

  const compIdx = lines.findIndex(l => /^compatibility:\s*(#.*)?$/.test(l));
  if (compIdx === -1) {
    if (lines.some(l => /^compatibility:/.test(l))) {
      throw new Error('app.yaml has a non-block "compatibility:" value; refusing to edit');
    }
    // No compatibility block: append one.
    if (lines.length && !isBlank(lines[lines.length - 1])) lines.push('');
    lines.push('compatibility:', '  engine_tested:',
      `    commit: ${q(commit)}`, `    version: ${q(version)}`, `    date: ${q(date)}`);
    return lines.join(eol) + eol;
  }

  // Block = following lines until the next non-blank line at column 0.
  let end = compIdx + 1;
  while (end < lines.length && (isBlank(lines[end]) || indentOf(lines[end]) > 0)) end++;
  // Drop trailing blank lines from the block.
  let lastContent = end - 1;
  while (lastContent > compIdx && isBlank(lines[lastContent])) lastContent--;

  const firstChild = lines.slice(compIdx + 1, lastContent + 1).find(l => !isBlank(l));
  const ind = firstChild ? indentOf(firstChild) : 2;
  const pad = ' '.repeat(ind);
  const newEntry = [
    `${pad}engine_tested:`,
    `${pad}${pad}commit: ${q(commit)}`,
    `${pad}${pad}version: ${q(version)}`,
    `${pad}${pad}date: ${q(date)}`,
  ];

  const etIdx = lines.findIndex((l, i) =>
    i > compIdx && i <= lastContent && indentOf(l) === ind && /^\s*engine_tested:/.test(l));

  if (etIdx === -1) {
    lines.splice(lastContent + 1, 0, ...newEntry);
  } else {
    // Existing entry spans its own line plus any more-indented continuation lines.
    let etEnd = etIdx + 1;
    while (etEnd <= lastContent && (isBlank(lines[etEnd]) || indentOf(lines[etEnd]) > ind)) etEnd++;
    while (etEnd - 1 > etIdx && isBlank(lines[etEnd - 1])) etEnd--;
    lines.splice(etIdx, etEnd - etIdx, ...newEntry);
  }
  return lines.join(eol) + (hadTrailingNewline ? eol : '');
}

/**
 * Write engine_tested into <appDir>/app.yaml. Call ONLY after a passing run.
 * Returns the info written, or null if app.yaml does not exist.
 */
export function recordEngineTested({ appDir, engineCwd, now = new Date(), log = console.log }) {
  const appYaml = join(appDir, 'app.yaml');
  if (!existsSync(appYaml)) {
    log(`No app.yaml at ${appYaml}; engine_tested not recorded`);
    return null;
  }
  const info = getEngineInfo(engineCwd, now);
  const before = readFileSync(appYaml, 'utf8');
  const after = setEngineTested(before, info);
  const tmp = `${appYaml}.tmp-${process.pid}`;
  writeFileSync(tmp, after);
  renameSync(tmp, appYaml);
  log(`Recorded engine_tested in ${appYaml}: commit ${info.commit}, version ${info.version}, date ${info.date}`);
  return info;
}
