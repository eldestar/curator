#!/usr/bin/env bash
# The Curator — Memory/doc adapter registry (Tier A)
# Sourced by hooks/session-start.sh. Defines detect_<id>()/read_<id>() pairs
# for the file-based memory/knowledge systems, plus run_registry() to probe
# and emit them in order. This file must be safe to `source` under
# `set -euo pipefail`: no top-level executable statements beyond function
# definitions, no unguarded commands that can exit non-zero.

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

# --- registry ---------------------------------------------------------------
# run_registry <entry_point> <session_log> <id1> [<id2> ...]
#
# Probes each adapter id in the given order; on a detect hit, calls its
# read_* function, subject to two dedup skips (Appendix A "Detection &
# ordering"):
#   - claude_native is skipped when entry_point == CLAUDE.md (the existing
#     entry-point block already injects CLAUDE.md's content).
#   - any adapter whose target file path equals session_log is skipped
#     (path-string equality only, no realpath — matches existing hook
#     behaviour for SESSION_LOG).
#
# Unknown ids are ignored silently (forward-compat). Never raises — every
# read_* already always exits 0, and unknown-id lookups are guarded.
run_registry() {
  local _entry_point="$1"; shift
  local _session_log="$1"; shift
  local _id

  for _id in "$@"; do
    case "$_id" in
      claude-native|claude_native)
        [[ "$_entry_point" == "CLAUDE.md" ]] && continue
        [[ "$_session_log" == "CLAUDE.md" ]] && continue
        if detect_claude_native; then read_claude_native; fi
        ;;
      agents-md|agents_md)
        [[ "$_session_log" == "AGENTS.md" ]] && continue
        if detect_agents_md; then read_agents_md; fi
        ;;
      cline-bank|cline_bank)
        [[ "$_session_log" == "memory-bank/activeContext.md" || "$_session_log" == "memory-bank/progress.md" ]] && continue
        if detect_cline_bank; then read_cline_bank; fi
        ;;
      copilot)
        [[ "$_session_log" == ".github/copilot-instructions.md" ]] && continue
        if detect_copilot; then read_copilot; fi
        ;;
      cursor)
        [[ "$_session_log" == ".cursorrules" ]] && continue
        if detect_cursor; then read_cursor; fi
        ;;
      *)
        : # unknown id — ignored silently
        ;;
    esac
  done
}
