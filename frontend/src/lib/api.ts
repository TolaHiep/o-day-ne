import type {
  Room, ContributedPhoto, Review, Report, User, AuthProviders, RoomFilters, AdminStats, Feedback,
} from '../types'

const TOKEN_KEY = 'odn.session.token'

function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
function writeToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* ignore */ }
}

export const authToken = { get: readToken, set: writeToken }

class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body: unknown) {
    super(message); this.status = status; this.body = body
  }
}
export { ApiError }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {})
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'application/json')
  const t = readToken()
  if (t) headers.set('Authorization', `Bearer ${t}`)

  const res = await fetch(path, { ...init, headers })
  const text = await res.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>))
      ? String((body as Record<string, unknown>).error)
      : `Lỗi ${res.status}`
    throw new ApiError(res.status, msg, body)
  }
  return body as T
}

// ---------- auth ----------
export const apiAuth = {
  async session(): Promise<{ ok: boolean; user: User | null }> {
    return request('/api/auth/session')
  },
  async providers(): Promise<{ ok: boolean; providers: AuthProviders }> {
    return request('/api/auth/providers')
  },
  async demo(input: { provider: string; email: string; name?: string; role?: 'seeker' | 'landlord' }) {
    const r = await request<{ ok: boolean; user: User; token: string }>('/api/auth/demo', {
      method: 'POST', body: JSON.stringify(input),
    })
    writeToken(r.token)
    return r
  },
  // Mint a fresh OAuth state on the server and get back the Google authorize
  // URL with that state already baked in. The browser then redirects to that
  // URL; Google echoes the state on the callback so we can verify it server-
  // side (CSRF protection — see `/api/auth/google/callback`).
  async googleStart(role?: 'seeker' | 'landlord') {
    return request<{
      ok: boolean
      state: string
      expiresInSec: number
      authorizeUrl: string
    }>('/api/auth/google/start', {
      method: 'POST', body: JSON.stringify(role ? { role } : {}),
    })
  },
  async google(code: string, state: string) {
    const r = await request<{ ok: boolean; user: User; token: string }>('/api/auth/google/callback', {
      method: 'POST', body: JSON.stringify({ code, state }),
    })
    writeToken(r.token)
    return r
  },
  async logout() {
    try { await request('/api/auth/logout', { method: 'POST' }) }
    finally { writeToken(null) }
  },
  async setRole(role: 'seeker' | 'landlord') {
    return request<{ ok: boolean; user: User }>('/api/auth/role', {
      method: 'POST', body: JSON.stringify({ role }),
    })
  },
  async updateMe(patch: { name?: string; phone?: string | null; avatar?: string | null }) {
    return request<{ ok: boolean; user: User }>('/api/users/me', {
      method: 'PATCH', body: JSON.stringify(patch),
    })
  },
  async deleteMe() {
    return request<{ ok: boolean }>('/api/users/me', { method: 'DELETE' })
  },
  async verifyStart(kind: 'email' | 'phone', target?: string) {
    return request<{
      ok: boolean
      sent?: boolean
      sentVia?: string
      target?: string
      expiresInSec?: number
      preview?: boolean
      previewCode?: string
      alreadyVerified?: boolean
    }>(`/api/me/verify/${kind}/start`, {
      method: 'POST',
      body: JSON.stringify(target ? { target } : {}),
    })
  },
  async verifyConfirm(kind: 'email' | 'phone', code: string) {
    return request<{ ok: boolean; user: User }>(`/api/me/verify/${kind}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  },
}

// ---------- rooms ----------
// Tolerate the legacy `district: string` shape on RoomFilters so saved filters
// from older builds still survive the round-trip into the new districts[]
// query format.
function collectDistricts(f: RoomFilters): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (v: unknown) => {
    if (typeof v !== 'string') return
    const s = v.trim()
    if (!s || seen.has(s)) return
    seen.add(s); out.push(s)
  }
  if (Array.isArray(f.districts)) f.districts.forEach(push)
  const legacy = (f as RoomFilters & { district?: unknown }).district
  push(legacy)
  return out
}

function filtersToQuery(f: RoomFilters): string {
  const u = new URLSearchParams()
  // Multi-select districts go on the wire as repeated `?district=X&district=Y`
  // params. The backend also accepts a single value or a comma list to keep
  // old saved-filter URLs working.
  const districts = collectDistricts(f)
  for (const d of districts) u.append('district', d)
  if (f.roomType) u.set('roomType', f.roomType)
  if (f.priceMin != null) u.set('priceMin', String(f.priceMin))
  if (f.priceMax != null) u.set('priceMax', String(f.priceMax))
  if (f.areaMin != null) u.set('areaMin', String(f.areaMin))
  if (f.amenities && f.amenities.length) u.set('amenities', f.amenities.join(','))
  if (f.sort) u.set('sort', f.sort)
  if (f.text) u.set('q', f.text)
  return u.toString() ? `?${u}` : ''
}

export const apiRooms = {
  async list(filters: RoomFilters = {}, opts: { excludeSeen?: boolean } = {}) {
    const q = filtersToQuery(filters)
    const sep = q ? '&' : '?'
    const tail = opts.excludeSeen === false ? `${sep}excludeSeen=0` : ''
    return request<{ ok: boolean; rooms: Room[]; total: number }>(`/api/rooms${q}${tail}`)
  },
  async get(id: string) {
    return request<{
      ok: boolean; room: Room; reviews: Review[]; contributedPhotos: ContributedPhoto[]; myAction: 'like' | 'pass' | null
    }>(`/api/rooms/${encodeURIComponent(id)}`)
  },
  async create(payload: Partial<Room>) {
    return request<{ ok: boolean; room: Room }>('/api/rooms', {
      method: 'POST', body: JSON.stringify(payload),
    })
  },
  async update(id: string, payload: Partial<Room>) {
    return request<{ ok: boolean; room: Room }>(`/api/rooms/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(payload),
    })
  },
  async close(id: string) {
    return request<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  async setStatus(id: string, status: 'active' | 'hidden' | 'closed') {
    return request<{ ok: boolean; room: Room }>(`/api/rooms/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    })
  },
  async mine() {
    return request<{ ok: boolean; rooms: Room[] }>('/api/rooms/my')
  },
  async saved() {
    return request<{ ok: boolean; rooms: Room[] }>('/api/rooms/saved')
  },
  async swipe(id: string, action: 'like' | 'pass') {
    return request<{ ok: boolean; action: string }>(`/api/rooms/${encodeURIComponent(id)}/swipe`, {
      method: 'POST', body: JSON.stringify({ action }),
    })
  },
  async unsave(id: string) {
    return request<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(id)}/swipe`, { method: 'DELETE' })
  },
  async review(id: string, stars: number, text: string) {
    return request<{ ok: boolean; review: Review }>(`/api/rooms/${encodeURIComponent(id)}/reviews`, {
      method: 'POST', body: JSON.stringify({ stars, text }),
    })
  },
  async report(id: string, reason: string, detail?: string) {
    return request<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(id)}/reports`, {
      method: 'POST', body: JSON.stringify({ reason, detail }),
    })
  },
  async contributePhoto(id: string, url: string, caption?: string) {
    return request<{ ok: boolean; photo: ContributedPhoto }>(`/api/rooms/${encodeURIComponent(id)}/photos`, {
      method: 'POST', body: JSON.stringify({ url, caption }),
    })
  },
}

// MIME → human label used in upload error messages. Keep in sync with
// backend/src/api.mjs UPLOAD_MIME_TO_EXT.
export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif'
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024
const UPLOAD_OK_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
])

type UploadConfig =
  | { provider: 'local'; maxBytes: number }
  | { provider: 'cloudinary'; cloudName: string; apiKey: string; folder: string; maxBytes: number }

// Cached after first call — the provider doesn't change at runtime so we
// only probe once per page load.
let _configCache: Promise<UploadConfig> | null = null
async function getUploadConfig(): Promise<UploadConfig> {
  if (!_configCache) {
    _configCache = request<UploadConfig & { ok: boolean }>('/api/uploads/config')
      .then((r) => {
        // Strip the `ok` flag — same shape minus the wire flag.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { ok: _ok, ...rest } = r
        return rest as UploadConfig
      })
      .catch((): UploadConfig => ({ provider: 'local', maxBytes: UPLOAD_MAX_BYTES }))
  }
  return _configCache
}

export const apiUploads = {
  async config(): Promise<UploadConfig> { return getUploadConfig() },

  // Routes the upload through Cloudinary if backend says so, otherwise hits
  // the local /api/uploads endpoint. Either way returns a URL the room.images
  // validator accepts (URL_RE for any https, UPLOAD_URL_RE for /uploads, or
  // CLOUDINARY_URL_RE for our cloud).
  async image(file: File): Promise<{ url: string; bytes: number }> {
    if (!UPLOAD_OK_MIMES.has(file.type)) {
      throw new ApiError(415, 'Chỉ chấp nhận JPG, PNG, WebP, GIF hoặc AVIF. Ảnh HEIC từ iPhone cần đổi định dạng trước.', null)
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      throw new ApiError(413, `Ảnh quá ${(UPLOAD_MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`, null)
    }
    const cfg = await getUploadConfig()
    if (cfg.provider === 'cloudinary') {
      return uploadToCloudinary(file, cfg)
    }
    return uploadToLocal(file)
  },
}

// Local fallback path: POST raw binary to our own backend, written to
// backend/data/uploads/.
async function uploadToLocal(file: File): Promise<{ url: string; bytes: number }> {
  const headers = new Headers({ 'Content-Type': file.type, 'Accept': 'application/json' })
  const t = authToken.get()
  if (t) headers.set('Authorization', `Bearer ${t}`)
  const res = await fetch('/api/uploads', { method: 'POST', headers, body: file })
  const text = await res.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>))
      ? String((body as Record<string, unknown>).error)
      : `Tải ảnh thất bại (HTTP ${res.status}).`
    throw new ApiError(res.status, msg, body)
  }
  const r = body as { url: string; bytes: number }
  return { url: r.url, bytes: r.bytes }
}

// Cloudinary signed-upload path: ask the backend to sign a fresh timestamp +
// folder, then POST the file as multipart/form-data directly to Cloudinary.
// File never traverses our VPS — saves bandwidth, gives us f_auto/q_auto, and
// auto-converts iPhone HEIC to web formats.
async function uploadToCloudinary(
  file: File,
  cfg: Extract<UploadConfig, { provider: 'cloudinary' }>,
): Promise<{ url: string; bytes: number }> {
  // 1. Get a signature from our backend (server holds the API secret).
  const sign = await request<{
    ok: boolean
    cloudName: string
    apiKey: string
    timestamp: number
    folder: string
    allowedFormats: string
    signature: string
  }>('/api/uploads/cloudinary-sign', { method: 'POST', body: JSON.stringify({}) })

  // 2. POST multipart directly to Cloudinary's upload API. We use FormData
  //    (multipart) because that's the only body shape Cloudinary's REST API
  //    accepts for binary uploads.
  const form = new FormData()
  form.append('file', file)
  form.append('api_key', sign.apiKey)
  form.append('timestamp', String(sign.timestamp))
  form.append('folder', sign.folder)
  form.append('allowed_formats', sign.allowedFormats)
  form.append('signature', sign.signature)

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/image/upload`
  const res = await fetch(endpoint, { method: 'POST', body: form })
  const text = await res.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>))
      ? String(((body as { error?: { message?: string } }).error?.message) || 'Cloudinary từ chối ảnh.')
      : `Cloudinary trả lỗi (HTTP ${res.status}).`
    throw new ApiError(res.status, msg, body)
  }
  const r = body as { secure_url: string; bytes: number }
  return { url: r.secure_url, bytes: r.bytes }
}

// ---------- feedbacks ----------
export const apiFeedback = {
  async list() {
    return request<{ ok: boolean; total: number; feedbacks: Feedback[] }>('/api/feedbacks')
  },
  async create(input: { title: string; content: string; images: string[] }) {
    return request<{ ok: boolean; feedback: Feedback }>('/api/feedbacks', {
      method: 'POST', body: JSON.stringify(input),
    })
  },
  async remove(id: string) {
    return request<{ ok: boolean }>(`/api/feedbacks/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  // Admin-only: download CSV blob with current session's bearer token. Returned
  // blob is offered to the user as a download via an <a download> link.
  async exportCsv(): Promise<{ blob: Blob; filename: string }> {
    const t = readToken()
    const res = await fetch('/api/admin/feedbacks.csv', {
      headers: t ? { Authorization: `Bearer ${t}`, Accept: 'text/csv' } : { Accept: 'text/csv' },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new ApiError(res.status, text || `HTTP ${res.status}`, text)
    }
    const blob = await res.blob()
    const cd = res.headers.get('content-disposition') || ''
    const m = cd.match(/filename="([^"]+)"/)
    return { blob, filename: m ? m[1] : 'gop-y.csv' }
  },
}

// ---------- admin ----------
export const apiAdmin = {
  async stats() { return request<{ ok: boolean; stats: AdminStats }>('/api/admin/stats') },
  async rooms() { return request<{ ok: boolean; rooms: Room[] }>('/api/admin/rooms') },
  async patchRoom(id: string, patch: Partial<{ status: string; featured: boolean; verified: boolean }>) {
    return request<{ ok: boolean; room: Room }>(`/api/admin/rooms/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    })
  },
  async deleteRoom(id: string) {
    return request<{ ok: boolean }>(`/api/admin/rooms/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  async reports() { return request<{ ok: boolean; reports: Report[] }>('/api/admin/reports') },
  async resolveReport(id: string) {
    return request<{ ok: boolean }>(`/api/admin/reports/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({}) })
  },
  async photos() { return request<{ ok: boolean; photos: ContributedPhoto[] }>('/api/admin/photos') },
  async reviewPhoto(id: string, status: 'approved' | 'rejected') {
    return request<{ ok: boolean }>(`/api/admin/photos/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    })
  },
  async users() { return request<{ ok: boolean; users: User[] }>('/api/admin/users') },
  async patchUser(id: string, patch: Partial<{ suspended: boolean; isAdmin: boolean; role: string }>) {
    return request<{ ok: boolean; user: User }>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    })
  },
}
