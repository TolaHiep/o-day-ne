// Minimal RFC 4180-ish CSV parser. Handles quoted fields, escaped quotes
// ("" → "), and CRLF or LF line endings. Returns an array of row objects
// keyed by the header line.
//
// We don't add `csv-parse` as a dep — every Google Sheet export we care
// about here fits this subset, and the parser is ~40 lines.

export function parseCsv(text) {
  const rows = parseCsvRows(text)
  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim())
  const out = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (r.length === 1 && r[0] === '') continue
    const obj = {}
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = r[c] ?? ''
    out.push(obj)
  }
  return out
}

function parseCsvRows(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else { inQuotes = false }
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        row.push(field); field = ''
      } else if (ch === '\n') {
        row.push(field); field = ''
        rows.push(row); row = []
      } else if (ch === '\r') {
        // swallow — handled by following \n, or treat lone \r as line break
        if (text[i + 1] !== '\n') {
          row.push(field); field = ''
          rows.push(row); row = []
        }
      } else {
        field += ch
      }
    }
  }
  // flush last field/row if file didn't end with newline
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
