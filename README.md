# The Curator

A portable session-protocol skill for Claude Code. Keeps projects from developing doc sprawl, gives every new session instant orientation, and improves with each project over time.

## What it does

- **Auto-orient** — a SessionStart hook reads `.protocol.md`, git state, and the session log and injects them as context. No more starting cold or manually running `/open`.
- **Single entry point** — `CLAUDE.md` is a live index of every project doc. The AI reads it first, knows what exists and why, and loads only what the current task needs.
- **Anti-sprawl** — in `auto` mode, the AI is reminded at session start to extend existing docs rather than create new ones before closing, and to update the index when things change. No Stop hook is wired by default.
- **Adaptive manifest** — `.protocol.md` tracks current focus, key commands, and session notes. It grows with the project and rides with the repo.

## Structure

```
skills/
  open.md            /open  — session orientation
  setup.md           /setup — new project scaffold + doc registration
hooks/
  session-start.sh   SessionStart hook (outputs additionalContext JSON)
template/
  CLAUDE.md          AI entry point template
  DESIGN.md          Session log template
  .protocol.md       Session manifest template
INSTALL.md
```

## Quick start

```sh
# 1. Copy skills into your project
mkdir -p .claude/commands
cp /path/to/curator/skills/* .claude/commands/

# 2. Wire the hook in ~/.claude/settings.json (see INSTALL.md)

# 3. Start a Claude Code session and run:
/setup
```

## Modes

| Mode | Behavior |
|------|----------|
| `auto` | AI is reminded at session start to check doc state before closing; no enforcement hook (add a `Stop` hook for hard enforcement) |
| `manual` | Explicit `/setup register` only; no prompting |

Toggle in `.protocol.md`: `curator_mode: auto` or `curator_mode: manual`.

## Compatibility

- **IJFW-aware** — defers to `ijfw_memory_prelude` when present; fully functional without it.
- **No hard dependencies** — bash only (POSIX, no node).
- **Portable** — drop into any project. The SessionStart hook exits silently when `.protocol.md` is absent, so it's safe to install globally in `~/.claude/settings.json`. See [SECURITY.md](SECURITY.md) for trust boundary details.
