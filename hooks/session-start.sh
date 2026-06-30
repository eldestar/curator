#!/usr/bin/env bash
# The Curator — SessionStart hook
# Injects project state as context when .protocol.md is present.
# Silent exit in projects that don't use The Curator.

set -euo pipefail

[[ -f ".protocol.md" ]] || exit 0

# Read mode (default: auto)
MODE=$(grep -m1 '^curator_mode:' .protocol.md 2>/dev/null | sed 's/^curator_mode:[[:space:]]*//' | tr -d '[:space:]' || true)
MODE="${MODE:-auto}"

# Read session log filename (default: DESIGN.md)
SESSION_LOG=$(grep -m1 '^session_log:' .protocol.md 2>/dev/null | sed 's/^session_log:[[:space:]]*//' || true)
# Strip leading/trailing whitespace only — preserve internal spaces for error detection
SESSION_LOG=$(echo "$SESSION_LOG" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
SESSION_LOG="${SESSION_LOG:-DESIGN.md}"

# Sanitize session_log path
_BS=$'\\'
_reject=false

# Reject paths containing internal spaces (silently mangling them would be worse)
if [[ "$SESSION_LOG" =~ [[:space:]] ]]; then
  printf 'curator: WARN: session_log "%s" contains spaces — using DESIGN.md\n' "$SESSION_LOG" >&2
  SESSION_LOG="DESIGN.md"
fi

if [[ "$SESSION_LOG" == /* || "$SESSION_LOG" == ~* ]]; then
  _reject=true  # Unix absolute
elif [[ "${SESSION_LOG:1:1}" == ":" && ( "${SESSION_LOG:2:1}" == "/" || "${SESSION_LOG:2:1}" == "$_BS" ) ]]; then
  _reject=true  # Windows drive-letter absolute (C:/ or C:\)
elif [[ "$SESSION_LOG" =~ ^\\\\[^\\]+ ]]; then
  _reject=true  # UNC path (\\server\share)
elif [[ "$SESSION_LOG" =~ (^|/)\.\.(/|$) ]]; then
  _reject=true  # traversal segment (../ or /..)
elif [[ -e "$SESSION_LOG" && -L "$SESSION_LOG" ]]; then
  _reject=true  # direct final-component symlink
else
  # Containment check: resolve the directory component and verify it stays under
  # the repo root. This catches linked-dir/secret.md where linked-dir is the symlink.
  # Note: repos entered through symlinked paths may see inconsistent results here
  # because git rev-parse returns the physical path. This is a known limitation;
  # see SECURITY.md for details.
  _repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)
  _log_dir=$(dirname "$SESSION_LOG")
  _resolved_dir=$(cd "$_log_dir" 2>/dev/null && pwd -P) || true
  if [[ -n "$_resolved_dir" ]]; then
    case "${_resolved_dir}/" in
      "${_repo_root}/"*) : ;;  # inside repo root — ok
      *) _reject=true ;;
    esac
  fi
fi

if [[ "$_reject" == true ]]; then
  printf 'curator: WARN: session_log "%s" rejected (unsafe path) — using DESIGN.md\n' "$SESSION_LOG" >&2
  SESSION_LOG="DESIGN.md"
fi

build_context() {
  echo "## .protocol.md"
  echo ""
  # Cap at 100 lines AND ~8KB to guard against long-line context bloat
  head -n 100 .protocol.md | head -c 8192
  echo ""

  if git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    echo "## Git State"
    echo ""
    git status --short 2>/dev/null | head -n 20 || true
    echo ""
    echo "Recent commits:"
    git log --oneline -5 2>/dev/null || true
    echo ""
  fi

  if [[ -f "$SESSION_LOG" ]]; then
    echo "## ${SESSION_LOG} (head)"
    echo ""
    head -n 60 "$SESSION_LOG" 2>/dev/null | head -c 6144 || true
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

build_context
