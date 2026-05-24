// Expand a public Google Drive folder URL into a list of image URLs that
// can be used as `<img src>`.
//
// The sheet's "Ảnh phòng" cell hyperlinks to a folder like
//   https://drive.google.com/drive/folders/<folderId>
// The frontend's room cards render `room.images` as image src directly, so
// the folder URL itself is not usable. The public `embeddedfolderview` HTML
// page lists every file in a folder shared with "anyone with the link", and
// we can scrape its file IDs without credentials or an OAuth dance.
//
// Each extracted file ID is turned into:
//   https://drive.google.com/thumbnail?id=<fileId>&sz=w1200
// — a stable Drive endpoint that returns a JPEG/PNG of the file (Drive
// renders images, PDFs, etc.) and is suitable as an `<img src>`. Browsers
// follow the 302 to lh3.googleusercontent.com transparently.
//
// Dependency-free; uses globalThis.fetch (Node ≥ 18).

const FILE_ID_RE = /[a-zA-Z0-9_-]{15,}/

export function extractFolderId(input) {
  if (!input) return null
  const s = String(input)
  // /drive/folders/<id> and /folderview?id=<id> are the two public forms.
  const m1 = s.match(/\/folders\/([a-zA-Z0-9_-]{15,})/)
  if (m1) return m1[1]
  const m2 = s.match(/[?&]id=([a-zA-Z0-9_-]{15,})/)
  if (m2) return m2[1]
  return null
}

export function isDriveFolderUrl(input) {
  if (!input) return false
  return /drive\.google\.com\/(?:drive\/folders|folderview)/.test(String(input))
}

// Build the public Drive endpoint that returns an image we can embed.
// Thumbnail is preferred over `uc?export=view` because the latter shows an
// interstitial for files above ~25MB; thumbnail always returns binary.
export function thumbnailUrl(fileId, width = 1200) {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`
}

// Scan the embedded folder view HTML for file IDs.
// Drive marks each grid cell with id="entry-<fileId>" and also links to
// /file/d/<fileId>/view. Both forms appear; one is enough but matching both
// improves robustness against minor markup changes.
export function extractFileIdsFromHtml(html, folderIdToSkip = null) {
  if (!html) return []
  const seen = new Set()
  const out = []
  const push = (id) => {
    if (!id || !FILE_ID_RE.test(id)) return
    if (folderIdToSkip && id === folderIdToSkip) return
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
  }
  let m
  const re1 = /entry-([a-zA-Z0-9_-]{15,})/g
  while ((m = re1.exec(html)) !== null) push(m[1])
  const re2 = /\/file\/d\/([a-zA-Z0-9_-]{15,})/g
  while ((m = re2.exec(html)) !== null) push(m[1])
  return out
}

// Fetch a public folder's HTML and return image URLs.
//
// Returns { folderId, fileIds, urls, reason } — never throws. `reason` is
// 'ok' on success, otherwise a short diagnostic ('not-a-folder-url',
// 'http-403', 'no-files', 'fetch-error:<msg>') that callers can stash in
// the mapper's `notes` array.
export async function fetchFolderImageUrls(folderUrl, {
  maxImages = 12,
  width = 1200,
  timeoutMs = 15_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const folderId = extractFolderId(folderUrl)
  if (!folderId) return { folderId: null, fileIds: [], urls: [], reason: 'not-a-folder-url' }

  const embedUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}#grid`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  let html
  try {
    const res = await fetchImpl(embedUrl, { redirect: 'follow', signal: ctrl.signal })
    if (!res.ok) return { folderId, fileIds: [], urls: [], reason: `http-${res.status}` }
    html = await res.text()
  } catch (err) {
    return { folderId, fileIds: [], urls: [], reason: `fetch-error:${err.message || err.name || 'unknown'}` }
  } finally {
    clearTimeout(t)
  }

  const allIds = extractFileIdsFromHtml(html, folderId)
  const fileIds = allIds.slice(0, Math.max(0, maxImages))
  const urls = fileIds.map((id) => thumbnailUrl(id, width))
  return {
    folderId,
    fileIds,
    urls,
    reason: urls.length ? 'ok' : 'no-files',
  }
}
