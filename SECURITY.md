# Security

## Trust boundary

The SessionStart hook (`hooks/session-start.sh`) is designed to be installed
globally in `~/.claude/settings.json`. It exits silently in any project that
lacks `.protocol.md`.

**`.protocol.md` is treated as untrusted input.** The hook reads two fields:
`curator_mode` and `session_log`. The `session_log` value is validated before
use — any violation falls back to `DESIGN.md` with a warning on stderr.

### Validation pipeline

**Stage 1 — string pre-checks (cheap, no subprocesses):**

| Rule | What it blocks |
|------|----------------|
| Rejects paths starting with `/` or `~` | Unix absolute paths |
| Rejects `[A-Za-z]:[/\]` via substring index | Windows drive-letter paths (`C:/...`, `C:\...`) |
| Rejects paths containing a `/../` segment | String-level traversal |
| Rejects the direct final component if it is a symlink | `session_log: evil-link.md` |

**Stage 2 — containment check (catches symlinked parent directories):**

Resolves the *directory* component of `session_log` via `cd … && pwd -P` (follows
all symlinks) and requires the result to start with the repo root. This blocks:

```
linked-dir -> ../outside-target
session_log: linked-dir/secret.md   ← caught here
```

**What a malicious `.protocol.md` can still do:**
- Point `session_log` at any plain relative file within the repo that the hook
  process can read. This is intentional — the hook injects project context, and
  the repo owner controls what files exist.

**What it cannot do:**
- Read files outside the repo via Unix or Windows absolute paths.
- Traverse out of the repo with `../` sequences.
- Escape via a symlinked final component (`evil-link.md`).
- Escape via a symlinked parent directory (`linked-dir/secret.md`).

**Known scope limits:**
- The containment check resolves the directory component, not the file itself. A
  plain file (not a symlink) that is inside the repo root and readable is
  reachable. Treat `.protocol.md` with the same trust you extend to the repo itself.
- On **Windows without Developer Mode**, `ln -s` silently creates regular files
  instead of symlinks, so the direct-symlink check is inert. The containment
  check (Stage 2) still fires for symlinked parent directories when directory
  symlinks are available.

## Reporting a vulnerability

Open a GitHub issue or email benjamin.antonson@gmail.com. Response within 72 hours.
