#!/usr/bin/env node
// pipeline/scripts/import.mjs
//
// CLI entrypoint. Loads the requested connector, runs ingest on a local
// file, dedupes, and emits a review-friendly JSON file under pipeline/out/.
//
// Default is dry-run. To actually write a review file you must pass --out
// explicitly OR use --write (which derives a timestamped filename). The
// pipeline does NOT touch the backend SQLite database — that handoff is a
// separate, deliberate step a human reviewer will trigger later.
//
// Usage:
//   node pipeline/scripts/import.mjs --source sheet-drive --file pipeline/samples/sheet-drive.json
//   node pipeline/scripts/import.mjs --source zalo-forward --file pipeline/samples/zalo-forward.txt --out pipeline/out/zalo.json
//   node pipeline/scripts/import.mjs --source facebook-group --file pipeline/samples/facebook-group.json --write

import fs from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'
import { SOURCES, validateCandidate } from '../lib/contract.mjs'
import { groupByDuplicateKey } from '../lib/dedupe.mjs'

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..')

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1)
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { out[a.slice(2)] = argv[++i] }
      else out[a.slice(2)] = true
    } else out._.push(a)
  }
  return out
}

function printUsage() {
  process.stdout.write(`
o-day-ne pipeline — local ingest CLI

  --source <name>     one of: ${SOURCES.join(', ')}
  --file <path>       input file (CSV/JSON/TXT depending on source)
  --out <path>        write review JSON to this path (also enables write mode)
  --write             write to pipeline/out/<source>-<timestamp>.json
  --dry-run           do not write, only summarize (default when --out/--write absent)
  --limit <n>         cap number of records processed
  --pretty            pretty-print stdout summary
  -h, --help          show this help

Pipeline never writes to the SQLite database. Review JSON files are produced
for a human to inspect before any data is persisted to the app.
`)
}

async function loadConnector(name) {
  if (!SOURCES.includes(name)) {
    throw new Error(`unknown source "${name}"; expected one of ${SOURCES.join(', ')}`)
  }
  const mod = await import(url.pathToFileURL(
    path.join(REPO_ROOT, 'pipeline', 'sources', `${name}.mjs`)
  ).href)
  if (typeof mod.ingest !== 'function') {
    throw new Error(`connector ${name} does not export an ingest() function`)
  }
  return mod
}

function summarize(records) {
  const total = records.length
  const withPrice = records.filter((r) => r.priceVnd != null).length
  const withPhone = records.filter((r) => r.phone).length
  const withImages = records.filter((r) => r.images.length > 0).length
  const withDistrict = records.filter((r) => r.district).length
  const avgConfidence = total
    ? records.reduce((a, r) => a + r.confidence, 0) / total
    : 0
  return {
    total,
    withPrice,
    withPhone,
    withImages,
    withDistrict,
    avgConfidence: Number(avgConfidence.toFixed(3)),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.h) { printUsage(); return }
  if (!args.source || !args.file) {
    process.stderr.write('error: --source and --file are required\n\n')
    printUsage()
    process.exit(2)
  }

  const connector = await loadConnector(args.source)
  const absFile = path.isAbsolute(args.file) ? args.file : path.resolve(process.cwd(), args.file)
  const exists = await fs.stat(absFile).then(() => true).catch(() => false)
  if (!exists) {
    process.stderr.write(`error: input file not found: ${absFile}\n`)
    process.exit(2)
  }

  process.stderr.write(`[pipeline] ingesting ${args.source} from ${path.relative(REPO_ROOT, absFile)}\n`)

  const raw = await connector.ingest({ file: absFile })
  let records = raw
  if (args.limit) records = records.slice(0, Number(args.limit))

  records.forEach((r, i) => validateCandidate(r, i))

  const { unique, duplicates } = groupByDuplicateKey(records)
  const review = [...unique, ...duplicates]

  const summary = summarize(unique)
  process.stderr.write(`[pipeline] parsed=${raw.length} unique=${unique.length} duplicates=${duplicates.length} avgConfidence=${summary.avgConfidence}\n`)

  const writeMode = Boolean(args.out || args.write) && !args['dry-run']
  if (!writeMode) {
    const payload = { mode: 'dry-run', source: args.source, summary, sample: unique.slice(0, 3) }
    process.stdout.write(JSON.stringify(payload, null, args.pretty ? 2 : 0))
    process.stdout.write('\n')
    return
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const defaultOut = path.join(REPO_ROOT, 'pipeline', 'out', `${args.source}-${stamp}.json`)
  const outPath = args.out
    ? (path.isAbsolute(args.out) ? args.out : path.resolve(process.cwd(), args.out))
    : defaultOut
  await fs.mkdir(path.dirname(outPath), { recursive: true })

  const doc = {
    source: args.source,
    ingestedAt: new Date().toISOString(),
    inputFile: path.relative(REPO_ROOT, absFile),
    summary,
    duplicates: duplicates.length,
    records: review,
  }
  await fs.writeFile(outPath, JSON.stringify(doc, null, 2), 'utf8')
  process.stderr.write(`[pipeline] wrote ${path.relative(REPO_ROOT, outPath)}\n`)
}

main().catch((err) => {
  process.stderr.write(`[pipeline] failed: ${err.message}\n`)
  if (process.env.DEBUG) process.stderr.write((err.stack || '') + '\n')
  process.exit(1)
})
