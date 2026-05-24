#!/usr/bin/env node
// pipeline/scripts/sync-sheet-to-db.mjs
//
// Download a Google Sheet as XLSX, filter rows where Tình trạng == "Còn
// trống", and either print a dry-run summary or upsert the rows into
// backend/data/db.sqlite as rooms.
//
// CSV export of a Google Sheet flattens hyperlinked cells to display text,
// which loses the Drive URL embedded in the "Ảnh phòng" column. XLSX keeps
// the URL in xl/worksheets/_rels/sheet1.xml.rels, which the local xlsx
// reader (pipeline/lib/xlsx.mjs) extracts without external deps.
//
// Usage:
//   node pipeline/scripts/sync-sheet-to-db.mjs --sheet-url <url> \
//     --status active \
//     --download pipeline/out/sheet-live.xlsx
//
//   # Actually upsert into backend/data/db.sqlite:
//   node pipeline/scripts/sync-sheet-to-db.mjs --sheet-url <url> --write
//
// Default is safe dry-run. Repeated runs are idempotent thanks to
// pipeline_source_map keyed by gsheet:<id>:<gid>:<row>.

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { readXlsxAsObjects } from '../lib/xlsx.mjs'
import { mapSheetRow } from '../lib/sheet-row-mapper.mjs'
import { fetchFolderImageUrls, isDriveFolderUrl } from '../lib/drive-folder.mjs'

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..')

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1)
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i]
      else out[a.slice(2)] = true
    } else out._.push(a)
  }
  return out
}

function printUsage() {
  process.stdout.write(`
o-day-ne — sync live Google Sheet to backend/data/db.sqlite

  --sheet-url <url>     Google Sheets URL (any /d/<id>/edit form is OK)
  --sheet-id <id>       alternative to --sheet-url
  --gid <n>             worksheet gid (default 0)
  --download <path>     where to save the .xlsx (default pipeline/out/sheet-live.xlsx)
  --xlsx <path>         skip download; parse this existing .xlsx file
  --status <active|all> filter rows — "active" keeps only Tình trạng = "Còn trống" (default)
  --limit <n>           cap rows processed
  --write               actually upsert rooms into the sqlite database
  --dry-run             force dry-run (default when --write absent)
  --json                emit a machine-readable JSON report (always to stdout)
  -h, --help            show this help
`)
}

function extractSpreadsheetId(input) {
  if (!input) return null
  const m = String(input).match(/[/]d[/]([a-zA-Z0-9_-]{20,})/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) return input
  return null
}

function extractGid(input, fallback = 0) {
  if (input == null) return fallback
  const s = String(input)
  if (/^\d+$/.test(s)) return Number(s)
  const m = s.match(/[#?&]gid=(\d+)/)
  return m ? Number(m[1]) : fallback
}

async function downloadXlsx(spreadsheetId, gid, dest) {
  const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx&gid=${gid}`
  process.stderr.write(`[sync-sheet] downloading ${exportUrl}\n`)
  const res = await fetch(exportUrl, { redirect: 'follow' })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`)
  const ct = res.headers.get('content-type') || ''
  // Google returns text/html for permission errors; ContentType for a real
  // export is application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.
  if (!/officedocument|octet-stream|zip/i.test(ct)) {
    throw new Error(`download returned content-type "${ct}" — is the sheet shared with "anyone with the link"?`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.writeFile(dest, buf)
  process.stderr.write(`[sync-sheet] wrote ${path.relative(REPO_ROOT, dest)} (${buf.length} bytes)\n`)
  return dest
}

function summarize(mappedAvailable, mappedSkipped) {
  const districts = {}
  let withPrice = 0
  let withImage = 0
  for (const m of mappedAvailable) {
    if (m.room.priceVnd > 0) withPrice++
    if (m.room.images.length > 0) withImage++
    districts[m.room.district] = (districts[m.room.district] || 0) + 1
  }
  return {
    total: mappedAvailable.length + mappedSkipped.length,
    available: mappedAvailable.length,
    skipped: mappedSkipped.length,
    withPrice,
    withImage,
    districts,
  }
}

async function importToDb(records, sourceName, sourceUrlForAudit) {
  // Load backend storage lazily so dry-runs don't spin up the SQLite database
  // (it eagerly seeds demo rooms on first open).
  const storage = await import('../../backend/src/storage.mjs')
  const { rooms, pipelineSourceMap, audit, newId, transaction } = storage

  const now = Date.now()
  const result = { inserted: 0, updated: 0, skipped: 0, roomIds: [] }

  // storage.transaction wraps + invokes immediately; do not re-call.
  transaction(() => {
    for (const m of records) {
      const existingRoomId = pipelineSourceMap.findRoomId(m.sourceKey)
      if (existingRoomId && rooms.findById(existingRoomId)) {
        rooms.update(existingRoomId, m.room, now)
        result.updated++
        result.roomIds.push(existingRoomId)
      } else {
        const roomId = newId('room-sheet')
        rooms.insert({
          ...m.room,
          id: roomId,
          createdAt: now,
          updatedAt: now,
          availableAt: m.room.availableAt ?? now,
        })
        pipelineSourceMap.upsert({
          sourceKey: m.sourceKey,
          roomId,
          source: sourceName,
          sourceId: String(m.rowNumber),
          now,
        })
        result.inserted++
        result.roomIds.push(roomId)
      }
    }
  })

  audit.push('pipeline.sheet.sync', {
    source: sourceName,
    sourceUrl: sourceUrlForAudit,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    rowCount: records.length,
  })

  return result
}

// Resolve every row's "Ảnh phòng" Drive folder link into thumbnail URLs and
// attach them to the record (read by sheet-row-mapper). Folders are cached
// by ID so duplicate links across rows hit the network once. Concurrency is
// capped to avoid Drive rate-limiting.
async function resolveImageFoldersInPlace(records, imageColIndex, { concurrency = 4 } = {}) {
  if (imageColIndex < 0) return
  const cache = new Map() // folderUrl → { urls, reason }
  const work = []
  for (const rec of records) {
    const url = (rec.__hyperlinks || {})[imageColIndex]
    if (!url || !isDriveFolderUrl(url)) continue
    if (!cache.has(url)) cache.set(url, null) // placeholder; filled below
    work.push({ rec, url })
  }
  const uniqueUrls = [...cache.keys()]
  process.stderr.write(`[sync-sheet] resolving ${uniqueUrls.length} Drive folder(s)...\n`)

  // Simple promise pool. Each task fills the cache entry for one URL.
  let cursor = 0
  async function worker() {
    while (cursor < uniqueUrls.length) {
      const i = cursor++
      const url = uniqueUrls[i]
      const result = await fetchFolderImageUrls(url)
      cache.set(url, result)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueUrls.length) }, worker))

  let folderOk = 0
  for (const url of uniqueUrls) {
    const r = cache.get(url)
    if (r && r.urls.length) folderOk++
  }
  for (const { rec, url } of work) {
    const result = cache.get(url)
    if (result && result.urls.length) {
      rec.__resolvedImages = result.urls
    } else {
      rec.__resolvedImages = []
    }
    rec.__resolvedImagesReason = result ? result.reason : 'unresolved'
  }
  process.stderr.write(`[sync-sheet] resolved ${folderOk}/${uniqueUrls.length} folder(s) to image URLs (${work.length} row(s) linked)\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.h) { printUsage(); return }

  const spreadsheetId = extractSpreadsheetId(args['sheet-id'] || args['sheet-url'])
  if (!spreadsheetId && !args.xlsx) {
    process.stderr.write('error: --sheet-url, --sheet-id, or --xlsx is required\n\n')
    printUsage()
    process.exit(2)
  }
  const gid = extractGid(args.gid ?? args['sheet-url'], 0)
  const statusFilter = (args.status || 'active').toLowerCase()
  const writeMode = Boolean(args.write) && !args['dry-run']
  const wantJson = Boolean(args.json)

  let xlsxPath = args.xlsx
  if (!xlsxPath) {
    const dest = args.download
      ? (path.isAbsolute(args.download) ? args.download : path.resolve(process.cwd(), args.download))
      : path.join(REPO_ROOT, 'pipeline', 'out', 'sheet-live.xlsx')
    await downloadXlsx(spreadsheetId, gid, dest)
    xlsxPath = dest
  } else if (!path.isAbsolute(xlsxPath)) {
    xlsxPath = path.resolve(process.cwd(), xlsxPath)
  }
  if (!fsSync.existsSync(xlsxPath)) throw new Error(`xlsx not found: ${xlsxPath}`)

  const { headers, records } = readXlsxAsObjects(xlsxPath)
  process.stderr.write(`[sync-sheet] parsed ${records.length} rows, headers=${headers.filter(Boolean).length}\n`)

  // Locate the "Ảnh phòng" column for hyperlink lookup.
  const imageColIndex = headers.findIndex((h) => /ảnh\s*phòng/i.test(String(h || '')))
  if (imageColIndex < 0) {
    process.stderr.write('[sync-sheet] WARN: could not find "Ảnh phòng" column — image URLs will be empty\n')
  }

  const sourceUrlForAudit = args['sheet-url']
    || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}`

  const ctx = { spreadsheetId, gid, imageColIndex, sourceUrl: sourceUrlForAudit }

  // When --limit is set we honor it before resolving folders so we don't
  // hammer Drive for rows the caller is going to drop anyway.
  const recordsToProcess = args.limit ? records.slice(0, Number(args.limit)) : records

  await resolveImageFoldersInPlace(recordsToProcess, imageColIndex)

  const mapped = []
  for (const rec of recordsToProcess) mapped.push(mapSheetRow(rec, ctx))

  const available = mapped.filter((m) => m.isAvailable)
  const skipped = mapped.filter((m) => !m.isAvailable)
  const toImport = statusFilter === 'all' ? mapped : available

  const summary = summarize(toImport, statusFilter === 'all' ? [] : skipped)

  let importResult = null
  if (writeMode) {
    importResult = await importToDb(toImport, 'sheet-live', sourceUrlForAudit)
  }

  const report = {
    mode: writeMode ? 'write' : 'dry-run',
    sourceUrl: sourceUrlForAudit,
    spreadsheetId,
    gid,
    statusFilter,
    summary,
    importResult,
    sample: toImport.slice(0, 3).map((m) => ({
      sourceKey: m.sourceKey,
      title: m.room.title,
      priceVnd: m.room.priceVnd,
      district: m.room.district,
      images: m.room.images,
      notes: m.notes,
    })),
  }

  if (wantJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    process.stderr.write(`[sync-sheet] mode=${report.mode} available=${summary.available} skipped=${summary.skipped} withPrice=${summary.withPrice} withImage=${summary.withImage}\n`)
    process.stderr.write(`[sync-sheet] districts: ${JSON.stringify(summary.districts)}\n`)
    if (importResult) {
      process.stderr.write(`[sync-sheet] inserted=${importResult.inserted} updated=${importResult.updated}\n`)
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  }
}

main().catch((err) => {
  process.stderr.write(`[sync-sheet] failed: ${err.message}\n`)
  if (process.env.DEBUG) process.stderr.write((err.stack || '') + '\n')
  process.exit(1)
})
