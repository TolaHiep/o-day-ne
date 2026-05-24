// Image cleanup helpers used when a room is permanently deleted. Each image
// stored in room.images may be one of:
//   - /uploads/<hex>.<ext>  → a file in the local uploadDir
//   - https://res.cloudinary.com/<our-cloud>/image/upload/...  → our Cloudinary
//   - any other https://... → external link we don't own; leave it alone
//
// Cleanup never throws to the caller — every per-image failure is captured as
// a `{ ok: false, error }` entry. Deleting a room must not depend on whether
// an external storage call succeeded.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const UPLOAD_PATH_RE = /^\/uploads\/([a-f0-9]{8,64}\.(?:jpg|png|webp|gif|avif))$/i

// Cloudinary delivery URL shape:
//   https://res.cloudinary.com/<cloud>/image/upload/[<tx>/][v<ver>/]<public_id>.<ext>
// where <tx> is one or more comma-separated `name_value` transformation atoms
// (e.g. `c_fill,h_300,w_400` or `f_auto/q_auto`) and the version segment looks
// like `v1700000000`. The public_id is everything left after stripping those
// leading segments, minus the trailing extension on the final filename.
export function parseCloudinaryPublicId(url, cloudName) {
  if (!url || typeof url !== 'string' || !cloudName) return null
  const escaped = cloudName.replace(/[.\\^$*+?()[\]{}|]/g, '\\$&')
  const re = new RegExp(`^https://res\\.cloudinary\\.com/${escaped}/image/upload/(.+)$`, 'i')
  const m = url.match(re)
  if (!m) return null
  let rest = m[1].split('?')[0].split('#')[0]
  if (!rest) return null
  const parts = rest.split('/')
  while (parts.length > 1) {
    const head = parts[0]
    if (/^v\d{4,}$/.test(head)) { parts.shift(); continue }
    if (isCloudinaryTransformSegment(head)) { parts.shift(); continue }
    break
  }
  const full = parts.join('/')
  if (!full) return null
  const lastSlash = full.lastIndexOf('/')
  const lastDot = full.lastIndexOf('.')
  if (lastDot > lastSlash) return full.slice(0, lastDot)
  return full
}

function isCloudinaryTransformSegment(seg) {
  if (!seg) return false
  // A transformation segment is a comma-separated list where every atom is a
  // short letter prefix + underscore + value, e.g. `w_500`, `c_fill,h_300`.
  const atoms = seg.split(',')
  return atoms.every((a) => /^[a-z]{1,3}_[^/]+$/i.test(a))
}

export async function cloudinaryDestroy({ publicId, cloudName, apiKey, apiSecret, fetchImpl = fetch }) {
  if (!publicId || !cloudName || !apiKey || !apiSecret) {
    throw new Error('cloudinary-destroy-missing-config')
  }
  // Cloudinary signing: alphabetical name=value joined by &, then secret
  // appended (NOT separated). https://cloudinary.com/documentation/signatures
  const timestamp = Math.floor(Date.now() / 1000)
  const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}`
  const signature = crypto.createHash('sha1').update(paramsToSign + apiSecret).digest('hex')
  const res = await fetchImpl(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      public_id: publicId,
      timestamp: String(timestamp),
      api_key: apiKey,
      signature,
    }),
  })
  if (!res || typeof res.ok !== 'boolean') throw new Error('cloudinary-destroy-bad-response')
  if (!res.ok) throw new Error(`cloudinary-destroy-http-${res.status}`)
  let data = null
  try { data = await res.json() } catch { /* tolerate odd payload */ }
  // `not found` is fine — asset was already gone, our row is the source of truth.
  if (data && (data.result === 'ok' || data.result === 'not found')) return data
  throw new Error(`cloudinary-destroy-result-${data?.result || 'unknown'}`)
}

export async function deleteLocalUpload(urlPath, uploadDir) {
  const m = String(urlPath || '').match(UPLOAD_PATH_RE)
  if (!m) throw new Error('not-a-local-upload')
  const filename = m[1]
  // Resolve and confirm the target sits inside uploadDir. The regex already
  // forbids slashes inside the filename, but resolve-then-prefix-check is the
  // canonical defence against ../ traversal and absolute-path injection.
  const resolvedDir = path.resolve(uploadDir)
  const resolvedTarget = path.resolve(path.join(resolvedDir, filename))
  if (resolvedTarget !== resolvedDir && !resolvedTarget.startsWith(resolvedDir + path.sep)) {
    throw new Error('path-traversal')
  }
  try {
    await fs.promises.unlink(resolvedTarget)
  } catch (err) {
    // Already gone? Treat as success — the goal state (file absent) is reached.
    if (err && err.code === 'ENOENT') return
    throw err
  }
}

export async function cleanupImage(url, ctx) {
  const u = String(url || '')
  if (!u) return { url: u, kind: 'unknown', ok: false, error: 'empty-url' }
  if (UPLOAD_PATH_RE.test(u)) {
    try { await deleteLocalUpload(u, ctx.uploadDir); return { url: u, kind: 'local', ok: true } }
    catch (err) { return { url: u, kind: 'local', ok: false, error: String(err?.message || err) } }
  }
  if (ctx.cloudinaryEnabled && ctx.cloudName) {
    const publicId = parseCloudinaryPublicId(u, ctx.cloudName)
    if (publicId) {
      try {
        await cloudinaryDestroy({
          publicId,
          cloudName: ctx.cloudName,
          apiKey: ctx.apiKey,
          apiSecret: ctx.apiSecret,
          fetchImpl: ctx.fetchImpl,
        })
        return { url: u, kind: 'cloudinary', publicId, ok: true }
      } catch (err) {
        return { url: u, kind: 'cloudinary', publicId, ok: false, error: String(err?.message || err) }
      }
    }
  }
  // External or unrecognised URL — we don't own the storage, so leaving it is
  // the correct behaviour. Marked skipped so callers can tell apart from a
  // genuine success.
  return { url: u, kind: 'external', ok: true, skipped: true }
}

export async function cleanupRoomImages(images, ctx) {
  const list = Array.isArray(images) ? images : []
  const results = []
  for (const u of list) {
    // Sequential keeps the load on Cloudinary modest (a single delete fan-out
    // is fine; we don't need to parallelise dozens of destroys per room).
    results.push(await cleanupImage(u, ctx))
  }
  const failed = results.filter((r) => !r.ok)
  return { results, failed }
}
