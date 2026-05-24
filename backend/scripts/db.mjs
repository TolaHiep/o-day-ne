#!/usr/bin/env node
// Ở Đây Nè — DB ops CLI.
//
//   node backend/scripts/db.mjs backup         → snapshot into backend/data/backups/
//   node backend/scripts/db.mjs list           → list existing backups
//   node backend/scripts/db.mjs restore <file> → replace live DB with a backup
//   node backend/scripts/db.mjs vacuum         → VACUUM + ANALYZE (offline)
//
// Designed to run with the API stopped (especially for restore/vacuum). The
// `backup` subcommand is online-safe because it uses SQLite's online backup
// API via better-sqlite3 — the live server can keep serving while it copies.
//
// Conventions:
//   - Honors ODN_DATA_DIR / BACKUP_KEEP / API_PORT (probe for running server)
//   - Exits non-zero on any failure → suitable for cron / systemd timer wrappers
//   - Never deletes user data implicitly; restore always takes a safety
//     snapshot first so a mis-restore is recoverable.

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

const dataDir = process.env.ODN_DATA_DIR
  ? path.resolve(process.env.ODN_DATA_DIR)
  : path.join(process.cwd(), 'backend', 'data')
const backupDir = path.join(dataDir, 'backups')
const dbFile = path.join(dataDir, 'db.sqlite')

const [, , cmd, ...rest] = process.argv

function die(msg, code = 1) { console.error(`[db] ${msg}`); process.exit(code) }
function ok(msg) { console.log(`[db] ${msg}`) }

async function probeApi() {
  const port = Number(process.env.API_PORT || 8788)
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 700 },
      (res) => { res.resume(); resolve(res.statusCode === 200) })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

async function withDb(open) {
  const Database = (await import('better-sqlite3')).default
  return new Database(dbFile, open || {})
}

async function cmdBackup() {
  // Re-uses snapshotBackup() so retention rules stay in one place.
  const { snapshotBackup } = await import('../src/storage.mjs')
  const r = await snapshotBackup()
  if (!r.ok) die(`backup failed: ${r.error || r.reason}`)
  ok(`backup written: ${r.file} (kept ${r.kept} on disk)`)
}

function cmdList() {
  if (!fs.existsSync(backupDir)) die(`no backup directory at ${backupDir}`, 0)
  const entries = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith('db-') && f.endsWith('.sqlite'))
    .sort()
    .map((f) => {
      const p = path.join(backupDir, f)
      const st = fs.statSync(p)
      return { file: f, size: st.size, mtime: st.mtime.toISOString() }
    })
  if (!entries.length) { ok('no backups yet — run `npm run db:backup`'); return }
  const widest = Math.max(...entries.map((e) => e.file.length))
  for (const e of entries) {
    const kb = (e.size / 1024).toFixed(1).padStart(7)
    console.log(`${e.file.padEnd(widest)}  ${kb} KB  ${e.mtime}`)
  }
}

async function cmdRestore(src) {
  if (!src) die('usage: db restore <backup-file>')
  const srcPath = path.isAbsolute(src) ? src : path.resolve(src)
  if (!fs.existsSync(srcPath)) die(`backup file not found: ${srcPath}`)
  if (await probeApi()) {
    die('API is running on $API_PORT — stop it first (`docker compose down` or kill the api process).')
  }
  // Safety snapshot of the current DB before we clobber it.
  if (fs.existsSync(dbFile)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const safety = path.join(backupDir, `db-pre-restore-${stamp}.sqlite`)
    fs.mkdirSync(backupDir, { recursive: true })
    fs.copyFileSync(dbFile, safety)
    ok(`pre-restore safety snapshot: ${safety}`)
    // Drop WAL/SHM so SQLite doesn't replay stale journal onto the new file.
    for (const ext of ['-wal', '-shm']) {
      const f = dbFile + ext
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
  }
  fs.copyFileSync(srcPath, dbFile)
  ok(`restored ${srcPath} → ${dbFile}`)
  ok('start the API and verify before discarding the safety snapshot.')
}

async function cmdVacuum() {
  if (await probeApi()) {
    die('API is running — vacuum needs exclusive DB access. Stop the API first.')
  }
  const db = await withDb()
  try {
    db.pragma('journal_mode = WAL')
    db.exec('VACUUM')
    db.exec('ANALYZE')
    const size = fs.statSync(dbFile).size
    ok(`VACUUM + ANALYZE done. Current db.sqlite size: ${(size / 1024).toFixed(1)} KB`)
  } finally { db.close() }
}

const dispatch = {
  backup: cmdBackup,
  list: cmdList,
  restore: () => cmdRestore(rest[0]),
  vacuum: cmdVacuum,
  help: () => console.log(usage()),
}

function usage() {
  return [
    'Usage: node backend/scripts/db.mjs <command> [args]',
    '',
    'Commands:',
    '  backup           Take an online snapshot into backend/data/backups/',
    '  list             Show backup files with size + mtime',
    '  restore <file>   Replace live DB with a backup (API must be stopped)',
    '  vacuum           VACUUM + ANALYZE the live DB (API must be stopped)',
    '',
    'Env: ODN_DATA_DIR (default ./backend/data), API_PORT (default 8788).',
  ].join('\n')
}

if (!cmd || !(cmd in dispatch)) { console.log(usage()); process.exit(cmd ? 1 : 0) }
try { await dispatch[cmd]() } catch (err) { die(err?.stack || err?.message || String(err)) }
