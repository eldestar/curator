# The Curator

A portable session-protocol skill for Claude Code. Keeps projects from developing doc sprawl, gives every new session instant orientation, and improves with each project over time.

## What it does

- **Auto-orient** — a SessionStart hook reads `.protocol.md`, git state, and the session log and injects them as context. No more starting cold or manually running `/open`.
- **Single entry point** — `CLAUDE.md` is a live index of every project doc. The AI reads it first, knows what exists and why, and loads only what the current task needs.
- **Plugs into your existing memory** — detects and reads the memory/knowledge systems a project already uses (`CLAUDE.md`, `AGENTS.md`, Cline `memory-bank/`, GitHub Copilot, Cursor rules, plus IJFW), so orientation works whether you adopt Curator's own docs or point it at what's already there.
- **Anti-sprawl** — in `auto` mode, the AI is reminded at session start to extend existing docs rather than create new ones before closing, and to update the index when things change. For hard enforcement, opt in to a Stop hook (`npx @eldestar/curator --enforce`) that blocks the session from closing — once — to prompt a doc-discipline check when work is pending.
- **Adaptive manifest** — `.protocol.md` tracks current focus, key commands, and session notes. It grows with the project and rides with the repo.

## Structure

```
skills/
  open.md            /open  — session orientation
  setup.md           /setup — scaffold / adopt / register / revert
hooks/
  session-start.sh   SessionStart hook (injects context via plain stdout)
  curator-adapters.sh  memory/doc adapter registry (sourced by the hook)
  stop.sh            opt-in Stop hook (--enforce)
scripts/
  postinstall.js     installer
  migrate.js         reversible adoption engine (convert / revert)
template/
  CLAUDE.md          AI entry point template
  DESIGN.md          Session log template
  .protocol.md       Session manifest template
INSTALL.md
```

## Quick start

```sh
npx @eldestar/curator
```

Then start a Claude Code session and run `/setup`.

## Modes

| Mode | Behavior |
|------|----------|
| `auto` | AI is reminded at session start to check doc state before closing; opt in to a Stop hook for hard enforcement with `npx @eldestar/curator --enforce` |
| `manual` | Explicit `/setup register` only; no prompting |

Toggle in `.protocol.md`: `curator_mode: auto` or `curator_mode: manual`.

## Adopting mid-project

Already have a project with its own docs or memory? Run `/setup adopt`. Curator detects what's there and lets you choose how to adopt — recorded as `adoption:` in `.protocol.md`:

| Mode | What it does | Reversal |
|------|--------------|----------|
| `link` | Creates **only** `.protocol.md`, pointing at your existing docs/memory. Nothing else is touched. | Delete `.protocol.md`. |
| `convert` | Additively upgrades the project to Curator's fuller structure. **Never overwrites** — it only creates new files or edits inside its own `<!-- curator:begin/end -->` fences, backs up every file first, and journals every change to `.curator/migration.json`. | `/setup revert` — replays the journal, restoring verbatim backups on any divergence. Never guesses; never loses data. |

`.curator/migration.json` is committed (so a teammate can revert too); `.curator/backups/` is git-ignored (local safety net).

## Compatibility

- **Works with your existing memory** — file-based adapters (`CLAUDE.md`, `AGENTS.md`, Cline `memory-bank/`, GitHub Copilot, Cursor rules) are read by the hook and `/open`; MCP-based systems (IJFW via `ijfw_memory_prelude`) are read by `/open`. Declare or pin them with `memory:` in `.protocol.md`, or omit it to auto-discover. Fully functional with none present.
- **No hard dependencies** — bash only, no node. The hooks are Bash scripts (they use `[[ ]]`, arrays, and `$'…'`), not portable POSIX `sh`; they call only standard utilities (`grep`, `sed`, `tr`, `head`, `git`).
- **Portable** — drop into any project. The SessionStart hook exits silently when `.protocol.md` is absent, so it's safe to install globally in `~/.claude/settings.json`. See [SECURITY.md](SECURITY.md) for trust boundary details.
