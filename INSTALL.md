# Installing The Curator

## Into a new project

1. Copy the skills into your project's `.claude/commands/` folder:
   ```sh
   mkdir -p .claude/commands
   cp /path/to/curator/skills/* .claude/commands/
   ```

2. Run `/setup` in a Claude Code session. It creates `CLAUDE.md`, `DESIGN.md`, and `.protocol.md` and asks about mode and remote control.

## Into an existing project

Same as above. `/setup` detects existing files and asks before overwriting. After scaffolding, register your existing docs one by one:

```
/setup register docs/ARCH.md "system design decisions" 200 "architecture questions"
/setup register docs/API.md "API reference" 300 "API or endpoint questions"
```

## Wiring the SessionStart hook (personal, not published)

This makes every new session auto-orient — the main reason to use The Curator.

Add to `~/.claude/settings.json` under a `"hooks"` key:

```json
"hooks": {
  "SessionStart": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "bash /path/to/curator/hooks/session-start.sh",
          "timeout": 15
        }
      ]
    }
  ]
}
```

Replace `/path/to/curator` with the absolute path to this repo. The hook exits silently in any project that doesn't have a `.protocol.md` — safe to install globally.

## Remote control (optional)

Add to `~/.claude/settings.json`:

```json
"remoteControlEnabled": true
```

Enables Claude Code remote access from your phone. Requires Claude Code ≥ v2.1.51 and Claude Pro.

## Toggling auto / manual mode

Edit `.protocol.md` in your project:

```
curator_mode: auto    ← AI checks doc state at session close
curator_mode: manual  ← explicit updates only, no prompting
```
