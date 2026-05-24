// Connector: Google Sheet rows + Google Drive image links.
//
// Local mode (today): reads a CSV or JSON export of the sheet.
//   - CSV: any column order; the connector tries known column names first
//     and falls back to a free-text description column when most fields are
//     blank.
//   - JSON: an array of row objects with the same column-name conventions.
//
// Live mode (later): swap `readLocal` for a Google Sheets API caller that
// returns the same row shape. Drive URLs in any column are rewritten to
// stable view URLs by the shared parser (see lib/normalize.mjs).
//
// Expected (case-insensitive) column names — all optional:
//   title | tieu_de
//   price | gia | giá
//   area  | dien_tich | diện tích | m2
//   district | quan | quận
//   address  | dia_chi | địa chỉ
//   phone    | sdt | số điện thoại
//   images   | anh | ảnh | drive | drive_links     (comma or newline separated)
//   amenities | tien_ich | tiện ích
//   description | mo_ta | mô tả | rawText | content
//   posted_at | ngay_dang | created_at              (ISO 8601 or epoch ms)
//   url | source_url

import fs from 'node:fs/promises'
import path from 'node:path'
import { emptyCandidate } from '../lib/contract.mjs'
import { parseListingText } from '../lib/normalize.mjs'
import { buildDuplicateKey } from '../lib/dedupe.mjs'
import { parseCsv } from '../lib/csv.mjs'

const COL = {
  title: ['title', 'tieu_de', 'tiêu đề'],
  price: ['price', 'gia', 'giá', 'price_vnd'],
  area: ['area', 'dien_tich', 'diện tích', 'm2', 'area_m2'],
  district: ['district', 'quan', 'quận'],
  address: ['address', 'dia_chi', 'địa chỉ'],
  phone: ['phone', 'sdt', 'số điện thoại'],
  images: ['images', 'anh', 'ảnh', 'drive', 'drive_links', 'drive_url'],
  amenities: ['amenities', 'tien_ich', 'tiện ích'],
  description: ['description', 'mo_ta', 'mô tả', 'rawtext', 'content', 'note'],
  posted_at: ['posted_at', 'ngay_dang', 'ngày đăng', 'created_at', 'date'],
  url: ['url', 'source_url', 'sheet_url'],
}

function pick(row, keys) {
  const lowered = {}
  for (const k of Object.keys(row)) lowered[k.toLowerCase().trim()] = row[k]
  for (const k of keys) {
    const v = lowered[k.toLowerCase()]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v)
  }
  return null
}

function toEpochMs(s) {
  if (!s) return null
  const n = Number(s)
  if (Number.isFinite(n) && n > 1_000_000_000) return n > 1e12 ? n : n * 1000
  const d = Date.parse(s)
  return Number.isFinite(d) ? d : null
}

function parsePriceCell(cell) {
  if (!cell) return null
  const digits = String(cell).replace(/[^\d]/g, '')
  if (!digits) return null
  const n = Number(digits)
  // If the cell looks like millions (e.g. 4.5 → 4500000 isn't possible — we
  // assume sheet writers use plain VND when filling a price column).
  if (n >= 500_000 && n <= 100_000_000) return n
  return null
}

function splitMulti(s) {
  if (!s) return []
  return String(s)
    .split(/[\n,;|]+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

async function readLocal(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const buf = await fs.readFile(filePath, 'utf8')
  if (ext === '.json') {
    const parsed = JSON.parse(buf)
    if (!Array.isArray(parsed)) throw new Error('sheet-drive JSON must be an array of row objects')
    return parsed
  }
  if (ext === '.csv' || ext === '.tsv' || ext === '.txt') return parseCsv(buf)
  throw new Error(`sheet-drive: unsupported file extension "${ext}" (use .csv or .json)`)
}

export async function ingest({ file }) {
  const rows = await readLocal(file)
  const out = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const desc = pick(row, COL.description) || ''
    const sheetPhone = pick(row, COL.phone)
    const sheetTitle = pick(row, COL.title)
    const sheetAddress = pick(row, COL.address)
    const sheetDistrict = pick(row, COL.district)
    const sheetImages = splitMulti(pick(row, COL.images))
    const sheetAmenities = splitMulti(pick(row, COL.amenities))
    const sheetPrice = parsePriceCell(pick(row, COL.price))
    const sheetArea = (() => {
      const v = pick(row, COL.area)
      if (!v) return null
      const n = Number(String(v).replace(/[^\d]/g, ''))
      return Number.isFinite(n) && n > 0 ? n : null
    })()

    // Build a synthetic raw text combining structured cells + description so
    // the text parser can rescue fields the operator left blank. We also
    // feed the amenities cell into the raw text so its words get mapped
    // to canonical amenity keys instead of being kept verbatim.
    const rawText = [
      sheetTitle,
      sheetAddress,
      sheetDistrict,
      sheetPrice ? `${sheetPrice}đ` : null,
      sheetArea ? `${sheetArea}m2` : null,
      sheetPhone,
      sheetImages.join('\n'),
      sheetAmenities.join(', '),
      desc,
    ].filter(Boolean).join('\n')

    const parsed = parseListingText(rawText)

    const candidate = {
      ...emptyCandidate('sheet-drive', row.id || row.row_id || `row-${i + 1}`),
      sourceUrl: pick(row, COL.url),
      rawText,
      title: sheetTitle || parsed.title,
      priceVnd: sheetPrice ?? parsed.priceVnd,
      areaM2: sheetArea ?? parsed.areaM2,
      district: sheetDistrict || parsed.district,
      address: sheetAddress || parsed.address,
      phone: sheetPhone || parsed.phone,
      images: parsed.images,
      amenities: parsed.amenities,
      postedAt: toEpochMs(pick(row, COL.posted_at)),
      confidence: parsed.confidence,
      notes: parsed.notes,
    }
    candidate.duplicateKey = buildDuplicateKey(candidate)
    out.push(candidate)
  }
  return out
}

export const meta = {
  name: 'sheet-drive',
  description: 'Google Sheets export (CSV/JSON) with Drive image links',
  liveModeNote:
    'Wire later via Sheets API v4 + Drive API. Service account read scope is enough. Replace readLocal() with a Sheets values.get() call returning the same row[] shape.',
}
