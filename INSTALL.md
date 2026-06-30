# Installing The Curator

## Install

```sh
npx @eldestar/curator
```

This copies the `/open` and `/setup` skills to `~/.claude/commands/` and wires the SessionStart hook in `~/.claude/settings.json`. Safe to run again — it's idempotent.

## Scaffold a project

After installing, start a Claude Code session in your project and run:

```
/setup
```

`/setup` creates `CLAUDE.md`, `DESIGN.md`, and `.protocol.md` and asks about curator mode and remote control. It detects existing files and asks before overwriting.

## Register existing docs

```
/setup register docs/ARCH.md "system design decisions" 200 "architecture questions"
/setup register docs/API.md "API reference" 300 "API or endpoint questions"
```

**Platform notes:**
- **macOS / Linux** — bash is available by default. Works as-is.
- **Windows** — the hook command above requires `bash` in your PATH. [Git for Windows](https://git-scm.com/download/win) (Git Bash) provides this. WSL also works. If you use WSL, use a Linux-style path to the script.
- The hook has no Node.js dependency and uses only POSIX utilities (`grep`, `sed`, `tr`, `head`, `git`).

## Remote control (optional)

Add to `~/.claude/settings.json`:

```json
"remoteControlEnabled": true
```

Enables Claude Code remote access from your phone. Requires Claude Code ≥ v2.1.51 and Claude Pro.

## Toggling auto / manual mode

Edit `.protocol.md` in your project:

```
curator_mode: auto    ← AI reminded at session start to check doc state before closing
curator_mode: manual  ← explicit updates only, no prompting
```
