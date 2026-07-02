#!/usr/bin/env bash
# scripts/test-stop.sh — smoke tests for hooks/stop.sh
# Run from repo root: bash scripts/test-stop.sh

set -euo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/hooks/stop.sh"
PASS=0; FAIL=0
TMPBASE=$(mktemp -d)
trap 'rm -rf "$TMPBASE"' EXIT

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

new_dir() { local d="$TMPBASE/$1"; mkdir -p "$d"; echo "$d"; }

# Run stop hook from dir with given JSON on stdin; captures stdout only; always exits 0 for us.
run_stop() { (cd "$1" && printf '%s' "$2" | bash "$HOOK") || true; }

assert_contains() {
  local desc="$1" dir="$2" json="$3" pattern="$4"
  local out; out=$(run_stop "$dir" "$json")
  if echo "$out" | grep -qF "$pattern"; then
    printf 'PASS  %s\n' "$desc"; ((PASS++)) || true
  else
    printf 'FAIL  %s\n      expected to contain: %s\n      got: %s\n' \
      "$desc" "$pattern" "$(echo "$out" | head -n 3)"; ((FAIL++)) || true
  fi
}

assert_silent() {
  local desc="$1" dir="$2" json="$3"
  local out; out=$(run_stop "$dir" "$json")
  if [[ -z "$out" ]]; then
    printf 'PASS  %s\n' "$desc"; ((PASS++)) || true
  else
    printf 'FAIL  %s\n      expected no output, got: %s\n' "$desc" "$out"; ((FAIL++)) || true
  fi
}

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

echo "--- stop hook behaviour ---"

# 1. No .protocol.md → silent, exit 0
D=$(new_dir "no-protocol")
assert_silent "no .protocol.md → silent exit" "$D" '{"stop_hook_active":false}'

# 2. auto mode + dirty git repo + stop_hook_active false → block
D=$(new_dir "dirty-auto")
git init -q "$D"
git -C "$D" config user.email "t@t"
git -C "$D" config user.name "t"
printf 'curator_mode: auto\nsession_log: DESIGN.md\n' > "$D/.protocol.md"
# untracked file makes porcelain non-empty
echo "dirty" > "$D/untracked.txt"
assert_contains "auto + dirty git + stop_hook_active false → block" "$D" \
  '{"stop_hook_active":false}' '"decision":"block"'

# 3. auto mode + stop_hook_active true → silent (loop guard)
D=$(new_dir "loop-guard")
git init -q "$D"
git -C "$D" config user.email "t@t"
git -C "$D" config user.name "t"
printf 'curator_mode: auto\nsession_log: DESIGN.md\n' > "$D/.protocol.md"
echo "dirty" > "$D/untracked.txt"
assert_silent "auto + stop_hook_active true → no block (loop guard)" "$D" \
  '{"stop_hook_active":true}'

# 4. manual mode → silent
D=$(new_dir "manual-mode")
git init -q "$D"
git -C "$D" config user.email "t@t"
git -C "$D" config user.name "t"
printf 'curator_mode: manual\nsession_log: DESIGN.md\n' > "$D/.protocol.md"
echo "dirty" > "$D/untracked.txt"
assert_silent "manual mode → no block" "$D" '{"stop_hook_active":false}'

# 5. auto mode + clean git repo → no block
D=$(new_dir "clean-git")
git init -q "$D"
git -C "$D" config user.email "t@t"
git -C "$D" config user.name "t"
printf 'curator_mode: auto\nsession_log: DESIGN.md\n' > "$D/.protocol.md"
git -C "$D" add .protocol.md
git -C "$D" commit -q -m "init"
assert_silent "auto + clean git repo → no block" "$D" '{"stop_hook_active":false}'

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
TOTAL=$((PASS + FAIL))
printf '%d/%d passed\n' "$PASS" "$TOTAL"
[[ "$FAIL" -eq 0 ]]
