#!/usr/bin/env node
// On-demand idea-usage day (and optional sample) hook run for idea#413.
//
// The live idea-usage process only writes day files for *past* dates: on
// process start (catch-up, today-14..yesterday, and only if the instance
// already existed that day) and in the kit-local night window 02:00–03:30.
// There is no Engine CLI to request today's day file. This helper imports
// the Engine's own runDayHook / runSampleHook / defaultExecHook from the
// deployed dist (read-only) and records each hook's exit code and duration
// against the declared timeout.
//
// Usage:
//   node trigger-day-hooks.mjs --day YYYY-MM-DD --out timings.json \
//        [--sample] [--instance-id <id>]...
//
// Environment:
//   ENGINE_ROOT  default /home/pi/idea/agents/agent-engine-dev
//
// Never prints hook stdout (may be large). Never prints credentials.
// Does not modify the Engine tree.

import { pathToFileURL } from 'node:url'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const engineRoot = process.env.ENGINE_ROOT || '/home/pi/idea/agents/agent-engine-dev'
const runnerJs = join(engineRoot, 'dist/src/usage/runner.js')
const discoverJs = join(engineRoot, 'dist/src/usage/discover.js')
if (!existsSync(runnerJs) || !existsSync(discoverJs)) {
  console.error(`ERROR: Engine usage dist not found under ${engineRoot} (need dist/src/usage/{runner,discover}.js)`)
  process.exit(1)
}

const { runDayHook, runSampleHook, defaultExecHook } = await import(pathToFileURL(runnerJs).href)
const { defaultListTargets } = await import(pathToFileURL(discoverJs).href)

const args = process.argv.slice(2)
let day = ''
let outPath = ''
let doSample = false
const onlyIds = new Set()
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--day') day = args[++i] || ''
  else if (a === '--out') outPath = args[++i] || ''
  else if (a === '--sample') doSample = true
  else if (a === '--instance-id') onlyIds.add(args[++i] || '')
  else if (a === '-h' || a === '--help') {
    console.log('Usage: trigger-day-hooks.mjs --day YYYY-MM-DD --out timings.json [--sample] [--instance-id id]...')
    process.exit(0)
  } else {
    console.error(`unknown argument: ${a}`)
    process.exit(2)
  }
}
if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day)) {
  console.error('ERROR: --day YYYY-MM-DD is required')
  process.exit(2)
}
if (!outPath) {
  console.error('ERROR: --out <timings.json> is required')
  process.exit(2)
}

const timings = []
const wrapExec = (meta) => async (spec) => {
  const started = Date.now()
  let result
  try {
    result = await defaultExecHook(spec)
  } catch (e) {
    const rec = {
      ...meta,
      instanceId: meta.instanceId,
      app: meta.app,
      mode: spec.mode || meta.mode,
      day: spec.day || meta.day || null,
      timeoutS: spec.timeoutS,
      durationMs: Date.now() - started,
      exitCode: 127,
      timedOut: false,
      oversizeStdout: false,
      error: e instanceof Error ? e.message : String(e),
    }
    timings.push(rec)
    throw e
  }
  timings.push({
    ...meta,
    instanceId: meta.instanceId,
    app: meta.app,
    mode: spec.mode || meta.mode,
    day: spec.day || meta.day || null,
    timeoutS: spec.timeoutS,
    durationMs: Date.now() - started,
    exitCode: result.exitCode,
    timedOut: Boolean(result.timedOut),
    oversizeStdout: Boolean(result.oversizeStdout),
    withinTimeout: !result.timedOut && (Date.now() - started) < ((spec.timeoutS + 15) * 1000),
  })
  return result
}

const all = await defaultListTargets()
const targets = all.filter((t) => onlyIds.size === 0 || onlyIds.has(t.instanceId))
if (targets.length === 0) {
  console.error('ERROR: no usage targets matched (discovered %d, filter %s)', all.length, [...onlyIds].join(',') || '<none>')
  writeFileSync(outPath, JSON.stringify({ day, targets: [], timings, error: 'no-targets' }, null, 2) + '\n')
  process.exit(1)
}

const dayFiles = []
const samples = []
for (const target of targets) {
  const meta = { instanceId: target.instanceId, app: target.app, name: target.name, listed: target.listed }
  if (doSample) {
    const rec = await runSampleHook({
      target,
      exec: wrapExec({ ...meta, mode: 'sample' }),
    })
    if (rec) samples.push({ instanceId: target.instanceId, app: target.app, supported: rec.supported !== false })
    else samples.push({ instanceId: target.instanceId, app: target.app, supported: false, stored: false })
  }
  const rec = await runDayHook({
    target,
    day,
    exec: wrapExec({ ...meta, mode: 'day', day }),
    overwriteOk: true,
  })
  dayFiles.push({
    instanceId: target.instanceId,
    app: rec.app || target.app,
    hookStatus: rec.hookStatus,
    skipReason: rec.skipReason || null,
    listed: rec.listed,
    day: rec.day,
  })
}

const report = {
  day,
  engineRoot,
  discovered: all.map((t) => ({ instanceId: t.instanceId, app: t.app, listed: t.listed })),
  ran: targets.map((t) => t.instanceId),
  dayFiles,
  samples,
  timings,
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ok: true, day, ran: report.ran, hookStatus: dayFiles.map((d) => [d.instanceId, d.hookStatus]), timings: timings.map((t) => ({ instanceId: t.instanceId, mode: t.mode, exitCode: t.exitCode, durationMs: t.durationMs, timeoutS: t.timeoutS, timedOut: t.timedOut })) }, null, 2))
