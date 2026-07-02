#!/usr/bin/env bash
# The Curator — Stop hook (opt-in, --enforce only)
# Blocks session end once to prompt doc-discipline check in auto mode.
# Silent exit in projects that don't use The Curator.

set -euo pipefail

input=$(cat)

[[ -f ".protocol.md" ]] || exit 0

# Read mode (default: auto)
MODE=$(grep -m1 '^curator_mode:' .protocol.md 2>/dev/null | sed 's/^curator_mode:[[:space:]]*//' | tr -d '[:space:]' || true)
MODE="${MODE:-auto}"

[[ "$MODE" == "auto" ]] || exit 0

# Loop guard: if we already blocked once this cycle, don't block again
# ponytail: grep -q returns 1 on no-match; wrap in if so set -e doesn't fire
if echo "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

# Work happened check: if inside a git repo and nothing changed, no need to remind
if git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
  _porcelain=$(git status --porcelain 2>/dev/null || true)
  if [[ -z "$_porcelain" ]]; then
    exit 0
  fi
fi

# Block once with a doc-discipline reminder
# ponytail: reason is a controlled constant — no user input, no escaping needed
reason="Curator auto mode: before ending, check doc discipline. Update the CLAUDE.md doc index if docs changed, extend existing docs instead of creating new ones, and update DESIGN.md and .protocol.md Current Focus. If already handled, stop again to proceed."

printf '{"decision":"block","reason":"%s"}\n' "$reason"
