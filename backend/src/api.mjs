// Ở Đây Nè REST API — native node http on a single port (default 8788).
// Provider-style auth: real Google OAuth if `GOOGLE_CLIENT_ID/SECRET` are set,
// otherwise a demo provider for local preview that the UI clearly labels as
// preview. Either path mints the same session token, so the rest of the API
// is OAuth-agnostic.

import http from 'node:http'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { promisify } from 'node:util'
import {
  newId, newToken, isSessionLive, TTL,
  transaction, publicUser, publicRoom,
  users, rooms, sessions, swipes, reviews, reports, photos, audit, verification, feedbacks,
  oauthStates,
  leadProfiles, viewingAppointments, consultationRequests,
  snapshotBackup, VALID_AMENITY_KEYS, uploadDir,
} from './storage.mjs'
import { cleanupRoomImages } from './image_cleanup.mjs'
import {
  normalizeDistrict, isSupportedDistrict, districtsMatch, listCanonicalDistricts, isCityLevel,
} from './districts.mjs'
import {
  notifyTelegram, telegramEnabled,
  formatLeadAccount, buildViewingAppointmentMessage, buildConsultationRequestMessage,
} from './telegram.mjs'

const gzip = promisify(zlib.gzip)

const port = Number(process.env.API_PORT || 8788)
const bindHost = process.env.API_BIND_HOST || '127.0.0.1'
const isProd = process.env.NODE_ENV === 'production'
const isDev = !isProd
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim()
const ALLOW_CORS_ORIGIN = (process.env.ALLOW_CORS_ORIGIN || '').trim()
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim()
// Which forwarded-IP header (if any) we trust for rate-limit keying and
// audit. `cloudflare` reads `CF-Connecting-IP`, which Cloudflare overwrites
// per-request and clients cannot spoof when traffic reaches the origin only
// through the tunnel. `xff` uses the leftmost `X-Forwarded-For` value
// (compatible with the historic behaviour but spoofable if the origin is
// reachable outside a trusted proxy). Empty/anything else → use the socket
// remote address only. Default `cloudflare` because the documented deploy
// path is Cloudflare Tunnel; non-tunnel deployments should set this to ''.
const TRUST_PROXY = (process.env.TRUST_PROXY || 'cloudflare').trim().toLowerCase()
// In production we refuse to mint preview OTP codes — the verification badge
// would otherwise be meaningless because the code is returned to whoever
// requested it. Set `OTP_PREVIEW_MODE=true` to keep the demo loop on (only
// safe for staging/dev). Real OTP providers (Resend/Twilio) should send the
// code through the side channel; until those are wired, production callers
// receive a 503 from the start endpoint.
const OTP_PREVIEW_MODE = process.env.OTP_PREVIEW_MODE === 'true'
  || (process.env.OTP_PREVIEW_MODE == null && !isProd)

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim()
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim()
const GOOGLE_REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI || '').trim()
const GOOGLE_OAUTH_ENABLED = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI)

// Demo provider is the fallback when real OAuth isn't configured. In production
// it's still allowed (it's a marketplace demo, not a fake creds vector) but the
// UI marks it as "Chế độ xem trước" so users know they aren't actually using
// Google. ALLOW_DEMO_AUTH=false turns it off in prod once real OAuth is wired.
const ALLOW_DEMO_AUTH = process.env.ALLOW_DEMO_AUTH === 'false' ? false : true

// Cloudinary signed upload (optional). When all three creds are set, frontend
// uploads go directly to Cloudinary's edge — files never touch this server,
// which saves VPS bandwidth and gives us f_auto/q_auto + automatic HEIC →
// WebP. When unset, the local `/api/uploads` endpoint stays the source of
// truth and Cloudinary URLs aren't accepted in room.images.
const CLOUDINARY_CLOUD_NAME = (process.env.CLOUDINARY_CLOUD_NAME || '').trim()
const CLOUDINARY_API_KEY = (process.env.CLOUDINARY_API_KEY || '').trim()
const CLOUDINARY_API_SECRET = (process.env.CLOUDINARY_API_SECRET || '').trim()
const CLOUDINARY_UPLOAD_FOLDER = (process.env.CLOUDINARY_UPLOAD_FOLDER || 'odayne/rooms').trim()
const CLOUDINARY_ENABLED = !!(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET)
// Restrict accepted Cloudinary URLs to our own cloud — prevents users from
// pasting links to other Cloudinary accounts that we don't control. Built at
// boot since cloud name comes from env.
const CLOUDINARY_URL_RE = CLOUDINARY_ENABLED
  ? new RegExp(`^https://res\\.cloudinary\\.com/${CLOUDINARY_CLOUD_NAME.replace(/[.\\^$*+?()[\]{}|]/g, '\\$&')}/image/upload/[\\w./%,@:-]+$`, 'i')
  : null

// Carries the env-driven settings the cleanup module needs so we don't have to
// re-read process.env from inside hot delete paths.
const IMAGE_CLEANUP_CTX = {
  uploadDir,
  cloudinaryEnabled: CLOUDINARY_ENABLED,
  cloudName: CLOUDINARY_CLOUD_NAME,
  apiKey: CLOUDINARY_API_KEY,
  apiSecret: CLOUDINARY_API_SECRET,
}

async function disposeRoomImages(roomId, images, source) {
  // Image deletion never blocks the user-facing delete success — but we wait
  // for it inline so audit/log lines land in the same request, and so the test
  // suite can assert the side-effects after the response.
  if (!Array.isArray(images) || images.length === 0) return
  try {
    const { failed } = await cleanupRoomImages(images, IMAGE_CLEANUP_CTX)
    if (failed.length) {
      const detail = failed.map((f) => ({ url: f.url, kind: f.kind, error: f.error }))
      audit.push('room.image_cleanup.fail', { roomId, source, failed: detail })
      logEvent('error', 'room.image_cleanup.fail', { roomId, source, failed: detail })
    }
  } catch (err) {
    audit.push('room.image_cleanup.fail', { roomId, source, error: String(err?.message || err) })
    logEvent('error', 'room.image_cleanup.exception', { roomId, source, err: String(err) })
  }
}

// Source of truth lives in ./districts.mjs — that module also handles
// accent-insensitive aliases (Dong Da → Đống Đa, Nam Tu Liem → Nam Từ Liêm,
// etc.) and refuses city-level tokens ("Hà Nội" / "Ha Noi"). We expose the
// canonical list here for code that only needs the set of supported names.
const VALID_DISTRICTS = new Set(listCanonicalDistricts())
const VALID_ROOM_TYPES = new Set(['studio', 'room', 'mini_apt', 'dorm', 'shared'])
const VALID_REPORT_REASONS = new Set([
  'fake_listing', 'wrong_price', 'wrong_address', 'spam', 'rude_owner', 'other',
])

const PHONE_RE = /^[0-9 +().\-]{8,20}$/
const NAME_RE = /^[\p{L}\p{M}0-9 .,'\-]{2,80}$/u
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// URLs allowed in room.images can be external https OR our own /uploads path
// (relative). The list validator handles both shapes. We refuse `http://`
// because the app is served over HTTPS (via Cloudflare) and any plain-http
// image would either be blocked by mixed-content rules or be a downgrade
// vector for users who hand-craft URLs.
const URL_RE = /^https:\/\/[\w.\-]+(:\d+)?(\/[\w.\-~:/?#\[\]@!$&'()*+,;=%]*)?$/i
const UPLOAD_URL_RE = /^\/uploads\/[a-f0-9]{8,64}\.(jpg|png|webp|gif|avif)$/i
const MAX_TITLE = 140
const MAX_DESC = 4000
const MAX_REPORT_DETAIL = 480
const MAX_REVIEW_TEXT = 800
const MAX_IMAGES = 12
// rooms.source — owner-private tag. 80 chars is plenty for "CTV Hà" /
// "Nhà Nhóm" style labels without giving anyone room to stuff prose in it.
const MAX_SOURCE = 80
const MAX_FEEDBACK_TITLE = 140
const MAX_FEEDBACK_CONTENT = 4000
const MAX_FEEDBACK_IMAGES = 6

// Upload constraints. JPEG/PNG/WebP/GIF/AVIF cover every modern device + the
// formats every browser <img> can render. HEIC is rejected explicitly — Safari
// renders it but Chrome/Firefox/Android Chrome do not, and we don't want to
// run a server-side converter for an MVP.
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024
const UPLOAD_MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}
const UPLOAD_FILENAME_RE = /^[a-f0-9]{8,64}\.(jpg|png|webp|gif|avif)$/i

// ---------- structured logging ----------
function logEvent(level, event, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })
  if (level === 'error') console.error(line)
  else console.log(line)
}

// ---------- rate limits ----------
const RATE_LIMITS = {
  auth: { perIp: { max: 30, windowMs: 10 * 60 * 1000 } },
  write: { perIp: { max: 120, windowMs: 60 * 1000 } },
  report: { perUser: { max: 20, windowMs: 24 * 60 * 60 * 1000 } },
  photo: { perUser: { max: 30, windowMs: 24 * 60 * 60 * 1000 } },
  // Failed X-Admin-Token attempts. Tight cap because ADMIN_TOKEN is a 32-byte
  // high-entropy shared secret — no legitimate caller should ever miss more
  // than once or twice. Throttling here blunts online brute-force, and the
  // audit trail surfaces any sustained probing.
  adminToken: { perIp: { max: 5, windowMs: 15 * 60 * 1000 } },
}
const rateBuckets = new Map()
function rateHit(key, max, windowMs) {
  const now = Date.now()
  const e = rateBuckets.get(key)
  if (!e || e.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }
  e.count += 1
  if (e.count > max) return { ok: false, retryAfter: Math.max(1, Math.ceil((e.resetAt - now) / 1000)) }
  return { ok: true }
}
// Read-only peek used when we only want to *count failures* (admin token
// brute-force defence) — a successful login should not consume budget that
// a brute-forcer is also using. Returns ok=false once the bucket has reached
// `max`, because the next failed attempt would push it over. Never mutates
// state.
function ratePeek(key, max) {
  const e = rateBuckets.get(key)
  if (!e || e.resetAt <= Date.now()) return { ok: true }
  if (e.count >= max) return { ok: false, retryAfter: Math.max(1, Math.ceil((e.resetAt - Date.now()) / 1000)) }
  return { ok: true }
}
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k)
}, 60_000).unref?.()

function clientIp(req) {
  // When TRUST_PROXY is set, prefer the header set by that proxy. Cloudflare's
  // CF-Connecting-IP is the canonical real-client IP and is overwritten by
  // Cloudflare on every request, so it cannot be spoofed by clients reaching
  // the origin through the tunnel. X-Forwarded-For is appended-to by
  // Cloudflare (and most proxies), so its leftmost value is attacker-supplied
  // unless we control the entire chain. Treat the socket address as the last
  // resort.
  if (TRUST_PROXY === 'cloudflare') {
    const cf = req.headers['cf-connecting-ip']
    if (typeof cf === 'string' && cf.trim()) return cf.trim()
  } else if (TRUST_PROXY === 'xff') {
    const fwd = req.headers['x-forwarded-for']
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

// crypto.timingSafeEqual rejects unequal-length inputs, so we hash both sides
// before comparing. Avoids `===` short-circuit timing on the shared admin
// token.
function safeTokenEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (!a || !b) return false
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

// ---------- response helpers ----------
function corsOrigin(req) {
  if (isDev) return '*'
  const origin = (req.headers.origin || '').trim()
  const allowList = [ALLOW_CORS_ORIGIN, PUBLIC_URL].filter(Boolean)
  if (allowList.length === 0) return null
  if (allowList.includes(origin)) return origin
  return null
}
function corsHeaders(req) {
  const origin = corsOrigin(req)
  if (!origin) return {}
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Vary': 'Origin',
  }
  // `Allow-Credentials: true` paired with `Allow-Origin: *` is a fetch-spec
  // violation that browsers refuse — only emit the credentials flag when we
  // echoed a concrete origin back. In dev the auth header is sent without
  // cookies anyway, so dropping the credentials flag for the wildcard case
  // doesn't break any flow.
  if (origin !== '*') headers['Access-Control-Allow-Credentials'] = 'true'
  return headers
}
async function sendJson(req, res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data)
  const ae = req.headers['accept-encoding'] || ''
  const acceptsGzip = /\bgzip\b/.test(ae) && body.length > 1024
  const baseHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(req),
    ...extraHeaders,
  }
  if (acceptsGzip) {
    try {
      const buf = await gzip(body)
      baseHeaders['Content-Encoding'] = 'gzip'
      baseHeaders['Content-Length'] = buf.length
      res.writeHead(status, baseHeaders); res.end(buf); return
    } catch { /* fall through */ }
  }
  baseHeaders['Content-Length'] = Buffer.byteLength(body)
  res.writeHead(status, baseHeaders); res.end(body)
}

const badRequest = (req, res, msg) => sendJson(req, res, 400, { ok: false, error: msg })
const unauthorized = (req, res) => sendJson(req, res, 401, { ok: false, error: 'Bạn cần đăng nhập để làm việc này.' })
const forbidden = (req, res) => sendJson(req, res, 403, { ok: false, error: 'Bạn không có quyền với mục này.' })
const notFound = (req, res, msg = 'Không tìm thấy.') => sendJson(req, res, 404, { ok: false, error: msg })
const conflict = (req, res, msg) => sendJson(req, res, 409, { ok: false, error: msg })
const rateLimited = (req, res, retryAfter, msg) =>
  sendJson(req, res, 429, { ok: false, error: msg || 'Bạn thao tác quá nhanh, thử lại sau ít phút.' }, {
    'Retry-After': String(retryAfter || 60),
  })

async function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > maxBytes) {
        reject(Object.assign(new Error('payload-too-large'), { code: 'PAYLOAD' })); req.destroy(); return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { reject(Object.assign(new Error('invalid-json'), { code: 'JSON' })) }
    })
    req.on('error', reject)
  })
}

// Raw-bytes counterpart used for binary uploads. We deliberately don't ship a
// multipart parser — the frontend sends one file per POST with its MIME in
// `Content-Type`, which keeps server-side parsing to a buffer concat.
async function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > maxBytes) {
        reject(Object.assign(new Error('payload-too-large'), { code: 'PAYLOAD' })); req.destroy(); return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// ---------- auth ----------
function bearerToken(req) {
  const h = req.headers.authorization || ''
  if (!h.toLowerCase().startsWith('bearer ')) return null
  return h.slice(7).trim() || null
}

function sessionForRequest(req) {
  const token = bearerToken(req)
  if (!token) return null
  const s = sessions.findByToken(token)
  if (!isSessionLive(s)) return null
  return s
}

function userForRequest(req) {
  const s = sessionForRequest(req)
  if (!s) return null
  const u = users.findById(s.userId)
  if (!u) return null
  if (u.suspendedAt) return null
  return u
}

function requireUser(req, res) {
  const u = userForRequest(req)
  if (!u) { unauthorized(req, res); return null }
  return u
}

function requireAdmin(req, res) {
  // Two routes to admin: a valid session belonging to an admin user, OR a
  // shared ADMIN_TOKEN env var for ops/backfill. The token path bypasses
  // session lookup so a recovery operator can reach admin endpoints even when
  // no admin user exists.
  if (ADMIN_TOKEN) {
    const raw = req.headers['x-admin-token']
    const t = (raw || '').toString().trim()
    if (t) {
      const ip = clientIp(req)
      // Reject the attempt up front if this IP is already over the failure
      // budget — `ratePeek` is read-only, so legitimate ops requests never
      // burn budget that a brute-forcer is consuming.
      const peek = ratePeek(`admin-token:${ip}`, RATE_LIMITS.adminToken.perIp.max)
      if (!peek.ok) {
        audit.push('admin.token.ratelimit', { ip, ua: (req.headers['user-agent'] || '').slice(0, 200) })
        logEvent('warn', 'admin.token.ratelimit', { ip })
        rateLimited(req, res, peek.retryAfter)
        return null
      }
      if (safeTokenEquals(t, ADMIN_TOKEN)) {
        return { id: 'admin-token', isAdmin: true, role: 'admin', name: 'token-admin' }
      }
      // Failed attempt — *now* count it against the bucket and record an
      // audit row (IP + UA + path). Never log the attempted token itself:
      // that would leak partial guesses into operator log archives.
      rateHit(`admin-token:${ip}`, RATE_LIMITS.adminToken.perIp.max, RATE_LIMITS.adminToken.perIp.windowMs)
      audit.push('admin.token.fail', {
        ip,
        path: (req.url || '').split('?')[0],
        ua: (req.headers['user-agent'] || '').slice(0, 200),
      })
      logEvent('warn', 'admin.token.fail', { ip, path: (req.url || '').split('?')[0] })
    }
  }
  const u = userForRequest(req)
  if (!u) { unauthorized(req, res); return null }
  if (!u.isAdmin) { forbidden(req, res); return null }
  return u
}

// ---------- auth: demo + google ----------
async function googleExchangeCode(code) {
  // Trade `code` for tokens, then fetch userinfo. Done on the server so the
  // client secret never leaves the host.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) throw new Error('google-token-exchange-failed')
  const tokenData = await tokenRes.json()
  const accessToken = tokenData.access_token
  if (!accessToken) throw new Error('google-no-access-token')
  const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!infoRes.ok) throw new Error('google-userinfo-failed')
  const info = await infoRes.json()
  return {
    sub: info.sub,
    email: info.email,
    // Google sets email_verified=true when they've confirmed deliverability.
    // We trust this and skip our own email-OTP flow for these accounts.
    emailVerified: info.email_verified === true || info.email_verified === 'true',
    name: info.name || info.email,
    picture: info.picture,
  }
}

function makeSessionForUser(userId, ip) {
  const token = newToken()
  const now = Date.now()
  sessions.insert({
    token, userId,
    createdAt: now,
    expiresAt: now + TTL.SESSION_MS,
    ip: ip || null,
  })
  users.setLastLogin(userId, now)
  return { token, expiresAt: now + TTL.SESSION_MS }
}

// Demo / preview providers don't actually verify the email they receive —
// anyone can POST {provider:'demo', email:'admin@odayne.local'} and the
// previous code would happily attach that login to an existing real account
// (including seeded admins) via the email-fallback branch. Lock email
// fallback to providers we trust to assert ownership (currently only real
// Google OAuth, where the token returns `email_verified: true`).
const TRUSTED_EMAIL_PROVIDERS = new Set(['google'])

// Returned by upsertUserFromProvider when a demo/unverified login tries to
// claim an email that is already owned by a different account. Callers turn
// this into a 409 instead of crashing on the users.email UNIQUE constraint.
const PROVIDER_EMAIL_CONFLICT = Symbol('provider-email-conflict')

function upsertUserFromProvider({ provider, providerId, email, name, avatar, intendedRole, emailVerified }) {
  let u = providerId ? users.findByProvider(provider, providerId) : null
  // Only fall back to an email-based match when the provider is one that
  // actually proves ownership of the address. Demo/*_demo providers must
  // never reach an existing user this way — that's the account-takeover
  // vector reported by the security review.
  const emailLookupAllowed = TRUSTED_EMAIL_PROVIDERS.has(provider) && emailVerified === true
  if (!u && email && emailLookupAllowed) u = users.findByEmail(email)
  // Untrusted providers must not be allowed to create a *new* record whose
  // email collides with an existing account either — the users.email UNIQUE
  // index would reject the insert (good), but we surface the conflict as a
  // typed sentinel so the caller can return a friendly 409.
  if (!u && email && !emailLookupAllowed) {
    const existing = users.findByEmail(email)
    if (existing) return PROVIDER_EMAIL_CONFLICT
  }
  const verifiedAt = emailVerified ? Date.now() : null
  if (u) {
    // Update name/avatar/phone/role if missing, propagate Google's freshly
    // refreshed avatar (people change profile photos). Email already locked
    // to provider so no patch there.
    const patch = {}
    if (!u.name && name) patch.name = name
    if (!u.avatar && avatar) patch.avatar = avatar
    if (Object.keys(patch).length) u = users.update(u.id, patch)
    // Promote email_verified the first time we see a verified provider login.
    if (verifiedAt && !u.emailVerifiedAt) {
      users.setEmailVerifiedAt(u.id, verifiedAt)
      u = users.findById(u.id)
    }
    return u
  }
  // New user — first one with admin email auto-admins (already seeded), others
  // start as seekers unless they explicitly chose 'landlord' at signup.
  const role = intendedRole === 'landlord' ? 'landlord' : 'seeker'
  const inserted = users.insert({
    id: newId('user'),
    email: email || null,
    provider,
    providerId: providerId || null,
    name: name || (email ? email.split('@')[0] : 'Bạn mới'),
    avatar: avatar || null,
    role,
    isAdmin: false,
    createdAt: Date.now(),
    lastLoginAt: null,
  })
  if (verifiedAt) {
    users.setEmailVerifiedAt(inserted.id, verifiedAt)
    return users.findById(inserted.id)
  }
  return inserted
}

// ---------- handlers ----------
async function handleAuthSession(req, res) {
  const u = userForRequest(req)
  return sendJson(req, res, 200, { ok: true, user: u ? publicUser(u) : null })
}

async function handleAuthProviders(req, res) {
  return sendJson(req, res, 200, {
    ok: true,
    providers: {
      google: GOOGLE_OAUTH_ENABLED
        ? { kind: 'oauth', clientId: GOOGLE_CLIENT_ID, redirectUri: GOOGLE_REDIRECT_URI }
        : null,
      demo: ALLOW_DEMO_AUTH ? { kind: 'demo' } : null,
    },
  })
}

async function handleAuthDemo(req, res) {
  if (!ALLOW_DEMO_AUTH) return forbidden(req, res)
  const ip = clientIp(req)
  const rl = rateHit(`auth:${ip}`, RATE_LIMITS.auth.perIp.max, RATE_LIMITS.auth.perIp.windowMs)
  if (!rl.ok) return rateLimited(req, res, rl.retryAfter)

  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')

  const provider = String(body.provider || 'demo').trim().toLowerCase()
  if (!['demo', 'google_demo', 'facebook_demo', 'zalo_demo'].includes(provider)) {
    return badRequest(req, res, 'Provider không hợp lệ.')
  }
  const email = String(body.email || '').trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email) || email.length > 200) {
    return badRequest(req, res, 'Email không hợp lệ.')
  }
  const name = String(body.name || '').trim()
  if (name && !NAME_RE.test(name)) return badRequest(req, res, 'Tên không hợp lệ.')
  const intendedRole = body.role === 'landlord' ? 'landlord' : 'seeker'

  const u = upsertUserFromProvider({
    provider,
    providerId: `${provider}:${email}`,
    email,
    name: name || email.split('@')[0],
    avatar: null,
    intendedRole,
  })
  if (u === PROVIDER_EMAIL_CONFLICT) {
    audit.push('auth.demo.email_conflict', { provider, ip })
    return conflict(req, res, 'Email này đã được dùng bởi tài khoản khác. Vui lòng đăng nhập bằng nhà cung cấp gốc.')
  }
  const s = makeSessionForUser(u.id, ip)
  audit.push('auth.demo', { userId: u.id, provider })
  return sendJson(req, res, 200, { ok: true, user: publicUser(u), token: s.token, expiresAt: s.expiresAt })
}

// OAuth state nonce: 32 random bytes hex. Generated server-side, stored in
// oauth_states, returned to the client to put on the Google authorize URL.
// Google echoes it back on the redirect; the callback consumes it once.
const OAUTH_STATE_RE = /^[a-f0-9]{16,128}$/i

function generateOAuthState() {
  return crypto.randomBytes(32).toString('hex')
}

// POST /api/auth/google/start — mint a fresh OAuth state, persist it bound to
// the (optional) role choice, and hand back the authorize URL the client
// should redirect to. The state lives in the DB for OAUTH_STATE_MS and is
// single-use (consumed by the callback). Rate-limited under the same auth
// bucket so a script can't spam new states to fill the table.
async function handleAuthGoogleStart(req, res) {
  if (!GOOGLE_OAUTH_ENABLED) return forbidden(req, res)
  const ip = clientIp(req)
  const rl = rateHit(`auth:${ip}`, RATE_LIMITS.auth.perIp.max, RATE_LIMITS.auth.perIp.windowMs)
  if (!rl.ok) return rateLimited(req, res, rl.retryAfter)

  const body = await readJsonBody(req).catch(() => null) || {}
  const role = body.role === 'landlord' ? 'landlord' : 'seeker'

  const state = generateOAuthState()
  const now = Date.now()
  oauthStates.insert({
    state,
    provider: 'google',
    role,
    ip,
    createdAt: now,
    expiresAt: now + TTL.OAUTH_STATE_MS,
  })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  })
  audit.push('auth.google.start', { ip, role })
  return sendJson(req, res, 200, {
    ok: true,
    state,
    expiresInSec: Math.floor(TTL.OAUTH_STATE_MS / 1000),
    authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  })
}

async function handleAuthGoogleCallback(req, res) {
  if (!GOOGLE_OAUTH_ENABLED) return forbidden(req, res)
  const ip = clientIp(req)
  const rl = rateHit(`auth:${ip}`, RATE_LIMITS.auth.perIp.max, RATE_LIMITS.auth.perIp.windowMs)
  if (!rl.ok) return rateLimited(req, res, rl.retryAfter)

  const body = await readJsonBody(req).catch(() => null)
  if (!body || !body.code) return badRequest(req, res, 'Thiếu authorization code.')

  // Validate state shape BEFORE hitting the DB — keeps the lookup index
  // honest and avoids logging arbitrary attacker-supplied strings later.
  const stateRaw = typeof body.state === 'string' ? body.state.trim() : ''
  if (!stateRaw || stateRaw.length > 128 || !OAUTH_STATE_RE.test(stateRaw)) {
    audit.push('auth.google.state_missing', { ip })
    return badRequest(req, res, 'Phiên đăng nhập Google không hợp lệ. Bấm đăng nhập lại.')
  }
  // Single-use: consume() atomically deletes and returns the row. A second
  // callback with the same state (replay) will see null here.
  const stateRow = oauthStates.consume(stateRaw)
  if (!stateRow) {
    audit.push('auth.google.state_invalid', { ip })
    return badRequest(req, res, 'Phiên đăng nhập Google không hợp lệ. Bấm đăng nhập lại.')
  }
  if (stateRow.expiresAt <= Date.now()) {
    audit.push('auth.google.state_expired', { ip })
    return badRequest(req, res, 'Phiên đăng nhập Google đã hết hạn. Bấm đăng nhập lại.')
  }

  try {
    const profile = await googleExchangeCode(String(body.code))
    if (!profile.email) return badRequest(req, res, 'Tài khoản Google không có email công khai.')
    // Role comes from the persisted state row, not the request body — binds
    // the role to the state the user actually opened the flow with.
    const u = upsertUserFromProvider({
      provider: 'google',
      providerId: profile.sub,
      email: profile.email,
      name: profile.name,
      avatar: profile.picture,
      emailVerified: profile.emailVerified,
      intendedRole: stateRow.role,
    })
    if (u === PROVIDER_EMAIL_CONFLICT) {
      audit.push('auth.google.email_conflict', { ip, sub: profile.sub })
      return conflict(req, res, 'Email Google này đã được liên kết với một tài khoản khác.')
    }
    const s = makeSessionForUser(u.id, ip)
    audit.push('auth.google', { userId: u.id })
    return sendJson(req, res, 200, { ok: true, user: publicUser(u), token: s.token, expiresAt: s.expiresAt })
  } catch (err) {
    logEvent('error', 'auth.google.fail', { err: String(err) })
    return badRequest(req, res, 'Đăng nhập Google thất bại. Thử lại.')
  }
}

async function handleAuthLogout(req, res) {
  const token = bearerToken(req)
  if (token) sessions.deleteByToken(token)
  return sendJson(req, res, 200, { ok: true })
}

async function handleAuthRoleSwitch(req, res) {
  const u = requireUser(req, res); if (!u) return
  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const role = String(body.role || '').trim()
  if (!['seeker', 'landlord'].includes(role)) return badRequest(req, res, 'Vai trò không hợp lệ.')
  const updated = users.update(u.id, { role })
  return sendJson(req, res, 200, { ok: true, user: publicUser(updated) })
}

// PATCH /api/users/me — lets the current user update their own profile
// (name / phone / avatar URL). Email is provider-driven and cannot be
// changed here. Role changes go through /api/auth/role.
async function handleMePatch(req, res) {
  const u = requireUser(req, res); if (!u) return
  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')

  const patch = {}
  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!NAME_RE.test(name)) return badRequest(req, res, 'Tên hiển thị không hợp lệ.')
    patch.name = name
  }
  if (typeof body.phone === 'string' || body.phone === null) {
    if (body.phone === null || body.phone === '') patch.phone = ''
    else {
      const phone = String(body.phone).trim()
      if (!PHONE_RE.test(phone)) return badRequest(req, res, 'Số điện thoại không hợp lệ.')
      patch.phone = phone
    }
  }
  if (typeof body.avatar === 'string' || body.avatar === null) {
    if (body.avatar === null || body.avatar === '') patch.avatar = ''
    else {
      const avatar = String(body.avatar).trim()
      if (avatar.length > 600 || !URL_RE.test(avatar)) {
        return badRequest(req, res, 'Avatar phải là URL ảnh https hợp lệ.')
      }
      patch.avatar = avatar
    }
  }

  if (!Object.keys(patch).length) return badRequest(req, res, 'Không có trường nào để cập nhật.')
  // Editing phone or email invalidates the existing verification — user must
  // re-verify the new value to keep the badge.
  if (patch.phone !== undefined && patch.phone !== (u.phone || '')) {
    users.setPhoneVerifiedAt(u.id, null)
  }
  const updated = users.update(u.id, patch)
  audit.push('me.patch', { userId: u.id, fields: Object.keys(patch) })
  return sendJson(req, res, 200, { ok: true, user: publicUser(updated) })
}

// ---------- verification (email/phone OTP) ----------
// We never ship an SMTP/SMS dependency by default — that pulls in a paid
// service. Instead the API generates a 6-digit code with TTL and:
//   * If `RESEND_API_KEY` / `SMS_PROVIDER` env vars are set → fire the real
//     send (TODO: add provider integrations). Right now neither is wired.
//   * Otherwise → return the code in the response under `previewCode` with
//     a `preview: true` flag, so dev/preview deploys still demo the loop.
//     The login popup labels this clearly in the UI.
const VERIFY_CODE_TTL_MS = 10 * 60 * 1000
const VERIFY_MAX_ATTEMPTS = 5
const VERIFY_RESEND_COOLDOWN_MS = 60 * 1000

function generateOtpCode() {
  // 6 zero-padded digits. Uses crypto.randomInt to avoid Math.random bias.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

async function handleVerifyStart(req, res, kind) {
  const u = requireUser(req, res); if (!u) return
  // No real OTP provider is configured. We refuse to mint a preview code in
  // production because the badge would otherwise mean nothing — the code is
  // handed straight back to the caller, so anyone can self-verify any phone
  // number / email they type. Set `OTP_PREVIEW_MODE=true` in staging or local
  // dev to keep the demo loop working.
  if (!OTP_PREVIEW_MODE) {
    return sendJson(req, res, 503, {
      ok: false,
      error: 'Tính năng xác minh tạm thời chưa khả dụng — cần cấu hình nhà cung cấp email/SMS.',
    })
  }
  const ip = clientIp(req)
  const rl = rateHit(`verify-start:${u.id}`, 5, 10 * 60 * 1000)
  if (!rl.ok) return rateLimited(req, res, rl.retryAfter)
  // Per-IP belt + suspenders so a hijacked session can't burn a budget.
  const rlIp = rateHit(`verify-start:${ip}`, 30, 60 * 60 * 1000)
  if (!rlIp.ok) return rateLimited(req, res, rlIp.retryAfter)

  const body = await readJsonBody(req).catch(() => null) || {}
  let target = (body.target || '').toString().trim()

  if (kind === 'email') {
    if (!target) target = u.email || ''
    if (!target || !EMAIL_RE.test(target) || target.length > 200) {
      return badRequest(req, res, 'Email không hợp lệ.')
    }
    if (u.emailVerifiedAt && target.toLowerCase() === (u.email || '').toLowerCase()) {
      return sendJson(req, res, 200, { ok: true, alreadyVerified: true })
    }
  } else if (kind === 'phone') {
    if (!target) target = u.phone || ''
    if (!target || !PHONE_RE.test(target)) {
      return badRequest(req, res, 'Số điện thoại không hợp lệ.')
    }
    if (u.phoneVerifiedAt && target === u.phone) {
      return sendJson(req, res, 200, { ok: true, alreadyVerified: true })
    }
  }

  // Cooldown so users can't rapid-fire codes (and burn provider quotas).
  const existing = verification.find(u.id, kind)
  if (existing && Date.now() - existing.created_at < VERIFY_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((VERIFY_RESEND_COOLDOWN_MS - (Date.now() - existing.created_at)) / 1000)
    return sendJson(req, res, 429, { ok: false, error: `Đợi ${wait}s rồi mới gửi mã mới.` }, { 'Retry-After': String(wait) })
  }

  const code = generateOtpCode()
  const now = Date.now()
  verification.upsert({
    userId: u.id, kind, code, target,
    expiresAt: now + VERIFY_CODE_TTL_MS,
    createdAt: now,
  })

  // Try the configured sender; if not configured we leak the code back to
  // the client (clearly labelled). Real providers go here later.
  let sentVia = 'preview'
  // TODO: integrate Resend / Mailgun / Twilio / SpeedSMS here. Until then
  // we ship a usable preview loop.

  audit.push(`verify.${kind}.start`, { userId: u.id, target, sentVia })
  return sendJson(req, res, 200, {
    ok: true,
    sent: true,
    sentVia,
    target,
    expiresInSec: Math.floor(VERIFY_CODE_TTL_MS / 1000),
    // Preview-mode only: the UI shows this to the user with a banner so
    // they know it's a demo. Real prod should set the env vars below
    // (Resend, Twilio, etc.) so this field is omitted.
    preview: true,
    previewCode: code,
  })
}

async function handleVerifyConfirm(req, res, kind) {
  const u = requireUser(req, res); if (!u) return
  const body = await readJsonBody(req).catch(() => null) || {}
  const code = (body.code || '').toString().trim()
  if (!/^\d{6}$/.test(code)) return badRequest(req, res, 'Mã xác minh phải gồm 6 số.')

  const entry = verification.find(u.id, kind)
  if (!entry) return badRequest(req, res, 'Chưa có mã. Bấm "Gửi mã" trước nhé.')
  if (entry.expires_at <= Date.now()) {
    verification.delete(u.id, kind)
    return badRequest(req, res, 'Mã đã hết hạn. Bấm gửi lại.')
  }
  if (entry.attempts >= VERIFY_MAX_ATTEMPTS) {
    verification.delete(u.id, kind)
    return badRequest(req, res, 'Nhập sai quá nhiều lần. Bấm gửi lại mã mới.')
  }
  if (entry.code !== code) {
    verification.incrementAttempts(u.id, kind)
    const left = Math.max(0, VERIFY_MAX_ATTEMPTS - entry.attempts - 1)
    return sendJson(req, res, 400, { ok: false, error: `Mã không đúng. Còn ${left} lần thử.` })
  }

  // Success — set verification timestamp + clear the code row.
  const now = Date.now()
  if (kind === 'email') {
    // If user changed email via this flow (target differs from current),
    // promote it to be the user's email too — provider auth aside, this is
    // intentional manual verification.
    if (entry.target && entry.target.toLowerCase() !== (u.email || '').toLowerCase()) {
      try {
        users.setEmail(u.id, entry.target.toLowerCase())
      } catch (err) {
        // Email collision (unique index). Surface a clear error.
        verification.delete(u.id, kind)
        return conflict(req, res, 'Email này đã thuộc về tài khoản khác.')
      }
    }
    users.setEmailVerifiedAt(u.id, now)
  } else if (kind === 'phone') {
    // Phone uniqueness isn't enforced — allow same number on multiple
    // accounts (family share). Just update the stored phone + verify ts.
    if (entry.target && entry.target !== u.phone) {
      users.update(u.id, { phone: entry.target })
    }
    users.setPhoneVerifiedAt(u.id, now)
  }
  verification.delete(u.id, kind)
  audit.push(`verify.${kind}.confirm`, { userId: u.id, target: entry.target })
  const updated = users.findById(u.id)
  return sendJson(req, res, 200, { ok: true, user: publicUser(updated) })
}

// DELETE /api/users/me — self-delete. ON DELETE CASCADE on every FK table
// covers swipes/sessions/reviews/reports/photos/verification_codes, so we
// only need a single DELETE. Rooms set owner_id NULL (kept as orphan listings)
// to preserve marketplace history; admin can prune them.
async function handleMeDelete(req, res) {
  const u = requireUser(req, res); if (!u) return
  // Defence: refuse if account is the *last* admin so nobody can lock
  // themselves out by accident. Other admins must promote a replacement.
  if (u.isAdmin) {
    const all = users.listAll(2000).filter((x) => x.isAdmin)
    if (all.length <= 1) {
      return badRequest(req, res, 'Đây là admin cuối cùng — chỉ định admin khác trước khi xoá.')
    }
  }
  users.delete(u.id)
  audit.push('me.delete', { userId: u.id })
  return sendJson(req, res, 200, { ok: true })
}

// ---------- reviews (edit/delete) ----------
// Authors can edit their own review's stars/text within 30 days; admin can
// edit anyone's. Hard-delete is allowed for the author at any time — the
// rating summary recomputes on next read.
async function handleReviewPatch(req, res, id) {
  const u = requireUser(req, res); if (!u) return
  const existing = reviews.findById(id)
  if (!existing) return notFound(req, res, 'Đánh giá không tồn tại.')
  if (existing.userId !== u.id && !u.isAdmin) return forbidden(req, res)

  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const patch = {}
  if (body.stars !== undefined) {
    const stars = Number(body.stars)
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return badRequest(req, res, 'Số sao 1–5.')
    patch.stars = stars
  }
  if (typeof body.text === 'string') {
    const text = body.text.trim()
    if (text.length < 5 || text.length > MAX_REVIEW_TEXT) {
      return badRequest(req, res, `Nhận xét từ 5 đến ${MAX_REVIEW_TEXT} ký tự.`)
    }
    patch.text = text
  }
  if (!Object.keys(patch).length) return badRequest(req, res, 'Không có trường nào để cập nhật.')

  const updated = reviews.update(id, patch)
  audit.push('review.update', { userId: u.id, reviewId: id, fields: Object.keys(patch) })
  return sendJson(req, res, 200, { ok: true, review: updated })
}

async function handleReviewDelete(req, res, id) {
  const u = requireUser(req, res); if (!u) return
  const existing = reviews.findById(id)
  if (!existing) return notFound(req, res, 'Đánh giá không tồn tại.')
  if (existing.userId !== u.id && !u.isAdmin) return forbidden(req, res)
  reviews.delete(id)
  audit.push('review.delete', { userId: u.id, reviewId: id, byAdmin: u.isAdmin && existing.userId !== u.id })
  return sendJson(req, res, 200, { ok: true })
}

// ---------- contributed photos (delete) ----------
// Authors can withdraw a still-pending photo. Approved photos require admin
// (so a user can't yank an image other people may already have shown to
// friends). Admin can delete at any stage.
async function handleContributedPhotoDelete(req, res, id) {
  const u = requireUser(req, res); if (!u) return
  const existing = photos.findById(id)
  if (!existing) return notFound(req, res, 'Ảnh không tồn tại.')
  const isOwner = existing.userId === u.id
  const isPending = existing.status === 'pending'
  if (!u.isAdmin && !(isOwner && isPending)) return forbidden(req, res)
  photos.delete(id)
  audit.push('photo.delete', { userId: u.id, photoId: id, byAdmin: u.isAdmin && !isOwner })
  return sendJson(req, res, 200, { ok: true })
}

// ---------- rooms ----------
// Owner-private fields (today: `source`) must be hidden from anonymous users
// and from anyone who isn't the owner or an admin. Centralising the rule
// here means every room handler stays consistent.
function canSeeSource(room, user) {
  if (!user || !room) return false
  if (user.isAdmin) return true
  return !!room.ownerId && room.ownerId === user.id
}

function computeMatch(room, filters) {
  // Lightweight 0–100 score. We boost rooms that match the user's filter
  // narrowly so the swipe deck feels personalised even before login.
  let score = 50
  if (filters.districts && filters.districts.length && filters.districts.includes(room.district)) {
    score += 15
  }
  if (filters.roomType && room.roomType === filters.roomType) score += 12
  if (filters.priceMax && room.priceVnd <= filters.priceMax) score += 6
  if (filters.priceMin && room.priceVnd >= filters.priceMin) score += 4
  if (filters.areaMin && room.areaM2 >= filters.areaMin) score += 4
  if (Array.isArray(filters.amenities) && filters.amenities.length) {
    const hit = filters.amenities.filter((a) => room.amenities.includes(a)).length
    score += Math.min(20, hit * 5)
  }
  if (room.verified) score += 4
  if (room.featured) score += 3
  if (room.reports >= 2) score -= 8
  if (score > 99) score = 99
  if (score < 5) score = 5
  return score
}

function parseRoomFilters(url) {
  const q = url.searchParams
  const num = (k) => {
    const v = q.get(k)
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const amenities = (q.get('amenities') || '').split(',').map((s) => s.trim()).filter(Boolean)
  // Multi-district selection: clients send repeated `?district=A&district=B`
  // params. Old clients (and saved-filter URLs) used a single value or a
  // comma-separated list — both still parse here.
  //
  // We canonicalize every accepted value through normalizeDistrict so
  // unaccented inputs ("Dong Da", "Cau Giay") match accented stored values
  // and vice-versa. Any value that fails to normalize is recorded in
  // `unknownDistricts` so applyRoomFilters can fail-closed instead of
  // silently widening the result to all districts.
  const districts = []
  const unknownDistricts = []
  const seen = new Set()
  const pushDistrict = (v) => {
    if (typeof v !== 'string') return
    const s = v.trim()
    if (!s) return
    const canonical = normalizeDistrict(s)
    if (!canonical) { unknownDistricts.push(s); return }
    if (seen.has(canonical)) return
    seen.add(canonical); districts.push(canonical)
  }
  for (const raw of q.getAll('district')) {
    for (const part of raw.split(',')) pushDistrict(part)
  }
  const roomType = q.get('roomType') || null
  const sort = q.get('sort') || 'match'
  return {
    districts,
    unknownDistricts,
    roomType,
    priceMin: num('priceMin'),
    priceMax: num('priceMax'),
    areaMin: num('areaMin'),
    amenities,
    sort,
    text: (q.get('q') || '').trim().toLowerCase(),
  }
}

function applyRoomFilters(list, filters) {
  let out = list
  // Caller asked for district(s) that don't map to anything supported (e.g.
  // a typo, or a city-level "Hà Nội" sent in the district field). Refuse
  // rather than silently widening the result to every district — the user
  // would otherwise see thousands of unrelated rooms and think the filter
  // works. Returning an empty list here matches the smallest behavioural
  // change versus the previous "silent widen" path.
  const hasUnknownOnly =
    (!filters.districts || filters.districts.length === 0) &&
    Array.isArray(filters.unknownDistricts) && filters.unknownDistricts.length > 0
  if (hasUnknownOnly) return []
  if (filters.districts && filters.districts.length) {
    // filters.districts is already canonical (see parseRoomFilters). Stored
    // rooms may still have dirty values from before write-side normalization
    // landed, so we compare via districtsMatch which folds both sides.
    const wanted = filters.districts
    out = out.filter((r) => wanted.some((w) => districtsMatch(r.district, w)))
  }
  if (filters.roomType && VALID_ROOM_TYPES.has(filters.roomType)) {
    out = out.filter((r) => r.roomType === filters.roomType)
  }
  if (filters.priceMin != null) out = out.filter((r) => r.priceVnd >= filters.priceMin)
  if (filters.priceMax != null) out = out.filter((r) => r.priceVnd <= filters.priceMax)
  if (filters.areaMin != null) out = out.filter((r) => r.areaM2 >= filters.areaMin)
  if (filters.amenities.length) {
    out = out.filter((r) => filters.amenities.every((a) => r.amenities.includes(a)))
  }
  if (filters.text) {
    out = out.filter((r) =>
      (r.title + ' ' + r.description + ' ' + r.district + ' ' + r.ward + ' ' + r.addressHint)
        .toLowerCase().includes(filters.text))
  }
  return out
}

async function handleListRooms(req, res, url) {
  const filters = parseRoomFilters(url)
  const all = rooms.listActive(1000)
  const filtered = applyRoomFilters(all, filters)
  const u = userForRequest(req)
  let seen = new Set()
  if (u) seen = new Set(swipes.seenRoomIds(u.id))
  // Hide seen so swipe deck advances. Detail view still works since /rooms/:id
  // doesn't go through this filter.
  const excludeSeen = url.searchParams.get('excludeSeen') !== '0'
  let list = filtered
  if (u && excludeSeen) list = list.filter((r) => !seen.has(r.id))

  const enriched = list.map((r) => {
    const matchScore = computeMatch(r, filters)
    const rating = reviews.summaryForRoom(r.id)
    // Source is per-room: an owner browsing the deck sees their own rooms
    // tagged, but never another landlord's source.
    return publicRoom(r, { matchScore, rating, includeSource: canSeeSource(r, u) })
  })
  if (filters.sort === 'price-asc') enriched.sort((a, b) => a.priceVnd - b.priceVnd)
  else if (filters.sort === 'price-desc') enriched.sort((a, b) => b.priceVnd - a.priceVnd)
  else if (filters.sort === 'newest') enriched.sort((a, b) => b.createdAt - a.createdAt)
  else if (filters.sort === 'area') enriched.sort((a, b) => b.areaM2 - a.areaM2)
  else enriched.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))

  return sendJson(req, res, 200, {
    ok: true,
    total: enriched.length,
    rooms: enriched,
    filters,
  })
}

async function handleGetRoom(req, res, id) {
  const r = rooms.findById(id)
  if (!r || r.status === 'hidden' || r.status === 'closed') return notFound(req, res, 'Phòng không còn hoạt động.')
  rooms.incViews(id)
  const u = userForRequest(req)
  const myAction = u ? (swipes.find(u.id, id)?.action || null) : null
  const photoList = u && (u.isAdmin || u.id === r.ownerId)
    ? photos.forRoomVisible(id) // owners/admins see pending too
    : photos.forRoomApproved(id)
  return sendJson(req, res, 200, {
    ok: true,
    room: publicRoom(r, {
      rating: reviews.summaryForRoom(id),
      includeSource: canSeeSource(r, u),
    }),
    reviews: reviews.forRoom(id),
    contributedPhotos: photoList,
    myAction,
  })
}

function validateRoomPayload(body, partial = false) {
  const errors = []
  const required = (cond, msg) => { if (!cond) errors.push(msg) }
  const strField = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max

  const title = (body.title || '').trim()
  const description = (body.description || '').trim()
  // Canonicalize district at write time so the rooms table only ever stores
  // the accented Vietnamese form (e.g. "Đống Đa"), even if the caller typed
  // "dong da" or "Dong  Da". Anything that doesn't map to a supported Hanoi
  // district — including the city-level "Hà Nội" — falls through to the
  // VALID_DISTRICTS check below and surfaces a 400.
  const districtRaw = (body.district || '').trim()
  const districtCanonical = normalizeDistrict(districtRaw)
  const district = districtCanonical || districtRaw
  const ward = (body.ward || '').trim()
  const addressHint = (body.addressHint || '').trim()
  const roomType = (body.roomType || '').trim()
  const priceVnd = Number(body.priceVnd)
  const depositVnd = Number(body.depositVnd ?? 0)
  const areaM2 = Number(body.areaM2)
  const contactName = (body.contactName || '').trim()
  const contactPhone = (body.contactPhone || '').trim()
  const contactZalo = (body.contactZalo || '').trim()
  const amenities = Array.isArray(body.amenities) ? body.amenities : []
  const images = Array.isArray(body.images) ? body.images : []
  const fees = body.fees && typeof body.fees === 'object' ? body.fees : {}
  const rules = body.rules && typeof body.rules === 'object' ? body.rules : {}
  // `source` is optional and owner-private. Accept any non-empty trimmed
  // string up to MAX_SOURCE chars, or an explicit empty string / null to
  // clear it. Anything else is a 400. The field never appears in public
  // projections — see publicRoom's includeSource gate.
  let sourceValue
  if (body.source === undefined) sourceValue = undefined
  else if (body.source === null || body.source === '') sourceValue = null
  else if (typeof body.source !== 'string') {
    errors.push('Nguồn phải là chữ.')
    sourceValue = undefined
  } else {
    const s = body.source.trim()
    if (s.length === 0) sourceValue = null
    else if (s.length > MAX_SOURCE) {
      errors.push(`Nguồn tối đa ${MAX_SOURCE} ký tự.`)
      sourceValue = undefined
    } else sourceValue = s
  }

  if (!partial || title) required(strField(title, MAX_TITLE), 'Tiêu đề từ 1–140 ký tự.')
  if (!partial || description) required(strField(description, MAX_DESC), 'Mô tả từ 1–4000 ký tự.')
  if (!partial || roomType) required(VALID_ROOM_TYPES.has(roomType), 'Loại phòng không hợp lệ.')
  if (!partial || districtRaw) required(
    !!districtCanonical && VALID_DISTRICTS.has(districtCanonical),
    isCityLevel(districtRaw)
      ? 'Vui lòng chọn quận/huyện cụ thể trong Hà Nội thay vì "Hà Nội" chung.'
      : 'Quận/Huyện chưa hỗ trợ.',
  )
  if (!partial || ward) required(strField(ward, 80), 'Phường không hợp lệ.')
  if (!partial || addressHint) required(strField(addressHint, 200), 'Mô tả vị trí không hợp lệ.')
  if (!partial || body.priceVnd !== undefined) required(Number.isFinite(priceVnd) && priceVnd >= 300_000 && priceVnd <= 200_000_000, 'Giá thuê 300k – 200tr.')
  if (!partial || body.areaM2 !== undefined) required(Number.isFinite(areaM2) && areaM2 >= 6 && areaM2 <= 500, 'Diện tích 6 – 500 m².')
  if (body.depositVnd !== undefined) required(Number.isFinite(depositVnd) && depositVnd >= 0 && depositVnd <= 500_000_000, 'Cọc không hợp lệ.')
  if (!partial || contactName) required(NAME_RE.test(contactName), 'Tên liên hệ không hợp lệ.')
  if (!partial || contactPhone) required(PHONE_RE.test(contactPhone), 'Số điện thoại không hợp lệ.')
  if (contactZalo) required(PHONE_RE.test(contactZalo), 'Zalo không hợp lệ.')
  required(amenities.every((a) => VALID_AMENITY_KEYS.includes(a)), 'Có tiện nghi không hợp lệ.')
  required(images.length <= MAX_IMAGES, `Tối đa ${MAX_IMAGES} ảnh.`)
  required(images.every((u) => typeof u === 'string' && u.length < 600 && isAcceptedImageUrl(u)), 'Có ảnh không phải URL hợp lệ.')
  // Fees: numbers >= 0
  for (const [k, v] of Object.entries(fees)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10_000_000) errors.push(`Phí "${k}" không hợp lệ.`)
  }
  return {
    ok: errors.length === 0,
    errors,
    value: {
      title, description, district, ward, addressHint, roomType,
      priceVnd, depositVnd, areaM2,
      contactName, contactPhone, contactZalo: contactZalo || null,
      amenities, images, fees, rules,
      source: sourceValue,
    },
  }
}

async function handleCreateRoom(req, res) {
  const u = requireUser(req, res); if (!u) return
  const ip = clientIp(req)
  const rl = rateHit(`write:${ip}`, RATE_LIMITS.write.perIp.max, RATE_LIMITS.write.perIp.windowMs)
  if (!rl.ok) return rateLimited(req, res, rl.retryAfter)

  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const v = validateRoomPayload(body)
  if (!v.ok) return badRequest(req, res, v.errors.join(' '))

  const now = Date.now()
  const room = rooms.insert({
    id: newId('room'),
    ...v.value,
    // Validator returns sourceValue ∈ { string, null, undefined }; storage
    // treats undefined as null for INSERT.
    source: v.value.source ?? null,
    verified: false,
    status: 'active', // MVP: auto-active; admin can hide later. Easy to flip to 'pending'.
    featured: false,
    ownerId: u.id,
    isSeed: false,
    createdAt: now,
    updatedAt: now,
    availableAt: now,
  })
  // Promote user to landlord if they were a seeker.
  if (u.role === 'seeker') users.update(u.id, { role: 'landlord' })
  audit.push('room.create', { userId: u.id, roomId: room.id })
  // Creator is always the owner → safe to include source in the echo.
  return sendJson(req, res, 201, { ok: true, room: publicRoom(room, { includeSource: true }) })
}

async function handleUpdateRoom(req, res, id) {
  const u = requireUser(req, res); if (!u) return
  const existing = rooms.findById(id)
  if (!existing) return notFound(req, res, 'Phòng không tồn tại.')
  if (existing.ownerId !== u.id && !u.isAdmin) return forbidden(req, res)

  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const v = validateRoomPayload(body, true)
  if (!v.ok) return badRequest(req, res, v.errors.join(' '))

  const patch = {}
  for (const k of [
    'title', 'roomType', 'priceVnd', 'depositVnd', 'areaM2',
    'district', 'ward', 'addressHint', 'description',
    'contactName', 'contactPhone', 'contactZalo',
  ]) if (body[k] !== undefined) patch[k] = v.value[k]
  if (body.amenities) patch.amenities = v.value.amenities
  if (body.images) patch.images = v.value.images
  if (body.fees) patch.fees = v.value.fees
  if (body.rules) patch.rules = v.value.rules

  let updated = existing
  const patchedFields = Object.keys(patch)
  if (patchedFields.length) {
    updated = rooms.update(id, patch)
    audit.push('room.update', { userId: u.id, roomId: id, fields: patchedFields })
  }
  // source uses a dedicated UPDATE so that an explicit "" / null clears it
  // (COALESCE in rooms.update would treat a null as "leave unchanged").
  if (body.source !== undefined) {
    rooms.setSource(id, v.value.source ?? null)
    updated = rooms.findById(id)
    audit.push('room.update', { userId: u.id, roomId: id, fields: ['source'] })
  }
  // Owners may toggle their own listing between active / closed / hidden so
  // they can re-open a closed tin without re-typing the form. Admin status
  // changes go through the admin endpoint.
  if (typeof body.status === 'string') {
    const next = body.status
    if (!['active', 'closed', 'hidden'].includes(next)) {
      return badRequest(req, res, 'Trạng thái không hợp lệ.')
    }
    rooms.setStatus(id, next)
    updated = rooms.findById(id)
    audit.push('room.status', { userId: u.id, roomId: id, status: next })
  }
  // Caller is either the owner or admin (gated above) → always safe to
  // include source in the response.
  return sendJson(req, res, 200, { ok: true, room: publicRoom(updated, { includeSource: true }) })
}

async function handleDeleteRoom(req, res, id) {
  const u = requireUser(req, res); if (!u) return
  const existing = rooms.findById(id)
  if (!existing) return notFound(req, res, 'Phòng không tồn tại.')
  if (existing.ownerId !== u.id && !u.isAdmin) return forbidden(req, res)
  // Snapshot images BEFORE the row goes — the images_json column is destroyed
  // with the row, so capturing here is the only chance to know what to clean.
  const images = Array.isArray(existing.images) ? existing.images.slice() : []
  rooms.delete(id)
  audit.push('room.delete', { userId: u.id, roomId: id, imageCount: images.length })
  await disposeRoomImages(id, images, 'owner')
  return sendJson(req, res, 200, { ok: true })
}

async function handleMyRooms(req, res) {
  const u = requireUser(req, res); if (!u) return
  // Every row in this list is owned by the caller — always include source.
  const list = rooms.byOwner(u.id).map((r) => publicRoom(r, { includeSource: true }))
  return sendJson(req, res, 200, { ok: true, rooms: list })
}

// ---------- swipes ----------
async function handleSwipe(req, res, id) {
  const room = rooms.findById(id)
  if (!room || room.status !== 'active') return notFound(req, res, 'Phòng không còn hoạt động.')

  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const action = String(body.action || '').trim().toLowerCase()
  if (!['like', 'pass'].includes(action)) return badRequest(req, res, 'Hành động phải là like hoặc pass.')

  if (action === 'like') {
    const u = requireUser(req, res); if (!u) return
    const prev = swipes.find(u.id, id)
    if (prev?.action !== 'like') {
      transaction(() => {
        swipes.upsert(u.id, id, 'like')
        rooms.incLikes(id)
      })
    }
    audit.push('swipe.like', { userId: u.id, roomId: id })
    return sendJson(req, res, 200, { ok: true, action: 'like' })
  }
  // pass: anonymous OK — client also stores locally; server records only if logged in
  const u = userForRequest(req)
  if (u) {
    const prev = swipes.find(u.id, id)
    if (prev?.action === 'like') {
      transaction(() => {
        swipes.upsert(u.id, id, 'pass')
        rooms.decLikes(id)
      })
    } else {
      swipes.upsert(u.id, id, 'pass')
    }
  }
  return sendJson(req, res, 200, { ok: true, action: 'pass' })
}

async function handleSavedList(req, res) {
  const u = requireUser(req, res); if (!u) return
  const list = swipes.likedRoomsForUser(u.id).map((r) => publicRoom(r, {
    rating: reviews.summaryForRoom(r.id),
    includeSource: canSeeSource(r, u),
  }))
  return sendJson(req, res, 200, { ok: true, rooms: list })
}

async function handleSwipeRemove(req, res, id) {
  const u = requireUser(req, res); if (!u) return
  const prev = swipes.find(u.id, id)
  if (prev?.action === 'like') rooms.decLikes(id)
  swipes.remove(u.id, id)
  return sendJson(req, res, 200, { ok: true })
}

// ---------- reviews ----------
async function handleCreateReview(req, res, id) {
  const u = requireUser(req, res); if (!u) return
  const room = rooms.findById(id)
  if (!room) return notFound(req, res, 'Phòng không tồn tại.')

  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const stars = Number(body.stars)
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return badRequest(req, res, 'Số sao 1–5.')
  const text = (body.text || '').trim()
  if (text.length < 5 || text.length > MAX_REVIEW_TEXT) {
    return badRequest(req, res, `Nhận xét từ 5 đến ${MAX_REVIEW_TEXT} ký tự.`)
  }

  try {
    const rev = reviews.insert({
      id: newId('rev'),
      roomId: id, userId: u.id, stars, text, createdAt: Date.now(),
    })
    audit.push('review.create', { userId: u.id, roomId: id, stars })
    return sendJson(req, res, 201, { ok: true, review: rev })
  } catch (err) {
    if (String(err).includes('UNIQUE')) return conflict(req, res, 'Bạn đã đánh giá phòng này rồi.')
    throw err
  }
}

// ---------- reports ----------
async function handleCreateReport(req, res, id) {
  const u = requireUser(req, res); if (!u) return
  const room = rooms.findById(id)
  if (!room) return notFound(req, res, 'Phòng không tồn tại.')

  const rl = rateHit(`report:${u.id}`, RATE_LIMITS.report.perUser.max, RATE_LIMITS.report.perUser.windowMs)
  if (!rl.ok) return rateLimited(req, res, rl.retryAfter, 'Bạn đã báo cáo nhiều phòng hôm nay.')

  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const reason = String(body.reason || '').trim()
  if (!VALID_REPORT_REASONS.has(reason)) return badRequest(req, res, 'Lý do báo cáo không hợp lệ.')
  const detail = (body.detail || '').trim()
  if (detail.length > MAX_REPORT_DETAIL) return badRequest(req, res, 'Chi tiết quá dài.')

  try {
    transaction(() => {
      reports.insert({
        id: newId('rep'),
        roomId: id, userId: u.id, reason, detail, createdAt: Date.now(),
      })
      rooms.incReports(id)
    })
  } catch (err) {
    if (String(err).includes('UNIQUE')) return conflict(req, res, 'Bạn đã báo cáo phòng này.')
    throw err
  }
  audit.push('report.create', { userId: u.id, roomId: id, reason })
  return sendJson(req, res, 201, { ok: true })
}

// ---------- contributed photos ----------
async function handleCreatePhoto(req, res, id) {
  const u = requireUser(req, res); if (!u) return
  const room = rooms.findById(id)
  if (!room) return notFound(req, res, 'Phòng không tồn tại.')

  const rl = rateHit(`photo:${u.id}`, RATE_LIMITS.photo.perUser.max, RATE_LIMITS.photo.perUser.windowMs)
  if (!rl.ok) return rateLimited(req, res, rl.retryAfter, 'Bạn đã đóng góp nhiều ảnh hôm nay.')

  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const url = (body.url || '').trim()
  if (url.length > 600 || !isAcceptedImageUrl(url)) {
    return badRequest(req, res, 'URL ảnh không hợp lệ.')
  }
  const caption = (body.caption || '').trim()
  if (caption.length > 240) return badRequest(req, res, 'Chú thích quá dài.')

  const p = photos.insert({
    id: newId('ph'),
    roomId: id, userId: u.id, url, caption, createdAt: Date.now(),
  })
  audit.push('photo.contribute', { userId: u.id, roomId: id, photoId: p.id })
  return sendJson(req, res, 201, { ok: true, photo: p })
}

// ---------- admin ----------
async function handleAdminStats(req, res) {
  const u = requireAdmin(req, res); if (!u) return
  const roomCounts = rooms.countsByStatus()
  return sendJson(req, res, 200, {
    ok: true,
    stats: {
      activeUsers: users.countActive(),
      rooms: roomCounts,
      flaggedRooms: rooms.countFlagged(),
      openReports: reports.countOpen(),
      pendingPhotos: photos.countPending(),
    },
  })
}

async function handleAdminListRooms(req, res) {
  const u = requireAdmin(req, res); if (!u) return
  const list = rooms.listAll(1000).map((r) => publicRoom(r, { includeSource: true }))
  return sendJson(req, res, 200, { ok: true, rooms: list })
}

async function handleAdminPatchRoom(req, res, id) {
  const u = requireAdmin(req, res); if (!u) return
  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const room = rooms.findById(id)
  if (!room) return notFound(req, res, 'Phòng không tồn tại.')
  if (body.status && ['active', 'hidden', 'closed', 'pending'].includes(body.status)) {
    rooms.setStatus(id, body.status)
  }
  if (typeof body.featured === 'boolean') rooms.setFeatured(id, body.featured)
  if (typeof body.verified === 'boolean') rooms.setVerified(id, body.verified)
  audit.push('admin.room.patch', { adminId: u.id, roomId: id, body })
  return sendJson(req, res, 200, { ok: true, room: publicRoom(rooms.findById(id), { includeSource: true }) })
}

async function handleAdminDeleteRoom(req, res, id) {
  const u = requireAdmin(req, res); if (!u) return
  const room = rooms.findById(id); if (!room) return notFound(req, res, 'Phòng không tồn tại.')
  const images = Array.isArray(room.images) ? room.images.slice() : []
  rooms.delete(id)
  audit.push('admin.room.delete', { adminId: u.id, roomId: id, imageCount: images.length })
  await disposeRoomImages(id, images, 'admin')
  return sendJson(req, res, 200, { ok: true })
}

async function handleAdminListReports(req, res) {
  const u = requireAdmin(req, res); if (!u) return
  const list = reports.listOpen(200)
  return sendJson(req, res, 200, { ok: true, reports: list })
}

async function handleAdminResolveReport(req, res, id) {
  const u = requireAdmin(req, res); if (!u) return
  reports.resolve(id)
  audit.push('admin.report.resolve', { adminId: u.id, reportId: id })
  return sendJson(req, res, 200, { ok: true })
}

async function handleAdminListPhotos(req, res) {
  const u = requireAdmin(req, res); if (!u) return
  const list = photos.listPending(200)
  return sendJson(req, res, 200, { ok: true, photos: list })
}

async function handleAdminPatchPhoto(req, res, id) {
  const u = requireAdmin(req, res); if (!u) return
  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const status = String(body.status || '').trim()
  if (!['approved', 'rejected'].includes(status)) return badRequest(req, res, 'status phải là approved hoặc rejected.')
  photos.setStatus(id, status)
  audit.push('admin.photo.review', { adminId: u.id, photoId: id, status })
  return sendJson(req, res, 200, { ok: true })
}

async function handleAdminListUsers(req, res) {
  const u = requireAdmin(req, res); if (!u) return
  const list = users.listAll(500).map((x) => ({ ...publicUser(x), isAdmin: x.isAdmin }))
  return sendJson(req, res, 200, { ok: true, users: list })
}

async function handleAdminPatchUser(req, res, id) {
  const u = requireAdmin(req, res); if (!u) return
  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const target = users.findById(id); if (!target) return notFound(req, res, 'Người dùng không tồn tại.')
  if (typeof body.suspended === 'boolean') users.setSuspended(id, body.suspended ? Date.now() : null)
  if (typeof body.isAdmin === 'boolean') users.setAdmin(id, body.isAdmin)
  if (body.role && ['seeker', 'landlord', 'admin'].includes(body.role)) users.update(id, { role: body.role })
  audit.push('admin.user.patch', { adminId: u.id, targetId: id, body })
  return sendJson(req, res, 200, { ok: true, user: publicUser(users.findById(id)) })
}

// ---------- uploads ----------
// Decides whether a given URL is allowed in room.images / contributed photos.
// Accepts: local /uploads, our own Cloudinary URLs (when configured), or any
// external https URL (long-standing behaviour for "paste a link").
function isAcceptedImageUrl(u) {
  if (UPLOAD_URL_RE.test(u)) return true
  if (CLOUDINARY_URL_RE && CLOUDINARY_URL_RE.test(u)) return true
  return URL_RE.test(u)
}

// Tells the frontend which upload provider to use. Frontend probes this once
// on first upload attempt and caches it for the session.
async function handleUploadConfig(req, res) {
  if (CLOUDINARY_ENABLED) {
    return sendJson(req, res, 200, {
      ok: true,
      provider: 'cloudinary',
      cloudName: CLOUDINARY_CLOUD_NAME,
      apiKey: CLOUDINARY_API_KEY,
      folder: CLOUDINARY_UPLOAD_FOLDER,
      maxBytes: UPLOAD_MAX_BYTES,
    })
  }
  return sendJson(req, res, 200, {
    ok: true,
    provider: 'local',
    maxBytes: UPLOAD_MAX_BYTES,
  })
}

// Cloudinary signed-upload helper. We ALONE hold the API secret; the frontend
// asks us for a signature (which carries a short-lived timestamp) and uses it
// to POST the file directly to Cloudinary's edge. Saves VPS bandwidth and
// keeps the secret out of the bundle.
async function handleCloudinarySign(req, res) {
  if (!CLOUDINARY_ENABLED) {
    return sendJson(req, res, 503, { ok: false, error: 'Cloudinary chưa được cấu hình.' })
  }
  const u = requireUser(req, res); if (!u) return
  const ip = clientIp(req)
  const limit = rateHit(`write:${ip}`, RATE_LIMITS.write.perIp.max, RATE_LIMITS.write.perIp.windowMs)
  if (!limit.ok) return sendJson(req, res, 429, { ok: false, error: 'Quá nhiều yêu cầu, thử lại sau.' }, { 'Retry-After': String(limit.retryAfter) })

  // Cloudinary's signing rule: alphabetical "name=value" pairs joined by &,
  // then the secret appended (NOT "&"). The `file`, `api_key`, `signature`,
  // `cloud_name`, and `resource_type` params are NEVER signed.
  // https://cloudinary.com/documentation/signatures
  const timestamp = Math.floor(Date.now() / 1000)
  const folder = CLOUDINARY_UPLOAD_FOLDER
  // Whitelist on the Cloudinary side too — Cloudinary refuses uploads whose
  // detected format isn't in this list. Defense in depth alongside our
  // client-side accept= filter.
  const allowedFormats = 'jpg,png,webp,gif,avif'
  const paramsToSign = [
    `allowed_formats=${allowedFormats}`,
    `folder=${folder}`,
    `timestamp=${timestamp}`,
  ].join('&')
  const signature = crypto.createHash('sha1').update(paramsToSign + CLOUDINARY_API_SECRET).digest('hex')

  audit.push('upload.sign', { userId: u.id, timestamp })
  return sendJson(req, res, 200, {
    ok: true,
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    timestamp,
    folder,
    allowedFormats,
    signature,
  })
}

// Single-file binary POST. Frontend sends the file as raw bytes with the MIME
// type in Content-Type; metadata (room id, captions, etc.) is plumbed through
// the consuming endpoint (room create/update or contribute photo) after the
// upload returns its URL. Keeps server parsing limited to a Buffer concat.
async function handleUploadImage(req, res) {
  const u = requireUser(req, res); if (!u) return
  const ip = clientIp(req)
  const limit = rateHit(`write:${ip}`, RATE_LIMITS.write.perIp.max, RATE_LIMITS.write.perIp.windowMs)
  if (!limit.ok) return sendJson(req, res, 429, { ok: false, error: 'Bạn upload quá nhanh, thử lại sau.' }, { 'Retry-After': String(limit.retryAfter) })

  const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  const ext = UPLOAD_MIME_TO_EXT[mime]
  if (!ext) {
    return sendJson(req, res, 415, {
      ok: false,
      error: 'Chỉ chấp nhận JPG, PNG, WebP, GIF hoặc AVIF. Ảnh HEIC/HEIF không hiển thị trên trình duyệt — vui lòng đổi định dạng.',
    })
  }

  let body
  try { body = await readRawBody(req, UPLOAD_MAX_BYTES) }
  catch (err) {
    if (err && err.code === 'PAYLOAD') {
      return sendJson(req, res, 413, { ok: false, error: `Ảnh quá ${(UPLOAD_MAX_BYTES / 1024 / 1024).toFixed(0)} MB.` })
    }
    throw err
  }
  if (body.length < 64) return badRequest(req, res, 'Tệp rỗng hoặc lỗi.')

  // Magic-byte sniff to reject anything that's not actually the claimed image
  // format. Cheap defence against someone uploading a JS/HTML blob with
  // Content-Type: image/jpeg hoping the browser will render it later.
  if (!matchesImageMagic(body, ext)) {
    return badRequest(req, res, 'Tệp không phải ảnh hợp lệ.')
  }

  const filename = `${crypto.randomBytes(12).toString('hex')}.${ext}`
  const target = path.join(uploadDir, filename)
  await fs.promises.writeFile(target, body)
  audit.push('upload', { userId: u.id, file: filename, bytes: body.length, mime })
  return sendJson(req, res, 201, { ok: true, url: `/uploads/${filename}`, bytes: body.length })
}

// Returns true if the buffer starts with the magic bytes of the claimed
// format. Conservative: a stripped EXIF or odd encoder can still pass.
function matchesImageMagic(buf, ext) {
  if (ext === 'jpg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  if (ext === 'png') return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  if (ext === 'gif') return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46
  if (ext === 'webp') return buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
                      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  if (ext === 'avif') {
    // ISO BMFF: bytes 4..7 = 'ftyp', then a brand. Cheap check for 'avif'/'avis'.
    if (buf[4] !== 0x66 || buf[5] !== 0x74 || buf[6] !== 0x79 || buf[7] !== 0x70) return false
    const brand = buf.slice(8, 12).toString('ascii')
    return brand === 'avif' || brand === 'avis' || brand === 'mif1'
  }
  return false
}

// Serves uploaded files. Lives on the API so the data dir has a single owner —
// the web tier proxies /uploads/* here, same as /api/*.
async function handleServeUpload(req, res, name) {
  if (!name || !UPLOAD_FILENAME_RE.test(name)) {
    return sendJson(req, res, 404, { ok: false, error: 'Không tìm thấy ảnh.' })
  }
  const filepath = path.join(uploadDir, name)
  // Guard against path traversal even though the regex already constrains it.
  if (!filepath.startsWith(uploadDir)) {
    return sendJson(req, res, 403, { ok: false, error: 'Forbidden.' })
  }
  try {
    const stat = await fs.promises.stat(filepath)
    if (!stat.isFile()) throw new Error('not-a-file')
    const ext = path.extname(name).slice(1).toLowerCase()
    const mime = Object.entries(UPLOAD_MIME_TO_EXT).find(([, e]) => e === ext)?.[0] || 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      // Uploaded files are content-addressed by random hex → safe to cache
      // forever. If the user removes & re-uploads, they get a new filename.
      'Cache-Control': 'public, max-age=31536000, immutable',
      ...corsHeaders(req),
    })
    if (req.method === 'HEAD') { res.end(); return }
    fs.createReadStream(filepath).pipe(res)
  } catch {
    return sendJson(req, res, 404, { ok: false, error: 'Không tìm thấy ảnh.' })
  }
}

// ---------- health ----------
async function handleHealth(req, res) {
  return sendJson(req, res, 200, {
    ok: true,
    service: 'odn-api',
    env: isProd ? 'production' : 'dev',
    googleOauth: GOOGLE_OAUTH_ENABLED,
    demoAuth: ALLOW_DEMO_AUTH,
    uploads: CLOUDINARY_ENABLED ? `cloudinary:${CLOUDINARY_CLOUD_NAME}` : 'local',
    telegram: telegramEnabled() ? 'on' : 'off',
  })
}

// GET /api/admin/audit — reads the audit table so ops can debug "who did
// what when". Supports kind prefix filter (e.g. `kind=admin.` matches every
// admin action) and pagination via limit/offset.
async function handleAdminAuditList(req, res, url) {
  const u = requireAdmin(req, res); if (!u) return
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100))
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  const kind = url.searchParams.get('kind') || null
  const entries = audit.list({ limit, offset, kind })
  return sendJson(req, res, 200, {
    ok: true,
    entries,
    total: audit.count(),
    limit, offset, kind,
  })
}

// On-demand backup. Same retention rules as the scheduled loop — it's just an
// extra trigger so ops can take a snapshot right before a risky migration or
// before manually editing the DB, without restarting the API.
async function handleAdminBackup(req, res) {
  const u = requireAdmin(req, res); if (!u) return
  try {
    const r = await snapshotBackup()
    if (!r.ok) return sendJson(req, res, 500, { ok: false, error: r.error || r.reason || 'backup-failed' })
    audit.push('admin.backup', { adminId: u.id, file: r.file, kept: r.kept })
    return sendJson(req, res, 200, { ok: true, file: r.file, kept: r.kept })
  } catch (err) {
    logEvent('error', 'admin.backup.fail', { err: String(err) })
    return sendJson(req, res, 500, { ok: false, error: 'Backup failed.' })
  }
}

// ---------- feedbacks (public board) ----------
function publicFeedback(f) {
  if (!f) return null
  return {
    id: f.id,
    userId: f.userId,
    title: f.title,
    content: f.content,
    images: f.images,
    createdAt: f.createdAt,
    author: f.author ? {
      id: f.author.id,
      name: f.author.name,
      avatar: f.author.avatar,
      isAdmin: !!f.author.isAdmin,
    } : null,
  }
}

async function handleListFeedbacks(req, res) {
  const list = feedbacks.list(500)
  return sendJson(req, res, 200, { ok: true, total: list.length, feedbacks: list.map(publicFeedback) })
}

async function handleCreateFeedback(req, res) {
  const u = requireUser(req, res); if (!u) return
  const rl = rateHit(`feedback:${u.id}`, 10, 60 * 60 * 1000)
  if (!rl.ok) return rateLimited(req, res, rl.retryAfter, 'Bạn gửi góp ý quá nhanh, thử lại sau ít phút.')
  const body = await readJsonBody(req).catch(() => null)
  if (!body || typeof body !== 'object') return badRequest(req, res, 'Body JSON không hợp lệ.')
  const title = String(body.title || '').trim()
  const content = String(body.content || '').trim()
  let images = Array.isArray(body.images) ? body.images : []
  if (!title) return badRequest(req, res, 'Tiêu đề không được trống.')
  if (title.length > MAX_FEEDBACK_TITLE) return badRequest(req, res, `Tiêu đề tối đa ${MAX_FEEDBACK_TITLE} ký tự.`)
  if (!content) return badRequest(req, res, 'Nội dung không được trống.')
  if (content.length > MAX_FEEDBACK_CONTENT) return badRequest(req, res, `Nội dung tối đa ${MAX_FEEDBACK_CONTENT} ký tự.`)
  if (images.length > MAX_FEEDBACK_IMAGES) return badRequest(req, res, `Tối đa ${MAX_FEEDBACK_IMAGES} ảnh.`)
  images = images.map((s) => String(s).trim()).filter(Boolean)
  for (const url of images) {
    if (url.length > 600 || !isAcceptedImageUrl(url)) return badRequest(req, res, 'Có ảnh không hợp lệ.')
  }
  const id = newId('feedback')
  const fresh = feedbacks.insert({ id, userId: u.id, title, content, images, createdAt: Date.now() })
  audit.push('feedback.create', { id, userId: u.id })
  return sendJson(req, res, 201, { ok: true, feedback: publicFeedback(fresh) })
}

async function handleAdminDeleteFeedback(req, res, id) {
  const admin = requireAdmin(req, res); if (!admin) return
  const changes = feedbacks.delete(id)
  if (!changes) return notFound(req, res, 'Không tìm thấy góp ý.')
  audit.push('feedback.delete', { id, adminId: admin.id })
  return sendJson(req, res, 200, { ok: true })
}

function csvEscape(v) {
  let s = String(v ?? '')
  // Defuse spreadsheet formula injection — if Excel/LibreOffice opens a CSV
  // with a cell starting with =/+/-/@/CR/TAB it will be parsed as a formula
  // (or call DDE/cmd), so we prefix a single quote which the spreadsheet
  // displays-but-doesn't-execute. Applies to every cell.
  // See: OWASP "CSV Injection".
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) s = "'" + s
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

async function handleAdminFeedbackCsv(req, res) {
  const admin = requireAdmin(req, res); if (!admin) return
  const list = feedbacks.list(5000)
  const rows = [
    ['id', 'created_at_iso', 'author_name', 'author_email', 'title', 'content', 'images_count', 'images_urls'],
    ...list.map((f) => [
      f.id,
      new Date(f.createdAt).toISOString(),
      f.author?.name || '',
      f.author?.email || '',
      f.title,
      f.content,
      String(f.images.length),
      f.images.join(' | '),
    ]),
  ]
  // UTF-8 BOM so Excel opens the file with the right encoding (Vietnamese diacritics).
  const csv = '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')
  const filename = `gop-y-${new Date().toISOString().slice(0, 10)}.csv`
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    ...corsHeaders(req),
  })
  res.end(csv)
  audit.push('feedback.export', { adminId: admin.id, count: list.length })
}

// ---------- leads (viewing appointments + consultation requests) ----------
// A "lead" is the seeker who wants to be contacted by our consultant — either
// to schedule a physical viewing of a specific room, or just to ask for help
// in general. We persist one canonical name/phone profile per lead identity:
//   * authenticated user → lead_key = `user:<userId>`
//   * anonymous browser  → lead_key = `anon:<clientId>` (uuid-ish, stored in
//                          the browser's localStorage and sent in the request)
// This lets a returning anonymous user prefill their info from a previous
// submission, and lets a logged-in user keep one record across sessions.
const ANON_CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/
const MAX_LEAD_NOTE = 500
const MAX_PREFERRED_AT = 80

// Limits — these are intentionally generous in the steady state (we expect
// few legit submissions per device per hour) but defensive against scripted
// abuse. Per-IP buckets piggy-back on the existing `write` rate limit so the
// shape stays predictable.
function leadIdentity(req) {
  const u = userForRequest(req)
  if (u) return { userId: u.id, clientId: null, leadKey: `user:${u.id}`, user: u }
  return { userId: null, clientId: null, leadKey: null, user: null }
}

function resolveLeadIdentity(req, body) {
  const base = leadIdentity(req)
  if (base.leadKey) return base
  const raw = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
  if (!raw || !ANON_CLIENT_ID_RE.test(raw)) return null
  return { userId: null, clientId: raw, leadKey: `anon:${raw}`, user: null }
}

function validateLeadContact(body) {
  const errors = []
  const name = String(body?.name || '').trim()
  const phone = String(body?.phone || '').trim()
  if (!name || !NAME_RE.test(name)) errors.push('Tên không hợp lệ.')
  if (!phone || !PHONE_RE.test(phone)) errors.push('Số điện thoại không hợp lệ.')
  return { ok: errors.length === 0, errors, name, phone }
}

function publicLeadProfile(p) {
  if (!p) return null
  return {
    name: p.name,
    phone: p.phone,
    email: p.email || null,
    updatedAt: p.updatedAt,
  }
}

function publicViewing(v) {
  if (!v) return null
  return {
    id: v.id,
    roomId: v.roomId,
    name: v.name,
    phone: v.phone,
    preferredAt: v.preferredAt,
    note: v.note,
    status: v.status,
    createdAt: v.createdAt,
  }
}

function publicConsultation(c) {
  if (!c) return null
  return {
    id: c.id,
    roomId: c.roomId,
    name: c.name,
    phone: c.phone,
    note: c.note,
    status: c.status,
    createdAt: c.createdAt,
  }
}

async function handleGetLeadProfile(req, res, url) {
  // GET /api/lead-profile[?clientId=…]
  // Returns the persisted profile so the modal can prefill. For a logged-in
  // user we also fall back to their user record's name/phone if no lead
  // profile exists yet, so first-time flows still feel one-tap.
  const u = userForRequest(req)
  let profile = null
  let source = null
  if (u) {
    profile = leadProfiles.findByKey(`user:${u.id}`)
    source = profile ? 'lead' : null
    if (!profile && (u.name || u.phone)) {
      // Light hint — the modal will treat this as defaults, not as saved data.
      return sendJson(req, res, 200, {
        ok: true,
        profile: { name: u.name || '', phone: u.phone || '', email: u.email || null, updatedAt: null },
        source: 'user',
      })
    }
  } else {
    const clientId = (url.searchParams.get('clientId') || '').trim()
    if (clientId && ANON_CLIENT_ID_RE.test(clientId)) {
      profile = leadProfiles.findByKey(`anon:${clientId}`)
      source = profile ? 'lead' : null
    }
  }
  return sendJson(req, res, 200, {
    ok: true,
    profile: publicLeadProfile(profile),
    source,
  })
}

async function handlePutLeadProfile(req, res) {
  // POST /api/lead-profile — explicit "remember me" used by the consultation
  // modal when the user edits and saves their info without yet creating a
  // ticket. Most callers go through the viewing/consultation endpoints, which
  // upsert this row as a side-effect.
  const ip = clientIp(req)
  const rl = rateHit(`lead-profile:${ip}`, 30, 60 * 60 * 1000)
  if (!rl.ok) return rateLimited(req, res, rl.retryAfter)

  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const ident = resolveLeadIdentity(req, body)
  if (!ident) return badRequest(req, res, 'Thiếu định danh khách (clientId).')
  const v = validateLeadContact(body)
  if (!v.ok) return badRequest(req, res, v.errors.join(' '))

  const now = Date.now()
  const profile = leadProfiles.upsert({
    leadKey: ident.leadKey,
    userId: ident.userId,
    clientId: ident.clientId,
    name: v.name,
    phone: v.phone,
    email: ident.user?.email || null,
    now,
  })
  audit.push('lead.profile.save', { leadKey: ident.leadKey, userId: ident.userId, anon: !ident.userId })
  return sendJson(req, res, 200, { ok: true, profile: publicLeadProfile(profile) })
}

async function handleCreateViewingAppointment(req, res) {
  // POST /api/viewing-appointments
  // { roomId, name, phone, preferredAt, note?, clientId? }
  const ip = clientIp(req)
  const rl = rateHit(`lead:${ip}`, 20, 60 * 60 * 1000)
  if (!rl.ok) return rateLimited(req, res, rl.retryAfter)

  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const ident = resolveLeadIdentity(req, body)
  if (!ident) return badRequest(req, res, 'Thiếu định danh khách (clientId).')

  const roomId = String(body.roomId || '').trim()
  if (!roomId) return badRequest(req, res, 'Thiếu mã phòng.')
  const room = rooms.findById(roomId)
  if (!room || room.status === 'hidden' || room.status === 'closed') {
    return notFound(req, res, 'Phòng không còn hoạt động.')
  }

  const v = validateLeadContact(body)
  if (!v.ok) return badRequest(req, res, v.errors.join(' '))

  const preferredAt = String(body.preferredAt || '').trim()
  if (!preferredAt || preferredAt.length > MAX_PREFERRED_AT) {
    return badRequest(req, res, 'Vui lòng chọn thời gian xem phòng.')
  }
  const note = (typeof body.note === 'string' ? body.note : '').trim()
  if (note.length > MAX_LEAD_NOTE) return badRequest(req, res, 'Ghi chú quá dài.')

  const now = Date.now()
  const id = newId('view')
  let appointment
  transaction(() => {
    appointment = viewingAppointments.insert({
      id,
      leadKey: ident.leadKey,
      userId: ident.userId,
      clientId: ident.clientId,
      roomId,
      name: v.name,
      phone: v.phone,
      preferredAt,
      note: note || null,
      createdAt: now,
    })
    leadProfiles.upsert({
      leadKey: ident.leadKey,
      userId: ident.userId,
      clientId: ident.clientId,
      name: v.name,
      phone: v.phone,
      email: ident.user?.email || null,
      now,
    })
  })

  audit.push('lead.viewing.create', {
    id, leadKey: ident.leadKey, userId: ident.userId, roomId, anon: !ident.userId,
  })

  // Fire-and-forget Telegram notify. Builder lives in telegram.mjs so the
  // text shape is unit-testable without spinning up the API server.
  notifyTelegram(buildViewingAppointmentMessage({
    room,
    publicUrl: PUBLIC_URL,
    name: v.name,
    phone: v.phone,
    preferredAt,
    note,
    account: formatLeadAccount(ident),
  }))

  return sendJson(req, res, 201, {
    ok: true,
    appointment: publicViewing(appointment),
    message: 'Tư vấn viên của chúng tôi sẽ sớm liên hệ với bạn.',
  })
}

async function handleCreateConsultationRequest(req, res) {
  // POST /api/consultation-requests
  // { name, phone, roomId?, note?, clientId? }
  const ip = clientIp(req)
  const rl = rateHit(`lead:${ip}`, 20, 60 * 60 * 1000)
  if (!rl.ok) return rateLimited(req, res, rl.retryAfter)

  const body = await readJsonBody(req).catch(() => null)
  if (!body) return badRequest(req, res, 'JSON không hợp lệ.')
  const ident = resolveLeadIdentity(req, body)
  if (!ident) return badRequest(req, res, 'Thiếu định danh khách (clientId).')

  const v = validateLeadContact(body)
  if (!v.ok) return badRequest(req, res, v.errors.join(' '))

  let roomId = null
  let room = null
  if (typeof body.roomId === 'string' && body.roomId.trim()) {
    roomId = body.roomId.trim()
    room = rooms.findById(roomId)
    if (!room) roomId = null // tolerate a stale reference rather than 404 a consult ticket
  }
  const note = (typeof body.note === 'string' ? body.note : '').trim()
  if (note.length > MAX_LEAD_NOTE) return badRequest(req, res, 'Ghi chú quá dài.')

  const now = Date.now()
  const id = newId('consult')
  let ticket
  transaction(() => {
    ticket = consultationRequests.insert({
      id,
      leadKey: ident.leadKey,
      userId: ident.userId,
      clientId: ident.clientId,
      roomId,
      name: v.name,
      phone: v.phone,
      note: note || null,
      createdAt: now,
    })
    leadProfiles.upsert({
      leadKey: ident.leadKey,
      userId: ident.userId,
      clientId: ident.clientId,
      name: v.name,
      phone: v.phone,
      email: ident.user?.email || null,
      now,
    })
  })

  audit.push('lead.consult.create', {
    id, leadKey: ident.leadKey, userId: ident.userId, roomId, anon: !ident.userId,
  })

  notifyTelegram(buildConsultationRequestMessage({
    room,
    publicUrl: PUBLIC_URL,
    name: v.name,
    phone: v.phone,
    note,
    account: formatLeadAccount(ident),
  }))

  return sendJson(req, res, 201, {
    ok: true,
    request: publicConsultation(ticket),
    message: 'Tư vấn viên của chúng tôi sẽ sớm liên hệ với bạn.',
  })
}

async function handleMyLeads(req, res, url) {
  // GET /api/my-leads[?clientId=…]
  // Returns the same identity's submissions so the Inbox page can list them.
  const u = userForRequest(req)
  let leadKey = null
  if (u) leadKey = `user:${u.id}`
  else {
    const clientId = (url.searchParams.get('clientId') || '').trim()
    if (clientId && ANON_CLIENT_ID_RE.test(clientId)) leadKey = `anon:${clientId}`
  }
  if (!leadKey) {
    return sendJson(req, res, 200, {
      ok: true,
      viewings: [],
      consultations: [],
      profile: null,
    })
  }
  const viewings = viewingAppointments.listForLead(leadKey, 100).map(publicViewing)
  const consultations = consultationRequests.listForLead(leadKey, 100).map(publicConsultation)
  return sendJson(req, res, 200, {
    ok: true,
    viewings,
    consultations,
    profile: publicLeadProfile(leadProfiles.findByKey(leadKey)),
  })
}

// ---------- routing ----------
const ROUTES = [
  { method: 'GET',    re: /^\/api\/health\/?$/, fn: (req, res) => handleHealth(req, res) },
  { method: 'GET',    re: /^\/api\/auth\/providers\/?$/, fn: (req, res) => handleAuthProviders(req, res) },
  { method: 'GET',    re: /^\/api\/auth\/session\/?$/, fn: (req, res) => handleAuthSession(req, res) },
  { method: 'POST',   re: /^\/api\/auth\/demo\/?$/, fn: (req, res) => handleAuthDemo(req, res) },
  { method: 'POST',   re: /^\/api\/auth\/google\/start\/?$/, fn: (req, res) => handleAuthGoogleStart(req, res) },
  { method: 'POST',   re: /^\/api\/auth\/google\/callback\/?$/, fn: (req, res) => handleAuthGoogleCallback(req, res) },
  { method: 'POST',   re: /^\/api\/auth\/logout\/?$/, fn: (req, res) => handleAuthLogout(req, res) },
  { method: 'POST',   re: /^\/api\/auth\/role\/?$/, fn: (req, res) => handleAuthRoleSwitch(req, res) },
  { method: 'PATCH',  re: /^\/api\/users\/me\/?$/, fn: (req, res) => handleMePatch(req, res) },
  { method: 'DELETE', re: /^\/api\/users\/me\/?$/, fn: (req, res) => handleMeDelete(req, res) },
  { method: 'POST',   re: /^\/api\/me\/verify\/email\/start\/?$/, fn: (req, res) => handleVerifyStart(req, res, 'email') },
  { method: 'POST',   re: /^\/api\/me\/verify\/email\/confirm\/?$/, fn: (req, res) => handleVerifyConfirm(req, res, 'email') },
  { method: 'POST',   re: /^\/api\/me\/verify\/phone\/start\/?$/, fn: (req, res) => handleVerifyStart(req, res, 'phone') },
  { method: 'POST',   re: /^\/api\/me\/verify\/phone\/confirm\/?$/, fn: (req, res) => handleVerifyConfirm(req, res, 'phone') },

  { method: 'PATCH',  re: /^\/api\/reviews\/([\w-]+)\/?$/, fn: (req, res, _u, id) => handleReviewPatch(req, res, id) },
  { method: 'DELETE', re: /^\/api\/reviews\/([\w-]+)\/?$/, fn: (req, res, _u, id) => handleReviewDelete(req, res, id) },
  { method: 'DELETE', re: /^\/api\/photos\/([\w-]+)\/?$/, fn: (req, res, _u, id) => handleContributedPhotoDelete(req, res, id) },

  { method: 'GET',    re: /^\/api\/rooms\/?$/, fn: (req, res, url) => handleListRooms(req, res, url) },
  { method: 'POST',   re: /^\/api\/rooms\/?$/, fn: (req, res) => handleCreateRoom(req, res) },
  { method: 'GET',    re: /^\/api\/rooms\/my\/?$/, fn: (req, res) => handleMyRooms(req, res) },
  { method: 'GET',    re: /^\/api\/rooms\/saved\/?$/, fn: (req, res) => handleSavedList(req, res) },
  { method: 'GET',    re: /^\/api\/rooms\/([\w-]+)\/?$/, fn: (req, res, _u, id) => handleGetRoom(req, res, id) },
  { method: 'PATCH',  re: /^\/api\/rooms\/([\w-]+)\/?$/, fn: (req, res, _u, id) => handleUpdateRoom(req, res, id) },
  { method: 'DELETE', re: /^\/api\/rooms\/([\w-]+)\/?$/, fn: (req, res, _u, id) => handleDeleteRoom(req, res, id) },
  { method: 'POST',   re: /^\/api\/rooms\/([\w-]+)\/swipe\/?$/, fn: (req, res, _u, id) => handleSwipe(req, res, id) },
  { method: 'DELETE', re: /^\/api\/rooms\/([\w-]+)\/swipe\/?$/, fn: (req, res, _u, id) => handleSwipeRemove(req, res, id) },
  { method: 'POST',   re: /^\/api\/rooms\/([\w-]+)\/reviews\/?$/, fn: (req, res, _u, id) => handleCreateReview(req, res, id) },
  { method: 'POST',   re: /^\/api\/rooms\/([\w-]+)\/reports\/?$/, fn: (req, res, _u, id) => handleCreateReport(req, res, id) },
  { method: 'POST',   re: /^\/api\/rooms\/([\w-]+)\/photos\/?$/, fn: (req, res, _u, id) => handleCreatePhoto(req, res, id) },

  { method: 'GET',    re: /^\/api\/admin\/stats\/?$/, fn: (req, res) => handleAdminStats(req, res) },
  { method: 'GET',    re: /^\/api\/admin\/rooms\/?$/, fn: (req, res) => handleAdminListRooms(req, res) },
  { method: 'PATCH',  re: /^\/api\/admin\/rooms\/([\w-]+)\/?$/, fn: (req, res, _u, id) => handleAdminPatchRoom(req, res, id) },
  { method: 'DELETE', re: /^\/api\/admin\/rooms\/([\w-]+)\/?$/, fn: (req, res, _u, id) => handleAdminDeleteRoom(req, res, id) },
  { method: 'GET',    re: /^\/api\/admin\/reports\/?$/, fn: (req, res) => handleAdminListReports(req, res) },
  { method: 'PATCH',  re: /^\/api\/admin\/reports\/([\w-]+)\/?$/, fn: (req, res, _u, id) => handleAdminResolveReport(req, res, id) },
  { method: 'GET',    re: /^\/api\/admin\/photos\/?$/, fn: (req, res) => handleAdminListPhotos(req, res) },
  { method: 'PATCH',  re: /^\/api\/admin\/photos\/([\w-]+)\/?$/, fn: (req, res, _u, id) => handleAdminPatchPhoto(req, res, id) },
  { method: 'GET',    re: /^\/api\/admin\/users\/?$/, fn: (req, res) => handleAdminListUsers(req, res) },
  { method: 'PATCH',  re: /^\/api\/admin\/users\/([\w-]+)\/?$/, fn: (req, res, _u, id) => handleAdminPatchUser(req, res, id) },
  { method: 'GET',    re: /^\/api\/admin\/audit\/?$/, fn: (req, res, url) => handleAdminAuditList(req, res, url) },
  { method: 'POST',   re: /^\/api\/admin\/backup\/?$/, fn: (req, res) => handleAdminBackup(req, res) },
  { method: 'GET',    re: /^\/api\/admin\/feedbacks\.csv\/?$/, fn: (req, res) => handleAdminFeedbackCsv(req, res) },

  { method: 'GET',    re: /^\/api\/feedbacks\/?$/, fn: (req, res) => handleListFeedbacks(req, res) },
  { method: 'POST',   re: /^\/api\/feedbacks\/?$/, fn: (req, res) => handleCreateFeedback(req, res) },
  { method: 'DELETE', re: /^\/api\/feedbacks\/([\w-]+)\/?$/, fn: (req, res, _u, id) => handleAdminDeleteFeedback(req, res, id) },

  { method: 'GET',    re: /^\/api\/lead-profile\/?$/, fn: (req, res, url) => handleGetLeadProfile(req, res, url) },
  { method: 'POST',   re: /^\/api\/lead-profile\/?$/, fn: (req, res) => handlePutLeadProfile(req, res) },
  { method: 'POST',   re: /^\/api\/viewing-appointments\/?$/, fn: (req, res) => handleCreateViewingAppointment(req, res) },
  { method: 'POST',   re: /^\/api\/consultation-requests\/?$/, fn: (req, res) => handleCreateConsultationRequest(req, res) },
  { method: 'GET',    re: /^\/api\/my-leads\/?$/, fn: (req, res, url) => handleMyLeads(req, res, url) },

  { method: 'GET',    re: /^\/api\/uploads\/config\/?$/, fn: (req, res) => handleUploadConfig(req, res) },
  { method: 'POST',   re: /^\/api\/uploads\/cloudinary-sign\/?$/, fn: (req, res) => handleCloudinarySign(req, res) },
  { method: 'POST',   re: /^\/api\/uploads\/?$/, fn: (req, res) => handleUploadImage(req, res) },
  { method: 'GET',    re: /^\/uploads\/([^/?#]+)$/, fn: (req, res, _u, name) => handleServeUpload(req, res, name) },
  { method: 'HEAD',   re: /^\/uploads\/([^/?#]+)$/, fn: (req, res, _u, name) => handleServeUpload(req, res, name) },
]

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req)); res.end(); return
  }

  for (const r of ROUTES) {
    if (req.method !== r.method) continue
    const m = url.pathname.match(r.re)
    if (!m) continue
    try {
      await r.fn(req, res, url, m[1], m[2])
    } catch (err) {
      if (err && err.code === 'PAYLOAD') return sendJson(req, res, 413, { ok: false, error: 'Dữ liệu quá lớn.' })
      if (err && err.code === 'JSON') return sendJson(req, res, 400, { ok: false, error: 'JSON không hợp lệ.' })
      logEvent('error', 'api.unhandled', { url: url.pathname, err: String(err), stack: err?.stack })
      return sendJson(req, res, 500, { ok: false, error: 'Lỗi máy chủ. Thử lại sau.' })
    }
    return
  }
  return sendJson(req, res, 404, { ok: false, error: 'Endpoint không tồn tại.' })
})

server.listen(port, bindHost, () => {
  logEvent('info', 'api.listen', { port, bindHost, env: isProd ? 'production' : 'dev', googleOauth: GOOGLE_OAUTH_ENABLED, demoAuth: ALLOW_DEMO_AUTH })
})

// ---------- background tasks ----------
setInterval(() => {
  try { sessions.pruneExpired() } catch { /* ignore */ }
  try { verification.pruneExpired() } catch { /* ignore */ }
  try { oauthStates.pruneExpired() } catch { /* ignore */ }
}, 30 * 60 * 1000).unref?.()

const BACKUP_INTERVAL_MIN = Number(process.env.BACKUP_INTERVAL_MIN || 0)
if (BACKUP_INTERVAL_MIN > 0) {
  setInterval(async () => {
    try {
      const r = await snapshotBackup()
      logEvent('info', 'backup', r)
    } catch (err) { logEvent('error', 'backup.fail', { err: String(err) }) }
  }, BACKUP_INTERVAL_MIN * 60_000).unref?.()
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => process.exit(0)) })
}
