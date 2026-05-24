// Connector: Facebook group rental posts.
//
// Facebook's Graph API does not expose third-party group post reading for
// groups the app doesn't own. The intended operator workflow today is:
//   1. Owner exports a group's posts via Meta Graph API (only works for
//      groups they admin and where the app is installed), OR
//   2. Posts are manually pasted into a JSON file with at least { id, text,
//      url?, ts?, images?[] }.
//
// We deliberately do NOT scrape facebook.com. Browser automation against FB
// is fragile, almost always against the platform's ToS, and frequently
// triggers account locks. Real ingestion will need the owner's consent and
// either Graph API (for owned groups) or a legitimate partner integration.
//
// Local input: a .json file containing an array of post objects.

import fs from 'node:fs/promises'
import path from 'node:path'
import { emptyCandidate } from '../lib/contract.mjs'
import { parseListingText } from '../lib/normalize.mjs'
import { buildDuplicateKey } from '../lib/dedupe.mjs'

async function readLocal(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext !== '.json') {
    throw new Error(`facebook-group: only .json input is supported (got ${ext})`)
  }
  const buf = await fs.readFile(filePath, 'utf8')
  const parsed = JSON.parse(buf)
  if (!Array.isArray(parsed)) throw new Error('facebook-group JSON must be an array of post objects')
  return parsed
}

function tsToEpochMs(t) {
  if (!t) return null
  const n = Number(t)
  if (Number.isFinite(n) && n > 1_000_000_000) return n > 1e12 ? n : n * 1000
  const d = Date.parse(t)
  return Number.isFinite(d) ? d : null
}

export async function ingest({ file }) {
  const posts = await readLocal(file)
  const out = []
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i]
    const id = p.id || p.post_id || `post-${i + 1}`
    const text = p.text || p.message || p.body || ''
    if (!text || text.length < 10) continue

    // Merge image URLs that came alongside the post (FB Graph returns
    // attachments separately) into the same text the parser sees, so the
    // image extractor still picks them up.
    const inlineImages = Array.isArray(p.images) ? p.images.filter(Boolean) : []
    const rawText = inlineImages.length
      ? text + '\n' + inlineImages.join('\n')
      : text

    const parsed = parseListingText(rawText)
    const candidate = {
      ...emptyCandidate('facebook-group', id),
      sourceUrl: p.url || p.permalink || null,
      rawText,
      title: parsed.title,
      priceVnd: parsed.priceVnd,
      areaM2: parsed.areaM2,
      district: parsed.district,
      address: parsed.address,
      phone: parsed.phone,
      images: [...new Set([...inlineImages, ...parsed.images])],
      amenities: parsed.amenities,
      postedAt: tsToEpochMs(p.ts || p.created_time || p.timestamp),
      confidence: parsed.confidence,
      notes: [
        ...parsed.notes,
        p.author ? `author:${p.author}` : null,
        p.group ? `group:${p.group}` : null,
      ].filter(Boolean),
    }
    candidate.duplicateKey = buildDuplicateKey(candidate)
    out.push(candidate)
  }
  return out
}

export const meta = {
  name: 'facebook-group',
  description: 'Facebook group rental posts (Graph API export or manually pasted JSON)',
  liveModeNote:
    'Use Meta Graph API only for groups where the operator is admin and has installed an app with the required permissions. DO NOT browser-scrape Facebook — it violates Meta ToS, breaks weekly, and gets accounts banned. For groups you do not own, the realistic path is asking the group admin to share an export.',
}
