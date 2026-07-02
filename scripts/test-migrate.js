#!/usr/bin/env node
// Tests for scripts/migrate.js — the data-safe migration engine (Appendix B).
// Node built-ins only. Fake project dirs via fs.mkdtempSync, cleaned up at end.
// Highest priority: the data-loss cases (§5 decisions, §7 edge-case matrix).

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const migrate = require('./migrate.js')

// ---------------------------------------------------------------------------
// Tiny assert harness (mirrors test-postinstall.js style)
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0
const failures = []

function assert(label, condition, detail) {
  if (condition) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    const msg = detail ? `${label} — ${detail}` : label
    failures.push(msg)
    console.log(`  FAIL  ${msg}`)
  }
}

function assertEqual(label, actual, expected) {
  const ok = actual === expected
  assert(label, ok, ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const dirs = []

function test(name, fn) {
  console.log(`\n[${name}]`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-migrate-'))
  dirs.push(dir)
  try {
    fn(dir)
  } catch (e) {
    failed++
    failures.push(`${name} — threw: ${e.message}`)
    console.log(`  FAIL  threw: ${e.message}\n${e.stack}`)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TS = '20260630T101500Z'
const TS2 = '20260630T120000Z'

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}
function readBuf(p) {
  return fs.readFileSync(p)
}
function write(dir, rel, data) {
  const p = path.join(dir, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, data)
  return p
}
// Snapshot every regular file under dir (excluding .curator) as rel -> sha.
function snapshotTree(dir) {
  const out = {}
  function walk(cur) {
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, e.name)
      const rel = path.relative(dir, abs).split(path.sep).join('/')
      if (rel === '.curator' || rel.startsWith('.curator/')) continue
      if (e.isDirectory()) walk(abs)
      else if (e.isFile()) out[rel] = sha(readBuf(abs))
    }
  }
  walk(dir)
  return out
}
function treesEqual(a, b) {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  if (ka.join('|') !== kb.join('|')) return false
  return ka.every(k => a[k] === b[k])
}

function convertPlan(plan, dir, ts) {
  return migrate.applyPlan(plan, { cwd: dir, timestamp: ts || TS })
}
function revert(dir) {
  return migrate.revert({ cwd: dir })
}
function codes(report) {
  return report.notes.map(n => n.code)
}

// A realistic plan: two creates + one append-block on an existing .gitignore.
function standardPlan() {
  return [
    { kind: 'create', path: '.protocol.md', content: 'curator_mode: auto\nadoption: convert\n' },
    { kind: 'create', path: 'DESIGN.md', content: '# Design\n' },
    { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: '.curator/backups/' },
  ]
}

// ---------------------------------------------------------------------------
// 1. Happy path: convert creates files + append-blocks; revert restores exactly.
// ---------------------------------------------------------------------------

test('1. Happy path convert + revert byte-identical', dir => {
  write(dir, '.gitignore', 'node_modules/\n')
  const before = snapshotTree(dir)

  const res = convertPlan(standardPlan(), dir)
  assert('convert ok', res.ok, codes(res.report).join(','))

  assert('.protocol.md created', fs.existsSync(path.join(dir, '.protocol.md')))
  assert('DESIGN.md created', fs.existsSync(path.join(dir, 'DESIGN.md')))
  assert('journal written', fs.existsSync(migrate.journalPath(dir)))

  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')
  assert('gitignore has begin marker', gi.includes('curator:begin id=curator-ignores'))
  assert('gitignore has end marker', gi.includes('curator:end id=curator-ignores'))
  assert('gitignore preserved original line', gi.startsWith('node_modules/\n'))
  assert('gitignore body inserted', gi.includes('.curator/backups/'))

  // Backup exists for the append-block target.
  const backup = path.join(dir, '.curator', 'backups', TS, '.gitignore')
  assert('backup written for .gitignore', fs.existsSync(backup))
  assert('backup byte-identical to pre-edit', readBuf(backup).equals(Buffer.from('node_modules/\n')))

  const rev = revert(dir)
  assert('revert ok', rev.ok, codes(rev.report).join(','))
  const after = snapshotTree(dir)
  assert('tree byte-identical after revert', treesEqual(before, after),
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
  assert('.curator removed on clean revert', !fs.existsSync(path.join(dir, '.curator')))
})

// ---------------------------------------------------------------------------
// 2. Divergence: user edits inside markers / markers removed → restore backup.
// ---------------------------------------------------------------------------

test('2a. Edited inside markers → revert restores verbatim backup', dir => {
  write(dir, '.gitignore', 'node_modules/\n')
  const preConvert = readBuf(path.join(dir, '.gitignore'))
  convertPlan([
    { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: '.curator/backups/' },
  ], dir)

  // User edits INSIDE the managed block.
  const p = path.join(dir, '.gitignore')
  let txt = fs.readFileSync(p, 'utf8')
  txt = txt.replace('.curator/backups/', '.curator/backups/\nMY_OWN_EDIT/')
  fs.writeFileSync(p, txt)

  const rev = revert(dir)
  // Diverged → restore backup (never strip by guess). No E_ error since backup present.
  assert('no E_ error (backup restored)', !rev.report.notes.some(n => n.code.startsWith('E_')), codes(rev.report).join(','))
  assert('restored to pre-convert bytes', readBuf(p).equals(preConvert))
  assert('user edit is gone (backup won)', !fs.readFileSync(p, 'utf8').includes('MY_OWN_EDIT'))
})

test('2b. Markers removed but journal says append-block → restore backup', dir => {
  write(dir, '.gitignore', 'keep-me/\n')
  const preConvert = readBuf(path.join(dir, '.gitignore'))
  convertPlan([
    { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: '.curator/backups/' },
  ], dir)

  // User deletes the markers (but leaves some altered content) → diverged.
  fs.writeFileSync(path.join(dir, '.gitignore'), 'keep-me/\nsomething-else/\n')

  const rev = revert(dir)
  assert('no E_ error', !rev.report.notes.some(n => n.code.startsWith('E_')), codes(rev.report).join(','))
  assert('restored verbatim backup', readBuf(path.join(dir, '.gitignore')).equals(preConvert))
})

// ---------------------------------------------------------------------------
// 3. create diverged → revert keeps user-modified file (W_CREATE_DIVERGED).
// ---------------------------------------------------------------------------

test('3. create diverged → revert keeps file (W_CREATE_DIVERGED)', dir => {
  convertPlan([{ kind: 'create', path: 'CLAUDE.md', content: '# Curator\n' }], dir)
  // User rewrites the created file.
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My own content now\n')

  const rev = revert(dir)
  assert('CLAUDE.md kept (not deleted)', fs.existsSync(path.join(dir, 'CLAUDE.md')))
  assertEqual('content is user content', fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), '# My own content now\n')
  assert('W_CREATE_DIVERGED emitted', codes(rev.report).includes('W_CREATE_DIVERGED'))
  assert('.curator kept for inspection', fs.existsSync(path.join(dir, '.curator')))
})

// ---------------------------------------------------------------------------
// 4. Refusals: symlink, non-UTF-8, no journal, diverged + no backup.
// ---------------------------------------------------------------------------

// Probe symlink creatability (may need Developer Mode on Windows).
function symlinksOk() {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-symprobe-'))
  try {
    fs.writeFileSync(path.join(probe, 'target.txt'), 'x')
    fs.symlinkSync(path.join(probe, 'target.txt'), path.join(probe, 'link.txt'))
    const ok = fs.lstatSync(path.join(probe, 'link.txt')).isSymbolicLink()
    return ok
  } catch {
    return false
  } finally {
    try { fs.rmSync(probe, { recursive: true, force: true }) } catch {}
  }
}

test('4a. Symlink target refused (E_SYMLINK_REFUSED)', dir => {
  if (!symlinksOk()) {
    console.log('  SKIP  symlink tests (symlinks require elevated permissions on this system)')
    return
  }
  write(dir, 'real.md', 'real content\n')
  fs.symlinkSync(path.join(dir, 'real.md'), path.join(dir, '.gitignore'))
  const realBefore = readBuf(path.join(dir, 'real.md'))

  const res = convertPlan([
    { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: 'x' },
  ], dir)
  assert('E_SYMLINK_REFUSED emitted', codes(res.report).includes('E_SYMLINK_REFUSED'))
  assert('convert not ok', !res.ok)
  assert('real file untouched through link', readBuf(path.join(dir, 'real.md')).equals(realBefore))
})

test('4b. Non-UTF-8 target refused (E_NOT_UTF8)', dir => {
  // 0xFF 0xFE is not valid UTF-8.
  write(dir, '.gitignore', Buffer.from([0xff, 0xfe, 0x00, 0x41]))
  const before = readBuf(path.join(dir, '.gitignore'))

  const res = convertPlan([
    { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: 'x' },
  ], dir)
  assert('E_NOT_UTF8 emitted', codes(res.report).includes('E_NOT_UTF8'))
  assert('file untouched', readBuf(path.join(dir, '.gitignore')).equals(before))
})

test('4c. No journal → revert changes nothing (E_NO_JOURNAL)', dir => {
  write(dir, 'file.txt', 'unrelated\n')
  const before = snapshotTree(dir)
  const rev = revert(dir)
  assert('E_NO_JOURNAL emitted', codes(rev.report).includes('E_NO_JOURNAL'))
  assert('nothing changed', treesEqual(before, snapshotTree(dir)))
})

test('4d. Diverged + no backup → E_BACKUP_MISSING, change nothing', dir => {
  write(dir, '.gitignore', 'orig/\n')
  convertPlan([
    { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: '.curator/backups/' },
  ], dir)
  // Delete the backup (simulate fresh clone: backups gitignored/absent).
  fs.rmSync(path.join(dir, '.curator', 'backups'), { recursive: true, force: true })
  // Diverge the file so a clean strip is impossible.
  const diverged = 'orig/\nHAND_EDITED/\n<!-- curator:begin id=curator-ignores v=1 -->\n.curator/backups/\n<!-- curator:end id=curator-ignores -->\n'
  fs.writeFileSync(path.join(dir, '.gitignore'), diverged)
  const before = readBuf(path.join(dir, '.gitignore'))

  const rev = revert(dir)
  assert('E_BACKUP_MISSING emitted', codes(rev.report).includes('E_BACKUP_MISSING'))
  assert('file unchanged (nothing guessed)', readBuf(path.join(dir, '.gitignore')).equals(before))
})

// ---------------------------------------------------------------------------
// 5. Idempotency: convert×2 → one journal/one block; revert×2 → no double-strip.
// ---------------------------------------------------------------------------

test('5a. convert×2 → one journal, one block, byte-stable fixpoint', dir => {
  write(dir, '.gitignore', 'node_modules/\n')
  convertPlan(standardPlan(), dir)
  const afterFirst = snapshotTree(dir)
  const journalAfterFirst = fs.readFileSync(migrate.journalPath(dir), 'utf8')

  // Second convert on unchanged tree (re-migration).
  const res2 = convertPlan(standardPlan(), dir, TS2)
  assert('second convert ok', res2.ok, codes(res2.report).join(','))

  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')
  const beginCount = (gi.match(/curator:begin id=curator-ignores/g) || []).length
  assertEqual('exactly one managed block', beginCount, 1)

  const afterSecond = snapshotTree(dir)
  assert('tree byte-stable across convert×2', treesEqual(afterFirst, afterSecond))

  const j = JSON.parse(fs.readFileSync(migrate.journalPath(dir), 'utf8'))
  const appendActions = j.actions.filter(a => a.type === 'append-block' && a.blockId === 'curator-ignores')
  assertEqual('one append-block action for key', appendActions.length, 1)
})

test('5b. revert×2 → fully idempotent, no double-strip', dir => {
  write(dir, '.gitignore', 'node_modules/\n')
  const before = snapshotTree(dir)
  convertPlan(standardPlan(), dir)

  const rev1 = revert(dir)
  assert('first revert ok', rev1.ok, codes(rev1.report).join(','))
  assert('tree restored', treesEqual(before, snapshotTree(dir)))

  // Second revert: journal already removed on clean revert → E_NO_JOURNAL, no-op.
  const rev2 = revert(dir)
  assert('second revert changes nothing', treesEqual(before, snapshotTree(dir)))
  assert('second revert reports E_NO_JOURNAL (journal gone)', codes(rev2.report).includes('E_NO_JOURNAL'))
})

// ---------------------------------------------------------------------------
// 6. Preservation: CRLF and no-trailing-newline round-trip byte-identical.
// ---------------------------------------------------------------------------

test('6a. CRLF file round-trips byte-identical', dir => {
  write(dir, '.gitignore', Buffer.from('node_modules/\r\ndist/\r\n'))
  const before = readBuf(path.join(dir, '.gitignore'))

  const res = convertPlan([
    { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: '.curator/backups/' },
  ], dir)
  assert('convert ok', res.ok, codes(res.report).join(','))
  const gi = readBuf(path.join(dir, '.gitignore')).toString('latin1')
  assert('inserted region uses CRLF', gi.includes('curator:begin id=curator-ignores v=1 -->\r\n'))
  assert('no lone LF introduced in block', !/[^\r]\n/.test(gi.replace(/\r\n/g, '')))

  const rev = revert(dir)
  assert('revert ok', rev.ok, codes(rev.report).join(','))
  assert('CRLF file byte-identical after revert', readBuf(path.join(dir, '.gitignore')).equals(before))
})

test('6b. No-trailing-newline file round-trips byte-identical', dir => {
  // Note: NO trailing newline.
  write(dir, '.gitignore', Buffer.from('node_modules/'))
  const before = readBuf(path.join(dir, '.gitignore'))
  assert('precondition: no trailing newline', before[before.length - 1] !== 0x0a)

  const res = convertPlan([
    { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: '.curator/backups/' },
  ], dir)
  assert('convert ok', res.ok, codes(res.report).join(','))

  const j = JSON.parse(fs.readFileSync(migrate.journalPath(dir), 'utf8'))
  const a = j.actions.find(x => x.type === 'append-block')
  assertEqual('trailingNewline recorded false', a.trailingNewline, false)

  const rev = revert(dir)
  assert('revert ok', rev.ok, codes(rev.report).join(','))
  assert('no-trailing file byte-identical after revert', readBuf(path.join(dir, '.gitignore')).equals(before))
})

// ---------------------------------------------------------------------------
// 7. Interrupted convert: journal absent but edits + backups present → rerun
//    reconciles; no torn JSON. (§7 row 5)
// ---------------------------------------------------------------------------

test('7. Interrupted convert (journal absent) → rerun reconciles', dir => {
  write(dir, '.gitignore', 'node_modules/\n')
  const preConvert = readBuf(path.join(dir, '.gitignore'))

  // First convert produces edits + backups + journal.
  convertPlan(standardPlan(), dir)

  // Simulate a kill AFTER edits+backups but BEFORE journal commit: delete journal
  // (backups and fenced edits remain on disk). migration.json is now absent.
  fs.rmSync(migrate.journalPath(dir), { force: true })
  assert('journal absent (interrupted)', !fs.existsSync(migrate.journalPath(dir)))

  // Rerun convert: fresh plan. Because the journal is gone, the append-block is
  // treated as fresh; the collision scan must catch the orphaned fence and refuse
  // that action (E_MARKER_COLLISION) rather than double-inserting.
  const res = convertPlan(standardPlan(), dir, TS2)
  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')
  const beginCount = (gi.match(/curator:begin id=curator-ignores/g) || []).length
  assertEqual('no double-insert of block', beginCount, 1)
  assert('collision reported for orphan fence', codes(res.report).includes('E_MARKER_COLLISION'))

  // Reconciliation refused every action safely (creates already exist but are
  // not journal-owned → W_CREATE_DIVERGED; append-block → E_MARKER_COLLISION),
  // so no new journal is written. If a journal IS present it must parse (never
  // torn) — the atomic temp+rename guarantees migration.json is never half-written.
  const journalPresent = fs.existsSync(migrate.journalPath(dir))
  assert('no torn JSON (journal absent, or parses cleanly)', (() => {
    if (!journalPresent) return true
    try { JSON.parse(fs.readFileSync(migrate.journalPath(dir), 'utf8')); return true } catch { return false }
  })())
  assert('creates recognized as diverged, not overwritten', codes(res.report).includes('W_CREATE_DIVERGED'))

  // Recovery path a user would take: manually strip the orphan fence to restore
  // from backup, or accept the collision. Here we assert the safety property:
  // the pre-convert content is still recoverable from the retained backup.
  const backup = path.join(dir, '.curator', 'backups', TS, '.gitignore')
  assert('original recoverable from retained backup', fs.existsSync(backup) && readBuf(backup).equals(preConvert))
})

// ---------------------------------------------------------------------------
// 8. Extra: append-block onto a NON-existent target becomes a create (no backup).
// ---------------------------------------------------------------------------

test('8. append-block on absent file → create (no backup), revert deletes', dir => {
  const before = snapshotTree(dir)
  const res = convertPlan([
    { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: '.curator/backups/' },
  ], dir)
  assert('convert ok', res.ok, codes(res.report).join(','))
  assert('.gitignore created', fs.existsSync(path.join(dir, '.gitignore')))

  const j = JSON.parse(fs.readFileSync(migrate.journalPath(dir), 'utf8'))
  const a = j.actions[0]
  assertEqual('recorded as create', a.type, 'create')
  assertEqual('no backup for create', a.backup, null)

  const rev = revert(dir)
  assert('revert ok', rev.ok, codes(rev.report).join(','))
  assert('tree restored (created file removed)', treesEqual(before, snapshotTree(dir)))
})

// ---------------------------------------------------------------------------
// 9. Marker collision on a FOREIGN (un-journaled) marker → E_MARKER_COLLISION.
// ---------------------------------------------------------------------------

test('9. Foreign marker in file → collision refused, file untouched', dir => {
  // A doc that legitimately contains the literal marker string (un-journaled).
  const content = 'intro\n<!-- curator:begin id=curator-ignores v=1 -->\nnot ours\n<!-- curator:end id=curator-ignores -->\nend\n'
  write(dir, '.gitignore', content)
  const before = readBuf(path.join(dir, '.gitignore'))

  const res = convertPlan([
    { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: '.curator/backups/' },
  ], dir)
  assert('E_MARKER_COLLISION emitted', codes(res.report).includes('E_MARKER_COLLISION'))
  assert('file untouched', readBuf(path.join(dir, '.gitignore')).equals(before))
})

// ---------------------------------------------------------------------------
// 10. Strip-verification fallback (§5.2.1): whole-file sha matches after, but a
//     hostile/edited fence means strip can't reproduce sha_before → restore backup.
// ---------------------------------------------------------------------------

test('10. Strip verify fails → falls back to verbatim backup (§5.2.1)', dir => {
  write(dir, '.gitignore', 'node_modules/\n')
  const preConvert = readBuf(path.join(dir, '.gitignore'))
  convertPlan([
    { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: '.curator/backups/' },
  ], dir)

  // Tamper with the JOURNAL so sha256_before is wrong (points at bytes the strip
  // can never reproduce), while sha256_after still matches the on-disk file.
  const jp = migrate.journalPath(dir)
  const j = JSON.parse(fs.readFileSync(jp, 'utf8'))
  const a = j.actions.find(x => x.type === 'append-block')
  a.sha256_before = crypto.createHash('sha256').update('never-matches').digest('hex')
  // Backup on disk is still the true pre-convert bytes, but its sha won't match
  // the tampered sha256_before either → restoreBackup rejects it as corrupt →
  // E_BACKUP_MISSING, change nothing (never emit a guessed result).
  fs.writeFileSync(jp, JSON.stringify(j, null, 2))
  const onDiskBefore = readBuf(path.join(dir, '.gitignore'))

  const rev = revert(dir)
  assert('strip did not run to a guessed result', codes(rev.report).includes('E_BACKUP_MISSING'))
  assert('file unchanged (no guessed strip)', readBuf(path.join(dir, '.gitignore')).equals(onDiskBefore))
  // Sanity: the real pre-convert bytes are still safely on disk in the backup.
  const backup = path.join(dir, '.curator', 'backups', TS, '.gitignore')
  assert('true backup still holds pre-convert bytes', readBuf(backup).equals(preConvert))
})

// ---------------------------------------------------------------------------
// 11. CLI smoke: `convert` then `revert` via the real process entry point.
// ---------------------------------------------------------------------------

test('11. CLI convert + revert round-trip (real process)', dir => {
  const { spawnSync } = require('child_process')
  const script = path.join(__dirname, 'migrate.js')
  write(dir, '.gitignore', 'node_modules/\n')
  const before = snapshotTree(dir)

  const c = spawnSync(process.execPath, [script, 'convert', '--timestamp', TS], { cwd: dir, encoding: 'utf8' })
  assertEqual('convert exit 0', c.status, 0)
  assert('journal exists after CLI convert', fs.existsSync(migrate.journalPath(dir)))

  const r = spawnSync(process.execPath, [script, 'revert'], { cwd: dir, encoding: 'utf8' })
  assertEqual('revert exit 0', r.status, 0)
  assert('tree restored via CLI', treesEqual(before, snapshotTree(dir)),
    `before=${JSON.stringify(before)} after=${JSON.stringify(snapshotTree(dir))}`)
})

// ---------------------------------------------------------------------------
// 12. Clean revert must NOT recursively delete a pre-existing .curator/ with
//     unowned user data. Only Curator's own journal + this run's backup subtree
//     may be removed; unrelated files survive. (Finding 1)
// ---------------------------------------------------------------------------

test('12. Pre-existing .curator contents survive a clean revert', dir => {
  // Drop UNOWNED files under .curator BEFORE adoption.
  write(dir, '.curator/notes.txt', 'my private notes\n')
  write(dir, '.curator/backups/other/x', 'someone-elses-backup\n')
  write(dir, '.gitignore', 'node_modules/\n')

  const notesAbs = path.join(dir, '.curator', 'notes.txt')
  const otherAbs = path.join(dir, '.curator', 'backups', 'other', 'x')
  const notesBefore = readBuf(notesAbs)
  const otherBefore = readBuf(otherAbs)

  const res = convertPlan(standardPlan(), dir)
  assert('convert ok', res.ok, codes(res.report).join(','))
  // This run's backup subtree exists.
  assert("this run's backup subtree exists", fs.existsSync(path.join(dir, '.curator', 'backups', TS)))

  const rev = revert(dir)
  assert('revert ok', rev.ok, codes(rev.report).join(','))

  // Unowned files must still exist, byte-identical.
  assert('unowned .curator/notes.txt survived', fs.existsSync(notesAbs))
  assert('notes.txt byte-identical', fs.existsSync(notesAbs) && readBuf(notesAbs).equals(notesBefore))
  assert('unowned .curator/backups/other/x survived', fs.existsSync(otherAbs))
  assert('other backup byte-identical', fs.existsSync(otherAbs) && readBuf(otherAbs).equals(otherBefore))

  // Curator-owned artifacts must be gone: the journal and THIS run's backup subtree.
  assert('journal removed', !fs.existsSync(migrate.journalPath(dir)))
  assert("this run's backup subtree removed", !fs.existsSync(path.join(dir, '.curator', 'backups', TS)))

  // .curator/ and .curator/backups/ themselves must remain (not empty).
  assert('.curator/ retained (has unowned data)', fs.existsSync(path.join(dir, '.curator')))
})

// ---------------------------------------------------------------------------
// 13. A managed path replaced by a DIRECTORY before revert must not crash the
//     whole revert. The bad action changes nothing + emits a note; other actions
//     still revert; .curator/ is retained. (Finding 2)
// ---------------------------------------------------------------------------

test('13. Managed create replaced by a directory → no crash, others revert', dir => {
  write(dir, '.gitignore', 'node_modules/\n')
  const giBefore = readBuf(path.join(dir, '.gitignore'))
  const res = convertPlan(standardPlan(), dir)
  assert('convert ok', res.ok, codes(res.report).join(','))

  // Replace the Curator-created DESIGN.md file with a DIRECTORY.
  const design = path.join(dir, 'DESIGN.md')
  fs.rmSync(design, { force: true })
  fs.mkdirSync(design)
  fs.writeFileSync(path.join(design, 'inside.txt'), 'user put a dir here\n')

  let rev
  let threw = false
  try {
    rev = revert(dir)
  } catch (e) {
    threw = true
  }
  assert('revert did not throw', !threw)

  // The diverged create was left alone (still a directory), with a note.
  assert('DESIGN.md still a directory (left alone)', fs.existsSync(design) && fs.statSync(design).isDirectory())
  assert('W_CREATE_DIVERGED emitted for directory create', codes(rev.report).includes('W_CREATE_DIVERGED'))

  // OTHER actions still reverted: .protocol.md removed, .gitignore restored.
  assert('other created file (.protocol.md) removed', !fs.existsSync(path.join(dir, '.protocol.md')))
  assert('.gitignore restored to pre-convert bytes', readBuf(path.join(dir, '.gitignore')).equals(giBefore))

  // Non-clean run → .curator/ retained for inspection.
  assert('.curator retained after non-clean revert', fs.existsSync(path.join(dir, '.curator')))
})

test('13b. Append-block target replaced by a directory → E_ change-nothing, no crash', dir => {
  write(dir, '.gitignore', 'node_modules/\n')
  convertPlan([
    { kind: 'create', path: 'DESIGN.md', content: '# Design\n' },
    { kind: 'append-block', path: '.gitignore', blockId: 'curator-ignores', body: '.curator/backups/' },
  ], dir)

  // Replace the append-block target (.gitignore) with a DIRECTORY.
  fs.rmSync(path.join(dir, '.gitignore'), { force: true })
  fs.mkdirSync(path.join(dir, '.gitignore'))

  let rev
  let threw = false
  try {
    rev = revert(dir)
  } catch (e) {
    threw = true
  }
  assert('revert did not throw', !threw)
  assert('E_BACKUP_MISSING emitted for directory append-target', codes(rev.report).includes('E_BACKUP_MISSING'))
  assert('.gitignore still a directory (changed nothing)', fs.statSync(path.join(dir, '.gitignore')).isDirectory())

  // The OTHER action (create DESIGN.md) still reverted.
  assert('other created file (DESIGN.md) removed', !fs.existsSync(path.join(dir, 'DESIGN.md')))
  assert('.curator retained after non-clean revert', fs.existsSync(path.join(dir, '.curator')))
})

// ---------------------------------------------------------------------------
// Cleanup + summary
// ---------------------------------------------------------------------------

for (const dir of dirs) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

const total = passed + failed
console.log(`\n${passed}/${total} passed`)
if (failures.length) {
  console.log('\nFailed:')
  for (const f of failures) console.log(`  - ${f}`)
}
process.exit(failed ? 1 : 0)
