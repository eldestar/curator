#!/usr/bin/env node
// The Curator — data-safe migration engine (Appendix B, normative).
// Node stdlib ONLY. Run from the project root (cwd = the project being adopted).
//
//   node migrate.js convert [--timestamp <YYYYMMDDTHHMMSSZ>]
//   node migrate.js revert
//   node migrate.js --selfcheck
//
// The three HARD INVARIANTS are acceptance criteria, not aspirations:
//   1. Never overwrite a whole existing file — only create new, or edit strictly
//      between Curator's own marker fences.
//   2. Always write+fsync a verbatim backup BEFORE any in-place edit.
//   3. Journal every mutating action to .curator/migration.json (atomic write).
//
// Every E_* code means: stop THAT action and preserve; never proceed-and-guess.

'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const os = require('os')
const assert = require('assert')

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEMA = 1
const MARKER_VERSION = 1
const CURATOR_VERSION = '1.3.0'
const CURATOR_DIR = '.curator'
const JOURNAL_NAME = 'migration.json'

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

// ponytail: UTF-8 validity via round-trip. Node's TextDecoder with fatal:true
// throws on invalid sequences — the exact test Appendix B §4.5 needs.
function isValidUtf8(buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return true
  } catch {
    return false
  }
}

// Detect EOL style (§4.5): CRLF if \r\n present and >= bare \n count.
function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length
  const bare = (text.match(/\n/g) || []).length - crlf
  return crlf > 0 && crlf >= bare ? 'crlf' : 'lf'
}

function eolStr(eol) {
  return eol === 'crlf' ? '\r\n' : '\n'
}

function hasTrailingNewline(text) {
  return text.length > 0 && text[text.length - 1] === '\n'
}

// Trimmed-line marker strings (§1). Begin carries id + version; end carries id.
function beginMarker(blockId, major) {
  return `<!-- curator:begin id=${blockId} v=${major} -->`
}
function endMarker(blockId) {
  return `<!-- curator:end id=${blockId} -->`
}

// Regexes matching a begin/end marker on a trimmed line, for a specific id.
// Leading indentation is preserved in the file but not part of the match.
function beginRe(blockId) {
  return new RegExp(
    `^[ \\t]*<!--\\s*curator:begin\\s+id=${escapeRe(blockId)}\\s+v=(\\d+)\\s*-->[ \\t]*$`
  )
}
function endRe(blockId) {
  return new RegExp(
    `^[ \\t]*<!--\\s*curator:end\\s+id=${escapeRe(blockId)}\\s*-->[ \\t]*$`
  )
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Filesystem primitives (fsync-aware, atomic)
// ---------------------------------------------------------------------------

function fsyncPath(p) {
  // ponytail: best-effort dir fsync. On some platforms (notably Windows)
  // opening a directory for fsync is unsupported; durability there is weaker
  // but the atomic rename below still guarantees no torn file.
  let fd
  try {
    fd = fs.openSync(p, 'r')
    fs.fsyncSync(fd)
  } catch {
    // ignore — see note above
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd) } catch {}
  }
}

// Write bytes durably: temp in same dir → fsync file → rename over dest → fsync dir.
function writeFileAtomic(dest, buf) {
  const dir = path.dirname(dest)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, '.' + path.basename(dest) + '.tmp-' + process.pid)
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, buf, 0, buf.length, 0)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, dest)
  fsyncPath(dir)
}

// Verbatim backup: copy source bytes to backup path, fsync file + dir (Invariant 2).
function backupFile(srcAbs, backupAbs) {
  const buf = fs.readFileSync(srcAbs)
  writeFileAtomic(backupAbs, buf)
}

// ---------------------------------------------------------------------------
// Repo containment (§4.4 symlink refusal)
// ---------------------------------------------------------------------------

// Resolve the repo root: prefer git toplevel, else the real cwd. Both are
// realpath'd so containment comparison is apples-to-apples.
function repoRoot(cwd) {
  return fs.realpathSync(cwd)
}

// True iff `abs` is inside `root` (or equals it), after resolving the deepest
// existing ancestor of `abs`. Guards against a symlinked parent escaping root.
function isContained(root, abs) {
  const rootReal = fs.realpathSync(root)
  // Walk up to the deepest component that exists, realpath it, then re-append
  // the non-existent tail. This resolves symlinked parents without requiring
  // the leaf to exist yet (create case).
  let existing = abs
  const tail = []
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing))
    const parent = path.dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  let realExisting
  try {
    realExisting = fs.realpathSync(existing)
  } catch {
    return false
  }
  const resolved = tail.length ? path.join(realExisting, ...tail) : realExisting
  const rel = path.relative(rootReal, resolved)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// Is the FINAL component a symlink? (lstat, don't follow — §4.1/§4.4)
function isSymlink(abs) {
  try {
    return fs.lstatSync(abs).isSymbolicLink()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Journal I/O (§3, §4.6)
// ---------------------------------------------------------------------------

function journalPath(cwd) {
  return path.join(cwd, CURATOR_DIR, JOURNAL_NAME)
}

function loadJournal(cwd) {
  const p = journalPath(cwd)
  if (!fs.existsSync(p)) return null
  let raw
  try {
    raw = fs.readFileSync(p, 'utf8')
  } catch {
    return { __unparseable: true }
  }
  try {
    const j = JSON.parse(raw)
    if (!j || typeof j !== 'object' || !Array.isArray(j.actions)) {
      return { __unparseable: true }
    }
    return j
  } catch {
    return { __unparseable: true }
  }
}

// Atomic journal write: serialize → temp → fsync → rename (§4.6). Never append.
function writeJournal(cwd, journal) {
  const p = journalPath(cwd)
  const buf = Buffer.from(JSON.stringify(journal, null, 2) + '\n', 'utf8')
  writeFileAtomic(p, buf)
}

// ---------------------------------------------------------------------------
// Marker / block location (§1.2, §1.3)
// ---------------------------------------------------------------------------

// Find a cleanly-bounded (begin,end) pair for blockId. Returns
// { beginLine, endLine, major } (0-based line indices) or null / {crossed:true}.
function locateBlock(lines, blockId) {
  const bRe = beginRe(blockId)
  const eRe = endRe(blockId)
  let beginLine = -1
  let endLine = -1
  let major = null
  let beginCount = 0
  let endCount = 0
  for (let i = 0; i < lines.length; i++) {
    const m = bRe.exec(lines[i])
    if (m) {
      beginCount++
      if (beginLine === -1) {
        beginLine = i
        major = parseInt(m[1], 10)
      }
    }
    if (eRe.test(lines[i])) {
      endCount++
      if (endLine === -1 && beginLine !== -1 && i > beginLine) endLine = i
    }
  }
  if (beginCount === 0 && endCount === 0) return null
  // Not cleanly bounded: zero/duplicate/crossed (§1.3 pair integrity).
  if (beginCount !== 1 || endCount !== 1 || beginLine === -1 || endLine === -1 || endLine <= beginLine) {
    return { crossed: true }
  }
  return { beginLine, endLine, major }
}

// Does ANY begin/end marker string for blockId appear? (collision scan §1.3)
function hasAnyMarker(lines, blockId) {
  const bRe = beginRe(blockId)
  const eRe = endRe(blockId)
  return lines.some(l => bRe.test(l) || eRe.test(l))
}

// ---------------------------------------------------------------------------
// Error accumulation
// ---------------------------------------------------------------------------

class Report {
  constructor() {
    this.notes = []   // { code, path, blockId?, message }
    this.mutated = false
  }
  add(code, target, message) {
    this.notes.push({ code, path: target, message: message || code })
  }
  hasErrors() {
    return this.notes.some(n => n.code.startsWith('E_'))
  }
  hasAny() {
    return this.notes.length > 0
  }
  print(prefix) {
    for (const n of this.notes) {
      const loc = n.path ? ` ${n.path}` : ''
      process.stderr.write(`${prefix}${n.code}:${loc} ${n.message}\n`)
    }
  }
}

// ---------------------------------------------------------------------------
// Plan model
// ---------------------------------------------------------------------------
// A plan is data so tests can drive create + append-block cases directly.
// Each item:
//   { kind: 'create',       path, content }
//   { kind: 'append-block', path, blockId, body }
// `content`/`body` use '\n' internally; EOL is applied per detected file style.

// The concrete demo plan a bare `convert` applies. Kept small + sensible; the
// ENGINE below is generic over any plan (applyPlan).
function demoPlan() {
  return [
    {
      kind: 'create',
      path: '.protocol.md',
      content: [
        'curator_mode: auto',
        'session_log: DESIGN.md',
        'entry_point: CLAUDE.md',
        'adoption: convert',
        '',
      ].join('\n'),
    },
    {
      kind: 'create',
      path: 'DESIGN.md',
      content: [
        '# Design Journal',
        '',
        '_Session log created by Curator adoption (convert)._',
        '',
      ].join('\n'),
    },
    {
      kind: 'append-block',
      path: '.gitignore',
      blockId: 'curator-ignores',
      body: '.curator/backups/',
    },
  ]
}

// ---------------------------------------------------------------------------
// Build a managed-block region (the fenced text inserted into a file)
// ---------------------------------------------------------------------------
// Returns the exact string block: begin\n<body>\nend  — using the file's EOL.
// Curator writes exactly one newline after begin and ensures one before end (§1.2).
function renderBlock(blockId, major, body, eol) {
  const nl = eolStr(eol)
  // Normalize body to the file's EOL; strip a single trailing newline so we
  // control spacing deterministically.
  const bodyNorm = body.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').join(nl)
  return beginMarker(blockId, major) + nl + bodyNorm + nl + endMarker(blockId)
}

// ---------------------------------------------------------------------------
// CONVERT (§4) + re-migration (§6)
// ---------------------------------------------------------------------------

function applyPlan(plan, opts) {
  const cwd = opts.cwd
  const timestamp = opts.timestamp
  const report = new Report()

  const root = repoRoot(cwd)

  // §4.0 Pre-flight: existing journal → re-migration, else fresh.
  const existing = loadJournal(cwd)
  if (existing && existing.__unparseable) {
    // A torn/foreign journal blocks convert to avoid clobbering an unknown state.
    report.add('E_NO_JOURNAL', journalPath(cwd), 'existing migration.json is unparseable; refusing to convert')
    return finishConvert(report, null, cwd)
  }
  const reMigration = !!existing

  // Index prior actions by key for authority + in-place update.
  const priorByKey = new Map() // "create:path" | "append-block:path|blockId" -> action
  if (reMigration) {
    for (const a of existing.actions) {
      priorByKey.set(actionKey(a), a)
    }
  }

  // The journal we will (re)write. Start from prior curatorVersion metadata but
  // fresh action list built from current plan reconciliation.
  const journal = {
    schema: SCHEMA,
    curatorVersion: CURATOR_VERSION,
    markerVersion: MARKER_VERSION,
    timestamp: timestamp,
    actions: [],
  }

  // ---- Classify (§4.1) + collect append-block targets needing backup ----
  const classified = []
  for (const item of plan) {
    const abs = path.join(cwd, item.path)

    // §4.4 symlink / containment refusal (applies to both kinds).
    if (isSymlink(abs)) {
      report.add('E_SYMLINK_REFUSED', item.path, 'target is a symlink; refusing to edit')
      continue
    }
    if (!isContained(root, abs)) {
      report.add('E_SYMLINK_REFUSED', item.path, 'target resolves outside repo root; refusing to edit')
      continue
    }

    let exists = false
    try {
      exists = fs.existsSync(abs) && fs.lstatSync(abs).isFile()
    } catch {
      exists = false
    }

    if (item.kind === 'create') {
      // A create whose file now exists is handled as an append-block only if the
      // plan says so; a plain create over an existing file is refused by
      // Invariant 1 unless it's Curator's own prior create (idempotent rewrite).
      if (exists) {
        const key = 'create:' + item.path
        if (reMigration && priorByKey.has(key)) {
          // Idempotent create: leave file, keep/refresh journal entry per §6.2.
          classified.push({ item, abs, kind: 'create-existing' })
        } else {
          // ponytail: don't blindly overwrite a pre-existing file we didn't
          // author. Report and skip — Invariant 1.
          report.add('W_CREATE_DIVERGED', item.path, 'file already exists and is not Curator-owned; skipping create')
        }
      } else {
        classified.push({ item, abs, kind: 'create' })
      }
    } else if (item.kind === 'append-block') {
      classified.push({ item, abs, kind: exists ? 'append-block' : 'create-from-append' })
    }
  }

  // ---- §4.2 Back up EVERY append-block target FIRST; abort run on any fail ----
  const backups = new Map() // abs -> repo-relative backup path
  for (const c of classified) {
    if (c.kind !== 'append-block') continue
    const rel = c.item.path
    const backupRel = path.join(CURATOR_DIR, 'backups', timestamp, rel)
    const backupAbs = path.join(cwd, backupRel)
    try {
      backupFile(c.abs, backupAbs)
      backups.set(c.abs, backupRel.split(path.sep).join('/'))
    } catch (e) {
      // Any backup that can't be written aborts the whole run before any edit.
      report.add('E_BACKUP_MISSING', rel, 'could not write pre-edit backup; aborting run before any edit: ' + e.message)
      return finishConvert(report, null, cwd)
    }
  }

  // ---- §4.3 Create / merge in deterministic (sorted) order ----
  classified.sort((a, b) => (a.item.path < b.item.path ? -1 : a.item.path > b.item.path ? 1 : 0))

  for (const c of classified) {
    const item = c.item
    const abs = c.abs

    if (c.kind === 'create' || c.kind === 'create-from-append') {
      // Fresh file authored by Curator. LF + single trailing newline.
      const content = (c.kind === 'create' ? item.content : renderBlock(item.blockId, MARKER_VERSION, item.body, 'lf'))
      const buf = Buffer.from(normalizeCreate(content), 'utf8')
      try {
        writeFileAtomic(abs, buf)
      } catch (e) {
        report.add('E_SYMLINK_REFUSED', item.path, 'write failed: ' + e.message)
        continue
      }
      report.mutated = true
      journal.actions.push({
        type: 'create',
        path: item.path,
        sha256_before: null,
        sha256_after: sha256(buf),
        eol: 'lf',
        trailingNewline: true,
        backup: null,
      })
      continue
    }

    if (c.kind === 'create-existing') {
      // Idempotent create over Curator's own prior file: re-check divergence.
      const prior = priorByKey.get('create:' + item.path)
      const cur = fs.readFileSync(abs)
      const curSha = sha256(cur)
      if (curSha === prior.sha256_after) {
        // Unchanged — carry the prior action forward unchanged (true fixpoint).
        journal.actions.push(cloneAction(prior))
      } else {
        // User made it their own; do NOT overwrite (§5.1 spirit / Invariant 1).
        report.add('W_CREATE_DIVERGED', item.path, 'Curator-created file diverged; leaving user content, keeping journal entry')
        journal.actions.push(cloneAction(prior))
      }
      continue
    }

    if (c.kind === 'append-block') {
      const before = fs.readFileSync(abs)
      const shaBefore = sha256(before)
      if (!isValidUtf8(before)) {
        report.add('E_NOT_UTF8', item.path, 'file is not valid UTF-8; refusing append')
        continue
      }
      const text = before.toString('utf8')
      const eol = detectEol(text)
      const trailing = hasTrailingNewline(text)
      const key = 'append-block:' + item.path + '|' + item.blockId

      // ---- Re-migration in-place update (§6.2/§6.3) ----
      if (reMigration && priorByKey.has(key)) {
        const prior = priorByKey.get(key)
        // Divergence check: whole-file bytes must equal the journal's after-sha.
        if (shaBefore !== prior.sha256_after) {
          report.add('W_BLOCK_DIVERGED', item.path, 'managed block diverged from journal; not overwriting')
          journal.actions.push(cloneAction(prior)) // keep prior record
          continue
        }
        const loc = locateBlock(text.split('\n'), item.blockId)
        if (!loc || loc.crossed) {
          report.add('W_BLOCK_DIVERGED', item.path, 'managed markers not cleanly bounded; not overwriting')
          journal.actions.push(cloneAction(prior))
          continue
        }
        const newBlock = renderBlock(item.blockId, MARKER_VERSION, item.body, eol)
        const rebuilt = replaceRegion(text, loc, newBlock, eol)
        if (rebuilt === text) {
          // No change — true fixpoint, carry prior forward.
          journal.actions.push(cloneAction(prior))
          continue
        }
        const outBuf = Buffer.from(rebuilt, 'utf8')
        writeFileAtomic(abs, outBuf)
        report.mutated = true
        journal.actions.push({
          type: 'append-block',
          path: item.path,
          blockId: item.blockId,
          markerVersion: MARKER_VERSION,
          sha256_before: prior.sha256_before, // pre-CONVERT baseline preserved
          sha256_after: sha256(outBuf),
          eol,
          trailingNewline: trailing,
          insertedByteLen: Buffer.byteLength(newBlock, 'utf8'),
          backup: prior.backup || backups.get(abs) || null,
        })
        continue
      }

      // ---- Fresh append-block ----
      // Collision scan (§1.3): if the block already appears and isn't ours → abort action.
      if (hasAnyMarker(text.split('\n'), item.blockId)) {
        report.add('E_MARKER_COLLISION', item.path, `marker for id=${item.blockId} already present and not journal-owned; file untouched`)
        continue
      }
      const nl = eolStr(eol)
      const block = renderBlock(item.blockId, MARKER_VERSION, item.body, eol)
      // Insert: ensure a separating newline before the block; preserve trailing state.
      let out
      if (text.length === 0) {
        out = block + nl
      } else if (trailing) {
        out = text + block + nl
      } else {
        // No trailing newline: add one to separate, block, then restore no-trailing? No —
        // §7 row 7: insert newline before block; final file ends with block + single nl.
        out = text + nl + block + nl
      }
      const outBuf = Buffer.from(out, 'utf8')
      writeFileAtomic(abs, outBuf)
      report.mutated = true
      journal.actions.push({
        type: 'append-block',
        path: item.path,
        blockId: item.blockId,
        markerVersion: MARKER_VERSION,
        sha256_before: shaBefore,
        sha256_after: sha256(outBuf),
        eol,
        trailingNewline: trailing,
        insertedByteLen: Buffer.byteLength(block, 'utf8'),
        backup: backups.get(abs) || null,
      })
      continue
    }
  }

  // Carry forward any prior actions whose targets weren't in this plan (§6.4/§6.5
  // handle add/remove; here we simply drop removed keys — nothing to do). If a
  // prior action's key was not re-emitted and not intentionally removed, it means
  // the plan no longer manages it; we leave the on-disk block alone (revert will
  // still find it via the retained-or-not journal). We keep only re-emitted keys,
  // which reflects "current state, not an append log" (§6.1).

  // §4.6 Atomic journal write — only if we have actions or we mutated.
  if (journal.actions.length > 0 || report.mutated || reMigration) {
    writeJournal(cwd, journal)
  }

  return finishConvert(report, journal, cwd)
}

function finishConvert(report, journal, cwd) {
  return { ok: !report.hasErrors(), report, journal }
}

// Overwrite the located region (between begin/end inclusive) with newBlock,
// preserving surrounding text and the file's EOL.
function replaceRegion(text, loc, newBlock, eol) {
  const nl = eolStr(eol)
  const lines = text.split('\n')
  // Re-split preserving nothing about original line endings; we rejoin with nl.
  // Build: lines[0..beginLine-1] + newBlock lines + lines[endLine+1..].
  const before = lines.slice(0, loc.beginLine)
  const after = lines.slice(loc.endLine + 1)
  const blockLines = newBlock.split(nl)
  const all = before.concat(blockLines, after)
  let joined = all.join(nl)
  // Preserve original trailing-newline state of the file.
  if (hasTrailingNewline(text) && !joined.endsWith(nl)) joined += nl
  if (!hasTrailingNewline(text) && joined.endsWith(nl)) joined = joined.replace(/(\r\n|\n)$/, '')
  return joined
}

// A create's content: normalize to LF, single trailing newline.
function normalizeCreate(content) {
  let c = content.replace(/\r\n/g, '\n')
  c = c.replace(/\n+$/, '\n')
  if (!c.endsWith('\n')) c += '\n'
  return c
}

function actionKey(a) {
  if (a.type === 'create') return 'create:' + a.path
  return 'append-block:' + a.path + '|' + a.blockId
}

function cloneAction(a) {
  return JSON.parse(JSON.stringify(a))
}

// ---------------------------------------------------------------------------
// REVERT (§5)
// ---------------------------------------------------------------------------

function revert(opts) {
  const cwd = opts.cwd
  const report = new Report()

  // §5.0 load + validate journal.
  const journal = loadJournal(cwd)
  if (!journal || journal.__unparseable) {
    report.add('E_NO_JOURNAL', journalPath(cwd), 'missing or unparseable migration.json; changing nothing')
    return { ok: false, report }
  }

  // Replay last → first.
  const actions = journal.actions.slice().reverse()
  for (const a of actions) {
    if (a.type === 'create') revertCreate(cwd, a, report)
    else if (a.type === 'append-block') revertAppendBlock(cwd, a, report)
  }

  // §5.4 finish: clean run may remove ONLY Curator-owned artifacts; any E_*/W_*
  // keeps .curator/ intact for inspection. We must NEVER `rm -rf .curator` — the
  // directory may have pre-existed adoption with unrelated user data in it.
  if (!report.hasAny()) {
    cleanupCuratorArtifacts(cwd, journal)
  }
  return { ok: !report.hasErrors(), report }
}

// Remove only the artifacts THIS journal created: the journal file itself, and
// the backup subtree(s) `.curator/backups/<timestamp>/` for the timestamp(s)
// referenced by this journal's actions' `backup` paths. Then remove
// `.curator/backups/` and `.curator/` themselves ONLY if now empty. Never touch
// unrelated files that may live under `.curator/` (Invariant: non-destructive).
function cleanupCuratorArtifacts(cwd, journal) {
  const curatorAbs = path.join(cwd, CURATOR_DIR)

  // 1. Remove the journal file.
  try {
    fs.rmSync(journalPath(cwd), { force: true })
  } catch {}

  // 2. Collect the backup-subtree timestamps this journal owns. A backup path
  //    looks like ".curator/backups/<timestamp>/<rel...>"; take the <timestamp>
  //    component. Fall back to the journal's own timestamp for completeness.
  const timestamps = new Set()
  if (journal && Array.isArray(journal.actions)) {
    for (const a of journal.actions) {
      if (!a || !a.backup) continue
      const parts = a.backup.split('/') // journal stores '/'-joined paths
      const bi = parts.indexOf('backups')
      if (bi !== -1 && parts.length > bi + 1) timestamps.add(parts[bi + 1])
    }
  }
  if (journal && journal.timestamp) timestamps.add(journal.timestamp)

  const backupsAbs = path.join(curatorAbs, 'backups')
  for (const ts of timestamps) {
    if (!ts) continue
    try {
      fs.rmSync(path.join(backupsAbs, ts), { recursive: true, force: true })
    } catch {}
  }

  // 3. Remove .curator/backups/ and .curator/ themselves ONLY if now empty.
  //    rmdirSync throws ENOTEMPTY when other (unowned) entries remain — ignore.
  try { fs.rmdirSync(backupsAbs) } catch {}
  try { fs.rmdirSync(curatorAbs) } catch {}
}

function revertCreate(cwd, a, report) {
  const abs = path.join(cwd, a.path)
  if (!fs.existsSync(abs)) return // absent → no-op
  if (isSymlink(abs)) {
    report.add('W_CREATE_DIVERGED', a.path, 'path is now a symlink; not deleting')
    return
  }
  // The path exists but may no longer be a regular file (user replaced our
  // created file with a directory, socket, etc.). Treat as a divergence for
  // THIS action — never readFileSync a non-file (would throw and abort revert).
  let st
  try {
    st = fs.lstatSync(abs)
  } catch {
    return // vanished between existsSync and lstat → no-op
  }
  if (!st.isFile()) {
    report.add('W_CREATE_DIVERGED', a.path, 'path is no longer a regular file; not deleting')
    return
  }
  const cur = sha256(fs.readFileSync(abs))
  if (cur === a.sha256_after) {
    fs.rmSync(abs, { force: true })
    report.mutated = true
  } else {
    // §5.1 diverged → keep, never delete a file the user has made their own.
    report.add('W_CREATE_DIVERGED', a.path, 'created file diverged; keeping user content')
  }
}

function revertAppendBlock(cwd, a, report) {
  const abs = path.join(cwd, a.path)
  const backupAbs = a.backup ? path.join(cwd, a.backup) : null

  // If the managed path now exists but is NOT a regular file (directory, socket,
  // symlink, etc.), we cannot read it as a file and cannot safely restore a
  // backup over it (writeFileAtomic can't rename over a directory). This is a
  // divergence for THIS action → change nothing, emit E_*, continue the revert.
  if (fs.existsSync(abs) && !isSymlink(abs)) {
    let st
    try {
      st = fs.lstatSync(abs)
    } catch {
      st = null
    }
    if (st && !st.isFile()) {
      report.add('E_BACKUP_MISSING', a.path, 'managed path is no longer a regular file; cannot restore over it; changing nothing')
      return
    }
  }

  const exists = fs.existsSync(abs) && !isSymlink(abs)
  const cur = exists ? fs.readFileSync(abs) : null
  const curSha = cur ? sha256(cur) : null

  // sha == before → already reverted / block absent → no-op (§5.2).
  if (curSha === a.sha256_before) return

  if (curSha === a.sha256_after) {
    // §5.2 strip in place, then §5.2.1 verify → else restore backup.
    const text = cur.toString('utf8')
    const stripped = stripBlock(text, a)
    if (stripped !== null) {
      const strippedBuf = Buffer.from(stripped, 'utf8')
      if (sha256(strippedBuf) === a.sha256_before) {
        writeFileAtomic(abs, strippedBuf)
        report.mutated = true
        return
      }
    }
    // Strip didn't reproduce known-good bytes → discard, restore verbatim backup.
    if (restoreBackup(abs, backupAbs, a, report)) return
    // No usable backup: §5.3 diverged + no backup → change nothing.
    report.add('E_BACKUP_MISSING', a.path, 'strip verification failed and backup missing/unreadable; changing nothing')
    return
  }

  // Anything else (diverged: user edits, deleted file, missing markers) →
  // restore verbatim backup (§5.2/§5.3). Never strip a diverged block by guess.
  if (restoreBackup(abs, backupAbs, a, report)) return
  report.add('E_BACKUP_MISSING', a.path, 'diverged and backup missing/unreadable; changing nothing')
}

// Remove the fenced block (fence + content) for a.blockId, restoring pre-edit
// trailing-newline state. Returns the new text, or null if not cleanly bounded.
function stripBlock(text, a) {
  const lines = text.split('\n')
  const loc = locateBlock(lines, a.blockId)
  if (!loc || loc.crossed) return null
  const before = lines.slice(0, loc.beginLine)
  const after = lines.slice(loc.endLine + 1)
  // The block was inserted with a separating newline; removing it must undo that.
  // Reconstruct by joining remaining lines. We then reconcile trailing newline.
  let out = before.concat(after).join('\n')
  // Restore recorded pre-edit trailing-newline state.
  if (a.trailingNewline) {
    if (!out.endsWith('\n')) out += '\n'
  } else {
    out = out.replace(/\n$/, '')
  }
  // The insert added a leading separating newline before the block when the
  // original had no trailing newline OR always after existing content. Because
  // strip is sha-VERIFIED against sha256_before (§5.2.1), any residual mismatch
  // falls back to the verbatim backup — so we never emit a guessed result.
  return out
}

function restoreBackup(abs, backupAbs, a, report) {
  if (!backupAbs || !fs.existsSync(backupAbs)) return false
  // Never write a restored backup over a non-regular-file destination (e.g. a
  // directory the user put there): rename-over-directory fails. Treat as unable
  // to restore so the caller emits a change-nothing E_* rather than crashing.
  if (fs.existsSync(abs) && !isSymlink(abs)) {
    try {
      if (!fs.lstatSync(abs).isFile()) return false
    } catch {
      return false
    }
  }
  let buf
  try {
    buf = fs.readFileSync(backupAbs)
  } catch {
    return false
  }
  // Verify the backup is the byte-identical pre-edit file (sha256_before).
  if (a.sha256_before && sha256(buf) !== a.sha256_before) {
    // Corrupt backup treated as missing (§7 row 4).
    return false
  }
  writeFileAtomic(abs, buf)
  report.mutated = true
  return true
}

// ---------------------------------------------------------------------------
// .gitignore handling is expressed as a plan item (see demoPlan) — no special
// code path; §2.1 is satisfied by the append-block on `.gitignore` there, or by
// a create if `.gitignore` is absent (create-from-append).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CLI timestamp
// ---------------------------------------------------------------------------

function stampNow() {
  // YYYYMMDDTHHMMSSZ (UTC)
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    'T' +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    'Z'
  )
}

function validTimestamp(s) {
  return /^\d{8}T\d{6}Z$/.test(s)
}

// ---------------------------------------------------------------------------
// --selfcheck: assert-based round-trip (one create + one append-block) in tmp.
// ---------------------------------------------------------------------------

function selfcheck() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-selfcheck-'))
  try {
    // Seed an existing file for the append-block target.
    const giPath = path.join(dir, '.gitignore')
    fs.writeFileSync(giPath, 'node_modules/\n')
    const giBefore = fs.readFileSync(giPath)

    const ts = '20260630T101500Z'
    const plan = [
      { kind: 'create', path: 'CLAUDE.md', content: '# Hello\n' },
      { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: '.curator/backups/' },
    ]

    const res = applyPlan(plan, { cwd: dir, timestamp: ts })
    assert.ok(res.ok, 'selfcheck: convert should succeed')
    assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')), 'selfcheck: CLAUDE.md created')
    assert.ok(fs.existsSync(journalPath(dir)), 'selfcheck: journal written')
    const gi = fs.readFileSync(giPath, 'utf8')
    assert.ok(gi.includes('curator:begin id=curator-ignores'), 'selfcheck: block inserted')
    assert.ok(gi.includes('.curator/backups/'), 'selfcheck: body inserted')

    // Journal parses and is well-formed.
    const j = JSON.parse(fs.readFileSync(journalPath(dir), 'utf8'))
    assert.strictEqual(j.schema, SCHEMA, 'selfcheck: schema')
    assert.strictEqual(j.actions.length, 2, 'selfcheck: two actions')

    // Round-trip: revert restores byte-identical pre-convert tree.
    const rev = revert({ cwd: dir })
    assert.ok(rev.ok, 'selfcheck: revert should succeed')
    assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')), 'selfcheck: created file removed')
    const giAfter = fs.readFileSync(giPath)
    assert.ok(giBefore.equals(giAfter), 'selfcheck: .gitignore byte-identical after revert')
    assert.ok(!fs.existsSync(path.join(dir, CURATOR_DIR)), 'selfcheck: .curator removed on clean revert')

    process.stdout.write('selfcheck: OK\n')
    return 0
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2)
  if (args.includes('--selfcheck')) {
    return selfcheck()
  }
  const cmd = args[0]
  const cwd = process.cwd()

  if (cmd === 'convert') {
    let ts = null
    const ti = args.indexOf('--timestamp')
    if (ti !== -1) ts = args[ti + 1]
    // Timestamp is caller-supplied; if omitted, stamp ONCE here at CLI entry and
    // pass it down. Core functions never read the clock.
    if (!ts) ts = stampNow()
    if (!validTimestamp(ts)) {
      process.stderr.write(`E_BAD_TIMESTAMP: expected YYYYMMDDTHHMMSSZ, got ${JSON.stringify(ts)}\n`)
      return 2
    }
    const res = applyPlan(demoPlan(), { cwd, timestamp: ts })
    res.report.print('')
    if (res.ok) {
      process.stdout.write(`convert: done. Journal: ${CURATOR_DIR}/${JOURNAL_NAME}, backups: ${CURATOR_DIR}/backups/${ts}/\n`)
      process.stdout.write('Run `node migrate.js revert` to undo.\n')
      return 0
    }
    return 1
  }

  if (cmd === 'revert') {
    const res = revert({ cwd })
    res.report.print('')
    if (res.ok) {
      process.stdout.write('revert: done.\n')
      return 0
    }
    return 1
  }

  process.stderr.write('usage: migrate.js convert [--timestamp <YYYYMMDDTHHMMSSZ>] | revert | --selfcheck\n')
  return 2
}

// Export the internal API for tests; run CLI when invoked directly.
module.exports = {
  applyPlan,
  revert,
  demoPlan,
  // helpers useful to tests:
  sha256,
  detectEol,
  hasTrailingNewline,
  locateBlock,
  beginMarker,
  endMarker,
  journalPath,
  loadJournal,
  CURATOR_DIR,
  JOURNAL_NAME,
  MARKER_VERSION,
}

if (require.main === module) {
  process.exit(main(process.argv))
}
