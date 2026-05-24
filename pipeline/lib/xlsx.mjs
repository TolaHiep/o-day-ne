// Minimal XLSX reader that preserves cell hyperlinks.
//
// CSV export of a Google Sheet flattens hyperlink cells to their display
// text, so the Drive URL inside an "Ảnh phòng" cell is lost. XLSX keeps it:
//
//   xl/worksheets/sheet1.xml  → <hyperlink ref="E2" r:id="rId4"/>
//   xl/worksheets/_rels/sheet1.xml.rels → <Relationship Id="rId4" Target="https://drive..."/>
//
// We don't pull in a dep (sheetjs, exceljs, jszip…) — XLSX is a ZIP of XML
// and node:zlib already does raw DEFLATE. The pieces we need (central dir
// walk, shared strings, one worksheet, the rels for that sheet) fit in a
// few hundred lines of plain regex-driven extraction.

import fs from 'node:fs'
import zlib from 'node:zlib'

// ---------- ZIP reader ----------

const EOCD_SIG = 0x06054b50
const CD_SIG = 0x02014b50
const LFH_SIG = 0x04034b50

// Find the End-Of-Central-Directory record. It lives near the end of the
// file but may be followed by up to 65535 bytes of ZIP comment, so we scan
// the last 66KB backwards for the signature.
function findEocd(buf) {
  const maxBack = Math.min(buf.length, 0xffff + 22)
  const start = buf.length - maxBack
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  throw new Error('xlsx: EOCD signature not found — file is not a ZIP')
}

function readCentralDir(buf) {
  const eocd = findEocd(buf)
  const totalEntries = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)

  const entries = []
  let p = cdOffset
  const end = cdOffset + cdSize
  while (p < end && entries.length < totalEntries) {
    if (buf.readUInt32LE(p) !== CD_SIG) {
      throw new Error(`xlsx: bad central-directory signature at offset ${p}`)
    }
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.push({ name, method, compSize, uncompSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readEntryData(buf, entry) {
  let p = entry.localOffset
  if (buf.readUInt32LE(p) !== LFH_SIG) {
    throw new Error(`xlsx: bad local-file-header at offset ${p}`)
  }
  const nameLen = buf.readUInt16LE(p + 26)
  const extraLen = buf.readUInt16LE(p + 28)
  const dataStart = p + 30 + nameLen + extraLen
  const dataEnd = dataStart + entry.compSize
  const raw = buf.subarray(dataStart, dataEnd)
  if (entry.method === 0) return raw
  if (entry.method === 8) return zlib.inflateRawSync(raw)
  throw new Error(`xlsx: unsupported compression method ${entry.method} for ${entry.name}`)
}

export function readZipEntries(filePath) {
  const buf = fs.readFileSync(filePath)
  const entries = readCentralDir(buf)
  const out = new Map()
  for (const e of entries) {
    out.set(e.name, () => readEntryData(buf, e).toString('utf8'))
  }
  return out
}

// ---------- XML helpers ----------

const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
function decodeXml(s) {
  if (s == null) return ''
  return String(s).replace(/&(#?[a-zA-Z0-9]+);/g, (_, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    }
    return XML_ENTITIES[ref] ?? _
  })
}

// Extract text content of every <t> inside the given XML chunk (used for an
// individual <si> element). Rich-string runs have multiple <t> children that
// must be concatenated; plain strings have one. Tags carry namespace
// prefixes in some writers, so we match `<...:t>` too.
function extractTextNodes(chunk) {
  let out = ''
  const re = /<(?:[\w-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?t>/g
  let m
  while ((m = re.exec(chunk)) !== null) out += decodeXml(m[1])
  return out
}

// ---------- shared strings ----------

function parseSharedStrings(xml) {
  if (!xml) return []
  const strings = []
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    strings.push(extractTextNodes(m[1]))
  }
  return strings
}

// ---------- worksheet rels ----------

function parseRels(xml) {
  if (!xml) return {}
  const map = {}
  // Attribute values contain '/' (Type URLs, Target URLs), so we cannot
  // exclude '/' from the attrs span — only the closing '>'. Non-greedy so
  // the optional self-closing '/' before '>' still gets consumed correctly.
  const re = /<Relationship\b([^>]*?)\/?>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1]
    const id = (attrs.match(/\bId="([^"]+)"/) || [])[1]
    const target = (attrs.match(/\bTarget="([^"]+)"/) || [])[1]
    if (id && target) map[id] = decodeXml(target)
  }
  return map
}

// ---------- column ref helpers ----------

function colLettersToIndex(letters) {
  let n = 0
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}

function parseCellRef(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  return { col: colLettersToIndex(m[1]), row: Number(m[2]) - 1 }
}

// ---------- worksheet ----------

function parseSheet(xml, sharedStrings) {
  // Build a sparse 2D matrix keyed by (rowIndex, colIndex).
  const matrix = []
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g
  const cellRe = /<c\b([^>/]*)(?:\/>|>([\s\S]*?)<\/c>)/g
  let mRow
  let maxCol = 0
  while ((mRow = rowRe.exec(xml)) !== null) {
    const rowAttrs = mRow[1]
    const body = mRow[2]
    const rIdx = (() => {
      const m = rowAttrs.match(/\br="(\d+)"/)
      return m ? Number(m[1]) - 1 : null
    })()
    if (rIdx == null) continue
    const row = matrix[rIdx] || (matrix[rIdx] = [])

    let mCell
    cellRe.lastIndex = 0
    while ((mCell = cellRe.exec(body)) !== null) {
      const attrs = mCell[1]
      const inner = mCell[2] ?? ''
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1]
      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || 'n'
      const pos = ref ? parseCellRef(ref) : null
      if (!pos) continue
      if (pos.col > maxCol) maxCol = pos.col

      let value = ''
      if (type === 's') {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
        const idx = v != null ? Number(v) : NaN
        value = Number.isFinite(idx) ? (sharedStrings[idx] ?? '') : ''
      } else if (type === 'inlineStr' || type === 'str') {
        value = extractTextNodes(inner)
      } else if (type === 'b') {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
        value = v === '1' ? 'TRUE' : 'FALSE'
      } else {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
        value = v != null ? decodeXml(v) : ''
      }
      row[pos.col] = value
    }
  }

  return { matrix, maxCol }
}

function parseHyperlinks(xml) {
  // Hyperlinks are in <hyperlinks><hyperlink ref="E2" r:id="rId4"/></hyperlinks>.
  const out = []
  const block = xml.match(/<hyperlinks\b[^>]*>([\s\S]*?)<\/hyperlinks>/)
  if (!block) return out
  const re = /<hyperlink\b([^>]*?)\/?>/g
  let m
  while ((m = re.exec(block[1])) !== null) {
    const attrs = m[1]
    const ref = (attrs.match(/\bref="([^"]+)"/) || [])[1]
    const rid = (attrs.match(/\br:id="([^"]+)"/) || [])[1]
    const display = (attrs.match(/\bdisplay="([^"]+)"/) || [])[1]
    if (ref) out.push({ ref, rid, display: display ? decodeXml(display) : null })
  }
  return out
}

// ---------- workbook ----------

function parseFirstSheetTarget(workbookXml, workbookRels) {
  // First <sheet name="..." r:id="rIdN"/> in workbook.xml. Map rId via
  // workbook.xml.rels to "worksheets/sheet1.xml" (or whatever the writer
  // chose). Caller resolves relative to xl/.
  const m = workbookXml.match(/<sheet\b[^>]*\br:id="([^"]+)"/)
  if (!m) return null
  return workbookRels[m[1]] || null
}

// ---------- public API ----------

export function readXlsxSheet(filePath, { gid = null } = {}) {
  const entries = readZipEntries(filePath)
  const get = (name) => entries.get(name)?.()

  const workbookXml = get('xl/workbook.xml') || ''
  const workbookRels = parseRels(get('xl/_rels/workbook.xml.rels') || '')
  const sharedStrings = parseSharedStrings(get('xl/sharedStrings.xml') || '')

  // Pick worksheet. gid in Google Sheets maps to the sheet's writer index;
  // since this script always exports a single gid we just take the first
  // sheet referenced from workbook.xml.
  void gid
  let sheetRel = parseFirstSheetTarget(workbookXml, workbookRels)
  if (!sheetRel) {
    // Fallback: scan entries for the first worksheets/sheet*.xml.
    for (const name of entries.keys()) {
      if (name.startsWith('xl/worksheets/sheet') && name.endsWith('.xml')) {
        sheetRel = name.replace(/^xl\//, '')
        break
      }
    }
  }
  if (!sheetRel) throw new Error('xlsx: no worksheet found in workbook')

  const sheetPath = sheetRel.startsWith('xl/') ? sheetRel : `xl/${sheetRel}`
  const sheetXml = get(sheetPath)
  if (!sheetXml) throw new Error(`xlsx: worksheet entry not found: ${sheetPath}`)

  // Per-worksheet rels file lives in xl/worksheets/_rels/<file>.rels.
  const sheetFile = sheetPath.split('/').pop()
  const sheetRelsPath = `xl/worksheets/_rels/${sheetFile}.rels`
  const sheetRels = parseRels(get(sheetRelsPath) || '')

  const { matrix, maxCol } = parseSheet(sheetXml, sharedStrings)
  const hyperlinks = parseHyperlinks(sheetXml)

  // Index hyperlinks by cell ref so the caller can pair them with cell text.
  const hyperlinkByRef = {}
  for (const h of hyperlinks) {
    const url = h.rid ? sheetRels[h.rid] : null
    if (url) hyperlinkByRef[h.ref] = url
  }

  // Convert sparse matrix to dense rows (preserve original order).
  const rows = []
  for (let r = 0; r < matrix.length; r++) {
    const src = matrix[r] || []
    const cells = []
    for (let c = 0; c <= maxCol; c++) cells.push(src[c] ?? '')
    rows.push({ rowIndex: r, cells })
  }

  // Pair hyperlinks back onto rows keyed by column index for caller convenience.
  for (const [ref, url] of Object.entries(hyperlinkByRef)) {
    const pos = parseCellRef(ref)
    if (!pos) continue
    const row = rows[pos.row]
    if (!row) continue
    row.hyperlinks = row.hyperlinks || {}
    row.hyperlinks[pos.col] = url
  }

  return { rows, hyperlinkByRef }
}

// Convenience: read first sheet as objects keyed by header row.
export function readXlsxAsObjects(filePath, opts = {}) {
  const { rows, hyperlinkByRef } = readXlsxSheet(filePath, opts)
  if (rows.length === 0) return { headers: [], records: [], hyperlinkByRef }
  const headerCells = rows[0].cells.map((c) => String(c || '').trim())
  const records = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const obj = {}
    let hasAny = false
    for (let c = 0; c < headerCells.length; c++) {
      const key = headerCells[c] || `col_${c}`
      const v = row.cells[c] ?? ''
      obj[key] = v
      if (String(v).trim() !== '') hasAny = true
    }
    obj.__rowNumber = row.rowIndex + 1
    obj.__hyperlinks = row.hyperlinks || {}
    if (hasAny) records.push(obj)
  }
  return { headers: headerCells, records, hyperlinkByRef }
}
