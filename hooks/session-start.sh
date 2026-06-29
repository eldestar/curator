#!/usr/bin/env bash
# The Curator — SessionStart hook
# Injects project state as context when .protocol.md is present.
# Silent exit in projects that don't use The Curator.

set -euo pipefail

[[ -f ".protocol.md" ]] || exit 0

# Read mode (default: auto) — || true prevents set -e from killing on missing key
MODE=$(grep -m1 '^curator_mode:' .protocol.md 2>/dev/null | sed 's/^curator_mode:[[:space:]]*//' | tr -d '[:space:]' || true)
MODE="${MODE:-auto}"

# Read session log filename (default: DESIGN.md)
SESSION_LOG=$(grep -m1 '^session_log:' .protocol.md 2>/dev/null | sed 's/^session_log:[[:space:]]*//' | tr -d '[:space:]' || true)
SESSION_LOG="${SESSION_LOG:-DESIGN.md}"

# Sanitize session_log — must resolve to a path inside the repo root.
# Stage 1: cheap string pre-checks (absolute paths, traversal segments, drive letters).
# Stage 2: realpath-equivalent containment via cd+pwd -P — catches symlinked parent dirs.
# Note: [[ =~ [/\\] ]] misses C:\path because bash consumes the backslash before
# the regex engine sees it — use substring indexing for the Windows drive-letter check.
_BS=$'\\'
_reject=false
if [[ "$SESSION_LOG" == /* || "$SESSION_LOG" == ~* ]]; then
  _reject=true  # Unix absolute
elif [[ "${SESSION_LOG:1:1}" == ":" && ( "${SESSION_LOG:2:1}" == "/" || "${SESSION_LOG:2:1}" == "$_BS" ) ]]; then
  _reject=true  # Windows drive-letter absolute (C:/ or C:\)
elif [[ "$SESSION_LOG" =~ (^|/)\.\.(/|$) ]]; then
  _reject=true  # traversal segment (../ or /..)
elif [[ -e "$SESSION_LOG" && -L "$SESSION_LOG" ]]; then
  _reject=true  # direct final-component symlink
else
  # Containment check: resolve the directory component and verify it stays under
  # the repo root. This catches linked-dir/secret.md where linked-dir is the symlink.
  _repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)
  _log_dir=$(dirname "$SESSION_LOG")
  _resolved_dir=$(cd "$_log_dir" 2>/dev/null && pwd -P) || true
  if [[ -n "$_resolved_dir" ]]; then
    case "${_resolved_dir}/" in
      "${_repo_root}/"*) : ;;  # inside repo root — ok
      *) _reject=true ;;        # directory resolved outside repo (symlinked parent)
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
  cat .protocol.md
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
    head -n 60 "$SESSION_LOG" 2>/dev/null || true
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

# Plain stdout is a valid SessionStart context channel (no JSON wrapper needed).
# Note: the previous {"additionalContext":...} top-level JSON was silently ignored
# by Claude Code — the hook was injecting nothing. Plain stdout actually works.
build_context
