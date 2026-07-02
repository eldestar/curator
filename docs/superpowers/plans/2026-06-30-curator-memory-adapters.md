# Curator Memory-Adapters & Reversible Adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Before implementing:** this plan is > 5 steps and touches data-loss-sensitive code. Per project IRON RULES, run `/codex:adversarial-review` on it first — specifically pointing the reviewer at **Appendix B** (reversible migration) to hunt for data-loss paths.

**Goal:** Let Curator plug into a project's *existing* memory/knowledge system as the orientation source (instead of assuming its own docs), and let a user adopt Curator **mid-project** in one of two explicit, fully reversible, never-destructive modes — `link` (point at what's there) or `convert` (additively upgrade to Curator's fuller structure, with backups + a journal + clean revert).

**Two capabilities, one feature:**
1. **Adapter registry** — a uniform way to detect and read 5 file-based memory systems (Claude native, AGENTS.md, Cline Memory Bank, GitHub Copilot, Cursor) from the bash hook, plus IJFW from the skill layer. Full spec: **Appendix A**.
2. **Reversible adoption** — `adoption: link | convert` in `.protocol.md`, with a data-safe `convert`/`revert` engine governed by three hard invariants (never overwrite a whole file; always back up before an in-place edit; journal every mutation). Full spec: **Appendix B**.

## Architecture

- **Registry, not hardcoding.** The current hook hardcodes `.protocol.md` + `DESIGN.md`; `/open` hardcodes an "if IJFW" step. Both become driven by an adapter registry. `.protocol.md` gains a `memory:` field (comma-separated adapter ids; absent = auto-discover all). See Appendix A §"Adapter model".
- **Roles, not files.** Curator mandates exactly one file it owns: `.protocol.md`. `entry_point:`/`session_log:` (already present) plus the new `memory:` are pointers. Existing `CLAUDE.md`/`AGENTS.md`/`memory-bank/` fulfil the entry-point and session-log roles when present.
- **Adoption is user-chosen and reversible.** `.protocol.md` records `adoption: link | convert`. `link` creates only `.protocol.md` (revert = delete it). `convert` additively upgrades via the migration engine. Behaviour toward an existing `CLAUDE.md`/`AGENTS.md` is therefore mode-dependent: `link` leaves it untouched; `convert` merges only inside Curator marker fences, backed up and journaled.
- **The migration engine is a deterministic Node script**, `scripts/migrate.js` (`convert` / `revert` subcommands), copied to `~/.claude/curator-migrate.js` by the installer and invoked by the `/setup` skill (`node ~/.claude/curator-migrate.js convert`). Rationale: SHA-256, verbatim backups, atomic temp+rename, and the strip-vs-restore decision must be exact and unit-testable — not left to model improvisation in skill prose. Mirrors the existing `postinstall.js` Node discipline. The caller stamps the run timestamp once (`Date.now()`), keeping the core logic pure/deterministic.
- **Layer split is a hard boundary.** The bash hook can only read files → all 5 file-based adapters (Tier A) plus the migration engine's file work. MCP-only systems (IJFW; future: mem0, server-memory) are Tier B, reachable only from `/open`.
- **No new runtime dependencies.** Hook stays bash + coreutils (no `jq`). Engine stays Node stdlib (`fs`, `crypto`, `path`, `os`). Tests stay bash + node, run by `npm test`.

## Tech Stack

Bash (hook + adapters, `set -euo pipefail`, coreutils only), Node ≥ 18 (installer + migration engine, stdlib only), Markdown (skills, templates, docs). No new deps.

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `hooks/adapters.sh` | Create | Sourced library: `detect_<id>()` / `read_<id>()` for the 5 Tier-A adapters (Appendix A) |
| `hooks/session-start.sh` | Modify | Source `adapters.sh`; parse `memory:`; probe registry in priority order; dedup against `entry_point`/`session_log` |
| `scripts/migrate.js` | Create | `convert` / `revert` / re-migration engine (Appendix B): backups, markers, journal, atomic write, sha-gated revert |
| `scripts/test-migrate.js` | Create | Node tests covering Appendix B §7 edge-case matrix (fake project dirs) |
| `scripts/test-hook.sh` | Modify | Add adapter detect/read cases (present/absent/empty/dedup) |
| `scripts/postinstall.js` | Modify | Also copy `hooks/adapters.sh` + `scripts/migrate.js` → `~/.claude/`; keep idempotent |
| `skills/setup.md` | Modify | `/setup adopt` (detect → ask link vs convert), `/setup convert`, `/setup revert`; call migrate.js |
| `skills/curator-setup.md` | Modify | Mirror the setup changes (namespaced alias) |
| `skills/open.md` | Modify | Step 4.5 (Tier-A deeper read); generalize step 5 to Tier-B registry (IJFW) |
| `skills/curator-open.md` | Modify | Mirror the open changes (namespaced alias) |
| `template/.protocol.md` | Modify | Add `memory:` and `adoption:` fields (documented, defaulted) |
| `package.json` | Modify | Add `scripts/migrate.js` to `files`; wire `test-migrate.js` into `npm test` |
| `README.md` / `INSTALL.md` | Modify | Document adapters, adoption modes (`link`/`convert`), and `/setup revert` |

## Non-goals (v1)

- MCP memory systems beyond IJFW (mem0, `@modelcontextprotocol/server-memory`, basic-memory, Letta). The registry is designed to accept them later as Tier-B rows; not implemented now.
- Semantic dedup across adapters (see Appendix A §"Detection & ordering" — bounded by caps + priority, not diffing).
- Auto-detection from the hook *without* `.protocol.md`. The hook stays gated on `.protocol.md` (silent otherwise) for the global-install safety contract. Detection happens in `/setup adopt`, the explicit opt-in.
- Claude auto-memory (`~/.claude/projects/<hash>/memory/`) as a load-bearing source — the project-hash scheme is undocumented; kept as a best-effort decoration only (Appendix A).

---

## Task 1: `.protocol.md` schema — `memory:` and `adoption:` fields

**Files:** Modify `template/.protocol.md`

Adds the two pointer fields the rest of the feature reads. Backward-compatible: both are optional with safe defaults (`memory:` absent → auto-discover; `adoption:` absent → treated as `link`).

- [ ] **Step 1:** Add to the manifest header, below `entry_point:`:
  ```
  # memory: comma-separated adapter ids, or omit to auto-discover all.
  #   ids: claude-native, agents-md, cline-bank, copilot, cursor, ijfw
  memory:
  # adoption: how Curator was added to this project. link = point at existing
  #   docs (Curator owns only this file). convert = additively upgraded (see .curator/).
  adoption: link
  ```
- [ ] **Step 2:** Confirm parse-compatibility: `grep -m1 '^memory:'` / `'^adoption:'` + the existing trim `sed` yield clean values; a commented (`#`) line is ignored by `^memory:` anchor. Add a one-line note to the template explaining `link` vs `convert`.
- [ ] **Step 3:** Commit: `feat(protocol): add memory: and adoption: fields`.

## Task 2: Adapter library `hooks/adapters.sh`

**Files:** Create `hooks/adapters.sh`

Implement the 5 Tier-A adapters exactly per **Appendix A** — `detect_<id>()` (silent, 0/1) and `read_<id>()` (capped markdown, always exit 0), honouring `set -euo pipefail` (`|| true` / `if`-wrapped greps, `&>/dev/null` glob-existence, byte caps via `head -n N | head -c B`). Adapters: `claude-native`, `agents-md`, `cline-bank`, `copilot`, `cursor`. Frontmatter is **stripped** (extract only `applyTo` / `description`/`globs`/`alwaysApply` as labelled lines) per Appendix A rationale.

- [ ] **Step 1:** Write the five `detect_*`/`read_*` pairs from Appendix A §"Bash reference snippets" verbatim (they are `set -euo pipefail`-safe as written).
- [ ] **Step 2:** Add a `run_registry()` entry point: given an ordered id list (from `memory:` or the default priority order), call each `detect_*` and, on hit, its `read_*`, respecting the dedup skips in Step 3.
- [ ] **Step 3:** Implement dedup vs pointers: skip `claude-native`'s read when the resolved `entry_point == CLAUDE.md`; skip any adapter whose target path equals the resolved `session_log` (path-string equality, no realpath — matches existing hook behaviour).
- [ ] **Step 4 (self-check):** `bash -n hooks/adapters.sh` clean; source it and run each `read_*` in a scratch dir with the file present, absent, and empty — no non-zero exit escapes, output is bounded.

## Task 3: Wire the registry into `hooks/session-start.sh`

**Files:** Modify `hooks/session-start.sh`

- [ ] **Step 1:** Source `adapters.sh` from the hook's own directory: resolve dir via `${BASH_SOURCE[0]}` so it works from the copied `~/.claude/` location. If `adapters.sh` is absent, skip adapters silently (forward/backward compat).
- [ ] **Step 2:** Parse `memory:` like `SESSION_LOG` (grep/sed/trim, split on `,`). Empty/absent → default priority order `claude-native, agents-md, cline-bank, copilot, cursor`. Unknown ids ignored.
- [ ] **Step 3:** In `build_context()`, after the git block, call `run_registry` with the id list; keep it under the existing per-file byte-cap discipline. Preserve today's `.protocol.md` and `session_log` blocks unchanged (the dedup skips prevent double-injection).
- [ ] **Step 4 (self-check):** Extend the existing manual run — a project with `AGENTS.md` + `memory-bank/activeContext.md` emits both sections; a bare `.protocol.md` project is unchanged from today.

## Task 4: Migration engine `scripts/migrate.js` (`convert`)

**Files:** Create `scripts/migrate.js`

Implement `convert` exactly per **Appendix B §§1–4, 6**. Node stdlib only (`fs`, `crypto`, `path`). CLI: `node migrate.js convert [--timestamp <stamp>]` run from the project root. The three HARD INVARIANTS are acceptance criteria, not aspirations.

- [ ] **Step 1:** Marker helpers (Appendix B §1): build/find `<!-- curator:begin id=<id> v=<major> -->` … `<!-- curator:end id=<id> -->`; match on trimmed lines; collision scan (§1.3) using **journal authority** — a fence is Curator's only if `(path, blockId)` is journaled.
- [ ] **Step 2:** `.curator/` layout (§2): `migration.json` + `backups/<timestamp>/<path>`; timestamp is a CLI arg (caller-stamped), not read from the clock inside the logic.
- [ ] **Step 3:** Journal schema (§3): `create` / `append-block` actions with whole-file `sha256_before`/`sha256_after`, `eol`, `trailingNewline`, `insertedByteLen`, `backup`. Concrete shape per §3 example.
- [ ] **Step 4:** Convert pipeline (§4): snapshot → classify (lstat; refuse symlink §4.4, refuse non-UTF-8 §4.5) → **back up every append-block target first, fsync, abort run if any backup fails** → per target sha_before → collision-scan → create/fence-in preserving detected EOL + trailing-newline → sha_after → **atomic journal write** (temp + fsync + rename, §4.6).
- [ ] **Step 5:** Re-migration/idempotency (§6): single authoritative journal; update managed block in place keyed by `(path, blockId)`; version bump rewrites the `v=` tag + content; diverged block → back off with `W_BLOCK_DIVERGED`, never clobber.
- [ ] **Step 6:** `.gitignore` handling (§2.1): ensure `.curator/backups/` is ignored (append inside a Curator-managed block, or create `.gitignore`); `migration.json` stays committed.
- [ ] **Step 7 (self-check):** exercised by Task 6 tests; add an `assert`-based `--selfcheck` that round-trips one create + one append-block in a tmp dir.

## Task 5: Migration engine `revert`

**Files:** Modify `scripts/migrate.js`

Implement `revert` exactly per **Appendix B §5, §7**. CLI: `node migrate.js revert`. Prime directive: predictable, zero-loss; never guess.

- [ ] **Step 1:** Pre-flight (§5.0): load+validate `migration.json`; missing/unparseable → `E_NO_JOURNAL`, change nothing. Replay actions last→first.
- [ ] **Step 2:** Revert `create` (§5.1): current sha == `sha256_after` → delete; absent → no-op; diverged → keep + `W_CREATE_DIVERGED`.
- [ ] **Step 3:** Revert `append-block` (§5.2): sha == after → strip-in-place then **verify result hashes to `sha256_before`, else discard and restore backup** (§5.2.1); sha == before → no-op; anything else (diverged) → **restore verbatim backup**; backup missing + diverged → `E_BACKUP_MISSING`, change nothing.
- [ ] **Step 4:** Finish (§5.4): clean run may remove `.curator/`; any `E_*`/`W_*` → keep `.curator/` for inspection. Idempotent on second run (§7 row 10).
- [ ] **Step 5 (self-check):** covered by Task 6.

## Task 6: Migration tests `scripts/test-migrate.js`

**Files:** Create `scripts/test-migrate.js`

Node test harness (fake project dirs via `fs.mkdtempSync`, cleaned up), asserting the **Appendix B §7 edge-case matrix**. Highest priority: the data-loss cases.

- [ ] **Step 1:** Happy path — convert creates `CLAUDE.md`/`.protocol.md`, append-blocks `.gitignore`; journal + backups written; revert restores byte-identical pre-convert tree.
- [ ] **Step 2:** Divergence cases (§7 rows 1,3): user edits inside markers / markers removed → revert restores verbatim backup, never strips by guess.
- [ ] **Step 3:** `create` diverged (§5.1) → revert keeps the user-modified file.
- [ ] **Step 4:** Safety refusals: symlink target (§7.6 `E_SYMLINK_REFUSED`), non-UTF-8 (§7.8 `E_NOT_UTF8`), no journal (`E_NO_JOURNAL`), diverged + no backup (`E_BACKUP_MISSING` → change nothing).
- [ ] **Step 5:** Idempotency: convert×2 → one journal, one block (§6); revert×2 → no double-strip (§7.10).
- [ ] **Step 6:** Preservation: CRLF file and no-trailing-newline file round-trip byte-identical (§7.7).
- [ ] **Step 7:** Interrupted convert (§7.5): simulate journal absent but edits+backups present → rerun convert reconciles; no torn JSON.
- [ ] **Step 8 (self-check):** `node scripts/test-migrate.js` prints `N/N passed`, exits non-zero on any failure.

## Task 7: Installer — ship the new files

**Files:** Modify `scripts/postinstall.js`, `package.json`

- [ ] **Step 1:** `copyHook()` also copies `hooks/adapters.sh` → `~/.claude/curator-adapters.sh` and `scripts/migrate.js` → `~/.claude/curator-migrate.js` (chmod on Unix, try/catch). Keep session-start's source path to `curator-adapters.sh` consistent with Step 1 of Task 3.
- [ ] **Step 2:** `package.json` `files`: ensure `hooks/` (covers adapters.sh) and add `scripts/migrate.js`. `test`: append `&& node scripts/test-migrate.js`.
- [ ] **Step 3 (self-check):** existing `test-postinstall.js` still green; add one case asserting `curator-adapters.sh` + `curator-migrate.js` land in the fake `~/.claude/`.

## Task 8: `/setup` skill — adopt / convert / revert

**Files:** Modify `skills/setup.md`, `skills/curator-setup.md`

- [ ] **Step 1:** `/setup adopt`: detect present systems (reuse the adapter detect signals); summarise; **ask the user `link` vs `convert`** (AskUserQuestion). Write `.protocol.md` with `memory:` (detected ids) + chosen `adoption:`.
- [ ] **Step 2:** `link` path: create only `.protocol.md` pointing at detected `entry_point`/`session_log`/memory. Touch nothing else. Note revert = delete `.protocol.md`.
- [ ] **Step 3:** `convert` path: instruct the skill to run `node ~/.claude/curator-migrate.js convert` from the project root, then report the journal + backup location and that `/setup revert` undoes it. The skill must NOT hand-edit files — all mutation goes through migrate.js.
- [ ] **Step 4:** `/setup revert`: run `node ~/.claude/curator-migrate.js revert`; surface any `E_*`/`W_*` to the user verbatim.
- [ ] **Step 5:** Mirror all changes into `skills/curator-setup.md`.
- [ ] **Step 6 (self-check):** dry-run the skill prose against a scratch repo; confirm the commands and the link-vs-convert branch read correctly.

## Task 9: `/open` skill — Tier-A deeper read + Tier-B registry

**Files:** Modify `skills/open.md`, `skills/curator-open.md`

- [ ] **Step 1:** Insert step 4.5 (Appendix A §"Layer split"): re-check the Tier-A adapters the hook already surfaced; read a full file only when the task needs more than the injected head. Don't re-probe from scratch.
- [ ] **Step 2:** Generalize step 5: "for each Tier-B adapter in `memory:`, invoke its MCP tool" — IJFW (`ijfw_memory_prelude`) is the one v1 row; keep current behaviour.
- [ ] **Step 3:** Mirror into `skills/curator-open.md`.
- [ ] **Step 4 (self-check):** verify the routing table in `open.md` still reads coherently top-to-bottom.

## Task 10: Docs

**Files:** Modify `README.md`, `INSTALL.md`

- [ ] **Step 1:** README: add a "Works with your existing memory" section (the 5 adapters + IJFW) and document `adoption: link | convert`.
- [ ] **Step 2:** INSTALL: document `/setup adopt`, the `link` vs `convert` choice, `.curator/` (journal committed, backups gitignored), and `/setup revert`.
- [ ] **Step 3:** Cross-check claims against behaviour (no overstated enforcement, matching the earlier POSIX/auto-mode corrections).

---

## Self-Review

**Coverage check:**

| Requirement (from the ask) | Task(s) | Covered? |
|---|---|---|
| Support other memory/knowledge systems | 2, 3, 9 + Appendix A | ✅ (5 file-based + IJFW) |
| Use existing memory system as the source | 1, 3, 8 (pointers + `memory:`) | ✅ |
| Adapt `/open` and wrap commands to current memory/doc structure | 3, 8, 9 | ✅ |
| Reformat/consolidate docs to a cleaner setup | 1 (roles/pointers) + 8 (adopt) | ✅ |
| Add mid-project, into existing system or bootstrap its own | 8 (`link`/`convert`) | ✅ |
| User-chosen convert vs use-existing | 8 Step 1 (AskUserQuestion) | ✅ |
| Never overwrite data; add to / improve | Appendix B invariants 1–2; Tasks 4–6 | ✅ |
| Reversible, leaves a doc to undo cleanly | Appendix B §3 journal, §5 revert; Task 5,6 | ✅ |

**Risk hotspots for the adversarial reviewer:**
1. **Data loss in `revert`** — every strip is sha-gated and self-verifying; diverged → restore backup; diverged + no backup → change nothing (`E_BACKUP_MISSING`). Reviewer: find any path that edits a diverged block by guesswork.
2. **Marker collision** — resolved by journal authority; reviewer: find a way a foreign marker string gets treated as Curator-owned.
3. **Torn journal on crash** — atomic temp+rename; reviewer: find a partial-write window that leaves an unparseable `migration.json`.
4. **Hook `set -euo pipefail` regressions** — new adapters add greps/globs; reviewer: find a missing-file/empty-dir case that exits non-zero and kills the hook.
5. **Symlink / path escape** — engine refuses to edit through symlinks and verifies parent containment; reviewer: find a traversal that writes outside the repo or backs up a linked target.

**Placeholder scan:** no TBDs; every task has concrete files, steps, and a self-check. Full normative specs are Appendices A & B.

**Ordering:** 1 → 2 → 3 (hook path) can land independently of 4 → 5 → 6 (engine). 7 ships both. 8/9/10 wire the UX/docs once 3 and 6 are green. Recommended: engine (4–6) first (highest risk, fully testable in isolation), then hook (2–3), then installer/skills/docs (7–10).

---

# Appendix A — Memory/Doc Adapter Registry (normative)

### Adapter model

An **adapter** is a named, stateless probe over one memory/knowledge system. Every adapter — Tier A or Tier B — implements the same four-field contract:

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string, `[a-z0-9_-]+` | Stable identifier, referenced from `.protocol.md` and used as the bash function suffix (`detect_<id>`, `read_<id>`). |
| `detect` | predicate | A cheap, side-effect-free test ("does this file/dir exist and look non-empty?"). Must not error under `set -euo pipefail` when the target is absent. |
| `read` | procedure | Emits a capped, markdown-formatted snippet to stdout. Never mutates project state. |
| `tier` | `A` \| `B` | `A` = file-based, safe to run from the bash hook. `B` = MCP-based, only reachable from the skill layer. |
| `priority` | integer | Lower runs/prints first. Used for both probe order and, on conflict, which adapter "wins" a dedup decision. |

Tier A adapters additionally expose a `cap` (byte/line ceiling for what `read` may emit) so the hook's total output stays bounded regardless of how many systems are detected.

**`.protocol.md` declaration.** Follow the existing flat `key: value` pointer style. Add one new key, `memory:`, holding a comma-separated list of adapter ids — no YAML lists, no nesting, parseable by `grep`+`sed` alone:

```
curator_mode: auto
session_log: DESIGN.md
entry_point: CLAUDE.md
memory: claude-native, agents-md, cline-bank
```

Semantics:
- **Absent `memory:` line** → probe everything in priority order, emit what's detected (auto-discovery, zero config).
- **Present `memory:` line** → an explicit allowlist *and* forced priority order. Lets a project suppress noisy detection or declare `ijfw` explicitly (Tier B can't be auto-detected by the hook).
- Unknown ids are ignored silently (forward-compat).
- Parse identically to `SESSION_LOG`: `grep -m1 '^memory:' .protocol.md | sed 's/^memory:[[:space:]]*//'`, split on `,`, trim each token with `sed 's/^[[:space:]]*//;s/[[:space:]]*$//'`.

### Per-adapter table

Byte caps follow the session-start.sh discipline: `head -n <lines> <file> | head -c <bytes>` (line-cap first, byte-cap second).

| id | tier | detect signal | read method | cap |
|----|------|----------------|--------------|-----|
| `claude-native` | A | `[[ -f CLAUDE.md ]]` (project); `[[ -f ~/.claude/CLAUDE.md ]]` (global, optional) | `head -n 40 CLAUDE.md | head -c 4096` | 40 lines / 4 KiB per file |
| `claude-native-memory` (optional best-effort sub-probe) | A | `[[ -f "$AUTO_MEM" ]]` where `$AUTO_MEM` is a *guessed* `~/.claude/projects/<hash>/memory/MEMORY.md` | `head -n 30 | head -c 3072` | **never load-bearing; hash scheme undocumented, decoration only** |
| `agents-md` | A | `[[ -f AGENTS.md ]]` | `head -n 40 AGENTS.md | head -c 4096` | 40 lines / 4 KiB |
| `cline-bank` | A | `[[ -d memory-bank ]] && ls memory-bank/*.md &>/dev/null` | high-signal first: `activeContext.md` (30 lines), `progress.md` (20 lines), then existence-only notes for `projectbrief.md`/`productContext.md`/`systemPatterns.md`/`techContext.md` | 30+20 lines / 3 KiB + 2 KiB |
| `copilot` | A | `[[ -f .github/copilot-instructions.md ]]` OR `ls .github/instructions/*.instructions.md &>/dev/null` | instructions head (40 lines); scoped files: first 5, filename + `applyTo:` + 15-line body | 40 lines / 4 KiB; 5 files × 15 lines/1 KiB |
| `cursor` | A | `ls .cursor/rules/*.mdc &>/dev/null` OR `[[ -f .cursorrules ]]` | `.mdc`: first 5, filename + `description`/`globs`/`alwaysApply` + 15-line body; legacy `.cursorrules` head (40 lines) | 5 files × 15 lines/1 KiB; legacy 40 lines/4 KiB |
| `ijfw` | B | tool `ijfw_memory_prelude` present in the MCP tool list | invoke `ijfw_memory_prelude` (skill-layer call) | tool's own response size |

Detect-signal notes:
- Use `&>/dev/null` (not bare `2>/dev/null`) for glob-existence checks (a glob that matches nothing passes the literal pattern to `ls`, which exits non-zero and prints to stderr; swallow both).
- `cline-bank` requires the directory to exist AND contain ≥1 `.md` — an empty `memory-bank/` must not fire.
- All Tier-A `read` invocations end with `|| true` or are `if`-wrapped (TOCTOU: a file that vanishes between `detect` and `read` must not abort the hook).

### Bash reference snippets

Each Tier-A adapter gets `detect_<id>()` (0/1, silent) and `read_<id>()` (emits markdown, always exits 0). Sourced by the hook.

```bash
# --- claude-native ---------------------------------------------------------
detect_claude_native() { [[ -f "CLAUDE.md" ]]; }

read_claude_native() {
  echo "## CLAUDE.md (head)"
  echo ""
  head -n 40 CLAUDE.md 2>/dev/null | head -c 4096 || true
  echo ""
  # Optional, best-effort: global auto-memory. Project-hash derivation is NOT
  # officially documented — soft probe only, never load-bearing.
  local _guess="${HOME}/.claude/projects/$(basename "$(pwd -P)")/memory/MEMORY.md"
  if [[ -f "$_guess" ]]; then
    echo "## Claude auto-memory (best-effort, unverified path)"
    echo ""
    head -n 30 "$_guess" 2>/dev/null | head -c 3072 || true
    echo ""
  fi
}

# --- agents-md -------------------------------------------------------------
detect_agents_md() { [[ -f "AGENTS.md" ]]; }

read_agents_md() {
  echo "## AGENTS.md (head)"
  echo ""
  head -n 40 AGENTS.md 2>/dev/null | head -c 4096 || true
  echo ""
}

# --- cline-bank ------------------------------------------------------------
detect_cline_bank() {
  [[ -d "memory-bank" ]] || return 1
  ls memory-bank/*.md &>/dev/null || return 1
  return 0
}

read_cline_bank() {
  echo "## Cline Memory Bank"
  echo ""
  if [[ -f "memory-bank/activeContext.md" ]]; then
    echo "### activeContext.md (head)"
    head -n 30 memory-bank/activeContext.md 2>/dev/null | head -c 3072 || true
    echo ""
  fi
  if [[ -f "memory-bank/progress.md" ]]; then
    echo "### progress.md (head)"
    head -n 20 memory-bank/progress.md 2>/dev/null | head -c 2048 || true
    echo ""
  fi
  local _f
  for _f in projectbrief.md productContext.md systemPatterns.md techContext.md; do
    [[ -f "memory-bank/${_f}" ]] && echo "- memory-bank/${_f} present (not loaded — see /open for full read)"
  done
  echo ""
}

# --- copilot (instructions + scoped) ---------------------------------------
detect_copilot() {
  [[ -f ".github/copilot-instructions.md" ]] && return 0
  ls .github/instructions/*.instructions.md &>/dev/null && return 0
  return 1
}

read_copilot() {
  echo "## GitHub Copilot instructions"
  echo ""
  if [[ -f ".github/copilot-instructions.md" ]]; then
    head -n 40 .github/copilot-instructions.md 2>/dev/null | head -c 4096 || true
    echo ""
  fi
  if ls .github/instructions/*.instructions.md &>/dev/null; then
    local _n=0 _f
    for _f in .github/instructions/*.instructions.md; do
      [[ -f "$_f" ]] || continue
      _n=$((_n + 1))
      [[ $_n -gt 5 ]] && { echo "- (additional scoped instruction files truncated)"; break; }
      echo "### ${_f}"
      local _applyTo
      _applyTo=$(sed -n '/^---$/,/^---$/p' "$_f" | grep -m1 '^applyTo:' | sed 's/^applyTo:[[:space:]]*//' || true)
      [[ -n "$_applyTo" ]] && echo "applyTo: ${_applyTo}"
      sed '/^---$/,/^---$/d' "$_f" 2>/dev/null | head -n 15 | head -c 1024 || true
      echo ""
    done
  fi
}

# --- cursor (rules dir + legacy .cursorrules) ------------------------------
detect_cursor() {
  ls .cursor/rules/*.mdc &>/dev/null && return 0
  [[ -f ".cursorrules" ]] && return 0
  return 1
}

read_cursor() {
  echo "## Cursor rules"
  echo ""
  if ls .cursor/rules/*.mdc &>/dev/null; then
    local _n=0 _f
    for _f in .cursor/rules/*.mdc; do
      [[ -f "$_f" ]] || continue
      _n=$((_n + 1))
      [[ $_n -gt 5 ]] && { echo "- (additional .mdc rules truncated)"; break; }
      echo "### ${_f}"
      local _desc _globs _always
      _desc=$(sed -n '/^---$/,/^---$/p' "$_f" | grep -m1 '^description:' | sed 's/^description:[[:space:]]*//' || true)
      _globs=$(sed -n '/^---$/,/^---$/p' "$_f" | grep -m1 '^globs:' | sed 's/^globs:[[:space:]]*//' || true)
      _always=$(sed -n '/^---$/,/^---$/p' "$_f" | grep -m1 '^alwaysApply:' | sed 's/^alwaysApply:[[:space:]]*//' || true)
      [[ -n "$_desc" ]] && echo "description: ${_desc}"
      [[ -n "$_globs" ]] && echo "globs: ${_globs}"
      [[ -n "$_always" ]] && echo "alwaysApply: ${_always}"
      sed '/^---$/,/^---$/d' "$_f" 2>/dev/null | head -n 15 | head -c 1024 || true
      echo ""
    done
  fi
  if [[ -f ".cursorrules" ]]; then
    echo "### .cursorrules (legacy, head)"
    head -n 40 .cursorrules 2>/dev/null | head -c 4096 || true
    echo ""
  fi
}
```

**Frontmatter handling — strip, don't pass through.** Extract only the fields Curator cares about (`description`/`globs`/`alwaysApply` or `applyTo`) as labelled `key: value` lines, then strip the `---…---` block before capping the body. Raw frontmatter is YAML meant for the *other* tool's parser; passing it verbatim adds parsing noise and risks multi-line YAML confusing the hook's line-oriented `grep`/`sed`. `sed -n '/^---$/,/^---$/p'` on a file with no frontmatter yields empty (all `grep -m1` miss, `|| true` swallows) — correct fallback.

### Detection & ordering

**Probe order (priority ascending):** `claude-native` → `agents-md` → `cline-bank` → `copilot` → `cursor` → `ijfw` (Tier B, `/open` only, last — it summarizes rather than competes).

**Dedup rule.** These systems are not mutually exclusive; a repo can have both `AGENTS.md` and a Cline bank, each targeting a distinct tool. Do not suppress an adapter because another fired. No semantic diffing (over-engineering for a context hook) — ordering + per-adapter caps bound the redundancy (worst case: small duplicate, more-canonical source printed first).

**Avoiding double-injection with `entry_point`/`session_log`.** `build_context()` already reads `entry_point:` (default `CLAUDE.md`) and `session_log:` (default `DESIGN.md`). Two skips:
- `entry_point == CLAUDE.md` → skip `claude-native` read (`SKIP_CLAUDE_NATIVE=1`); the registry only adds value when `entry_point` points elsewhere/absent.
- Any adapter target path `== session_log` → skip that adapter's read. Path-string equality only (no realpath), consistent with the hook's existing `SESSION_LOG` handling.

**Edge cases.** Missing file → `detect` returns 1, `read` never called. Empty file → `detect` true, `read` emits an empty section (harmless; not worth a `-s` check for a context hook — but `cline-bank` directory-detect *does* require ≥1 file). Empty/absent rules dir → `ls …&>/dev/null` false in both cases. Frontmatter-less `.mdc`/`.instructions.md` → only body prints.

### Layer split

**Runs in the bash hook:** all Tier-A adapters (pure file tests, coreutils only, no `jq`). Hook probes in priority order, applies the dedup skips, emits under per-file byte caps.

**Runs only in `/open`:** the `ijfw` Tier-B adapter, via the existing step 5, now formally the one Tier-B registry entry.

**How `/open` reuses the registry:** `/open` re-checks the same Tier-A adapters the hook surfaced, reading full files at higher fidelity when the task needs more than the injected head (it isn't bound by the 15 s hook timeout or the tighter byte caps). Add a step 4.5 to `skills/open.md`:

```
## 4.5 Memory/doc adapters (Tier A, deeper read)
Re-check the Tier A adapters the SessionStart hook already surfaced (CLAUDE.md,
AGENTS.md, Cline memory bank, Copilot instructions, Cursor rules). If the hook's
context block showed a section for one, and the current task needs more than the
head-only snippet already injected, read the full file now. Skip any adapter
whose signal wasn't present in the injected hook context — don't re-probe from
scratch.
```

Tier A logic lives in one place conceptually (bash for the hook; prose directing Claude's Read tool for the skill); Tier B (`ijfw`) is additive and unique to `/open`.

---

# Appendix B — Adoption `convert` mode: data-safe project upgrade (normative)

> This section governs every mutating code path in `/setup convert` and `/setup revert`. The three HARD INVARIANTS are non-negotiable; any implementation that can violate one is a bug, not a trade-off.

## B0. Scope and invariants

Adoption is opt-in and user-chosen, recorded in `.protocol.md` as `adoption: link | convert`.

- **`link`** — Curator creates **only** `.protocol.md`, pointing at existing docs/memory. No existing file is touched. **Reversal is total: delete `.protocol.md`.** Needs no journal, backups, or markers (except §B7 row 9).
- **`convert`** — Curator *additively* upgrades an existing project into Curator's fuller structure. Everything below governs it.

### The three HARD INVARIANTS

1. **Never overwrite a whole existing file.** Only (a) create a new file, or (b) edit **strictly within Curator's own marker fences**. Bytes outside Curator's fences are immutable to Curator, forever.
2. **Always back up (verbatim) before any in-place edit.** The backup is written and `fsync`'d *before* the edited file is written.
3. **Every mutating action is journaled** in `.curator/migration.json` with enough to reverse it exactly; the journal is the single source of truth for `revert`.

Corollary that resolves every ambiguity: **when in doubt, do less and preserve more.** A refused convert loses nothing. A full-backup restore loses nothing. Guessing loses data. We never guess.

## B1. Marker convention

```
<!-- curator:begin id=<block-id> v=<major> -->
… Curator-managed content …
<!-- curator:end id=<block-id> -->
```

- **Begin** (exact, own line): `<!-- curator:begin id=<block-id> v=<major> -->`. **End** (exact, own line): `<!-- curator:end id=<block-id> -->`.
- `<block-id>` — stable lowercase `[a-z0-9-]+` naming the block's *purpose* (e.g. `entry-index`); unique within a file; the join key between file, marker pair, and journal.
- `<major>` — marker-schema major (`v=1`), on the **begin** marker only; governs content shape and strip/merge logic. The end marker carries only `id` so a version bump never orphans it.
- Markers occupy their own line; leading indentation is preserved but not part of the match (matching is on the trimmed line).

**Read/replace rule (B1.2).** Curator only reads/replaces content **strictly between** a matched begin/end pair whose `block-id` it wrote (i.e. that appears in the journal). Begin line, end line, and everything outside are never modified in place (they can be removed as a unit during strip — §B5 — never partially rewritten). Managed content = bytes after the newline terminating the begin line, up to (not including) the newline beginning the end line. Curator writes exactly one newline after begin and ensures one before end.

**Uniqueness / collision (B1.3).** A file may legitimately contain the literal marker string (e.g. this spec committed as a doc). Defenses, all required:
1. **Journal authority.** A marker pair is Curator's **iff** its `(path, block-id)` is an `append-block` action in `migration.json`. Un-journaled markers are foreign, immutable user text.
2. **Pre-write collision scan.** Before appending block `X` to a file, scan for any begin/end marker string for that same `X` (trimmed-line match). If present and not journal-owned → **abort that action**, `E_MARKER_COLLISION`, file untouched.
3. **Pair integrity.** A managed block needs exactly one begin + one end for its `id`, begin before end. Zero/duplicate/crossed → "not cleanly bounded" → divergence rule (§B5.3), never text surgery.

## B2. `.curator/` layout

```
.curator/
├── migration.json                    # journal — COMMITTED
└── backups/                          # verbatim pre-edit copies — GITIGNORED
    └── <timestamp>/
        └── <original-relative-path>  # byte-identical mirror
```

- `<timestamp>` — one deterministic stamp per `convert` run, `YYYYMMDDTHHMMSSZ` (UTC), **passed in by the caller** (installer/skill stamps `Date.now()` once at entry), never read from the clock inside the migration logic. Keeps logic pure/testable; one invocation ↔ one backup generation.
- `<original-relative-path>` — repo-relative path preserved verbatim (incl. subdirs). Curator never edits through a symlinked segment (§B4.4), so backup paths can't escape `.curator/backups/<timestamp>/`.

**Gitignore policy (B2.1).** `convert` ensures `.gitignore` contains `.curator/backups/` (appended inside a Curator-managed block, or `.gitignore` created — the append itself follows §B4). **`migration.json` is COMMITTED** (team-shared reversal record). **`backups/` is GITIGNORED** (large, local-only safety net, reconstructible only on the machine that ran convert).

## B3. `migration.json` schema

```jsonc
{
  "schema": 1,
  "curatorVersion": "1.3.0",
  "markerVersion": 1,
  "timestamp": "20260630T101500Z",   // == backups/<timestamp>
  "actions": [ /* ordered; revert replays in reverse */ ]
}
```

**`create`** (new file Curator authored):
```jsonc
{ "type": "create", "path": "CLAUDE.md", "sha256_before": null,
  "sha256_after": "<sha of bytes Curator wrote>", "eol": "lf",
  "trailingNewline": true, "backup": null }
```
Reversal: current sha == `sha256_after` → delete; diverged → do not delete (§B5.4).

**`append-block`** (marked block added to an existing file):
```jsonc
{ "type": "append-block", "path": ".gitignore", "blockId": "curator-ignores",
  "markerVersion": 1, "sha256_before": "<whole file before>",
  "sha256_after": "<whole file after>", "eol": "lf", "trailingNewline": true,
  "insertedByteLen": 42, "backup": ".curator/backups/20260630T101500Z/.gitignore" }
```
- shas are over the **whole file** (revert proves the file is exactly what the journal expects before touching it).
- `backup` is **always** non-null for `append-block` (Invariant 2). A file that didn't exist before is recorded as `create` (no backup) instead.
- `insertedByteLen` + the located fence strips precisely; the sha fields decide *whether* stripping is safe (§B5).

## B4. `/setup convert` algorithm

Only writer of the journal. Caller supplies the run timestamp. All shas are SHA-256 over raw bytes.

- **B4.0 Pre-flight (no mutations):** refuse unless `adoption: convert`; if a valid `migration.json` exists → **re-migration** (§B6), not a fresh run; build the plan (create-set + append-set) writing no bytes.
- **B4.1 Classify (lstat, don't follow final component):** absent → `create`; regular file → `append-block`; symlink / symlinked parent → **refuse** (§B4.4).
- **B4.2 Back up every append-block target FIRST** (verbatim copy, `fsync` file + dir). A backup that can't be written **aborts the whole run before any edit**.
- **B4.3 Create / merge:** deterministic order (sorted by path). `create`: compute content, write, LF + single trailing newline. `append-block`: read whole file as bytes → `sha256_before` → detect EOL + trailing-newline (§B4.5) → collision scan (§B1.3) → build fence with the file's detected EOL → write → `sha256_after` + `insertedByteLen`.
- **B4.4 Symlink refusal:** if a target is a symlink (final component) or any parent resolves outside the repo root (compare `pwd -P`/`realpath` against `git rev-parse --show-toplevel`) → **do not edit**, `E_SYMLINK_REFUSED`, skip. `create` verifies its resolved parent is inside the repo before writing.
- **B4.5 Newline/encoding:** detect EOL by counting `\r\n` vs bare `\n` (CRLF if `\r\n` present and ≥ bare-`\n`); Curator's inserted region uses the detected style; never normalize the user's existing endings. Preserve trailing-newline state. Non-UTF-8 → **refuse append** (`E_NOT_UTF8`), skip (`create` always writes UTF-8).
- **B4.6 Journal write — atomic, not incremental:** serialize completed `actions` to `migration.json.tmp` → `fsync` → `rename()` over `migration.json`. Chosen over incremental append because a torn JSON journal is the least-recoverable failure. Interruption safety instead comes from **backups-first ordering + self-identifying marker fences**: a kill after some edits but before the journal commit leaves backups on disk, edits identifiable by their fences, and `migration.json` either absent or the previous committed version (never half-written). Recovery is a fresh `convert` re-plan (§B7 row 5).

Summary: `snapshot → classify → back up every append-block (fsync, abort on fail) → per target: sha_before → collision-scan → create/fence-in (preserve EOL+trailing) → sha_after → temp+fsync+atomic-rename journal`.

## B5. `/setup revert` algorithm

Replays `migration.json` in reverse. Prime directive: predictable, zero-loss; never guess; on divergence prefer the verbatim backup; if it can't act safely, **stop and change nothing**.

- **B5.0:** load+validate journal (missing/unparseable → `E_NO_JOURNAL`, change nothing). Iterate last→first.
- **B5.1 `create`:** current sha == `sha256_after` → delete; absent → no-op; diverged → **keep**, `W_CREATE_DIVERGED` (never delete a file the user has made their own).
- **B5.2 `append-block` decision:**
  - sha == `sha256_after` → **strip in place** (locate `(blockId)` fence, remove fence + content, restore pre-edit trailing-newline).
  - sha == `sha256_before` → block already absent → **no-op**.
  - anything else (diverged) → **restore verbatim backup** (§B5.3); do not strip.
- **B5.2.1 Strip verification:** after strip, re-hash; == `sha256_before` → done; else **discard strip result, restore verbatim backup**. So strip either reproduces known-good pre-edit bytes or falls back to the byte-identical backup — never leaves a guessed result.
- **B5.3 Restore-from-backup (safe default on divergence):** copy recorded `backup` verbatim over the target (temp+rename, `fsync`). **If backup missing/unreadable AND file diverged → `E_BACKUP_MISSING`, change nothing for that action**, continue. Under no circumstances strip a diverged/hand-edited block by guesswork. (Backup missing but file un-diverged → clean strip still preferred.)
- **B5.4 Finish:** all clean → may remove `.curator/`; any `E_*`/`W_*` → **keep `.curator/`** for inspection. Never deletes files it didn't create/fully strip.

## B6. Idempotency & re-migration

Running `convert` twice, or after a marker version bump (v1→v2), must **update Curator's own block in place** without duplicating it or touching user content; the journal reflects current state, not an append log.

1. **Single authoritative journal.** Exactly one `migration.json`; re-migration **rewrites** it (atomic rename) keyed by `(path, blockId)` — never a second `append-block` for the same key.
2. **In-place block update.** For a managed `(path, blockId)` present and un-diverged (bytes == journal `sha256_after`): unchanged content+version → **no-op** (true fixpoint); changed (v1→v2) → replace only the region between the fence, rewrite the begin `v=` tag, back up first (new timestamp generation), update the action's shas/version/`insertedByteLen`.
3. **Divergence during re-migration.** Managed block's bytes ≠ journal → **do not overwrite**, `W_BLOCK_DIVERGED`, leave user edits intact.
4. **New targets** → handled like a fresh convert (create/append-block with fresh backups), added to the rewritten journal.
5. **Removed targets** (v2 no longer manages a v1 block) → strip via §B5.2 rules, drop the action.

Net: N runs on an unchanged tree → one journal, one copy of each block. A version bump updates in place. No duplicate/stale entries.

## B7. Edge-case matrix (safe default per case)

| # | Situation | Safe default |
|---|---|---|
| 1 | User edited *inside* Curator's markers before revert | Diverged (sha ≠ after). **Don't strip.** Restore verbatim backup. Re-migration: `W_BLOCK_DIVERGED`, don't overwrite. |
| 2 | User deleted the managed file before revert | `append-block`: absent ≠ after ≠ before → diverged → restore-from-backup (recreates pre-convert file — a gain). Backup missing → `E_BACKUP_MISSING`, change nothing. `create`d file absent → no-op. |
| 3 | Markers missing but journal says `append-block` | Not cleanly bounded. sha == before → already reverted, no-op. Else diverged → restore backup; missing → `E_BACKUP_MISSING`, change nothing. |
| 4 | `.curator/backups` missing/corrupt | Expected on a fresh clone (gitignored). Un-diverged blocks still revert via clean strip (no backup needed). Diverged + no backup → `E_BACKUP_MISSING`, that action changes nothing; rest proceeds. Corrupt backup treated as missing. |
| 5 | Partial/interrupted convert | Backups written first + edits fence-identified + `migration.json` absent or prior committed (atomic rename, never torn). Recovery: rerun `convert` (re-plans, reconciles orphan blocks vs backups). No manual JSON repair. |
| 6 | Target is a symlink | **Refuse** (`E_SYMLINK_REFUSED`). No backup-through-link, no write-through. Skip; rest proceeds. |
| 7 | File has no trailing newline | Detected/recorded (`trailingNewline:false`). Insert newline before the block; revert restores exact pre-edit tail from `sha256_before`/backup. Byte-for-byte reproduced. |
| 8 | File not valid UTF-8 | `append-block` **refuses** (`E_NOT_UTF8`). Fences meaningless; re-encoding corrupts. Skip. |
| 9 | `.protocol.md` already exists (prior `link`) | Treated as existing: not overwritten (Invariant 1). Either set `adoption: convert` **inside a managed block** (append-block, backed up + journaled) or, if the field is outside any fence, leave untouched and report the conflict — never a blind whole-file rewrite. Once convert journals an edit, revert follows the journal (strip/restore), not the blunt `link` delete. |
| 10 | Running `revert` twice | Fully idempotent. Second run: creates already deleted (absent → no-op) or diverged-and-kept; append-blocks already stripped/restored (sha == before → no-op). No double-strip. |

**Error/warning codes.** `E_MARKER_COLLISION`, `E_SYMLINK_REFUSED`, `E_NOT_UTF8`, `E_NO_JOURNAL`, `E_BACKUP_MISSING`, `W_CREATE_DIVERGED`, `W_BLOCK_DIVERGED`. Every `E_*` is **stop-for-that-action-and-preserve**, never proceed-and-guess — the invariant the adversarial review should find no exception to.
