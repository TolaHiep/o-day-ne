// Dedupe key generation for review candidates.
//
// The goal is to collapse multiple posts of the same listing (the same room
// reposted on Zalo, then on Facebook, then on a Google Sheet) into a single
// entry that a reviewer can act on once. We don't need cryptographic
// collision resistance here — a short SHA-256 prefix is plenty.

import crypto from 'node:crypto'

// Light normalization: lowercase + strip diacritics + collapse whitespace.
// We don't go full slug-style (no aggressive punctuation stripping) because
// for short titles every signal matters.
export function normalizeText(s) {
  if (!s) return ''
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizePhone(p) {
  if (!p) return ''
  return String(p).replace(/\D/g, '')
}

// Stable key: phone is the strongest signal (one landlord usually = one
// number, and the main thing we want to catch is the same landlord
// re-posting). To still distinguish a landlord who actually has multiple
// listings, we bucket by phone + price-band + area-band — close-enough
// numbers collapse, genuinely different listings stay separate.
//
// When phone is missing we fall back to a hash of the normalized address
// + title + first 200 chars of raw text.
export function buildDuplicateKey({ phone, address, title, rawText, priceVnd, areaM2 }) {
  const phoneNorm = normalizePhone(phone)
  if (phoneNorm) {
    const priceBand = priceVnd ? Math.round(priceVnd / 500_000) : 'np'
    const areaBand = areaM2 ? Math.round(areaM2 / 5) : 'na'
    return `phone:${phoneNorm}:p${priceBand}:a${areaBand}`
  }
  const blob = [
    normalizeText(address || ''),
    normalizeText(title || ''),
    normalizeText((rawText || '').slice(0, 200)),
  ].join('|')
  return `text:${shortHash(blob)}`
}

export function shortHash(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12)
}

// Group already-built candidates by duplicateKey. Returns { unique, groups }
// where `unique` is the first occurrence of each key and `groups` lists all
// records sharing the same key (so a reviewer can see the duplicates).
export function groupByDuplicateKey(records) {
  const groups = new Map()
  for (const r of records) {
    const key = r.duplicateKey
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const unique = []
  const duplicates = []
  for (const [, items] of groups) {
    unique.push(items[0])
    for (const dup of items.slice(1)) {
      duplicates.push({ ...dup, status: 'duplicate', notes: [...dup.notes, `dup-of:${items[0].sourceId}`] })
    }
  }
  return { unique, duplicates, groups }
}
