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

## Adopting into an existing project

If the project already has docs or a memory system, run `/setup adopt` instead of `/setup`. Curator detects what's present (`CLAUDE.md`, `AGENTS.md`, Cline `memory-bank/`, GitHub Copilot, Cursor rules, IJFW) and asks how to adopt:

- **`link`** — writes **only** `.protocol.md`, pointing at your existing docs/memory. Nothing else is touched. To undo: delete `.protocol.md`.
- **`convert`** — additively upgrades the project to Curator's fuller structure by running `node ~/.claude/curator-migrate.js convert`. It **never overwrites**: it only creates new files or edits inside its own `<!-- curator:begin/end -->` fences, writes a verbatim backup of every file before editing it, and records every change in `.curator/migration.json`.
  - `.curator/migration.json` is **committed** (a teammate can revert too); `.curator/backups/` is **git-ignored** (local safety net).
  - Undo any time with **`/setup revert`** (`node ~/.claude/curator-migrate.js revert`). On any divergence — you edited inside a managed block, a file changed, a backup is missing — it restores the verbatim backup or changes nothing, and surfaces an `E_*`/`W_*` code. It never guesses and never loses data.
  - If you previously adopted with `link`, a later `convert` leaves your existing `.protocol.md` untouched and reports `W_CREATE_DIVERGED` — update `adoption: convert` by hand if you want the field to match.

## Register existing docs

```
/setup register docs/ARCH.md "system design decisions" 200 "architecture questions"
/setup register docs/API.md "API reference" 300 "API or endpoint questions"
```

**Platform notes:**
- **macOS / Linux** — bash is available by default. Works as-is.
- **Windows** — the hook command above requires `bash` in your PATH. [Git for Windows](https://git-scm.com/download/win) (Git Bash) provides this. WSL also works. If you use WSL, use a Linux-style path to the script.
- The hooks have no Node.js dependency. They are Bash scripts (they use `[[ ]]`, arrays, and `$'…'`), so they need `bash` — not a portable POSIX `sh`. They call only standard utilities (`grep`, `sed`, `tr`, `head`, `git`).

## Remote control (optional)

Add to `~/.claude/settings.json`:

```json
"remoteControlEnabled": true
```

Enables Claude Code remote access from your phone. Requires Claude Code ≥ v2.1.51 and Claude Pro.

## Hard enforcement (optional Stop hook)

By default `auto` mode only *reminds* the AI at session start. To enforce doc discipline at session **end**, opt in to the Stop hook:

```sh
npx @eldestar/curator --enforce
```

This wires a `Stop` hook (`~/.claude/curator-stop.sh`) alongside the SessionStart hook. When a project has `.protocol.md` with `curator_mode: auto` **and** the working tree has uncommitted changes, the hook blocks the session from closing **once** with a doc-discipline reminder (update the `CLAUDE.md` index, extend existing docs, update `DESIGN.md`/`.protocol.md`). Stopping again proceeds — it never loops. It stays silent in projects without `.protocol.md`, in `manual` mode, or when nothing changed.

Plain `npx @eldestar/curator` (no flag) leaves any existing Stop hook untouched. To disable enforcement, remove the `Stop` entry from `~/.claude/settings.json` manually.

## Toggling auto / manual mode

Edit `.protocol.md` in your project:

```
curator_mode: auto    ← AI reminded at session start to check doc state before closing
curator_mode: manual  ← explicit updates only, no prompting
```
