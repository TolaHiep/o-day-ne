// Connector: forwarded messages from Zalo groups.
//
// Zalo doesn't expose a public API for group chats. The realistic operator
// workflow is:
//   1. Long-press a message in the Zalo group → "Forward" to a designated
//      collector account or "Save to cloud" → export.
//   2. Periodically dump the collector chat into a text or JSON file.
//   3. Run this connector against that file.
//
// Two local input shapes are supported:
//   * .txt — messages separated by a blank line OR a marker line that
//     starts with "----" / "===" / "---". Each block is treated as one post.
//   * .json — an array of { id?, author?, text, ts? } records.
//
// We treat every block as opaque raw text and rely on lib/normalize.mjs to
// pull structured fields out of it.

import fs from 'node:fs/promises'
import path from 'node:path'
import { emptyCandidate } from '../lib/contract.mjs'
import { parseListingText } from '../lib/normalize.mjs'
import { buildDuplicateKey } from '../lib/dedupe.mjs'

function splitMessageBlocks(text) {
  // Normalize line endings, then split on blank lines or separator lines.
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let buf = []
  const flush = () => {
    const joined = buf.join('\n').trim()
    if (joined) blocks.push(joined)
    buf = []
  }
  for (const line of lines) {
    if (line.trim() === '' || /^[-=*]{3,}$/.test(line.trim())) flush()
    else buf.push(line)
  }
  flush()
  return blocks
}

async function readLocal(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const buf = await fs.readFile(filePath, 'utf8')
  if (ext === '.json') {
    const parsed = JSON.parse(buf)
    if (!Array.isArray(parsed)) throw new Error('zalo-forward JSON must be an array of message objects')
    return parsed.map((m, i) => ({
      id: m.id || m.messageId || `msg-${i + 1}`,
      author: m.author || m.from || null,
      text: m.text || m.body || m.content || '',
      ts: m.ts || m.timestamp || m.sent_at || null,
    }))
  }
  if (ext === '.txt' || ext === '.md') {
    return splitMessageBlocks(buf).map((text, i) => ({
      id: `block-${i + 1}`,
      author: null,
      text,
      ts: null,
    }))
  }
  throw new Error(`zalo-forward: unsupported file extension "${ext}" (use .txt or .json)`)
}

function tsToEpochMs(t) {
  if (!t) return null
  const n = Number(t)
  if (Number.isFinite(n) && n > 1_000_000_000) return n > 1e12 ? n : n * 1000
  const d = Date.parse(t)
  return Number.isFinite(d) ? d : null
}

export async function ingest({ file }) {
  const messages = await readLocal(file)
  const out = []
  for (const msg of messages) {
    if (!msg.text || msg.text.length < 10) continue
    const parsed = parseListingText(msg.text)
    const candidate = {
      ...emptyCandidate('zalo-forward', msg.id),
      sourceUrl: null,
      rawText: msg.text,
      title: parsed.title,
      priceVnd: parsed.priceVnd,
      areaM2: parsed.areaM2,
      district: parsed.district,
      address: parsed.address,
      phone: parsed.phone,
      images: parsed.images,
      amenities: parsed.amenities,
      postedAt: tsToEpochMs(msg.ts),
      confidence: parsed.confidence,
      notes: [...parsed.notes, msg.author ? `author:${msg.author}` : null].filter(Boolean),
    }
    candidate.duplicateKey = buildDuplicateKey(candidate)
    out.push(candidate)
  }
  return out
}

export const meta = {
  name: 'zalo-forward',
  description: 'Forwarded/exported Zalo group chat messages (offline export)',
  liveModeNote:
    'Zalo has no first-party group-chat API for third parties. Production options: (a) operator forwards messages to a collector account and we poll its export, (b) an authorised on-device companion app sends messages to a webhook. Do not scrape Zalo Web — it violates ToS and the session cookies break weekly.',
}
