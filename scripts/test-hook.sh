#!/usr/bin/env bash
# scripts/test-hook.sh — smoke tests for hooks/session-start.sh
# Run from repo root: bash scripts/test-hook.sh

set -euo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/hooks/session-start.sh"
PASS=0; FAIL=0
TMPBASE=$(mktemp -d)
trap 'rm -rf "$TMPBASE"' EXIT

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

new_dir() { local d="$TMPBASE/$1"; mkdir -p "$d"; echo "$d"; }

# Run hook from dir; captures both stdout and stderr; always exits 0 for us.
run() { (cd "$1" && bash "$HOOK" 2>&1) || true; }

assert_contains() {
  local desc="$1" dir="$2" pattern="$3"
  local out; out=$(run "$dir")
  if echo "$out" | grep -qF -- "$pattern"; then
    printf 'PASS  %s\n' "$desc"; ((PASS++)) || true
  else
    printf 'FAIL  %s\n      expected to contain: %s\n      got: %s\n' \
      "$desc" "$pattern" "$(echo "$out" | head -n 3)"; ((FAIL++)) || true
  fi
}

assert_not_contains() {
  local desc="$1" dir="$2" pattern="$3"
  local out; out=$(run "$dir")
  if ! echo "$out" | grep -qF -- "$pattern"; then
    printf 'PASS  %s\n' "$desc"; ((PASS++)) || true
  else
    printf 'FAIL  %s\n      expected NOT to contain: %s\n' "$desc" "$pattern"; ((FAIL++)) || true
  fi
}

assert_silent() {
  local desc="$1" dir="$2"
  local out; out=$(run "$dir")
  if [[ -z "$out" ]]; then
    printf 'PASS  %s\n' "$desc"; ((PASS++)) || true
  else
    printf 'FAIL  %s\n      expected no output, got: %s\n' "$desc" "$out"; ((FAIL++)) || true
  fi
}

minimal_protocol() {
  printf 'curator_mode: auto\nsession_log: DESIGN.md\n' > "$1/.protocol.md"
}

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

echo "--- basic behaviour ---"

D=$(new_dir "no-protocol")
assert_silent "no .protocol.md → silent exit" "$D"

D=$(new_dir "minimal")
minimal_protocol "$D"
assert_contains "minimal .protocol.md → outputs protocol section" "$D" "## .protocol.md"

D=$(new_dir "missing-keys")
echo "name: test" > "$D/.protocol.md"
assert_contains "missing curator_mode/session_log → defaults, no crash" "$D" "## Curator — AUTO mode"

D=$(new_dir "manual-mode")
printf 'curator_mode: manual\nsession_log: DESIGN.md\n' > "$D/.protocol.md"
assert_not_contains "manual mode → no AUTO section" "$D" "## Curator — AUTO mode"

echo ""
echo "--- session_log path sanitization ---"

bad_paths=(
  "/etc/hosts"
  "~/.ssh/config"
  "../../outside.md"
)
for p in "${bad_paths[@]}"; do
  D=$(new_dir "bad-$(echo "$p" | tr '/' '_' | tr ':' '_')")
  printf 'session_log: %s\n' "$p" > "$D/.protocol.md"
  assert_contains "bad path rejected: $p" "$D" "WARN"
done

# Windows drive-letter paths
for p in "C:/secret" "C:\\secret"; do
  D=$(new_dir "win-$(echo "$p" | tr '/' '_' | tr ':' '_' | tr '\\' '_')")
  printf 'session_log: %s\n' "$p" > "$D/.protocol.md"
  assert_contains "Windows path rejected: $p" "$D" "WARN"
done

# UNC paths
for p in "\\\\server\\share\\secret.md" "//server/share/secret.md"; do
  D=$(new_dir "unc-$(echo "$p" | tr '/' '_' | tr '\\' '_' | tr ':' '_')")
  printf 'session_log: %s\n' "$p" > "$D/.protocol.md"
  assert_contains "UNC path rejected: $p" "$D" "WARN"
done

# Paths with internal spaces
D=$(new_dir "space-in-path")
printf 'session_log: my notes.md\n' > "$D/.protocol.md"
assert_contains "space in session_log path rejected" "$D" "WARN"

# Double-dot filename (false-positive guard)
D=$(new_dir "double-dot-filename")
minimal_protocol "$D"
echo "notes" > "$D/changelog-1..2.md"
printf 'curator_mode: auto\nsession_log: changelog-1..2.md\n' > "$D/.protocol.md"
assert_not_contains "changelog-1..2.md NOT rejected (no traversal segment)" "$D" "WARN"
assert_contains "changelog-1..2.md contents loaded" "$D" "changelog-1..2.md (head)"

echo ""
echo "--- symlink escape attempts ---"

# Symlink tests — skipped on Windows without Developer Mode (Cygwin ln -s silently
# creates regular files for real-path targets without elevation; probe with a real file).
_SYMLINKS_OK=false
_TEST_SYM_D=$(new_dir "symlink-probe")
echo "probe-target" > "$_TEST_SYM_D/target.txt"
ln -s "$_TEST_SYM_D/target.txt" "$_TEST_SYM_D/probe.txt" 2>/dev/null \
  && [[ -L "$_TEST_SYM_D/probe.txt" ]] && _SYMLINKS_OK=true || true

if [[ "$_SYMLINKS_OK" == true ]]; then
  # Direct final-component symlink
  D=$(new_dir "direct-symlink")
  OUTSIDE=$(new_dir "outside-direct"); echo "secret" > "$OUTSIDE/secret.txt"
  minimal_protocol "$D"
  ln -s "$OUTSIDE/secret.txt" "$D/evil-link.md"
  printf 'curator_mode: auto\nsession_log: evil-link.md\n' > "$D/.protocol.md"
  assert_contains "direct final-component symlink rejected" "$D" "WARN"

  # Symlinked parent directory
  D=$(new_dir "parent-symlink")
  OUTSIDE=$(new_dir "outside-parent"); echo "OUTSIDE_PARENT_LEAK_TOKEN" > "$OUTSIDE/secret.md"
  ln -s "$OUTSIDE" "$D/linked-dir"
  printf 'curator_mode: auto\nsession_log: linked-dir/secret.md\n' > "$D/.protocol.md"
  assert_contains "symlinked parent dir rejected" "$D" "WARN"
  assert_not_contains "symlinked parent dir: outside file not read" "$D" "OUTSIDE_PARENT_LEAK_TOKEN"
else
  printf 'SKIP  symlink tests (symlinks require elevated permissions on this system)\n'
fi

echo ""
echo "--- session log loading ---"

D=$(new_dir "with-design")
minimal_protocol "$D"
printf '# DESIGN.md\n\n## Current State\nAll good.\n' > "$D/DESIGN.md"
assert_contains "DESIGN.md head section loaded" "$D" "## DESIGN.md (head)"
assert_contains "DESIGN.md content visible" "$D" "All good."

D=$(new_dir "missing-design")
minimal_protocol "$D"
assert_not_contains "missing DESIGN.md → no error, section skipped" "$D" "DESIGN.md (head)"

echo ""
echo "--- memory/doc adapters ---"

# AGENTS.md present
D=$(new_dir "adapter-agents-md")
minimal_protocol "$D"
printf '# AGENTS.md\n\nProject agent notes.\n' > "$D/AGENTS.md"
assert_contains "AGENTS.md present → ## AGENTS.md section" "$D" "## AGENTS.md"

# Cline memory bank: activeContext.md present → fires
D=$(new_dir "adapter-cline-bank")
minimal_protocol "$D"
mkdir -p "$D/memory-bank"
printf '# Active Context\n\nWorking on the adapter registry.\n' > "$D/memory-bank/activeContext.md"
assert_contains "memory-bank/activeContext.md present → section shown" "$D" "### activeContext.md (head)"
assert_contains "memory-bank/activeContext.md content visible" "$D" "Working on the adapter registry."

# Cline memory bank: empty dir (no .md files) → does NOT fire
D=$(new_dir "adapter-cline-bank-empty")
minimal_protocol "$D"
mkdir -p "$D/memory-bank"
assert_not_contains "empty memory-bank/ (no .md) → NOT fired" "$D" "Cline Memory Bank"

# Cursor .mdc rule with frontmatter → labelled fields shown, fence stripped
D=$(new_dir "adapter-cursor")
minimal_protocol "$D"
mkdir -p "$D/.cursor/rules"
cat > "$D/.cursor/rules/x.mdc" <<'EOF'
---
description: TypeScript style rules
globs: **/*.ts
alwaysApply: true
---
Use strict null checks.
EOF
assert_contains "cursor .mdc → description label shown" "$D" "description: TypeScript style rules"
assert_contains "cursor .mdc → globs label shown" "$D" "globs: **/*.ts"
assert_contains "cursor .mdc → alwaysApply label shown" "$D" "alwaysApply: true"
assert_contains "cursor .mdc → body content shown" "$D" "Use strict null checks."
assert_not_contains "cursor .mdc → frontmatter fence stripped" "$D" "---"

# Dedup: default entry_point (CLAUDE.md) + CLAUDE.md present → claude-native
# adapter is skipped (the entry-point role already covers CLAUDE.md; the
# registry only adds value when entry_point points elsewhere/absent).
D=$(new_dir "adapter-dedup-claude-native")
minimal_protocol "$D"
printf '# CLAUDE.md\n\nDedup check content.\n' > "$D/CLAUDE.md"
assert_not_contains "claude-native dedup: no adapter section for default entry_point" "$D" "## CLAUDE.md (head)"
assert_not_contains "claude-native dedup: CLAUDE.md body not injected via adapter" "$D" "Dedup check content."

# memory: allowlist honored — agents-md only suppresses a present cursor rules dir
D=$(new_dir "adapter-memory-allowlist")
minimal_protocol "$D"
printf 'curator_mode: auto\nsession_log: DESIGN.md\nmemory: agents-md\n' > "$D/.protocol.md"
printf '# AGENTS.md\n\nAllowlisted adapter.\n' > "$D/AGENTS.md"
mkdir -p "$D/.cursor/rules"
cat > "$D/.cursor/rules/y.mdc" <<'EOF'
---
description: Should be suppressed
---
Suppressed body.
EOF
assert_contains "memory: agents-md → AGENTS.md still shown" "$D" "## AGENTS.md"
assert_not_contains "memory: agents-md → cursor rules suppressed" "$D" "Cursor rules"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
TOTAL=$((PASS + FAIL))
printf '%d/%d passed\n' "$PASS" "$TOTAL"
[[ "$FAIL" -eq 0 ]]
