#!/usr/bin/env node
// Ở Đây Nè — one-off backfill for rooms.district.
//
// Production DB still carries pre-validation dirt:
//   - alias spellings ("Dong Da", "Nam Tu Liem", "q. cau giay", ...) that
//     normalizeDistrict() can resolve to a canonical name; and
//   - city-level strings ("Ha Noi", "Hà Nội") that are NOT districts and
//     must NOT be auto-rewritten — they need human triage.
//
// This script rewrites only the first bucket. City-level and otherwise
// unresolved values are reported and left untouched.
//
// Usage:
//   node backend/scripts/backfill-districts.mjs              # dry-run
//   node backend/scripts/backfill-districts.mjs --apply      # write changes
//   node backend/scripts/backfill-districts.mjs --db PATH    # custom db file
//
// Exits non-zero on argument / IO errors; exits 0 on a clean dry-run even
// when unresolved rows exist (those are surfaced in the report, not failed).
//
// Safety:
//   - Dry-run is the default. --apply is required to mutate.
//   - Wraps writes in a single transaction so partial failure rolls back.
//   - Refuses to run when the column is missing (wrong DB / wrong schema).

import fs from 'node:fs'
import path from 'node:path'
import { normalizeDistrict } from '../src/districts.mjs'

function parseArgs(argv) {
  const out = { apply: false, db: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') out.apply = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (a === '--db') {
      const v = argv[++i]
      if (!v) throw new Error('--db requires a path')
      out.db = v
    } else if (a.startsWith('--db=')) {
      out.db = a.slice('--db='.length)
    } else {
      throw new Error(`unknown argument: ${a}`)
    }
  }
  return out
}

function usage() {
  return [
    'Usage: node backend/scripts/backfill-districts.mjs [--apply] [--db PATH]',
    '',
    '  --apply       Write the updates. Without this flag the script is a dry-run.',
    '  --db PATH     SQLite DB file (default: backend/data/db.sqlite).',
    '',
    'Reports counts by bucket: already-canonical, alias-rewritable, unresolved',
    '(including city-level "Hà Nội" / "Ha Noi" which are deliberately skipped).',
  ].join('\n')
}

const args = (() => {
  try { return parseArgs(process.argv.slice(2)) }
  catch (e) { console.error(`[backfill] ${e.message}`); console.error(usage()); process.exit(2) }
})()

if (args.help) { console.log(usage()); process.exit(0) }

const dbFile = args.db
  ? path.resolve(args.db)
  : path.join(process.cwd(), 'backend', 'data', 'db.sqlite')

if (!fs.existsSync(dbFile)) {
  console.error(`[backfill] db file not found: ${dbFile}`)
  process.exit(1)
}

const Database = (await import('better-sqlite3')).default
const db = new Database(dbFile)

try {
  const cols = db.prepare("PRAGMA table_info('rooms')").all()
  if (!cols.length) throw new Error("table 'rooms' not found — wrong DB?")
  if (!cols.some((c) => c.name === 'district')) {
    throw new Error("column 'rooms.district' not found — wrong schema?")
  }

  const rows = db.prepare('SELECT id, district FROM rooms').all()

  const rewrites = []         // { id, from, to }
  const unresolved = new Map() // raw -> count (kept for the report)
  let alreadyCanonical = 0
  let blank = 0

  for (const r of rows) {
    const raw = r.district == null ? '' : String(r.district)
    if (!raw.trim()) { blank++; continue }
    const canon = normalizeDistrict(raw)
    if (canon == null) {
      unresolved.set(raw, (unresolved.get(raw) || 0) + 1)
      continue
    }
    if (canon === raw) { alreadyCanonical++; continue }
    rewrites.push({ id: r.id, from: raw, to: canon })
  }

  console.log(`[backfill] db:      ${dbFile}`)
  console.log(`[backfill] mode:    ${args.apply ? 'APPLY' : 'dry-run'}`)
  console.log(`[backfill] rooms scanned:     ${rows.length}`)
  console.log(`[backfill] already canonical: ${alreadyCanonical}`)
  console.log(`[backfill] blank/null:        ${blank}`)
  console.log(`[backfill] alias rewrites:    ${rewrites.length}`)
  console.log(`[backfill] unresolved rows:   ${[...unresolved.values()].reduce((a, b) => a + b, 0)}`)

  if (rewrites.length) {
    const byPair = new Map()
    for (const w of rewrites) {
      const key = `${w.from} -> ${w.to}`
      byPair.set(key, (byPair.get(key) || 0) + 1)
    }
    console.log('\n[backfill] rewrite plan (from -> to: rows):')
    for (const [k, v] of [...byPair.entries()].sort()) {
      console.log(`  ${k}: ${v}`)
    }
  }

  if (unresolved.size) {
    console.log('\n[backfill] unresolved values (left untouched — needs human triage):')
    for (const [k, v] of [...unresolved.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${JSON.stringify(k)}: ${v}`)
    }
  }

  if (!args.apply) {
    console.log('\n[backfill] dry-run complete. Re-run with --apply to write changes.')
    process.exit(0)
  }

  if (!rewrites.length) {
    console.log('\n[backfill] nothing to write.')
    process.exit(0)
  }

  const upd = db.prepare('UPDATE rooms SET district = @to WHERE id = @id AND district = @from')
  const tx = db.transaction((items) => {
    let n = 0
    for (const it of items) n += upd.run(it).changes
    return n
  })
  const changed = tx(rewrites)
  console.log(`\n[backfill] applied. rows updated: ${changed} / planned: ${rewrites.length}`)
  if (changed !== rewrites.length) {
    console.error('[backfill] WARNING: some rows changed between scan and update — re-run dry-run to confirm state.')
    process.exit(1)
  }
} catch (err) {
  console.error(`[backfill] ${err?.stack || err?.message || String(err)}`)
  process.exit(1)
} finally {
  db.close()
}
