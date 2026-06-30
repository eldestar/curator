# Curator Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six verified issues flagged by Codex adversarial review: wrong install path, broken hook contract, path-traversal vulnerability, set -euo pipefail bug, overstated auto-mode claim, and missing public-reuse basics.

**Architecture:** All changes are confined to three files (`hooks/session-start.sh`, `README.md`, `INSTALL.md`) plus two new files (`LICENSE`, `SECURITY.md`). No new dependencies, no structural changes to the repo.

**Tech Stack:** Bash (POSIX-compatible), Markdown.

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `hooks/session-start.sh` | Modify | Drop node; plain stdout; path sanitization; `|| true` guards |
| `README.md` | Modify | Install path `.claude/skills/` → `.claude/commands/`; soften auto-mode claim |
| `INSTALL.md` | Modify | Install path `.claude/skills/` → `.claude/commands/` |
| `LICENSE` | Create | MIT license |
| `SECURITY.md` | Create | Trust boundary note |

---

### Task 1: Fix `set -euo pipefail` pipeline failures (P1 #4)

**Files:**
- Modify: `hooks/session-start.sh:11-16`

Background: `grep | sed | tr` exits with code 1 when a key is absent from `.protocol.md`. With `set -euo pipefail`, that kills the script before the `${VAR:-default}` fallback applies. Verified: a `.protocol.md` without `curator_mode:` exits the hook silently with code 1.

- [ ] **Step 1: Write a test fixture**

Create a temp `.protocol.md` that has no `curator_mode:` or `session_log:` lines:

```bash
# Run from repo root
TMPDIR_TEST=$(mktemp -d)
echo "name: test-project" > "$TMPDIR_TEST/.protocol.md"
echo "" >> "$TMPDIR_TEST/.protocol.md"
echo "## Current Focus" >> "$TMPDIR_TEST/.protocol.md"
```

- [ ] **Step 2: Verify the bug reproduces**

```bash
cd "$TMPDIR_TEST"
bash /path/to/curator/hooks/session-start.sh
echo "exit: $?"
```
Expected: exits with code 1, no output. Confirms the bug.

- [ ] **Step 3: Apply the fix — append `|| true` to both pipelines**

In `hooks/session-start.sh`, change lines 11–16 from:

```bash
MODE=$(grep -m1 '^curator_mode:' .protocol.md 2>/dev/null | sed 's/^curator_mode:[[:space:]]*//' | tr -d '[:space:]')
MODE="${MODE:-auto}"

# Read session log filename (default: DESIGN.md)
SESSION_LOG=$(grep -m1 '^session_log:' .protocol.md 2>/dev/null | sed 's/^session_log:[[:space:]]*//' | tr -d '[:space:]')
SESSION_LOG="${SESSION_LOG:-DESIGN.md}"
```

To:

```bash
MODE=$(grep -m1 '^curator_mode:' .protocol.md 2>/dev/null | sed 's/^curator_mode:[[:space:]]*//' | tr -d '[:space:]' || true)
MODE="${MODE:-auto}"

# Read session log filename (default: DESIGN.md)
SESSION_LOG=$(grep -m1 '^session_log:' .protocol.md 2>/dev/null | sed 's/^session_log:[[:space:]]*//' | tr -d '[:space:]' || true)
SESSION_LOG="${SESSION_LOG:-DESIGN.md}"
```

- [ ] **Step 4: Verify fix**

```bash
cd "$TMPDIR_TEST"
bash /path/to/curator/hooks/session-start.sh
echo "exit: $?"
```
Expected: exit 0, context printed to stdout (once node is also fixed in Task 2 — for now it will fail on node, which is fine; this task only validates the grep pipelines don't kill the script).

Actually, to isolate this task: temporarily comment out the node block and verify the script reaches `build_context` cleanly. Or just proceed to Task 2 which removes node entirely, then re-verify.

- [ ] **Step 5: Commit**

```bash
git add hooks/session-start.sh
git commit -m "fix(hook): guard grep pipelines with || true to survive missing keys"
```

---

### Task 2: Drop node; emit plain stdout; fix hook contract (P0 #2 + P1 #5)

**Files:**
- Modify: `hooks/session-start.sh:54-62`

Background: The hook currently JSON-encodes context via `node` and emits `{"additionalContext": ...}`. The correct JSON format is `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`, but per Claude Code docs plain text on stdout is also a valid SessionStart output channel. Plain stdout is simpler, eliminates the node dependency, and removes the Windows/Git Bash breakage where `node` may not resolve through mise shims.

- [ ] **Step 1: Verify node dependency is the only non-POSIX part**

```bash
grep -n 'node\|python\|perl\|ruby' hooks/session-start.sh
```
Expected: lines 54-60 only (the node invocation).

- [ ] **Step 2: Replace the node block with plain stdout**

Remove lines 54–62 from `hooks/session-start.sh`:

```bash
# JSON-encode via node (always available in Claude Code environments)
CONTEXT_JSON=$(node -e "
process.stdin.resume();
let data = '';
process.stdin.on('data', function(chunk) { data += chunk; });
process.stdin.on('end', function() { process.stdout.write(JSON.stringify(data)); });
" <<< "$CONTEXT")

printf '{"additionalContext": %s}\n' "$CONTEXT_JSON"
```

And replace with:

```bash
printf '%s\n' "$CONTEXT"
```

The final hook (lines 52–63) should look like:

```bash
CONTEXT=$(build_context)
printf '%s\n' "$CONTEXT"
```

- [ ] **Step 3: Verify the full hook runs cleanly end-to-end**

```bash
cd /path/to/a/project/with/.protocol.md
bash /path/to/curator/hooks/session-start.sh
echo "---exit: $?---"
```
Expected: context text printed to stdout, exit 0.

```bash
# Also verify silent exit in a project without .protocol.md
cd /tmp
bash /path/to/curator/hooks/session-start.sh
echo "exit: $?"
```
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add hooks/session-start.sh
git commit -m "fix(hook): drop node dependency; emit plain stdout (valid SessionStart channel)"
```

---

### Task 3: Sanitize SESSION_LOG path (P0 #3)

**Files:**
- Modify: `hooks/session-start.sh` (after the SESSION_LOG assignment)

Background: `SESSION_LOG` is read directly from `.protocol.md` with no validation. A malicious repo could set `session_log: ~/.ssh/config` and have that file injected into Claude context. The hook is advertised as safe to install globally.

- [ ] **Step 1: Add path sanitization after the SESSION_LOG assignment**

After the line `SESSION_LOG="${SESSION_LOG:-DESIGN.md}"`, add:

```bash
# Reject absolute paths and traversal — session_log must stay within the repo
if [[ "$SESSION_LOG" == /* || "$SESSION_LOG" == ~* || "$SESSION_LOG" == *..* ]]; then
  printf 'curator: WARN: session_log "%s" rejected (absolute path or traversal) — using DESIGN.md\n' "$SESSION_LOG" >&2
  SESSION_LOG="DESIGN.md"
fi
```

- [ ] **Step 2: Verify rejection of bad paths**

```bash
# Test absolute path rejection
TMPDIR_TEST=$(mktemp -d)
printf 'curator_mode: auto\nsession_log: /etc/hosts\n' > "$TMPDIR_TEST/.protocol.md"
cd "$TMPDIR_TEST"
bash /path/to/curator/hooks/session-start.sh 2>&1 | grep -E "WARN|hosts"
```
Expected: warning line mentioning `/etc/hosts` rejected, fallback to `DESIGN.md`.

```bash
# Test traversal rejection
printf 'curator_mode: auto\nsession_log: ../../.ssh/config\n' > "$TMPDIR_TEST/.protocol.md"
cd "$TMPDIR_TEST"
bash /path/to/curator/hooks/session-start.sh 2>&1 | grep "WARN"
```
Expected: warning line, fallback to `DESIGN.md`.

```bash
# Verify legitimate relative path still works
printf 'curator_mode: auto\nsession_log: docs/NOTES.md\n' > "$TMPDIR_TEST/.protocol.md"
echo "# Notes" > "$TMPDIR_TEST/docs/NOTES.md" 2>/dev/null || { mkdir -p "$TMPDIR_TEST/docs" && echo "# Notes" > "$TMPDIR_TEST/docs/NOTES.md"; }
cd "$TMPDIR_TEST"
bash /path/to/curator/hooks/session-start.sh 2>&1 | grep -v WARN
```
Expected: no warning, context output includes `docs/NOTES.md` section.

- [ ] **Step 3: Commit**

```bash
git add hooks/session-start.sh
git commit -m "fix(hook): reject absolute paths and traversal in session_log (P0 path-traversal)"
```

---

### Task 4: Fix install path in docs (P0 #1)

**Files:**
- Modify: `README.md:29-32`
- Modify: `INSTALL.md:5-7`

Background: Both files say to copy skills into `.claude/skills/`. Claude Code slash commands (`/open`, `/setup`) are loaded from `.claude/commands/`, not `.claude/skills/`. The skills directory is for the Skill tool; user-typed `/commandname` invocations come from `.claude/commands/`.

- [ ] **Step 1: Fix README.md quick start block**

Change:

```markdown
```sh
# 1. Copy skills into your project
mkdir -p .claude/skills
cp /path/to/curator/skills/* .claude/skills/
```
```

To:

```markdown
```sh
# 1. Copy skills into your project's commands folder
mkdir -p .claude/commands
cp /path/to/curator/skills/* .claude/commands/
```
```

- [ ] **Step 2: Fix INSTALL.md step 1 (appears twice — new project and existing project sections)**

In the "Into a new project" section, change:

```markdown
1. Copy the skills into your project's `.claude/skills/` folder:
   ```sh
   mkdir -p .claude/skills
   cp /path/to/curator/skills/* .claude/skills/
   ```
```

To:

```markdown
1. Copy the skills into your project's `.claude/commands/` folder:
   ```sh
   mkdir -p .claude/commands
   cp /path/to/curator/skills/* .claude/commands/
   ```
```

The "Into an existing project" section says "Same as above" so it inherits the fix automatically — verify no separate copy command exists there.

- [ ] **Step 3: Verify no remaining `.claude/skills` install references**

```bash
grep -rn '\.claude/skills' README.md INSTALL.md
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md INSTALL.md
git commit -m "fix(docs): install into .claude/commands/ not .claude/skills/ (slash commands, not Skill tool)"
```

---

### Task 5: Soften auto-mode claim (P1 #6)

**Files:**
- Modify: `README.md:43-47`

Background: The Modes table says auto mode "AI checks doc state at session close". There is no Stop/SessionEnd hook — only a SessionStart reminder. The claim is technically false; it should say what actually happens.

- [ ] **Step 1: Fix the Modes table**

Change:

```markdown
| `auto` | AI checks doc state at session close; prompts to update CLAUDE.md when needed |
```

To:

```markdown
| `auto` | AI is reminded at session start to check doc state before the session closes; no enforcement hook (add a `Stop` hook for hard enforcement) |
```

- [ ] **Step 2: Fix the bullet in the "What it does" section**

Change:

```markdown
- **Anti-sprawl** — in `auto` mode, the AI is reminded at session close to extend existing docs rather than create new ones, and to update the index when things change.
```

To:

```markdown
- **Anti-sprawl** — in `auto` mode, the AI is reminded at session start to extend existing docs rather than create new ones before closing, and to update the index when things change. No Stop hook is wired by default.
```

- [ ] **Step 3: Verify no remaining "session close" language that implies enforcement**

```bash
grep -n 'session close\|at session close\|checks doc' README.md
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: soften auto-mode claim — reminder at start, no Stop hook enforcement"
```

---

### Task 6: Add LICENSE and SECURITY.md (P2 #8 partial)

**Files:**
- Create: `LICENSE`
- Create: `SECURITY.md`

- [ ] **Step 1: Create LICENSE (MIT)**

Create `LICENSE` with content:

```
MIT License

Copyright (c) 2026 Ben Antonson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Create SECURITY.md**

Create `SECURITY.md` with content:

```markdown
# Security

## Trust boundary

The SessionStart hook (`hooks/session-start.sh`) is safe to install globally in
`~/.claude/settings.json`. It exits silently in any project that lacks
`.protocol.md`.

**`.protocol.md` is treated as untrusted input.** The hook reads two fields from
it: `curator_mode` and `session_log`. The `session_log` value is validated before
use — absolute paths (starting with `/` or `~`) and path traversal sequences
(`..`) are rejected and fall back to `DESIGN.md`. A warning is printed to stderr.

**What a malicious `.protocol.md` can do:**
- Set `session_log` to a relative path within the repo — any file the hook user
  can read that lives inside the working directory.

**What it cannot do (after this fix):**
- Read files outside the repo root via absolute paths or `..` traversal.

## Reporting a vulnerability

Open a GitHub issue or email benjamin.antonson@gmail.com. Response within 72 hours.
```

- [ ] **Step 3: Commit**

```bash
git add LICENSE SECURITY.md
git commit -m "chore: add MIT license and SECURITY.md trust boundary note"
```

---

## Self-Review

**Spec coverage check:**

| Finding | Task | Covered? |
|---------|------|----------|
| P0 #1 install path | Task 4 | ✅ |
| P0 #2 hook contract / node | Task 2 | ✅ |
| P0 #3 path traversal | Task 3 | ✅ |
| P1 #4 set -euo pipefail | Task 1 | ✅ |
| P1 #5 node dependency | Task 2 | ✅ (same fix) |
| P1 #6 auto mode claim | Task 5 | ✅ |
| P2 #7 test suite | Deferred | noted |
| P2 #8 license/CI/security | Task 6 | ✅ (license + SECURITY.md; CI deferred) |

**Placeholder scan:** No TBDs, no "implement later", no steps without code. ✅

**Type/name consistency:** Pure bash and markdown — no type surface to drift. ✅

**Order note:** Tasks 1 and 2 both touch `session-start.sh`. Do Task 1 first (|| true guards), then Task 2 (drop node), then Task 3 (path sanitization). The commits are small and clean in this order.
