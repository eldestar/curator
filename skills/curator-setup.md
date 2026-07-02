---
name: curator-setup
description: Scaffold a new project with The Curator doc structure, register a doc in the CLAUDE.md index, or adopt Curator into an existing project (link or convert). Namespaced alias for /setup. Usage: /curator-setup [register <path> "<purpose>" <cap_lines> "<load-when>" | adopt | revert]
---

# /curator-setup — Project Scaffold

## Detect mode

- If invoked as `/curator-setup register ...` → run **Register** flow.
- If invoked as `/curator-setup adopt` → run **Adopt** flow.
- If invoked as `/curator-setup revert` → run **Revert** flow.
- Otherwise → run **New Project** flow.

---

## New Project flow

**Pre-check:** if ANY of `CLAUDE.md`, `DESIGN.md`, or `.protocol.md` already exist, list which files were found and ask before overwriting any of them — offer to re-scaffold or abort.

### Step 1 — Ask (one message, not three)

Ask the user:
1. Project name?
2. Curator mode: `auto` (AI reminded at session start to check doc state before closing) or `manual` (explicit only)?
3. Enable remote control? (adds `remoteControlEnabled: true` to `~/.claude/settings.json`, requires Claude Code ≥ v2.1.51 + Claude Pro)

### Step 2 — Create `.protocol.md`

Create from the template below. Fill in `name:` and `curator_mode:`.

```markdown
# .protocol.md — Session Manifest

curator_mode: <auto|manual>
session_log: DESIGN.md
entry_point: CLAUDE.md

## Project
name: <project name>
description:

## Current Focus
branch:
sprint:
active:

## Key Commands
# build:
# test:
# deploy:

## Session Notes
```

### Step 3 — Create `DESIGN.md`

Create from the template below. Fill in the project name and today's date.

```markdown
# DESIGN.md — Session Log

_Project:_ <name>
_Last updated:_ <date>

## Current State
<!-- One paragraph: where the project is right now -->

## Active Branch / PR
<!-- Branch name + PR link if open -->

## Pending
<!-- Migrations, deploys, open decisions -->

---
<!-- Append session history below — newest entries at top -->
```

### Step 4 — Create `CLAUDE.md`

Create from the template below. Fill in the project name.

```markdown
# <Project> — AI Entry Point

> Curator mode: <auto|manual> · Context: selective · Rule: extend before create

Read this file first. Load nothing else until you know what the task needs.

## Always Load
- `.protocol.md` — session manifest: current focus, mode, key commands
- `DESIGN.md` — session log: head only (Current State + Active Branch sections)

## Project Docs
| File | Purpose | Cap | Load when |
|------|---------|-----|-----------|

_Register docs with: `/curator-setup register <path> "<purpose>" <cap_lines> "<load-when>"`_

## Doc Discipline
- Check this table before creating any file. Extend existing docs first.
- `Load when` is the routing guide — load only what the current task needs.
- If a doc exceeds its cap, flag it at the next `/curator-open` for pruning.
```

### Step 5 — Remote control (if requested)

Tell the user: to enable remote control, rerun the installer with the flag set manually:

```sh
# Add to ~/.claude/settings.json:
"remoteControlEnabled": true
```

Requires Claude Code ≥ v2.1.51 and Claude Pro. Do not edit `settings.json` directly — rerun `npx @eldestar/curator` after making the change, or edit the file carefully in a text editor.

### Step 6 — IJFW (if present)

If `ijfw_memory_prelude` is available, call `ijfw_memory_store` to register this project.

### Step 7 — Report

List exactly what was created. State the mode. One next step: "Run `/curator-open` to orient."

---

## Register flow

Adds a doc to the `## Project Docs` table in `CLAUDE.md` without touching other files.

**Usage:** `/curator-setup register <path> "<purpose>" <cap_lines> "<load-when>"`

**Example:** `/curator-setup register docs/ARCH.md "system design decisions" 200 "architecture questions"`

### Steps

1. Confirm the file exists (or note that it will be created).
2. **Anti-sprawl check:** scan the existing table for entries whose purpose closely overlaps. If found, flag it: `"Similar doc already registered: X. Extend that one instead?"` — let the user decide before proceeding.
3. Read `CLAUDE.md`. Append a row to the `## Project Docs` table:
   ```
   | `<path>` | <purpose> | <cap>L | <load-when> |
   ```
4. Write `CLAUDE.md` back. Confirm the new row.

---

## Adopt flow

Brings Curator into a project that already has its own docs/memory — mid-project, non-destructive. Use this instead of **New Project** whenever any existing memory/doc system is present.

### Step 1 — Detect

Check the project for each signal (same signals the SessionStart hook uses):

| System | Signal |
|--------|--------|
| Claude native | `CLAUDE.md` |
| AGENTS.md | `AGENTS.md` |
| Cline Memory Bank | `memory-bank/` containing at least one `.md` file |
| GitHub Copilot | `.github/copilot-instructions.md` or `.github/instructions/*.instructions.md` |
| Cursor | `.cursor/rules/*.mdc` or `.cursorrules` |
| IJFW | the `ijfw_memory_prelude` tool is available |

### Step 2 — Summarize

Tell the user plainly what was found (or "nothing found — this will be a fresh adoption").

### Step 3 — Ask link vs convert

Use AskUserQuestion to ask the user to choose:
- **link** — use the existing docs as-is. Curator owns only `.protocol.md`. Nothing else is created or touched.
- **convert** — additively upgrade to Curator's fuller structure (`CLAUDE.md`, `DESIGN.md`, etc.), fully reversible via a journal and backups.

### Step 4a — `link` chosen

Author `.protocol.md` only, from the template, with:
- `adoption: link`
- `memory:` set to the detected adapter ids (comma-separated), or left blank if none were found (auto-discover)
- `entry_point:` pointing at the detected entry doc (e.g. `AGENTS.md`) — default `CLAUDE.md` if none found
- `session_log:` pointing at the detected session/progress doc (e.g. `memory-bank/progress.md`) — default `DESIGN.md` if none found

Create nothing else. Tell the user: revert is just deleting `.protocol.md`.

### Step 4b — `convert` chosen

Run, from the project root:
```
node ~/.claude/curator-migrate.js convert
```

Do NOT hand-create or hand-edit `.protocol.md`, `CLAUDE.md`, `DESIGN.md`, `.gitignore`, or any other file yourself in this path — every file creation and mutation must go through `curator-migrate.js` so it is journaled and revertible. Then report:
- What it created/modified (from its output)
- The journal at `.curator/migration.json` and backups under `.curator/backups/…`
- That `/curator-setup revert` cleanly undoes the whole thing

### Step 5 — Report

State which mode was chosen and what exists now. One next step: "Run `/curator-open` to orient."

---

## Revert flow

**Usage:** `/curator-setup revert`

Run, from the project root:
```
node ~/.claude/curator-migrate.js revert
```

Surface any `E_*`/`W_*` codes it prints to the user verbatim — do not paraphrase them away. Explain that on divergence (content that no longer matches what convert originally wrote) it restores the verbatim pre-convert backup rather than guessing, so it never loses data.

---

## Doc Discipline (always active)

When any doc reaches its cap, flag it at the next `/curator-open` with: `"⚠ <file> is near/over its <cap>L cap — consider pruning."` Do not automatically split or delete content; surface it and let the user decide.
