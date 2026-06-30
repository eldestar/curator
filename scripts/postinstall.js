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

const PKG_ROOT = path.resolve(__dirname, '..')
const SKILLS_DIR = path.join(PKG_ROOT, 'skills')
const HOOK_SRC = path.join(PKG_ROOT, 'hooks', 'session-start.sh')

// Stable path — never changes between npm versions or cache locations
const hookCommand = process.platform === 'win32'
  ? `bash "${HOOK_DEST.replace(/\\/g, '/')}"`
  : `bash "${HOOK_DEST}"`

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
}

function wireHook() {
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

  settings.hooks = settings.hooks || {}
  settings.hooks.SessionStart = settings.hooks.SessionStart || []

  // Remove any stale Curator hooks (old path from prior installs)
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter(entry => {
    const hooks = entry.hooks || []
    const isCurator = hooks.some(h =>
      typeof h.command === 'string' && h.command.includes('curator')
    )
    if (isCurator) {
      console.log(`  removed: stale curator hook entry`)
    }
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

console.log('\nThe Curator — installing...')
copyHook()
copySkills()
wireHook()
console.log('\nDone. Start a Claude Code session and run /setup to scaffold your project.\n')
