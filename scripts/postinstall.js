#!/usr/bin/env node
// The Curator — install script
// Copies skills to ~/.claude/commands/ and wires the SessionStart hook.

const fs = require('fs')
const path = require('path')
const os = require('os')

const CLAUDE_DIR = path.join(os.homedir(), '.claude')
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands')
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json')

// Resolve the package root (works both as postinstall and as npx bin)
const PKG_ROOT = path.resolve(__dirname, '..')
const SKILLS_DIR = path.join(PKG_ROOT, 'skills')
const HOOK_SCRIPT = path.join(PKG_ROOT, 'hooks', 'session-start.sh')

// On Windows, Git Bash is the bash provider — use a forward-slash path
const hookCommand = process.platform === 'win32'
  ? `bash "${HOOK_SCRIPT.replace(/\\/g, '/')}"`
  : `bash "${HOOK_SCRIPT}"`

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function copySkills() {
  ensureDir(COMMANDS_DIR)
  const files = fs.readdirSync(SKILLS_DIR)
  for (const file of files) {
    const src = path.join(SKILLS_DIR, file)
    const dest = path.join(COMMANDS_DIR, file)
    fs.copyFileSync(src, dest)
    console.log(`  copied: ${file} → ~/.claude/commands/`)
  }
}

function wireHook() {
  let settings = {}
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    } catch {
      console.warn('  warn: could not parse settings.json — will merge carefully')
    }
  }

  settings.hooks = settings.hooks || {}
  settings.hooks.SessionStart = settings.hooks.SessionStart || []

  // Idempotent: skip if our hook command is already present
  const alreadyWired = settings.hooks.SessionStart.some(entry =>
    (entry.hooks || []).some(h => h.command === hookCommand)
  )

  if (alreadyWired) {
    console.log('  hook already wired — skipped')
    return
  }

  settings.hooks.SessionStart.push({
    hooks: [{ type: 'command', command: hookCommand, timeout: 15 }]
  })

  ensureDir(CLAUDE_DIR)
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n')
  console.log('  wired: SessionStart hook → ~/.claude/settings.json')
}

console.log('\nThe Curator — installing...')
copySkills()
wireHook()
console.log('\nDone. Start a Claude Code session and run /setup to scaffold your project.\n')
