// Data contract for normalized candidate rental listings.
//
// Every connector under pipeline/sources/ must produce records that match
// this shape. The CLI runner validates each record before writing it to the
// review JSON so a malformed connector fails loudly instead of corrupting
// the review queue.
//
// IMPORTANT: this contract is intentionally a superset of the rooms table
// in backend/src/storage.mjs. The pipeline never touches the SQLite db; a
// human reviewer (or a future approve script) is expected to map approved
// candidates onto room inserts.

export const SOURCES = ['sheet-drive', 'zalo-forward', 'facebook-group']

export const REVIEW_STATUSES = ['review', 'approved', 'rejected', 'duplicate']

export const REQUIRED_FIELDS = [
  'source',
  'sourceId',
  'rawText',
  'duplicateKey',
  'status',
  'confidence',
]

const STRING_FIELDS = ['source', 'sourceId', 'rawText', 'duplicateKey', 'status']

export function emptyCandidate(source, sourceId) {
  return {
    source,
    sourceId: String(sourceId),
    sourceUrl: null,
    rawText: '',
    title: null,
    priceVnd: null,
    areaM2: null,
    district: null,
    address: null,
    phone: null,
    images: [],
    amenities: [],
    postedAt: null,
    confidence: 0,
    status: 'review',
    duplicateKey: '',
    notes: [],
  }
}

export function validateCandidate(c, idx = -1) {
  const where = idx >= 0 ? ` (record #${idx})` : ''
  if (!c || typeof c !== 'object') throw new Error(`candidate is not an object${where}`)
  if (!SOURCES.includes(c.source)) {
    throw new Error(`invalid source "${c.source}"${where}; expected one of ${SOURCES.join(', ')}`)
  }
  if (!REVIEW_STATUSES.includes(c.status)) {
    throw new Error(`invalid status "${c.status}"${where}`)
  }
  for (const f of STRING_FIELDS) {
    if (typeof c[f] !== 'string' || !c[f]) {
      throw new Error(`missing string field "${f}"${where}`)
    }
  }
  if (!Array.isArray(c.images)) throw new Error(`images must be an array${where}`)
  if (!Array.isArray(c.amenities)) throw new Error(`amenities must be an array${where}`)
  if (!Array.isArray(c.notes)) throw new Error(`notes must be an array${where}`)
  if (typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1) {
    throw new Error(`confidence must be a number in [0,1]${where}`)
  }
}
