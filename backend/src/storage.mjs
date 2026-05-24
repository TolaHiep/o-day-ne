// SQLite persistence for Ở Đây Nè. better-sqlite3 is synchronous — for a single
// process MVP this is faster than async drivers because there are no microtask
// boundaries inside transactions. WAL lets readers proceed while a writer holds
// the lock — important for swipe bursts while someone posts a room.
//
// All schema changes go through a one-shot block at boot. Seed Hanoi rooms run
// only when the rooms table is empty so re-launches don't double-insert.

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const dataDir = process.env.ODN_DATA_DIR
  ? path.resolve(process.env.ODN_DATA_DIR)
  : path.join(process.cwd(), 'backend', 'data')
const uploadDir = path.join(dataDir, 'uploads')
const backupDir = path.join(dataDir, 'backups')
const dbFile = path.join(dataDir, 'db.sqlite')

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(uploadDir, { recursive: true })
fs.mkdirSync(backupDir, { recursive: true })

export const db = new Database(dbFile)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')
db.pragma('temp_store = MEMORY')
db.pragma('mmap_size = 268435456')

// ---------- schema ----------
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  provider TEXT NOT NULL,
  provider_id TEXT,
  name TEXT NOT NULL,
  avatar TEXT,
  phone TEXT,
  role TEXT NOT NULL CHECK(role IN ('seeker','landlord','admin')) DEFAULT 'seeker',
  is_admin INTEGER NOT NULL DEFAULT 0,
  suspended_at INTEGER,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_provider_unique ON users(provider, provider_id) WHERE provider_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  room_type TEXT NOT NULL CHECK(room_type IN ('studio','room','mini_apt','dorm','shared')),
  price_vnd INTEGER NOT NULL,
  deposit_vnd INTEGER NOT NULL DEFAULT 0,
  area_m2 INTEGER NOT NULL,
  district TEXT NOT NULL,
  ward TEXT NOT NULL,
  address_hint TEXT NOT NULL,
  lat REAL,
  lng REAL,
  description TEXT NOT NULL,
  amenities_json TEXT NOT NULL,
  fees_json TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  images_json TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_zalo TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('active','hidden','closed','pending')) DEFAULT 'active',
  featured INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_seed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  available_at INTEGER
);
CREATE INDEX IF NOT EXISTS rooms_status_created ON rooms(status, created_at DESC);
CREATE INDEX IF NOT EXISTS rooms_owner ON rooms(owner_id);
CREATE INDEX IF NOT EXISTS rooms_district ON rooms(district);
CREATE INDEX IF NOT EXISTS rooms_reports ON rooms(reports);

CREATE TABLE IF NOT EXISTS swipes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('like','pass')),
  at INTEGER NOT NULL,
  PRIMARY KEY(user_id, room_id)
);
CREATE INDEX IF NOT EXISTS swipes_user_recent ON swipes(user_id, at DESC);
CREATE INDEX IF NOT EXISTS swipes_room_action ON swipes(room_id, action);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('visible','hidden')) DEFAULT 'visible',
  UNIQUE(room_id, user_id)
);
CREATE INDEX IF NOT EXISTS reviews_room ON reviews(room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_at INTEGER,
  UNIQUE(room_id, user_id)
);
CREATE INDEX IF NOT EXISTS reports_open ON reports(resolved, created_at DESC);

CREATE TABLE IF NOT EXISTS contributed_photos (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS photos_room_status ON contributed_photos(room_id, status);
CREATE INDEX IF NOT EXISTS photos_pending ON contributed_photos(status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS audit_recent ON audit(at DESC);

CREATE TABLE IF NOT EXISTS feedbacks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  images_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS feedbacks_recent ON feedbacks(created_at DESC);
`

db.exec(SCHEMA_SQL)
db.prepare(`INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('version', '1')`).run()

// ---------- lightweight migrations ----------
// We can't reuse CREATE TABLE IF NOT EXISTS for column additions on tables
// that may already exist with older shape, so each upgrade is wrapped in a
// try/catch that swallows the "duplicate column" SQLite error. Idempotent.
function safeExec(sql) {
  try { db.exec(sql) } catch (err) {
    const msg = String(err?.message || err)
    if (/duplicate column|already exists/i.test(msg)) return
    throw err
  }
}
safeExec(`ALTER TABLE users ADD COLUMN email_verified_at INTEGER`)
safeExec(`ALTER TABLE users ADD COLUMN phone_verified_at INTEGER`)
safeExec(`
  CREATE TABLE IF NOT EXISTS verification_codes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('email','phone')),
    code TEXT NOT NULL,
    target TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, kind)
  )
`)
safeExec(`CREATE INDEX IF NOT EXISTS verification_expires ON verification_codes(expires_at)`)

// pipeline_source_map: tracks which room each external pipeline source row
// produced, so re-importing the same Google Sheet (or other source) upserts
// instead of creating duplicate rooms. Keyed by an opaque source_key the
// importer chooses (e.g. "gsheet:<id>:<gid>:<row>"). Kept out of the rooms
// table so the schema there stays focused on UI fields.
safeExec(`
  CREATE TABLE IF NOT EXISTS pipeline_source_map (
    source_key TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    source_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)
safeExec(`CREATE INDEX IF NOT EXISTS pipeline_source_map_room ON pipeline_source_map(room_id)`)

// rooms.source: free-form, owner-only tag (≤80 chars) that the posting user
// types when creating/editing a room — e.g. "CTV Hà", "Nhà Nhóm" — so when a
// listing draws a question they remember which collaborator owns it. Private
// by default: only the owner and admins see it in API responses. The column
// itself is plain TEXT NULL because it's a soft user-facing string, not a
// foreign key.
safeExec(`ALTER TABLE rooms ADD COLUMN source TEXT`)

// oauth_states: short-lived single-use nonces for OAuth CSRF protection.
// One row is created when the user clicks "Sign in with Google" (the API
// returns the random `state` to put on the authorize URL) and consumed on
// the callback. Binding `role` here means the role chosen at start time
// can't be swapped mid-flight by a malicious callback. Pruned periodically;
// the expires_at index keeps the sweep cheap.
safeExec(`
  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('seeker','landlord')),
    ip TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )
`)
safeExec(`CREATE INDEX IF NOT EXISTS oauth_states_expires ON oauth_states(expires_at)`)

// ---------- helpers ----------
export function transaction(fn) { return db.transaction(fn)() }

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}
export function newToken() { return crypto.randomBytes(24).toString('hex') }

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
// OAuth state nonces live just long enough for the Google round-trip. 10 min
// covers slow networks, account switchers and re-auth prompts; longer windows
// would just enlarge the replay surface for a leaked URL.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
export const TTL = { SESSION_MS: SESSION_TTL_MS, OAUTH_STATE_MS: OAUTH_STATE_TTL_MS }

export function isSessionLive(s, now = Date.now()) {
  return s && s.expiresAt > now
}

// ---------- row mapping ----------
function rowToUser(r) {
  if (!r) return null
  return {
    id: r.id,
    email: r.email,
    provider: r.provider,
    providerId: r.provider_id,
    name: r.name,
    avatar: r.avatar,
    phone: r.phone,
    role: r.role,
    isAdmin: !!r.is_admin,
    suspendedAt: r.suspended_at,
    emailVerifiedAt: r.email_verified_at ?? null,
    phoneVerifiedAt: r.phone_verified_at ?? null,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  }
}

function rowToRoom(r) {
  if (!r) return null
  return {
    id: r.id,
    title: r.title,
    roomType: r.room_type,
    priceVnd: r.price_vnd,
    depositVnd: r.deposit_vnd,
    areaM2: r.area_m2,
    district: r.district,
    ward: r.ward,
    addressHint: r.address_hint,
    lat: r.lat,
    lng: r.lng,
    description: r.description,
    amenities: JSON.parse(r.amenities_json || '[]'),
    fees: JSON.parse(r.fees_json || '{}'),
    rules: JSON.parse(r.rules_json || '{}'),
    images: JSON.parse(r.images_json || '[]'),
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    contactZalo: r.contact_zalo,
    verified: !!r.verified,
    status: r.status,
    featured: !!r.featured,
    reports: r.reports,
    views: r.views,
    likes: r.likes,
    ownerId: r.owner_id,
    isSeed: !!r.is_seed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    availableAt: r.available_at,
    source: r.source ?? null,
  }
}

function rowToSession(r) {
  if (!r) return null
  return { token: r.token, userId: r.user_id, createdAt: r.created_at, expiresAt: r.expires_at, ip: r.ip }
}

function rowToReview(r) {
  if (!r) return null
  return {
    id: r.id, roomId: r.room_id, userId: r.user_id,
    stars: r.stars, text: r.text, createdAt: r.created_at, status: r.status,
  }
}

function rowToReport(r) {
  if (!r) return null
  return {
    id: r.id, roomId: r.room_id, userId: r.user_id,
    reason: r.reason, detail: r.detail, createdAt: r.created_at,
    resolved: !!r.resolved, resolvedAt: r.resolved_at,
  }
}

function rowToPhoto(r) {
  if (!r) return null
  return {
    id: r.id, roomId: r.room_id, userId: r.user_id,
    url: r.url, caption: r.caption, status: r.status,
    createdAt: r.created_at, reviewedAt: r.reviewed_at,
  }
}

function rowToFeedback(r) {
  if (!r) return null
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    content: r.content,
    images: JSON.parse(r.images_json || '[]'),
    createdAt: r.created_at,
    author: r.user_name != null ? {
      id: r.user_id,
      name: r.user_name,
      email: r.user_email,
      avatar: r.user_avatar,
      isAdmin: !!r.user_is_admin,
    } : null,
  }
}

// ---------- prepared statements ----------
const STMT = {
  user: {
    findById: db.prepare('SELECT * FROM users WHERE id = ?'),
    findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    findByProvider: db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?'),
    insert: db.prepare(`
      INSERT INTO users (id, email, provider, provider_id, name, avatar, phone, role, is_admin, created_at, last_login_at)
      VALUES (@id, @email, @provider, @providerId, @name, @avatar, @phone, @role, @isAdmin, @createdAt, @lastLoginAt)
    `),
    update: db.prepare(`
      UPDATE users SET
        name = COALESCE(@name, name),
        avatar = COALESCE(@avatar, avatar),
        phone = COALESCE(@phone, phone),
        role = COALESCE(@role, role)
      WHERE id = @id
    `),
    setAdmin: db.prepare(`UPDATE users SET is_admin = ?, role = CASE WHEN ? = 1 THEN 'admin' ELSE role END WHERE id = ?`),
    setSuspended: db.prepare(`UPDATE users SET suspended_at = ? WHERE id = ?`),
    setLastLogin: db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`),
    setEmailVerifiedAt: db.prepare(`UPDATE users SET email_verified_at = ? WHERE id = ?`),
    setPhoneVerifiedAt: db.prepare(`UPDATE users SET phone_verified_at = ? WHERE id = ?`),
    setEmail: db.prepare(`UPDATE users SET email = ? WHERE id = ?`),
    delete: db.prepare(`DELETE FROM users WHERE id = ?`),
    listAll: db.prepare(`SELECT * FROM users ORDER BY created_at DESC LIMIT ?`),
    countActive: db.prepare(`SELECT COUNT(*) c FROM users WHERE suspended_at IS NULL`),
  },
  verification: {
    upsert: db.prepare(`
      INSERT INTO verification_codes (user_id, kind, code, target, expires_at, attempts, created_at)
      VALUES (@userId, @kind, @code, @target, @expiresAt, 0, @createdAt)
      ON CONFLICT(user_id, kind) DO UPDATE SET
        code = excluded.code,
        target = excluded.target,
        expires_at = excluded.expires_at,
        attempts = 0,
        created_at = excluded.created_at
    `),
    find: db.prepare(`SELECT * FROM verification_codes WHERE user_id = ? AND kind = ?`),
    incrementAttempts: db.prepare(`UPDATE verification_codes SET attempts = attempts + 1 WHERE user_id = ? AND kind = ?`),
    delete: db.prepare(`DELETE FROM verification_codes WHERE user_id = ? AND kind = ?`),
    pruneExpired: db.prepare(`DELETE FROM verification_codes WHERE expires_at <= ?`),
  },
  oauthState: {
    insert: db.prepare(`
      INSERT INTO oauth_states (state, provider, role, ip, created_at, expires_at)
      VALUES (@state, @provider, @role, @ip, @createdAt, @expiresAt)
    `),
    // RETURNING makes consume atomic in a single statement — the row is gone
    // by the time we read it, so two concurrent callbacks with the same state
    // can't both succeed. (better-sqlite3 ships SQLite 3.35+, which supports
    // RETURNING.) Pair with the @state primary key uniqueness for correctness.
    consume: db.prepare(`DELETE FROM oauth_states WHERE state = ? RETURNING *`),
    pruneExpired: db.prepare(`DELETE FROM oauth_states WHERE expires_at <= ?`),
  },
  room: {
    findById: db.prepare('SELECT * FROM rooms WHERE id = ?'),
    insert: db.prepare(`
      INSERT INTO rooms (
        id, title, room_type, price_vnd, deposit_vnd, area_m2,
        district, ward, address_hint, lat, lng, description,
        amenities_json, fees_json, rules_json, images_json,
        contact_name, contact_phone, contact_zalo,
        verified, status, featured, reports, views, likes,
        owner_id, is_seed, created_at, updated_at, available_at, source
      ) VALUES (
        @id, @title, @roomType, @priceVnd, @depositVnd, @areaM2,
        @district, @ward, @addressHint, @lat, @lng, @description,
        @amenities, @fees, @rules, @images,
        @contactName, @contactPhone, @contactZalo,
        @verified, @status, @featured, @reports, @views, @likes,
        @ownerId, @isSeed, @createdAt, @updatedAt, @availableAt, @source
      )
    `),
    update: db.prepare(`
      UPDATE rooms SET
        title = COALESCE(@title, title),
        room_type = COALESCE(@roomType, room_type),
        price_vnd = COALESCE(@priceVnd, price_vnd),
        deposit_vnd = COALESCE(@depositVnd, deposit_vnd),
        area_m2 = COALESCE(@areaM2, area_m2),
        district = COALESCE(@district, district),
        ward = COALESCE(@ward, ward),
        address_hint = COALESCE(@addressHint, address_hint),
        description = COALESCE(@description, description),
        amenities_json = COALESCE(@amenities, amenities_json),
        fees_json = COALESCE(@fees, fees_json),
        rules_json = COALESCE(@rules, rules_json),
        images_json = COALESCE(@images, images_json),
        contact_name = COALESCE(@contactName, contact_name),
        contact_phone = COALESCE(@contactPhone, contact_phone),
        contact_zalo = COALESCE(@contactZalo, contact_zalo),
        source = COALESCE(@source, source),
        updated_at = @updatedAt
      WHERE id = @id
    `),
    delete: db.prepare('DELETE FROM rooms WHERE id = ?'),
    setStatus: db.prepare('UPDATE rooms SET status = ?, updated_at = ? WHERE id = ?'),
    setSource: db.prepare('UPDATE rooms SET source = ?, updated_at = ? WHERE id = ?'),
    setFeatured: db.prepare('UPDATE rooms SET featured = ? WHERE id = ?'),
    setVerified: db.prepare('UPDATE rooms SET verified = ? WHERE id = ?'),
    incReports: db.prepare('UPDATE rooms SET reports = reports + 1 WHERE id = ?'),
    incViews: db.prepare('UPDATE rooms SET views = views + 1 WHERE id = ?'),
    incLikes: db.prepare('UPDATE rooms SET likes = likes + 1 WHERE id = ?'),
    decLikes: db.prepare('UPDATE rooms SET likes = MAX(0, likes - 1) WHERE id = ?'),
    listActive: db.prepare(`
      SELECT * FROM rooms
      WHERE status = 'active' AND reports < 5
      ORDER BY featured DESC, created_at DESC
      LIMIT ?
    `),
    listAll: db.prepare(`SELECT * FROM rooms ORDER BY created_at DESC LIMIT ?`),
    byOwner: db.prepare(`SELECT * FROM rooms WHERE owner_id = ? ORDER BY created_at DESC`),
    countByStatus: db.prepare(`SELECT status, COUNT(*) c FROM rooms GROUP BY status`),
    countFlagged: db.prepare(`SELECT COUNT(*) c FROM rooms WHERE reports >= 3`),
  },
  session: {
    findByToken: db.prepare('SELECT * FROM sessions WHERE token = ?'),
    insert: db.prepare(`
      INSERT INTO sessions (token, user_id, created_at, expires_at, ip)
      VALUES (@token, @userId, @createdAt, @expiresAt, @ip)
    `),
    deleteByToken: db.prepare('DELETE FROM sessions WHERE token = ?'),
    deleteByUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    pruneExpired: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  },
  swipe: {
    upsert: db.prepare(`
      INSERT INTO swipes (user_id, room_id, action, at)
      VALUES (@userId, @roomId, @action, @at)
      ON CONFLICT(user_id, room_id) DO UPDATE SET action = excluded.action, at = excluded.at
    `),
    delete: db.prepare('DELETE FROM swipes WHERE user_id = ? AND room_id = ?'),
    find: db.prepare('SELECT * FROM swipes WHERE user_id = ? AND room_id = ?'),
    likedByUser: db.prepare(`
      SELECT r.* FROM rooms r
      JOIN swipes s ON s.room_id = r.id
      WHERE s.user_id = ? AND s.action = 'like' AND r.status = 'active'
      ORDER BY s.at DESC
    `),
    seenRoomIds: db.prepare(`SELECT room_id FROM swipes WHERE user_id = ?`),
  },
  review: {
    findById: db.prepare('SELECT * FROM reviews WHERE id = ?'),
    insert: db.prepare(`
      INSERT INTO reviews (id, room_id, user_id, stars, text, created_at, status)
      VALUES (@id, @roomId, @userId, @stars, @text, @createdAt, 'visible')
    `),
    forRoom: db.prepare(`SELECT * FROM reviews WHERE room_id = ? AND status = 'visible' ORDER BY created_at DESC`),
    avgForRoom: db.prepare(`SELECT AVG(stars) avg, COUNT(*) c FROM reviews WHERE room_id = ? AND status = 'visible'`),
    setStatus: db.prepare('UPDATE reviews SET status = ? WHERE id = ?'),
    deleteById: db.prepare(`DELETE FROM reviews WHERE id = ?`),
    updateById: db.prepare(`UPDATE reviews SET stars = COALESCE(@stars, stars), text = COALESCE(@text, text) WHERE id = @id`),
  },
  report: {
    findById: db.prepare('SELECT * FROM reports WHERE id = ?'),
    insert: db.prepare(`
      INSERT INTO reports (id, room_id, user_id, reason, detail, created_at)
      VALUES (@id, @roomId, @userId, @reason, @detail, @createdAt)
    `),
    listOpen: db.prepare(`SELECT * FROM reports WHERE resolved = 0 ORDER BY created_at DESC LIMIT ?`),
    resolve: db.prepare('UPDATE reports SET resolved = 1, resolved_at = ? WHERE id = ?'),
    countOpen: db.prepare('SELECT COUNT(*) c FROM reports WHERE resolved = 0'),
  },
  photo: {
    findById: db.prepare('SELECT * FROM contributed_photos WHERE id = ?'),
    insert: db.prepare(`
      INSERT INTO contributed_photos (id, room_id, user_id, url, caption, created_at)
      VALUES (@id, @roomId, @userId, @url, @caption, @createdAt)
    `),
    forRoomApproved: db.prepare(`
      SELECT * FROM contributed_photos
      WHERE room_id = ? AND status = 'approved'
      ORDER BY created_at DESC
    `),
    forRoomVisible: db.prepare(`
      SELECT * FROM contributed_photos
      WHERE room_id = ? AND status IN ('approved','pending')
      ORDER BY status = 'approved' DESC, created_at DESC
    `),
    listPending: db.prepare(`
      SELECT * FROM contributed_photos
      WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?
    `),
    setStatus: db.prepare(`UPDATE contributed_photos SET status = ?, reviewed_at = ? WHERE id = ?`),
    countPending: db.prepare(`SELECT COUNT(*) c FROM contributed_photos WHERE status = 'pending'`),
  },
  audit: {
    push: db.prepare(`INSERT INTO audit (at, kind, payload_json) VALUES (?, ?, ?)`),
    prune: db.prepare(`DELETE FROM audit WHERE id <= (SELECT MAX(id) - 500 FROM audit)`),
    list: db.prepare(`SELECT * FROM audit ORDER BY at DESC LIMIT ? OFFSET ?`),
    listByKind: db.prepare(`SELECT * FROM audit WHERE kind LIKE ? ORDER BY at DESC LIMIT ? OFFSET ?`),
    count: db.prepare(`SELECT COUNT(*) c FROM audit`),
  },
  feedback: {
    insert: db.prepare(`
      INSERT INTO feedbacks (id, user_id, title, content, images_json, created_at)
      VALUES (@id, @userId, @title, @content, @images, @createdAt)
    `),
    findById: db.prepare(`
      SELECT f.*, u.name AS user_name, u.email AS user_email, u.avatar AS user_avatar, u.is_admin AS user_is_admin
      FROM feedbacks f JOIN users u ON u.id = f.user_id
      WHERE f.id = ?
    `),
    delete: db.prepare(`DELETE FROM feedbacks WHERE id = ?`),
    listWithAuthor: db.prepare(`
      SELECT f.*, u.name AS user_name, u.email AS user_email, u.avatar AS user_avatar, u.is_admin AS user_is_admin
      FROM feedbacks f JOIN users u ON u.id = f.user_id
      ORDER BY f.created_at DESC
      LIMIT ?
    `),
    count: db.prepare(`SELECT COUNT(*) c FROM feedbacks`),
  },
  pipelineMap: {
    findRoomId: db.prepare(`SELECT room_id FROM pipeline_source_map WHERE source_key = ?`),
    upsert: db.prepare(`
      INSERT INTO pipeline_source_map (source_key, room_id, source, source_id, created_at, updated_at)
      VALUES (@sourceKey, @roomId, @source, @sourceId, @now, @now)
      ON CONFLICT(source_key) DO UPDATE SET
        room_id = excluded.room_id,
        updated_at = excluded.updated_at
    `),
    deleteByRoom: db.prepare(`DELETE FROM pipeline_source_map WHERE room_id = ?`),
    list: db.prepare(`SELECT * FROM pipeline_source_map ORDER BY updated_at DESC LIMIT ?`),
  },
}

// ---------- collection API ----------
export const users = {
  findById(id) { return rowToUser(STMT.user.findById.get(id)) },
  findByEmail(email) { return rowToUser(STMT.user.findByEmail.get(email)) },
  findByProvider(provider, providerId) {
    return rowToUser(STMT.user.findByProvider.get(provider, providerId))
  },
  insert(u) {
    STMT.user.insert.run({
      id: u.id,
      email: u.email ?? null,
      provider: u.provider,
      providerId: u.providerId ?? null,
      name: u.name,
      avatar: u.avatar ?? null,
      phone: u.phone ?? null,
      role: u.role || 'seeker',
      isAdmin: u.isAdmin ? 1 : 0,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt ?? null,
    })
    return users.findById(u.id)
  },
  update(id, patch) {
    STMT.user.update.run({
      id,
      name: patch.name ?? null,
      avatar: patch.avatar ?? null,
      phone: patch.phone ?? null,
      role: patch.role ?? null,
    })
    return users.findById(id)
  },
  setAdmin(id, isAdmin) {
    const v = isAdmin ? 1 : 0
    STMT.user.setAdmin.run(v, v, id)
  },
  setSuspended(id, at) { STMT.user.setSuspended.run(at, id) },
  setLastLogin(id, at) { STMT.user.setLastLogin.run(at, id) },
  setEmailVerifiedAt(id, at) { STMT.user.setEmailVerifiedAt.run(at, id) },
  setPhoneVerifiedAt(id, at) { STMT.user.setPhoneVerifiedAt.run(at, id) },
  setEmail(id, email) { STMT.user.setEmail.run(email, id) },
  delete(id) { STMT.user.delete.run(id) },
  listAll(limit = 500) { return STMT.user.listAll.all(limit).map(rowToUser) },
  countActive() { return STMT.user.countActive.get().c },
}

export const verification = {
  upsert({ userId, kind, code, target, expiresAt, createdAt = Date.now() }) {
    STMT.verification.upsert.run({ userId, kind, code, target, expiresAt, createdAt })
  },
  find(userId, kind) { return STMT.verification.find.get(userId, kind) || null },
  incrementAttempts(userId, kind) { STMT.verification.incrementAttempts.run(userId, kind) },
  delete(userId, kind) { STMT.verification.delete.run(userId, kind) },
  pruneExpired(now = Date.now()) { STMT.verification.pruneExpired.run(now) },
}

export const oauthStates = {
  insert({ state, provider, role, ip, createdAt = Date.now(), expiresAt }) {
    STMT.oauthState.insert.run({
      state, provider, role,
      ip: ip ?? null,
      createdAt, expiresAt,
    })
  },
  // Atomic single-use read: the DELETE … RETURNING removes the row and hands
  // back its fields. Returns null if no row matched (unknown / already
  // consumed / never existed).
  consume(state) {
    const row = STMT.oauthState.consume.get(state)
    if (!row) return null
    return {
      state: row.state,
      provider: row.provider,
      role: row.role,
      ip: row.ip,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }
  },
  pruneExpired(now = Date.now()) { STMT.oauthState.pruneExpired.run(now) },
}

export const rooms = {
  findById(id) { return rowToRoom(STMT.room.findById.get(id)) },
  insert(r) {
    STMT.room.insert.run({
      ...r,
      amenities: JSON.stringify(r.amenities || []),
      fees: JSON.stringify(r.fees || {}),
      rules: JSON.stringify(r.rules || {}),
      images: JSON.stringify(r.images || []),
      contactZalo: r.contactZalo ?? null,
      verified: r.verified ? 1 : 0,
      featured: r.featured ? 1 : 0,
      isSeed: r.isSeed ? 1 : 0,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      ownerId: r.ownerId ?? null,
      availableAt: r.availableAt ?? null,
      reports: r.reports ?? 0,
      views: r.views ?? 0,
      likes: r.likes ?? 0,
      source: r.source ?? null,
    })
    return rooms.findById(r.id)
  },
  update(id, patch, now = Date.now()) {
    STMT.room.update.run({
      id,
      title: patch.title ?? null,
      roomType: patch.roomType ?? null,
      priceVnd: patch.priceVnd ?? null,
      depositVnd: patch.depositVnd ?? null,
      areaM2: patch.areaM2 ?? null,
      district: patch.district ?? null,
      ward: patch.ward ?? null,
      addressHint: patch.addressHint ?? null,
      description: patch.description ?? null,
      amenities: patch.amenities ? JSON.stringify(patch.amenities) : null,
      fees: patch.fees ? JSON.stringify(patch.fees) : null,
      rules: patch.rules ? JSON.stringify(patch.rules) : null,
      images: patch.images ? JSON.stringify(patch.images) : null,
      contactName: patch.contactName ?? null,
      contactPhone: patch.contactPhone ?? null,
      contactZalo: patch.contactZalo ?? null,
      // patch.source === undefined → leave column unchanged (COALESCE).
      // Caller passing patch.source = '' (or null after trim) means "clear it"
      // — convert to null so COALESCE keeps the old value; the api layer maps
      // empty input to an explicit setSource call below instead.
      source: patch.source !== undefined && patch.source !== null && patch.source !== ''
        ? String(patch.source)
        : null,
      updatedAt: now,
    })
    return rooms.findById(id)
  },
  delete(id) { STMT.room.delete.run(id) },
  setStatus(id, status, now = Date.now()) { STMT.room.setStatus.run(status, now, id) },
  setSource(id, source, now = Date.now()) {
    // Accept null to clear, or a trimmed string ≤ caller's max-length policy.
    // Storage doesn't enforce the length cap — that lives in the API layer.
    STMT.room.setSource.run(source == null ? null : String(source), now, id)
  },
  setFeatured(id, featured) { STMT.room.setFeatured.run(featured ? 1 : 0, id) },
  setVerified(id, verified) { STMT.room.setVerified.run(verified ? 1 : 0, id) },
  incReports(id) { STMT.room.incReports.run(id) },
  incViews(id) { STMT.room.incViews.run(id) },
  incLikes(id) { STMT.room.incLikes.run(id) },
  decLikes(id) { STMT.room.decLikes.run(id) },
  listActive(limit = 500) { return STMT.room.listActive.all(limit).map(rowToRoom) },
  listAll(limit = 1000) { return STMT.room.listAll.all(limit).map(rowToRoom) },
  byOwner(ownerId) { return STMT.room.byOwner.all(ownerId).map(rowToRoom) },
  countsByStatus() {
    const m = { active: 0, hidden: 0, closed: 0, pending: 0 }
    for (const r of STMT.room.countByStatus.all()) m[r.status] = r.c
    return m
  },
  countFlagged() { return STMT.room.countFlagged.get().c },
}

export const sessions = {
  findByToken(token) { return rowToSession(STMT.session.findByToken.get(token)) },
  insert(s) {
    STMT.session.insert.run({ ...s, ip: s.ip ?? null })
    return sessions.findByToken(s.token)
  },
  deleteByToken(token) { STMT.session.deleteByToken.run(token) },
  deleteByUser(userId) { STMT.session.deleteByUser.run(userId) },
  pruneExpired(now = Date.now()) { STMT.session.pruneExpired.run(now) },
}

export const swipes = {
  upsert(userId, roomId, action, at = Date.now()) {
    STMT.swipe.upsert.run({ userId, roomId, action, at })
  },
  remove(userId, roomId) { STMT.swipe.delete.run(userId, roomId) },
  find(userId, roomId) { return STMT.swipe.find.get(userId, roomId) || null },
  likedRoomsForUser(userId) { return STMT.swipe.likedByUser.all(userId).map(rowToRoom) },
  seenRoomIds(userId) { return STMT.swipe.seenRoomIds.all(userId).map((r) => r.room_id) },
}

export const reviews = {
  insert(r) {
    STMT.review.insert.run(r)
    return rowToReview(STMT.review.findById.get(r.id))
  },
  findById(id) { return rowToReview(STMT.review.findById.get(id)) },
  forRoom(roomId) { return STMT.review.forRoom.all(roomId).map(rowToReview) },
  summaryForRoom(roomId) {
    const row = STMT.review.avgForRoom.get(roomId)
    return { avg: row?.avg ? Number(row.avg.toFixed(2)) : null, count: row?.c || 0 }
  },
  setStatus(id, status) { STMT.review.setStatus.run(status, id) },
  update(id, patch) {
    STMT.review.updateById.run({
      id,
      stars: patch.stars ?? null,
      text: patch.text ?? null,
    })
    return reviews.findById(id)
  },
  delete(id) { STMT.review.deleteById.run(id) },
}

export const reports = {
  insert(r) {
    STMT.report.insert.run({ ...r, detail: r.detail ?? null })
    return rowToReport(STMT.report.findById.get(r.id))
  },
  listOpen(limit = 200) { return STMT.report.listOpen.all(limit).map(rowToReport) },
  resolve(id, at = Date.now()) { STMT.report.resolve.run(at, id) },
  countOpen() { return STMT.report.countOpen.get().c },
}

export const photos = {
  insert(p) {
    STMT.photo.insert.run({ ...p, caption: p.caption ?? null })
    return rowToPhoto(STMT.photo.findById.get(p.id))
  },
  findById(id) { return rowToPhoto(STMT.photo.findById.get(id)) },
  forRoomApproved(roomId) { return STMT.photo.forRoomApproved.all(roomId).map(rowToPhoto) },
  forRoomVisible(roomId) { return STMT.photo.forRoomVisible.all(roomId).map(rowToPhoto) },
  listPending(limit = 200) { return STMT.photo.listPending.all(limit).map(rowToPhoto) },
  setStatus(id, status, at = Date.now()) { STMT.photo.setStatus.run(status, at, id) },
  countPending() { return STMT.photo.countPending.get().c },
  delete(id) {
    const row = STMT.photo.findById.get(id)
    if (!row) return null
    db.prepare(`DELETE FROM contributed_photos WHERE id = ?`).run(id)
    return rowToPhoto(row)
  },
}

export const feedbacks = {
  insert(f) {
    STMT.feedback.insert.run({
      id: f.id,
      userId: f.userId,
      title: f.title,
      content: f.content,
      images: JSON.stringify(f.images || []),
      createdAt: f.createdAt,
    })
    return rowToFeedback(STMT.feedback.findById.get(f.id))
  },
  findById(id) { return rowToFeedback(STMT.feedback.findById.get(id)) },
  list(limit = 200) { return STMT.feedback.listWithAuthor.all(limit).map(rowToFeedback) },
  delete(id) { return STMT.feedback.delete.run(id).changes },
  count() { return STMT.feedback.count.get().c },
}

export const pipelineSourceMap = {
  findRoomId(sourceKey) {
    const row = STMT.pipelineMap.findRoomId.get(sourceKey)
    return row ? row.room_id : null
  },
  upsert({ sourceKey, roomId, source, sourceId = null, now = Date.now() }) {
    STMT.pipelineMap.upsert.run({ sourceKey, roomId, source, sourceId, now })
  },
  deleteByRoom(roomId) { STMT.pipelineMap.deleteByRoom.run(roomId) },
  list(limit = 500) { return STMT.pipelineMap.list.all(limit) },
}

const AUDIT_PRUNE_EVERY = 50
let auditWritesSinceLastPrune = 0
export const audit = {
  push(kind, fields = {}) {
    STMT.audit.push.run(Date.now(), kind, JSON.stringify(fields))
    auditWritesSinceLastPrune++
    if (auditWritesSinceLastPrune >= AUDIT_PRUNE_EVERY) {
      try { STMT.audit.prune.run() } catch { /* ignore */ }
      auditWritesSinceLastPrune = 0
    }
  },
  list({ limit = 100, offset = 0, kind = null } = {}) {
    const rows = kind
      ? STMT.audit.listByKind.all(`${kind}%`, limit, offset)
      : STMT.audit.list.all(limit, offset)
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      kind: r.kind,
      payload: r.payload_json ? JSON.parse(r.payload_json) : null,
    }))
  },
  count() { return STMT.audit.count.get().c },
}

// ---------- public projections ----------
export function publicUser(u) {
  if (!u) return null
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatar,
    phone: u.phone,
    role: u.role,
    isAdmin: u.isAdmin,
    suspendedAt: u.suspendedAt,
    emailVerifiedAt: u.emailVerifiedAt,
    phoneVerifiedAt: u.phoneVerifiedAt,
    // Convenience flag — frontend just needs to know "show verified badge?"
    // True when either email OR phone has been verified.
    verified: !!(u.emailVerifiedAt || u.phoneVerifiedAt),
    createdAt: u.createdAt,
  }
}

export function publicRoom(r, extras = {}) {
  if (!r) return null
  const out = {
    id: r.id,
    title: r.title,
    roomType: r.roomType,
    priceVnd: r.priceVnd,
    depositVnd: r.depositVnd,
    areaM2: r.areaM2,
    district: r.district,
    ward: r.ward,
    addressHint: r.addressHint,
    lat: r.lat,
    lng: r.lng,
    description: r.description,
    amenities: r.amenities,
    fees: r.fees,
    rules: r.rules,
    images: r.images,
    contactName: r.contactName,
    contactPhone: r.contactPhone,
    contactZalo: r.contactZalo,
    verified: r.verified,
    status: r.status,
    featured: r.featured,
    reports: r.reports,
    views: r.views,
    likes: r.likes,
    ownerId: r.ownerId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    availableAt: r.availableAt,
    matchScore: extras.matchScore,
    rating: extras.rating,
  }
  // `source` is the room owner's private tag — only emit it when the API
  // layer has decided the viewer is the owner or an admin. Default OFF so a
  // forgetful caller never leaks it to anonymous / non-owner viewers.
  if (extras.includeSource) out.source = r.source ?? null
  return out
}

// ---------- seed data ----------
const AMENITY_KEYS = [
  'ac', 'private_wc', 'balcony', 'elevator', 'washer', 'dryer', 'kitchen',
  'parking', 'fire_safety', 'security_cam', 'pet_ok', 'no_owner', 'curfew_free',
  'window', 'furnished',
]

// Realistic-looking interior photos sourced from picsum (open seed). The id
// part of the URL gives us deterministic but distinct images per room.
function imageSet(seed, n) {
  const arr = []
  for (let i = 0; i < n; i++) {
    arr.push(`https://picsum.photos/seed/odn-${seed}-${i}/1200/800`)
  }
  return arr
}

const SEED_ROOMS = [
  {
    title: 'Studio mini đầu hồi gác xép Hàng Bạc',
    roomType: 'studio', priceVnd: 5200000, depositVnd: 5200000, areaM2: 22,
    district: 'Hoàn Kiếm', ward: 'Hàng Bạc',
    addressHint: 'Ngõ Tạ Hiện, sát phố cổ',
    lat: 21.0345, lng: 105.8540,
    description: 'Phòng nhỏ ấm cúng tầng 3, có gác xép ngủ riêng, cửa sổ nhìn ra mái ngói phố cổ. WC riêng, nóng lạnh, điều hoà, nội thất gỗ thông gọn gàng. Khu yên tĩnh sau 22h.',
    amenities: ['ac', 'private_wc', 'window', 'furnished', 'no_owner'],
    fees: { electric: 3500, water: 25000, internet: 0, service: 100000, parking: 100000 },
    rules: { maxPeople: 2, pets: false, vehicles: 'xe máy', minMonths: 6 },
    contactName: 'Cô Nga', contactPhone: '0903 451 220', contactZalo: '0903451220',
    verified: true, featured: true,
  },
  {
    title: 'Phòng ban công lớn cạnh Hồ Tây — view sương sớm',
    roomType: 'room', priceVnd: 4500000, depositVnd: 4500000, areaM2: 28,
    district: 'Tây Hồ', ward: 'Quảng An',
    addressHint: 'Gần đầm sen Quảng Bá',
    lat: 21.0670, lng: 105.8243,
    description: 'Phòng tầng 2 ban công 4m², gió Hồ Tây mát quanh năm. Bếp chung sạch, máy giặt chung. Khu xóm văn nghệ sĩ, hàng xóm nghệ thuật, thân thiện.',
    amenities: ['balcony', 'window', 'washer', 'kitchen', 'curfew_free'],
    fees: { electric: 4000, water: 20000, internet: 50000, service: 80000, parking: 0 },
    rules: { maxPeople: 2, pets: true, vehicles: 'xe máy, xe đạp', minMonths: 3 },
    contactName: 'Anh Sơn', contactPhone: '0915 778 002', contactZalo: '0915778002',
    verified: true,
  },
  {
    title: 'Mini apartment chân Keangnam — cao tốc đi làm',
    roomType: 'mini_apt', priceVnd: 8200000, depositVnd: 8200000, areaM2: 38,
    district: 'Nam Từ Liêm', ward: 'Mỹ Đình 2',
    addressHint: 'Đường Trần Văn Lai',
    lat: 21.0186, lng: 105.7820,
    description: 'Căn studio full nội thất, có bếp riêng, phòng tắm kính, máy giặt riêng. Toà có thang máy, an ninh 24/7, PCCC chuẩn. Có chỗ để ô tô gần đó.',
    amenities: ['ac', 'private_wc', 'kitchen', 'washer', 'elevator', 'fire_safety', 'security_cam', 'parking', 'furnished'],
    fees: { electric: 3800, water: 25000, internet: 60000, service: 150000, parking: 1200000 },
    rules: { maxPeople: 2, pets: false, vehicles: 'xe máy, ô tô', minMonths: 6 },
    contactName: 'Chị Hà', contactPhone: '0987 002 119',
    verified: true,
  },
  {
    title: 'Phòng trọ sinh viên Bách Khoa giá mềm',
    roomType: 'room', priceVnd: 2400000, depositVnd: 2400000, areaM2: 16,
    district: 'Hai Bà Trưng', ward: 'Bách Khoa',
    addressHint: 'Ngõ Tạ Quang Bửu',
    lat: 21.0040, lng: 105.8430,
    description: 'Phòng tầng 3, WC chung 2 phòng. Khu sinh viên đông vui, nhiều quán ăn rẻ. Chủ trọ ở tầng 1, đóng cổng 23h30, miễn phí gửi xe.',
    amenities: ['ac', 'window', 'parking'],
    fees: { electric: 3500, water: 30000, internet: 80000, service: 50000, parking: 0 },
    rules: { maxPeople: 2, pets: false, vehicles: 'xe máy, xe đạp', minMonths: 6 },
    contactName: 'Bác Bình', contactPhone: '0936 117 884',
  },
  {
    title: 'Studio gác lửng Quan Hoa — sát cầu giấy',
    roomType: 'studio', priceVnd: 4200000, depositVnd: 4200000, areaM2: 24,
    district: 'Cầu Giấy', ward: 'Quan Hoa',
    addressHint: 'Ngõ 165 Cầu Giấy',
    lat: 21.0312, lng: 105.7975,
    description: 'Phòng gác lửng tầng 4 mới sơn lại 2025. Có gác ngủ riêng, dưới làm việc bếp ăn. Cách Đại học Quốc Gia 1.2km, gần phố Trần Đăng Ninh ăn vặt.',
    amenities: ['ac', 'private_wc', 'kitchen', 'window', 'furnished', 'curfew_free'],
    fees: { electric: 4000, water: 25000, internet: 50000, service: 70000, parking: 100000 },
    rules: { maxPeople: 2, pets: false, vehicles: 'xe máy', minMonths: 6 },
    contactName: 'Anh Đạt', contactPhone: '0964 220 778', contactZalo: '0964220778',
  },
  {
    title: 'Phòng ở ghép nữ cao cấp Royal City',
    roomType: 'shared', priceVnd: 3500000, depositVnd: 3500000, areaM2: 20,
    district: 'Thanh Xuân', ward: 'Thượng Đình',
    addressHint: 'Toà R1 Royal City',
    lat: 21.0024, lng: 105.8160,
    description: 'Ở ghép 2 nữ cùng phòng đôi, full nội thất căn hộ Royal City. Hồ bơi, gym dùng chung. Yêu cầu nữ, không hút thuốc, sạch sẽ ngăn nắp.',
    amenities: ['ac', 'private_wc', 'kitchen', 'elevator', 'security_cam', 'washer', 'dryer', 'furnished', 'parking'],
    fees: { electric: 3800, water: 25000, internet: 0, service: 200000, parking: 0 },
    rules: { maxPeople: 2, pets: false, vehicles: 'xe máy, ô tô', minMonths: 3 },
    contactName: 'Chị Linh', contactPhone: '0901 442 008',
    verified: true,
  },
  {
    title: 'Phòng ban công Đặng Văn Ngữ — gần Đại học Y',
    roomType: 'room', priceVnd: 3200000, depositVnd: 3200000, areaM2: 18,
    district: 'Đống Đa', ward: 'Trung Tự',
    addressHint: 'Ngõ 95 Đặng Văn Ngữ',
    lat: 21.0046, lng: 105.8285,
    description: 'Phòng tầng 2 có ban công nhỏ phơi đồ, WC riêng. Chủ nhà dễ tính, không sống cùng. Đi học Đại học Y 5 phút.',
    amenities: ['ac', 'private_wc', 'balcony', 'window'],
    fees: { electric: 3800, water: 25000, internet: 70000, service: 50000, parking: 100000 },
    rules: { maxPeople: 2, pets: false, vehicles: 'xe máy', minMonths: 6 },
    contactName: 'Cô Hạnh', contactPhone: '0903 998 117', contactZalo: '0903998117',
  },
  {
    title: 'Phòng nội thất gỗ óc chó Linh Đàm — toà mới',
    roomType: 'mini_apt', priceVnd: 7500000, depositVnd: 7500000, areaM2: 40,
    district: 'Hoàng Mai', ward: 'Hoàng Liệt',
    addressHint: 'KĐT Linh Đàm — toà HH',
    lat: 20.9659, lng: 105.8270,
    description: 'Căn studio mới bàn giao, full nội thất gỗ óc chó, bếp đảo, ban công nhìn hồ điều hoà. Toà có hồ bơi và sân chơi trẻ em.',
    amenities: ['ac', 'private_wc', 'balcony', 'elevator', 'washer', 'dryer', 'kitchen', 'fire_safety', 'security_cam', 'parking', 'furnished'],
    fees: { electric: 3800, water: 25000, internet: 100000, service: 180000, parking: 1500000 },
    rules: { maxPeople: 2, pets: false, vehicles: 'xe máy, ô tô', minMonths: 6 },
    contactName: 'Anh Phong', contactPhone: '0978 113 442',
    verified: true,
  },
  {
    title: 'Phòng yên tĩnh ngõ rộng Văn Cao — đi bộ ra Hồ Tây',
    roomType: 'room', priceVnd: 4000000, depositVnd: 4000000, areaM2: 22,
    district: 'Ba Đình', ward: 'Liễu Giai',
    addressHint: 'Ngõ 12 Văn Cao',
    lat: 21.0438, lng: 105.8141,
    description: 'Phòng tầng 4 mát, ngõ ô tô vào tận nhà, an ninh tốt. Có chỗ phơi đồ trên sân thượng. Đi bộ ra Hồ Tây 10 phút.',
    amenities: ['ac', 'private_wc', 'window', 'parking', 'security_cam'],
    fees: { electric: 4000, water: 25000, internet: 70000, service: 80000, parking: 100000 },
    rules: { maxPeople: 2, pets: true, vehicles: 'xe máy', minMonths: 6 },
    contactName: 'Chị Yến', contactPhone: '0902 558 117', contactZalo: '0902558117',
  },
  {
    title: 'Phòng khép kín 25m² Định Công — gần khu Pháp Vân',
    roomType: 'room', priceVnd: 3000000, depositVnd: 3000000, areaM2: 25,
    district: 'Hoàng Mai', ward: 'Định Công',
    addressHint: 'Ngõ 22 Định Công Hạ',
    lat: 20.9778, lng: 105.8344,
    description: 'Phòng tầng 2 khép kín, có cửa sổ thoáng, gác xép để đồ. Hợp 2 bạn ở ghép. Khu yên tĩnh, chợ Định Công sát bên.',
    amenities: ['ac', 'private_wc', 'window', 'kitchen'],
    fees: { electric: 3500, water: 25000, internet: 70000, service: 60000, parking: 100000 },
    rules: { maxPeople: 2, pets: false, vehicles: 'xe máy', minMonths: 6 },
    contactName: 'Bác Tâm', contactPhone: '0913 220 779',
  },
  {
    title: 'Dorm 4 giường giá rẻ phố cổ — Tạ Hiện',
    roomType: 'dorm', priceVnd: 1600000, depositVnd: 1600000, areaM2: 18,
    district: 'Hoàn Kiếm', ward: 'Hàng Buồm',
    addressHint: 'Sát ngã tư Tạ Hiện',
    lat: 21.0345, lng: 105.8546,
    description: 'Giường đơn trong dorm 4 người, mỗi giường có rèm riêng, ổ cắm, đèn đọc. Bếp ăn chung, máy giặt chung. Hợp khách thuê ngắn hạn 1-3 tháng.',
    amenities: ['ac', 'kitchen', 'washer', 'curfew_free'],
    fees: { electric: 0, water: 0, internet: 0, service: 0, parking: 50000 },
    rules: { maxPeople: 1, pets: false, vehicles: 'xe máy', minMonths: 1 },
    contactName: 'Chị Mai — Old Quarter Hostel', contactPhone: '0982 117 003',
    verified: true,
  },
  {
    title: 'Phòng có bồn tắm Kim Mã — view công viên',
    roomType: 'room', priceVnd: 6500000, depositVnd: 6500000, areaM2: 32,
    district: 'Ba Đình', ward: 'Kim Mã',
    addressHint: 'Ngõ 535 Kim Mã',
    lat: 21.0297, lng: 105.8170,
    description: 'Phòng cao cấp có bồn tắm sứ, vòi sen toilet riêng. Cửa sổ kính lớn view công viên. Khu giàn giáo cao cấp, an ninh 2 lớp.',
    amenities: ['ac', 'private_wc', 'balcony', 'window', 'furnished', 'security_cam', 'no_owner'],
    fees: { electric: 4000, water: 25000, internet: 100000, service: 100000, parking: 150000 },
    rules: { maxPeople: 2, pets: false, vehicles: 'xe máy, ô tô', minMonths: 6 },
    contactName: 'Anh Tuấn', contactPhone: '0904 660 887',
    verified: true, featured: true,
  },
  {
    title: 'Phòng ở ghép nam — Đại Cồ Việt',
    roomType: 'shared', priceVnd: 2200000, depositVnd: 2200000, areaM2: 22,
    district: 'Hai Bà Trưng', ward: 'Lê Đại Hành',
    addressHint: 'Sát Đại Cồ Việt',
    lat: 21.0023, lng: 105.8429,
    description: 'Ở ghép 3 nam đã có 2, thiếu 1. Giường tầng riêng, tủ riêng. Anh em hoà đồng, hay nấu cơm chung cuối tuần.',
    amenities: ['ac', 'kitchen', 'private_wc', 'washer'],
    fees: { electric: 3500, water: 25000, internet: 70000, service: 50000, parking: 100000 },
    rules: { maxPeople: 3, pets: false, vehicles: 'xe máy', minMonths: 3 },
    contactName: 'Anh Hùng', contactPhone: '0908 220 116', contactZalo: '0908220116',
  },
  {
    title: 'Phòng ban công Mễ Trì — gần trung tâm hội nghị',
    roomType: 'room', priceVnd: 3800000, depositVnd: 3800000, areaM2: 24,
    district: 'Nam Từ Liêm', ward: 'Mễ Trì',
    addressHint: 'Ngõ 15 Mễ Trì Thượng',
    lat: 21.0084, lng: 105.7745,
    description: 'Phòng có ban công 2m², WC riêng. Cách Keangnam 8 phút xe máy, gần phố ẩm thực Mễ Trì.',
    amenities: ['ac', 'private_wc', 'balcony', 'window', 'furnished'],
    fees: { electric: 4000, water: 25000, internet: 80000, service: 80000, parking: 100000 },
    rules: { maxPeople: 2, pets: true, vehicles: 'xe máy', minMonths: 6 },
    contactName: 'Cô Hoà', contactPhone: '0906 117 224',
  },
  {
    title: 'Phòng cao cấp có máy sấy — Times City',
    roomType: 'mini_apt', priceVnd: 9500000, depositVnd: 9500000, areaM2: 45,
    district: 'Hai Bà Trưng', ward: 'Vĩnh Tuy',
    addressHint: 'Toà T5 Times City',
    lat: 20.9930, lng: 105.8693,
    description: 'Căn studio 45m² toà T5 Times City, full nội thất chủ đầu tư, máy giặt và sấy riêng. Khu tiện ích Vinhomes, hồ bơi, gym, bệnh viện Vinmec ngay cổng.',
    amenities: ['ac', 'private_wc', 'kitchen', 'washer', 'dryer', 'elevator', 'fire_safety', 'security_cam', 'parking', 'furnished', 'balcony'],
    fees: { electric: 3800, water: 25000, internet: 120000, service: 250000, parking: 1500000 },
    rules: { maxPeople: 2, pets: false, vehicles: 'xe máy, ô tô', minMonths: 6 },
    contactName: 'Anh Khôi', contactPhone: '0913 005 776',
    verified: true, featured: true,
  },
  {
    title: 'Phòng nhỏ tiết kiệm Long Biên — view sông Hồng',
    roomType: 'room', priceVnd: 2000000, depositVnd: 2000000, areaM2: 14,
    district: 'Long Biên', ward: 'Ngọc Lâm',
    addressHint: 'Ngõ 21 Nguyễn Văn Cừ',
    lat: 21.0497, lng: 105.8696,
    description: 'Phòng tầng 3 nhỏ gọn cho 1 người, view xa sông Hồng. WC chung 2 phòng. Đi qua cầu Chương Dương 5 phút sang phố cổ.',
    amenities: ['ac', 'window'],
    fees: { electric: 3500, water: 25000, internet: 80000, service: 40000, parking: 80000 },
    rules: { maxPeople: 1, pets: false, vehicles: 'xe máy', minMonths: 3 },
    contactName: 'Cô Loan', contactPhone: '0906 887 119',
  },
  {
    title: 'Studio nguyên căn Hà Đông — gần Aeon Mall',
    roomType: 'studio', priceVnd: 5500000, depositVnd: 5500000, areaM2: 30,
    district: 'Hà Đông', ward: 'Mỗ Lao',
    addressHint: 'Ngõ 76 Nguyễn Văn Lộc',
    lat: 20.9805, lng: 105.7822,
    description: 'Căn studio mới xây 2024, full nội thất, sàn gỗ, bếp riêng, WC kính. Đi bộ ra Aeon Mall Hà Đông 6 phút.',
    amenities: ['ac', 'private_wc', 'balcony', 'kitchen', 'window', 'furnished', 'fire_safety'],
    fees: { electric: 3800, water: 25000, internet: 80000, service: 100000, parking: 100000 },
    rules: { maxPeople: 2, pets: true, vehicles: 'xe máy', minMonths: 6 },
    contactName: 'Anh Quân', contactPhone: '0964 882 119', contactZalo: '0964882119',
    verified: true,
  },
  {
    title: 'Phòng nội thất tối giản Bắc Từ Liêm — ngõ ô tô',
    roomType: 'room', priceVnd: 3300000, depositVnd: 3300000, areaM2: 22,
    district: 'Bắc Từ Liêm', ward: 'Phú Diễn',
    addressHint: 'Ngõ 60 Trần Cung',
    lat: 21.0530, lng: 105.7705,
    description: 'Phòng nội thất tối giản gỗ sồi, có cửa sổ thoáng. Ngõ ô tô vào, an ninh camera. Chủ nhà không sống cùng, sống tự do giờ giấc.',
    amenities: ['ac', 'private_wc', 'window', 'furnished', 'security_cam', 'no_owner', 'curfew_free'],
    fees: { electric: 3800, water: 25000, internet: 70000, service: 80000, parking: 100000 },
    rules: { maxPeople: 2, pets: false, vehicles: 'xe máy, ô tô', minMonths: 6 },
    contactName: 'Chị Trang', contactPhone: '0909 117 224',
  },
]

export function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) c FROM rooms').get().c
  if (count > 0) return

  const now = Date.now()
  const insertSeed = db.transaction(() => {
    for (let i = 0; i < SEED_ROOMS.length; i++) {
      const r = SEED_ROOMS[i]
      STMT.room.insert.run({
        id: `room-seed-${(i + 1).toString().padStart(3, '0')}`,
        title: r.title,
        roomType: r.roomType,
        priceVnd: r.priceVnd,
        depositVnd: r.depositVnd,
        areaM2: r.areaM2,
        district: r.district,
        ward: r.ward,
        addressHint: r.addressHint,
        lat: r.lat ?? null,
        lng: r.lng ?? null,
        description: r.description,
        amenities: JSON.stringify(r.amenities || []),
        fees: JSON.stringify(r.fees || {}),
        rules: JSON.stringify(r.rules || {}),
        images: JSON.stringify(imageSet(i + 1, 4 + (i % 3))),
        contactName: r.contactName,
        contactPhone: r.contactPhone,
        contactZalo: r.contactZalo ?? null,
        verified: r.verified ? 1 : 0,
        status: 'active',
        featured: r.featured ? 1 : 0,
        reports: 0,
        views: Math.floor(40 + Math.random() * 360),
        likes: Math.floor(5 + Math.random() * 30),
        ownerId: null,
        isSeed: 1,
        createdAt: now - Math.floor(Math.random() * 14 * 24 * 3600_000),
        updatedAt: now,
        availableAt: now,
        source: null,
      })
    }
  })
  insertSeed()
}

export function seedAdminIfMissing(adminEmail = 'admin@odayne.local', name = 'Quản trị Ở Đây Nè') {
  const existing = users.findByEmail(adminEmail)
  if (existing) {
    if (!existing.isAdmin) users.setAdmin(existing.id, true)
    return existing
  }
  const now = Date.now()
  // The seeded admin is purely a demo-mode convenience: it only ships when
  // SEED_DEMO_DATA=true. Storing it under provider='demo' with the same
  // providerId the demo login handler uses (`demo:<email>`) lets the demo
  // provider re-attach to this row by providerId match. Real Google OAuth
  // login with this email still picks it up via the trusted-provider email
  // fallback in upsertUserFromProvider, so an operator can later move admin
  // off the demo path by just signing in with Google.
  return users.insert({
    id: newId('user'),
    email: adminEmail,
    provider: 'demo',
    providerId: `demo:${adminEmail}`,
    name,
    avatar: null,
    role: 'admin',
    isAdmin: true,
    createdAt: now,
    lastLoginAt: null,
  })
}

// SEED_DEMO_DATA=false skips both the 18 demo Hanoi rooms and the local
// admin@odayne.local account — set this in production so the deck stays empty
// until real landlords post and so the seeded admin can't claim ownership.
if (process.env.SEED_DEMO_DATA !== 'false') {
  seedIfEmpty()
  seedAdminIfMissing()
}

// ---------- backup ----------
const MAX_BACKUPS = Number(process.env.BACKUP_KEEP || 10)
export async function snapshotBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = path.join(backupDir, `db-${stamp}.sqlite`)
  try {
    await db.backup(target)
  } catch (err) {
    return { ok: false, reason: 'backup-failed', error: String(err) }
  }
  const entries = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith('db-') && f.endsWith('.sqlite'))
    .sort()
  const drop = entries.slice(0, Math.max(0, entries.length - MAX_BACKUPS))
  for (const f of drop) {
    try { fs.unlinkSync(path.join(backupDir, f)) } catch { /* ignore */ }
  }
  return { ok: true, file: target, kept: Math.min(entries.length, MAX_BACKUPS) }
}

process.on('beforeExit', () => {
  try { db.pragma('wal_checkpoint(PASSIVE)') } catch { /* ignore */ }
})

export const VALID_AMENITY_KEYS = AMENITY_KEYS
export { dataDir, uploadDir }
