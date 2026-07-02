#!/usr/bin/env node
// Integration tests for scripts/postinstall.js
// Uses only Node built-ins; no npm dependencies.

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

// ---------------------------------------------------------------------------
// Tiny assert harness
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0
const failures = []

function assert(label, condition, detail) {
  if (condition) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    const msg = detail ? `${label} — ${detail}` : label
    failures.push(msg)
    console.log(`  FAIL  ${msg}`)
  }
}

function assertEqual(label, actual, expected) {
  const ok = actual === expected
  assert(label, ok, ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..')
const POSTINSTALL = path.join(__dirname, 'postinstall.js')

function makeFakeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'curator-test-'))
}

function buildEnv(fakeHome) {
  return Object.assign({}, process.env, { HOME: fakeHome, USERPROFILE: fakeHome })
}

function run(fakeHome, args) {
  args = args || []
  const result = spawnSync(
    process.execPath,
    [POSTINSTALL].concat(args),
    { cwd: REPO_ROOT, env: buildEnv(fakeHome), encoding: 'utf8' }
  )
  return result
}

function readSettings(fakeHome) {
  const p = path.join(fakeHome, '.claude', 'settings.json')
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function writeSettings(fakeHome, obj) {
  const claudeDir = path.join(fakeHome, '.claude')
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(obj, null, 2) + '\n')
}

function writeSettingsRaw(fakeHome, raw) {
  const claudeDir = path.join(fakeHome, '.claude')
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), raw)
}

// Count SessionStart entries whose command includes the curator hook path.
function countCuratorSessionStart(settings, fakeHome) {
  const entries = (settings.hooks && settings.hooks.SessionStart) || []
  const hookDest = path.join(fakeHome, '.claude', 'curator-hook.sh')
  return entries.filter(entry => {
    const hooks = entry.hooks || []
    return hooks.some(h =>
      typeof h.command === 'string' &&
      (h.command.includes(hookDest) || h.command.includes(hookDest.replace(/\\/g, '/')))
    )
  }).length
}

// Count Stop entries whose command includes the curator stop hook path.
function countCuratorStop(settings, fakeHome) {
  const entries = (settings.hooks && settings.hooks.Stop) || []
  const stopDest = path.join(fakeHome, '.claude', 'curator-stop.sh')
  return entries.filter(entry => {
    const hooks = entry.hooks || []
    return hooks.some(h =>
      typeof h.command === 'string' &&
      (h.command.includes(stopDest) || h.command.includes(stopDest.replace(/\\/g, '/')))
    )
  }).length
}

const dirs = []

function test(name, fn) {
  console.log(`\n[${name}]`)
  const fakeHome = makeFakeHome()
  dirs.push(fakeHome)
  try {
    fn(fakeHome)
  } catch (e) {
    failed++
    failures.push(`${name} — threw: ${e.message}`)
    console.log(`  FAIL  threw: ${e.message}`)
  }
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

// 1. Fresh install (no settings.json)
test('1. Fresh install (no settings.json)', fakeHome => {
  const result = run(fakeHome)
  assertEqual('exit code', result.status, 0)

  const settings = readSettings(fakeHome)
  const sessionEntries = (settings.hooks || {}).SessionStart || []
  assert('SessionStart is array', Array.isArray(sessionEntries))
  assertEqual('SessionStart length', sessionEntries.length, 1)
  assertEqual('curator SessionStart count', countCuratorSessionStart(settings, fakeHome), 1)

  assert('curator-hook.sh exists', fs.existsSync(path.join(fakeHome, '.claude', 'curator-hook.sh')))
  assert('curator-stop.sh exists', fs.existsSync(path.join(fakeHome, '.claude', 'curator-stop.sh')))
  assert('curator-adapters.sh exists', fs.existsSync(path.join(fakeHome, '.claude', 'curator-adapters.sh')))
  assert('curator-migrate.js exists', fs.existsSync(path.join(fakeHome, '.claude', 'curator-migrate.js')))
  assert('commands/open.md exists', fs.existsSync(path.join(fakeHome, '.claude', 'commands', 'open.md')))

  // No --enforce → Stop should NOT have curator entries
  const stopEntries = (settings.hooks || {}).Stop
  const stopCuratorCount = countCuratorStop(settings, fakeHome)
  assert('no --enforce → no curator Stop entry', stopCuratorCount === 0)
})

// 2. Preserves unrelated settings
test('2. Preserves unrelated settings', fakeHome => {
  writeSettings(fakeHome, {
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: 'echo other' }] }
      ]
    },
    someKey: 'keep'
  })

  const result = run(fakeHome)
  assertEqual('exit code', result.status, 0)

  const settings = readSettings(fakeHome)
  assertEqual('someKey preserved', settings.someKey, 'keep')

  const sessionEntries = settings.hooks.SessionStart
  assert('SessionStart is array', Array.isArray(sessionEntries))
  assertEqual('total SessionStart entries = 2', sessionEntries.length, 2)
  assertEqual('curator SessionStart count = 1', countCuratorSessionStart(settings, fakeHome), 1)

  // Confirm echo other is still present
  const hasEchoOther = sessionEntries.some(entry =>
    (entry.hooks || []).some(h => h.command === 'echo other')
  )
  assert('echo other entry preserved', hasEchoOther)
})

// 3. Idempotent SessionStart (run twice)
test('3. Idempotent SessionStart', fakeHome => {
  run(fakeHome)
  const result2 = run(fakeHome)
  assertEqual('exit code second run', result2.status, 0)

  const settings = readSettings(fakeHome)
  assertEqual('curator SessionStart count = 1 after two runs', countCuratorSessionStart(settings, fakeHome), 1)
})

// 4. Bad SessionStart shape (object, not array)
test('4. Bad SessionStart shape', fakeHome => {
  writeSettings(fakeHome, { hooks: { SessionStart: { not: 'an array' } } })

  const result = run(fakeHome)
  assertEqual('exit code', result.status, 0)

  const settings = readSettings(fakeHome)
  assert('SessionStart is array after bad shape', Array.isArray(settings.hooks.SessionStart))
  assertEqual('curator SessionStart count = 1', countCuratorSessionStart(settings, fakeHome), 1)
})

// 5. Invalid JSON → exit 1 + .bak
test('5. Invalid JSON → exit 1 + .bak', fakeHome => {
  writeSettingsRaw(fakeHome, 'not json {')

  const result = run(fakeHome)
  assertEqual('exit code = 1', result.status, 1)
  assert('settings.json.bak exists', fs.existsSync(path.join(fakeHome, '.claude', 'settings.json.bak')))
})

// 6. --enforce wires Stop
test('6. --enforce wires Stop', fakeHome => {
  const result = run(fakeHome, ['--enforce'])
  assertEqual('exit code', result.status, 0)

  const settings = readSettings(fakeHome)
  assertEqual('curator SessionStart count = 1', countCuratorSessionStart(settings, fakeHome), 1)
  assertEqual('curator Stop count = 1', countCuratorStop(settings, fakeHome), 1)

  // Verify Stop entry command contains curator-stop.sh
  const stopEntries = settings.hooks.Stop || []
  const hasCuratorStop = stopEntries.some(entry =>
    (entry.hooks || []).some(h =>
      typeof h.command === 'string' && h.command.includes('curator-stop.sh')
    )
  )
  assert('Stop command includes curator-stop.sh', hasCuratorStop)
})

// 7. --enforce idempotent for Stop
test('7. --enforce idempotent for Stop', fakeHome => {
  run(fakeHome, ['--enforce'])
  const result2 = run(fakeHome, ['--enforce'])
  assertEqual('exit code second run', result2.status, 0)

  const settings = readSettings(fakeHome)
  assertEqual('curator Stop count = 1 after two --enforce runs', countCuratorStop(settings, fakeHome), 1)
})

// 8. No flag leaves existing Stop untouched
test('8. No flag leaves existing Stop untouched', fakeHome => {
  writeSettings(fakeHome, {
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: 'bash /x/curator-stop.sh' }] }
      ]
    }
  })

  const result = run(fakeHome)
  assertEqual('exit code', result.status, 0)

  const settings = readSettings(fakeHome)
  const stopEntries = (settings.hooks || {}).Stop || []
  assertEqual('Stop entry count unchanged = 1', stopEntries.length, 1)
  // The existing entry's command should still be the original path
  const hasOriginal = stopEntries.some(entry =>
    (entry.hooks || []).some(h => h.command === 'bash /x/curator-stop.sh')
  )
  assert('original Stop command intact', hasOriginal)
})

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

for (const dir of dirs) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const total = passed + failed
console.log(`\n${passed}/${total} passed`)
if (failures.length) {
  console.log('\nFailed:')
  for (const f of failures) console.log(`  - ${f}`)
}
process.exit(failed ? 1 : 0)
