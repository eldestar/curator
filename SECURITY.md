# Security

## Trust boundary

The SessionStart hook (`hooks/session-start.sh`) is designed to be installed
globally in `~/.claude/settings.json`. It exits silently in any project that
lacks `.protocol.md`.

**`.protocol.md` is treated as untrusted input.** The hook reads two fields:
`curator_mode` and `session_log`. The `session_log` value is validated before
use against the following rules — any violation falls back to `DESIGN.md` with
a warning on stderr:

| Rule | What it blocks |
|------|----------------|
| Rejects paths starting with `/` or `~` | Unix absolute paths |
| Rejects paths matching `^[A-Za-z]:[/\\]` | Windows drive-letter paths (`C:/...`, `C:\...`) |
| Rejects paths with a `/../` traversal segment | Directory traversal |
| Rejects symlinks | Intra-repo symlink escapes |

**What a malicious `.protocol.md` can still do:**
- Point `session_log` at any plain relative file within the repo that the hook
  process can read. This is intentional — the hook is a context-injection tool,
  and the repo owner controls what files exist in the repo.

**What it cannot do (after this version):**
- Read files outside the repo via Unix or Windows absolute paths.
- Traverse out of the repo with `../` sequences.
- Follow a symlink to a file outside the repo.

**Not in scope / known limitations:**
- The filter is string-based, not sandbox-based. A `realpath` containment check
  would be stronger but requires an extra subprocess.
- Files executable by the hook user that happen to sit inside the repo root are
  reachable. Treat `.protocol.md` with the same trust you extend to the repo itself.

## Reporting a vulnerability

Open a GitHub issue or email benjamin.antonson@gmail.com. Response within 72 hours.
