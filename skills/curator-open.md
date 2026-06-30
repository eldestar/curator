---
name: curator-open
description: Orient to the current project — reads CLAUDE.md map, git state, .protocol.md focus, and DESIGN.md head. Run at session start or to reorient mid-session. Namespaced alias for /open.
---

# /curator-open — Session Orientation

Work through these steps in order. Stop loading after each step unless the current task needs more.

## 1. Read the map

Read `CLAUDE.md` (the project's AI entry point).

- If absent: stop and suggest running `/curator-setup` to scaffold the project.
- If present: note the mode (`curator_mode` line), the always-load docs, and the `## Project Docs` table. This table tells you what exists and when to load it — use it for all routing decisions this session.

## 2. Read the manifest

Read `.protocol.md`. Extract:
- `curator_mode` (auto / manual)
- `Current Focus` — branch, sprint, active work
- `Key Commands` — project-specific commands to remember

## 3. Read the session log head

Read the first 60 lines of `DESIGN.md` (or whatever `session_log:` points to in `.protocol.md`). You need the `Current State` and `Active Branch / PR` sections. Do not load the full history unless the task requires it.

## 4. Git state

Run:
```
git status --short
git log --oneline -5
```

## 5. IJFW (if present)

If `ijfw_memory_prelude` is available, call it now to load project memory.

## 6. Report

Output a single brief orientation paragraph — no headers. Cover:
- Current branch and last meaningful commit
- Active focus / sprint from `.protocol.md`
- Any open items or pending decisions from `DESIGN.md`
- Any docs flagged over their cap (from the CLAUDE.md table)

## Context discipline

Do not load any doc not in the always-load list unless the current task explicitly needs it. The `Load when` column in `CLAUDE.md` is the routing guide. When in doubt, don't load it — the user can ask for more.
