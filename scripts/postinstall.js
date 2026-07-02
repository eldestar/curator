#!/usr/bin/env node
// The Curator — install script
// Copies skills to ~/.claude/commands/, copies hook to ~/.claude/curator-hook.sh,
// and wires the SessionStart hook in ~/.claude/settings.json.

const fs = require('fs')
const path = require('path')
const os = require('os')

const CLAUDE_DIR = path.join(os.homedir(), '.claude')
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands')
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json')
const HOOK_DEST = path.join(CLAUDE_DIR, 'curator-hook.sh')
const STOP_HOOK_DEST = path.join(CLAUDE_DIR, 'curator-stop.sh')
const ADAPTERS_DEST = path.join(CLAUDE_DIR, 'curator-adapters.sh')
const MIGRATE_DEST = path.join(CLAUDE_DIR, 'curator-migrate.js')

const PKG_ROOT = path.resolve(__dirname, '..')
const SKILLS_DIR = path.join(PKG_ROOT, 'skills')
const HOOK_SRC = path.join(PKG_ROOT, 'hooks', 'session-start.sh')
const STOP_HOOK_SRC = path.join(PKG_ROOT, 'hooks', 'stop.sh')
const ADAPTERS_SRC = path.join(PKG_ROOT, 'hooks', 'curator-adapters.sh')
const MIGRATE_SRC = path.join(PKG_ROOT, 'scripts', 'migrate.js')

// Stable path — never changes between npm versions or cache locations
const hookCommand = process.platform === 'win32'
  ? `bash "${HOOK_DEST.replace(/\\/g, '/')}"`
  : `bash "${HOOK_DEST}"`

const stopHookCommand = process.platform === 'win32'
  ? `bash "${STOP_HOOK_DEST.replace(/\\/g, '/')}"`
  : `bash "${STOP_HOOK_DEST}"`

const enforce = process.argv.includes('--enforce')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function copySkills() {
  ensureDir(COMMANDS_DIR)
  const files = fs.readdirSync(SKILLS_DIR)
  for (const file of files) {
    const dest = path.join(COMMANDS_DIR, file)
    if (fs.existsSync(dest)) {
      // Always overwrite namespaced files (curator-*); skip short-name collisions
      if (!file.startsWith('curator-')) {
        console.log(`  skipped: ${file} already exists → use /curator-${path.basename(file, '.md')} instead`)
        continue
      }
    }
    fs.copyFileSync(path.join(SKILLS_DIR, file), dest)
    console.log(`  copied: ${file} → ~/.claude/commands/`)
  }
}

function copyHook() {
  ensureDir(CLAUDE_DIR)
  fs.copyFileSync(HOOK_SRC, HOOK_DEST)
  // Ensure executable on Unix
  try { fs.chmodSync(HOOK_DEST, 0o755) } catch {}
  console.log(`  copied: session-start.sh → ~/.claude/curator-hook.sh`)
  fs.copyFileSync(STOP_HOOK_SRC, STOP_HOOK_DEST)
  try { fs.chmodSync(STOP_HOOK_DEST, 0o755) } catch {}
  console.log(`  copied: stop.sh → ~/.claude/curator-stop.sh`)
  fs.copyFileSync(ADAPTERS_SRC, ADAPTERS_DEST)
  try { fs.chmodSync(ADAPTERS_DEST, 0o755) } catch {}
  console.log(`  copied: curator-adapters.sh → ~/.claude/curator-adapters.sh`)
  fs.copyFileSync(MIGRATE_SRC, MIGRATE_DEST)
  try { fs.chmodSync(MIGRATE_DEST, 0o755) } catch {}
  console.log(`  copied: migrate.js → ~/.claude/curator-migrate.js`)
}

function loadSettings() {
  let settings = {}
  let raw = ''
  if (fs.existsSync(SETTINGS_FILE)) {
    raw = fs.readFileSync(SETTINGS_FILE, 'utf8')
    try {
      settings = JSON.parse(raw)
    } catch (e) {
      const bak = SETTINGS_FILE + '.bak'
      fs.writeFileSync(bak, raw)
      console.error(`  ERROR: ~/.claude/settings.json is not valid JSON.`)
      console.error(`  A backup was written to settings.json.bak`)
      console.error(`  Fix the JSON manually, then rerun: npx @eldestar/curator`)
      process.exit(1)
    }
  }
  return { settings, raw }
}

function wireHook() {
  const { settings, raw } = loadSettings()

  settings.hooks = settings.hooks || {}
  // Guard against unexpected SessionStart shape
  if (!Array.isArray(settings.hooks.SessionStart)) {
    settings.hooks.SessionStart = []
  }

  // Remove only exact Curator-owned hooks (matched by stable dest path, not substring)
  // ponytail: exact match prevents deleting unrelated hooks that happen to contain "curator"
  const curatorPaths = [
    HOOK_DEST,
    HOOK_DEST.replace(/\\/g, '/'),  // forward-slash variant on Windows
  ]
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter(entry => {
    const hooks = entry.hooks || []
    const isCurator = hooks.some(h =>
      typeof h.command === 'string' &&
      curatorPaths.some(p => h.command.includes(p))
    )
    if (isCurator) console.log(`  removed: stale curator hook entry`)
    return !isCurator
  })

  settings.hooks.SessionStart.push({
    hooks: [{ type: 'command', command: hookCommand, timeout: 15 }]
  })

  // Backup before write
  if (raw) fs.writeFileSync(SETTINGS_FILE + '.bak', raw)
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n')
  console.log(`  wired: SessionStart hook → ~/.claude/settings.json`)
}

function wireStopHook() {
  const { settings, raw } = loadSettings()

  settings.hooks = settings.hooks || {}
  // Guard against unexpected Stop shape
  if (!Array.isArray(settings.hooks.Stop)) {
    settings.hooks.Stop = []
  }

  // Remove only exact Curator-owned Stop entries
  // ponytail: exact match prevents deleting unrelated hooks that happen to contain "curator"
  const stopPaths = [
    STOP_HOOK_DEST,
    STOP_HOOK_DEST.replace(/\\/g, '/'),  // forward-slash variant on Windows
  ]
  settings.hooks.Stop = settings.hooks.Stop.filter(entry => {
    const hooks = entry.hooks || []
    const isCurator = hooks.some(h =>
      typeof h.command === 'string' &&
      stopPaths.some(p => h.command.includes(p))
    )
    if (isCurator) console.log(`  removed: stale curator Stop hook entry`)
    return !isCurator
  })

  settings.hooks.Stop.push({
    hooks: [{ type: 'command', command: stopHookCommand, timeout: 15 }]
  })

  // Backup before write
  if (raw) fs.writeFileSync(SETTINGS_FILE + '.bak', raw)
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n')
  console.log(`  wired: Stop hook → ~/.claude/settings.json`)
}

console.log('\nThe Curator — installing...')
copyHook()
copySkills()
wireHook()
if (enforce) {
  wireStopHook()
  console.log('\nDone (hard enforcement ON). Start a Claude Code session and run /setup to scaffold your project.\n')
} else {
  console.log('\nDone. Tip: run with --enforce to also wire the Stop hook for hard doc-discipline enforcement.')
  console.log('Start a Claude Code session and run /setup to scaffold your project.\n')
}
