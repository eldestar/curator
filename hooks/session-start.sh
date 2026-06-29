#!/usr/bin/env bash
# The Curator — SessionStart hook
# Injects project state as additionalContext when .protocol.md is present.
# Silent exit in projects that don't use The Curator.

set -euo pipefail

[[ -f ".protocol.md" ]] || exit 0

# Read mode (default: auto)
MODE=$(grep -m1 '^curator_mode:' .protocol.md 2>/dev/null | sed 's/^curator_mode:[[:space:]]*//' | tr -d '[:space:]')
MODE="${MODE:-auto}"

# Read session log filename (default: DESIGN.md)
SESSION_LOG=$(grep -m1 '^session_log:' .protocol.md 2>/dev/null | sed 's/^session_log:[[:space:]]*//' | tr -d '[:space:]')
SESSION_LOG="${SESSION_LOG:-DESIGN.md}"

build_context() {
  echo "## .protocol.md"
  echo ""
  cat .protocol.md
  echo ""

  if git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    echo "## Git State"
    echo ""
    git status --short 2>/dev/null | head -20 || true
    echo ""
    echo "Recent commits:"
    git log --oneline -5 2>/dev/null || true
    echo ""
  fi

  if [[ -f "$SESSION_LOG" ]]; then
    echo "## ${SESSION_LOG} (head)"
    echo ""
    head -60 "$SESSION_LOG" 2>/dev/null || true
    echo ""
  fi

  if [[ "$MODE" == "auto" ]]; then
    echo "## Curator — AUTO mode"
    echo ""
    echo "Doc discipline active. Before this session closes:"
    echo "- Check CLAUDE.md: does it need updating based on what was worked on?"
    echo "- Prefer extending existing docs over creating new ones."
    echo "- Each doc has one purpose and a size cap (see CLAUDE.md index)."
    echo "- Load only what the task needs; close context aggressively."
  fi
}

CONTEXT=$(build_context)

# JSON-encode via node (always available in Claude Code environments)
CONTEXT_JSON=$(node -e "
process.stdin.resume();
let data = '';
process.stdin.on('data', function(chunk) { data += chunk; });
process.stdin.on('end', function() { process.stdout.write(JSON.stringify(data)); });
" <<< "$CONTEXT")

printf '{"additionalContext": %s}\n' "$CONTEXT_JSON"
