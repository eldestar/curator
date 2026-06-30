---
name: setup
description: Scaffold a new project with The Curator doc structure, or register a doc in the CLAUDE.md index. Usage: /setup [register <path> "<purpose>" <cap_lines> "<load-when>"]
---

# /setup — Project Scaffold

## Detect mode

- If invoked as `/setup register ...` → run **Register** flow.
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

_Register docs with: `/setup register <path> "<purpose>" <cap_lines> "<load-when>"`_

## Doc Discipline
- Check this table before creating any file. Extend existing docs first.
- `Load when` is the routing guide — load only what the current task needs.
- If a doc exceeds its cap, flag it at the next `/open` for pruning.
```

### Step 5 — Remote control (if requested)

Read `~/.claude/settings.json`. Set `"remoteControlEnabled": true`. Write it back.

### Step 6 — IJFW (if present)

If `ijfw_memory_prelude` is available, call `ijfw_memory_store` to register this project.

### Step 7 — Report

List exactly what was created. State the mode. One next step: "Run `/open` to orient."

---

## Register flow

Adds a doc to the `## Project Docs` table in `CLAUDE.md` without touching other files.

**Usage:** `/setup register <path> "<purpose>" <cap_lines> "<load-when>"`

**Example:** `/setup register docs/ARCH.md "system design decisions" 200 "architecture questions"`

### Steps

1. Confirm the file exists (or note that it will be created).
2. **Anti-sprawl check:** scan the existing table for entries whose purpose closely overlaps. If found, flag it: `"Similar doc already registered: X. Extend that one instead?"` — let the user decide before proceeding.
3. Read `CLAUDE.md`. Append a row to the `## Project Docs` table:
   ```
   | `<path>` | <purpose> | <cap>L | <load-when> |
   ```
4. Write `CLAUDE.md` back. Confirm the new row.

---

## Doc Discipline (always active)

When any doc reaches its cap, flag it at the next `/open` with: `"⚠ <file> is near/over its <cap>L cap — consider pruning."` Do not automatically split or delete content; surface it and let the user decide.
