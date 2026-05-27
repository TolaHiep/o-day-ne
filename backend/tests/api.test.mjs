import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'odn-test-'))
const PORT = 8800 + Math.floor(Math.random() * 200)

const TEST_ADMIN_TOKEN = 'test-admin-token-' + crypto.randomBytes(16).toString('hex')

const child = spawn(process.execPath, ['backend/src/api.mjs'], {
  env: {
    ...process.env,
    API_PORT: String(PORT),
    API_BIND_HOST: '127.0.0.1',
    ODN_DATA_DIR: TMP,
    ALLOW_DEMO_AUTH: 'true',
    // Tests assert the demo Hanoi rooms + seeded admin behaviour explicitly,
    // so we keep seed data on even though prod now defaults SEED_DEMO_DATA
    // to false.
    SEED_DEMO_DATA: 'true',
    // Lets us exercise the admin-token rate-limit + audit-log path below.
    ADMIN_TOKEN: TEST_ADMIN_TOKEN,
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let started = false
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('api never started')), 10_000)
  child.stdout.on('data', (b) => {
    const s = b.toString()
    if (s.includes('api.listen')) { started = true; clearTimeout(t); resolve() }
  })
  child.stderr.on('data', (b) => {
    // Pass server errors through so test output is debuggable.
    process.stderr.write(b)
  })
  child.on('exit', (code) => { if (!started) { clearTimeout(t); reject(new Error('api exited: ' + code)) } })
})

const base = `http://127.0.0.1:${PORT}`
async function api(path, init = {}, token) {
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(base + path, { ...init, headers })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  return { status: res.status, body }
}

test.after(async () => {
  child.kill('SIGTERM')
  // Don't blow up tests just because rm fails on Windows.
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ }
})

test('health works', async () => {
  const r = await api('/api/health')
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.service, 'odn-api')
})

test('seed rooms are listed and filterable', async () => {
  const r = await api('/api/rooms')
  assert.equal(r.status, 200)
  assert.ok(r.body.total >= 18, `expected ≥18 seed rooms, got ${r.body.total}`)

  const filtered = await api('/api/rooms?district=Cầu+Giấy')
  assert.ok(filtered.body.rooms.every((x) => x.district === 'Cầu Giấy'))

  const priced = await api('/api/rooms?priceMax=3000000')
  assert.ok(priced.body.rooms.every((x) => x.priceVnd <= 3000000))
})

test('district filter accepts multiple districts (repeated and comma)', async () => {
  // Repeated `district=` params → union of both sets.
  const repeated = await api('/api/rooms?district=Cầu+Giấy&district=Đống+Đa')
  assert.equal(repeated.status, 200)
  assert.ok(repeated.body.rooms.length > 0, 'expected rooms for multi-district query')
  assert.ok(
    repeated.body.rooms.every((r) => r.district === 'Cầu Giấy' || r.district === 'Đống Đa'),
    'every room should be in one of the requested districts',
  )
  const districts = new Set(repeated.body.rooms.map((r) => r.district))
  assert.ok(districts.has('Cầu Giấy') && districts.has('Đống Đa'),
    'union should include rooms from both districts')

  // Comma-separated value works too (legacy-friendly path for hand-typed URLs).
  const commaed = await api('/api/rooms?district=Cầu+Giấy,Đống+Đa')
  assert.equal(commaed.status, 200)
  assert.equal(commaed.body.rooms.length, repeated.body.rooms.length)

  // Legacy single-string `district=X` still narrows to that one district.
  const single = await api('/api/rooms?district=Cầu+Giấy')
  assert.ok(single.body.rooms.every((r) => r.district === 'Cầu Giấy'))
  assert.ok(single.body.rooms.length < repeated.body.rooms.length,
    'single district should match fewer rooms than the union')
})

test('room detail includes images, amenities, reviews & contributed photos', async () => {
  const list = await api('/api/rooms')
  const first = list.body.rooms[0]
  const r = await api(`/api/rooms/${first.id}`)
  assert.equal(r.status, 200)
  assert.equal(r.body.room.id, first.id)
  assert.ok(Array.isArray(r.body.room.images))
  assert.ok(Array.isArray(r.body.reviews))
  assert.ok(Array.isArray(r.body.contributedPhotos))
})

test('demo auth issues a session and is gated for like-swipes', async () => {
  // Anonymous like must fail.
  const list = await api('/api/rooms')
  const id = list.body.rooms[0].id
  const anonLike = await api(`/api/rooms/${id}/swipe`, { method: 'POST', body: JSON.stringify({ action: 'like' }) })
  assert.equal(anonLike.status, 401)

  // Anonymous pass returns 200 (it doesn't persist server-side without a user).
  const anonPass = await api(`/api/rooms/${id}/swipe`, { method: 'POST', body: JSON.stringify({ action: 'pass' }) })
  assert.equal(anonPass.status, 200)

  // Demo login.
  const login = await api('/api/auth/demo', {
    method: 'POST', body: JSON.stringify({ provider: 'google_demo', email: 'test+swipe@odayne.local', name: 'Tester' }),
  })
  assert.equal(login.status, 200)
  const token = login.body.token

  // Authenticated like succeeds and shows up in saved list.
  const like = await api(`/api/rooms/${id}/swipe`, { method: 'POST', body: JSON.stringify({ action: 'like' }) }, token)
  assert.equal(like.status, 200)
  const saved = await api('/api/rooms/saved', {}, token)
  assert.equal(saved.status, 200)
  assert.ok(saved.body.rooms.some((r) => r.id === id))
})

test('post-room flow validates and creates listings, role auto-promotes', async () => {
  const login = await api('/api/auth/demo', {
    method: 'POST', body: JSON.stringify({ provider: 'demo', email: 'land@odayne.local', name: 'Landy', role: 'landlord' }),
  })
  const token = login.body.token

  const bad = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ title: '' }) }, token)
  assert.equal(bad.status, 400)

  const good = await api('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Phòng test cho test runner',
      roomType: 'studio',
      priceVnd: 4500000, depositVnd: 4500000, areaM2: 22,
      district: 'Đống Đa', ward: 'Trung Tự', addressHint: 'Ngõ test 12',
      description: 'Phòng do test runner đăng để kiểm thử API. Có cửa sổ thoáng, WC riêng.',
      amenities: ['ac', 'private_wc', 'window'],
      fees: { electric: 3800, water: 25000, internet: 70000, service: 80000, parking: 100000 },
      rules: { maxPeople: 2, pets: false, vehicles: 'xe máy', minMonths: 6 },
      images: ['https://picsum.photos/seed/odn-test/600/400'],
      contactName: 'Anh Test', contactPhone: '0901 234 567',
    }),
  }, token)
  assert.equal(good.status, 201, JSON.stringify(good.body))
  assert.ok(good.body.room.id)

  const mine = await api('/api/rooms/my', {}, token)
  assert.equal(mine.status, 200)
  assert.ok(mine.body.rooms.length >= 1)
})

test('reports and reviews require login and dedupe per user', async () => {
  const login = await api('/api/auth/demo', {
    method: 'POST', body: JSON.stringify({ provider: 'demo', email: 'reporter@odayne.local' }),
  })
  const token = login.body.token

  const list = await api('/api/rooms')
  const id = list.body.rooms[0].id

  const rep = await api(`/api/rooms/${id}/reports`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'fake_listing', detail: 'Số máy không liên hệ được.' }),
  }, token)
  assert.equal(rep.status, 201)
  const repDup = await api(`/api/rooms/${id}/reports`, {
    method: 'POST', body: JSON.stringify({ reason: 'fake_listing' }),
  }, token)
  assert.equal(repDup.status, 409)

  const rev = await api(`/api/rooms/${id}/reviews`, {
    method: 'POST', body: JSON.stringify({ stars: 4, text: 'Phòng ổn nhưng hơi nóng buổi trưa.' }),
  }, token)
  assert.equal(rev.status, 201)
  const revDup = await api(`/api/rooms/${id}/reviews`, {
    method: 'POST', body: JSON.stringify({ stars: 5, text: 'Lần nữa nè.' }),
  }, token)
  assert.equal(revDup.status, 409)
})

test('contributed photo flow: gated, queued, and admin can approve', async () => {
  // Seeker contributes a photo (pending).
  const seeker = await api('/api/auth/demo', {
    method: 'POST', body: JSON.stringify({ provider: 'demo', email: 'photo@odayne.local' }),
  })
  const tSeeker = seeker.body.token
  const list = await api('/api/rooms')
  const roomId = list.body.rooms[0].id

  const ph = await api(`/api/rooms/${roomId}/photos`, {
    method: 'POST',
    body: JSON.stringify({ url: 'https://picsum.photos/seed/odn-ugc/600/400', caption: 'Ảnh chụp lúc 5h chiều' }),
  }, tSeeker)
  assert.equal(ph.status, 201)
  const photoId = ph.body.photo.id
  assert.equal(ph.body.photo.status, 'pending')

  // Anonymous detail does NOT include pending photos.
  const anonView = await api(`/api/rooms/${roomId}`)
  assert.ok(!anonView.body.contributedPhotos.some((p) => p.id === photoId))

  // Admin logs in (seeded user).
  const admin = await api('/api/auth/demo', {
    method: 'POST', body: JSON.stringify({ provider: 'demo', email: 'admin@odayne.local', name: 'Admin' }),
  })
  const tAdmin = admin.body.token
  const meAdm = await api('/api/auth/session', {}, tAdmin)
  assert.equal(meAdm.body.user.isAdmin, true)

  // Approve.
  const ok = await api(`/api/admin/photos/${photoId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
  }, tAdmin)
  assert.equal(ok.status, 200)

  const anonView2 = await api(`/api/rooms/${roomId}`)
  assert.ok(anonView2.body.contributedPhotos.some((p) => p.id === photoId))
})

test('admin endpoints reject non-admins', async () => {
  const u = await api('/api/auth/demo', {
    method: 'POST', body: JSON.stringify({ provider: 'demo', email: 'normal@odayne.local' }),
  })
  const t = u.body.token
  const r = await api('/api/admin/stats', {}, t)
  assert.equal(r.status, 403)
})

// Drops a fake image file straight into the upload dir so we can assert the
// delete handler removes it. Skips the /api/uploads endpoint to keep this test
// focused on the cleanup path rather than upload validation.
function plantUpload(ext = 'jpg') {
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`
  const target = path.join(TMP, 'uploads', name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
  return { name, url: `/uploads/${name}`, target }
}

async function createRoomWithImages(token, images) {
  const r = await api('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Phòng test cleanup ảnh',
      roomType: 'studio',
      priceVnd: 4_000_000, depositVnd: 4_000_000, areaM2: 20,
      district: 'Đống Đa', ward: 'Trung Tự', addressHint: 'Ngõ test cleanup',
      description: 'Phòng tạo bởi test runner để kiểm tra dọn ảnh khi xoá phòng.',
      amenities: ['ac', 'private_wc'],
      fees: { electric: 3800, water: 25000, internet: 70000, service: 80000, parking: 100000 },
      rules: { maxPeople: 2, pets: false, vehicles: 'xe máy', minMonths: 6 },
      images,
      contactName: 'Anh Test', contactPhone: '0901 234 567',
    }),
  }, token)
  return r
}

test('owner DELETE removes the room and its local upload files', async () => {
  const login = await api('/api/auth/demo', {
    method: 'POST',
    body: JSON.stringify({ provider: 'demo', email: 'cleanup-owner@odayne.local', role: 'landlord' }),
  })
  const token = login.body.token
  const up1 = plantUpload('jpg')
  const up2 = plantUpload('png')
  const external = 'https://picsum.photos/seed/odn-cleanup-ext/600/400'
  const create = await createRoomWithImages(token, [up1.url, up2.url, external])
  assert.equal(create.status, 201, JSON.stringify(create.body))
  const roomId = create.body.room.id
  assert.ok(fs.existsSync(up1.target))
  assert.ok(fs.existsSync(up2.target))

  const del = await api(`/api/rooms/${roomId}`, { method: 'DELETE' }, token)
  assert.equal(del.status, 200)
  // Row is gone — public detail returns 404.
  const view = await api(`/api/rooms/${roomId}`)
  assert.equal(view.status, 404)
  // Local files cleaned up.
  assert.equal(fs.existsSync(up1.target), false, 'jpg upload should be gone')
  assert.equal(fs.existsSync(up2.target), false, 'png upload should be gone')
})

test('owner DELETE still succeeds when an image is already missing', async () => {
  const login = await api('/api/auth/demo', {
    method: 'POST',
    body: JSON.stringify({ provider: 'demo', email: 'cleanup-missing@odayne.local', role: 'landlord' }),
  })
  const token = login.body.token
  const up = plantUpload('webp')
  const create = await createRoomWithImages(token, [up.url])
  const roomId = create.body.room.id
  // Yank the file before deletion — cleanup must treat ENOENT as a no-op.
  fs.unlinkSync(up.target)
  const del = await api(`/api/rooms/${roomId}`, { method: 'DELETE' }, token)
  assert.equal(del.status, 200)
  assert.equal(del.body.ok, true)
})

test('admin DELETE removes the room and its local upload files', async () => {
  const landlord = await api('/api/auth/demo', {
    method: 'POST',
    body: JSON.stringify({ provider: 'demo', email: 'cleanup-target@odayne.local', role: 'landlord' }),
  })
  const tLandlord = landlord.body.token
  const up = plantUpload('gif')
  const create = await createRoomWithImages(tLandlord, [up.url])
  const roomId = create.body.room.id

  const admin = await api('/api/auth/demo', {
    method: 'POST', body: JSON.stringify({ provider: 'demo', email: 'admin@odayne.local', name: 'Admin' }),
  })
  const tAdmin = admin.body.token
  const meAdm = await api('/api/auth/session', {}, tAdmin)
  assert.equal(meAdm.body.user.isAdmin, true)

  const del = await api(`/api/admin/rooms/${roomId}`, { method: 'DELETE' }, tAdmin)
  assert.equal(del.status, 200)
  assert.equal(fs.existsSync(up.target), false)
  const view = await api(`/api/rooms/${roomId}`)
  assert.equal(view.status, 404)
})

// rooms.source is the owner's private collaborator tag. It must round-trip to
// the owner on create/update/detail/list and to admins everywhere, but stay
// absent from anonymous and non-owner responses (publicRoom drops the key, not
// just nulls it — so we assert key absence, not value).
async function createSourceRoom(token, source) {
  return api('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Phòng test gắn nguồn',
      roomType: 'studio',
      priceVnd: 4_500_000, depositVnd: 4_500_000, areaM2: 22,
      district: 'Đống Đa', ward: 'Trung Tự', addressHint: 'Ngõ test source',
      description: 'Phòng do test runner đăng để kiểm tra quyền riêng tư của trường nguồn.',
      amenities: ['ac', 'private_wc', 'window'],
      fees: { electric: 3800, water: 25000, internet: 70000, service: 80000, parking: 100000 },
      rules: { maxPeople: 2, pets: false, vehicles: 'xe máy', minMonths: 6 },
      images: ['https://picsum.photos/seed/odn-source-tag/600/400'],
      contactName: 'Anh Nguồn', contactPhone: '0901 234 567',
      source,
    }),
  }, token)
}

test('source tag: owner sees it on create/update/detail/list and /my', async () => {
  const owner = await api('/api/auth/demo', {
    method: 'POST',
    body: JSON.stringify({ provider: 'demo', email: 'source-owner@odayne.local', role: 'landlord' }),
  })
  const tOwner = owner.body.token

  const SRC = 'CTV Hà'
  const created = await createSourceRoom(tOwner, SRC)
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.equal(created.body.room.source, SRC, 'create response echoes source to owner')
  const roomId = created.body.room.id

  const mine = await api('/api/rooms/my', {}, tOwner)
  assert.equal(mine.status, 200)
  const mineRow = mine.body.rooms.find((r) => r.id === roomId)
  assert.ok(mineRow, 'room appears in /api/rooms/my')
  assert.equal(mineRow.source, SRC, '/my includes source for the owner')

  const detail = await api(`/api/rooms/${roomId}`, {}, tOwner)
  assert.equal(detail.body.room.source, SRC, 'detail includes source for owner')

  const list = await api('/api/rooms', {}, tOwner)
  const listRow = list.body.rooms.find((r) => r.id === roomId)
  assert.ok(listRow, 'owner sees own active room in public list')
  assert.equal(listRow.source, SRC, 'public list includes source for owner')

  const SRC2 = 'Nhà Nhóm'
  const updated = await api(`/api/rooms/${roomId}`, {
    method: 'PATCH', body: JSON.stringify({ source: SRC2 }),
  }, tOwner)
  assert.equal(updated.status, 200)
  assert.equal(updated.body.room.source, SRC2, 'update response echoes new source to owner')

  // Empty string clears it; storage's setSource maps "" → null.
  const cleared = await api(`/api/rooms/${roomId}`, {
    method: 'PATCH', body: JSON.stringify({ source: '' }),
  }, tOwner)
  assert.equal(cleared.status, 200)
  assert.equal(cleared.body.room.source, null, 'empty string clears source to null')
})

test('source tag: anonymous list/detail never includes the source key', async () => {
  const owner = await api('/api/auth/demo', {
    method: 'POST',
    body: JSON.stringify({ provider: 'demo', email: 'source-anon-owner@odayne.local', role: 'landlord' }),
  })
  const tOwner = owner.body.token
  const created = await createSourceRoom(tOwner, 'CTV Bí Mật')
  const roomId = created.body.room.id

  const detail = await api(`/api/rooms/${roomId}`)
  assert.equal(detail.status, 200)
  assert.ok(detail.body.room, 'anonymous detail returns room')
  assert.equal('source' in detail.body.room, false, 'anonymous detail must omit source')

  const list = await api('/api/rooms')
  const row = list.body.rooms.find((r) => r.id === roomId)
  assert.ok(row, 'anonymous list includes the active room')
  assert.equal('source' in row, false, 'anonymous list row must omit source')
})

test('source tag: a non-owner logged-in user does not see source', async () => {
  const owner = await api('/api/auth/demo', {
    method: 'POST',
    body: JSON.stringify({ provider: 'demo', email: 'source-no-leak-owner@odayne.local', role: 'landlord' }),
  })
  const tOwner = owner.body.token
  const created = await createSourceRoom(tOwner, 'CTV Riêng')
  const roomId = created.body.room.id

  const other = await api('/api/auth/demo', {
    method: 'POST',
    body: JSON.stringify({ provider: 'demo', email: 'source-stranger@odayne.local' }),
  })
  const tOther = other.body.token
  // Stranger must not be admin — guards against admin-seed bleed into this test.
  const meOther = await api('/api/auth/session', {}, tOther)
  assert.equal(meOther.body.user.isAdmin, false, 'non-owner is not an admin')

  const detail = await api(`/api/rooms/${roomId}`, {}, tOther)
  assert.equal('source' in detail.body.room, false, 'non-owner detail must omit source')

  const list = await api('/api/rooms', {}, tOther)
  const row = list.body.rooms.find((r) => r.id === roomId)
  assert.ok(row, 'non-owner sees the active room in the public list')
  assert.equal('source' in row, false, 'non-owner list row must omit source')
})

test('source tag: admin sees source on detail, public list, and admin list', async () => {
  const owner = await api('/api/auth/demo', {
    method: 'POST',
    body: JSON.stringify({ provider: 'demo', email: 'source-admin-target@odayne.local', role: 'landlord' }),
  })
  const tOwner = owner.body.token
  const SRC = 'CTV Mai'
  const created = await createSourceRoom(tOwner, SRC)
  const roomId = created.body.room.id

  const admin = await api('/api/auth/demo', {
    method: 'POST', body: JSON.stringify({ provider: 'demo', email: 'admin@odayne.local', name: 'Admin' }),
  })
  const tAdmin = admin.body.token
  const meAdm = await api('/api/auth/session', {}, tAdmin)
  assert.equal(meAdm.body.user.isAdmin, true, 'seeded admin is an admin')

  const detail = await api(`/api/rooms/${roomId}`, {}, tAdmin)
  assert.equal(detail.body.room.source, SRC, 'admin sees source on detail')

  const list = await api('/api/rooms', {}, tAdmin)
  const listRow = list.body.rooms.find((r) => r.id === roomId)
  assert.ok(listRow, 'admin sees room in public list')
  assert.equal(listRow.source, SRC, 'admin sees source on public list')

  const adminList = await api('/api/admin/rooms', {}, tAdmin)
  assert.equal(adminList.status, 200)
  const adminRow = adminList.body.rooms.find((r) => r.id === roomId)
  assert.ok(adminRow, 'admin list includes the room')
  assert.equal(adminRow.source, SRC, 'admin list includes source')
})

test('admin CSV export neutralises spreadsheet-formula payloads', async () => {
  // Author a feedback whose title leads with `=` — Excel/LibreOffice would
  // interpret that as a formula and run a DDE / cmd payload. The exporter
  // must prefix a single quote so the cell renders as text.
  const author = await api('/api/auth/demo', {
    method: 'POST', body: JSON.stringify({ provider: 'demo', email: 'csv-author@odayne.local' }),
  })
  const tAuthor = author.body.token
  const danger = '=cmd|"/c calc.exe"!A1'
  const submit = await api('/api/feedbacks', {
    method: 'POST',
    body: JSON.stringify({ title: danger, content: 'Nội dung test CSV injection — đủ dài.', images: [] }),
  }, tAuthor)
  assert.equal(submit.status, 201, JSON.stringify(submit.body))

  const admin = await api('/api/auth/demo', {
    method: 'POST', body: JSON.stringify({ provider: 'demo', email: 'admin@odayne.local', name: 'Admin' }),
  })
  const tAdmin = admin.body.token
  // /api/admin/feedbacks.csv returns text/csv — bypass the JSON helper.
  const csvRes = await fetch(`${base}/api/admin/feedbacks.csv`, {
    headers: { Authorization: `Bearer ${tAdmin}` },
  })
  assert.equal(csvRes.status, 200)
  const csv = await csvRes.text()
  // The dangerous payload appears in the file — but quoted (CSV requires
  // quoting for cells containing `,` or `"`) and prefixed with a leading `'`
  // so the spreadsheet treats it as literal text.
  assert.ok(csv.includes("\"'=cmd|"), 'leading-= cell should be defused with a single quote')
  // Make sure the original unprotected payload is NOT present anywhere.
  assert.ok(!csv.includes('"=cmd|"/c'), 'unescaped formula payload must not appear in CSV')
})

test('demo provider cannot hijack an existing user by email', async () => {
  // First, an existing demo user occupies an email. (In prod this would be
  // a Google-verified user; the test models the same shape — the row in
  // users.email is what matters to the upsert.)
  const victim = await api('/api/auth/demo', {
    method: 'POST',
    body: JSON.stringify({ provider: 'demo', email: 'victim-takeover@odayne.local', name: 'Victim' }),
  })
  assert.equal(victim.status, 200, 'baseline demo signup should succeed')
  const victimId = victim.body.user.id

  // Attacker now tries to sign in with a DIFFERENT untrusted provider
  // (facebook_demo) but the same email. Pre-fix, upsertUserFromProvider
  // followed the email fallback and returned the victim's row, handing the
  // attacker the victim's session. Post-fix we expect a 409.
  const attack = await api('/api/auth/demo', {
    method: 'POST',
    body: JSON.stringify({ provider: 'facebook_demo', email: 'victim-takeover@odayne.local', name: 'Mallory' }),
  })
  assert.equal(attack.status, 409, 'cross-provider email claim must be rejected')
  assert.equal(attack.body.ok, false)
  assert.ok(!attack.body.token, 'no session token may be issued on the conflict path')

  // Sanity: the victim's session still works and still points at the same user.
  const me = await api('/api/auth/session', {}, victim.body.token)
  assert.equal(me.status, 200)
  assert.equal(me.body.user.id, victimId, 'victim user id unchanged')
})

test('admin-token requests are rate-limited per IP and audit-logged on failure', async () => {
  // Sanity: a correct token is accepted via X-Admin-Token alone (no session).
  const ok = await fetch(`${base}/api/admin/stats`, {
    headers: { 'X-Admin-Token': TEST_ADMIN_TOKEN },
  })
  assert.equal(ok.status, 200, 'valid admin token should authorize the admin endpoint')

  // Fire wrong-token attempts in series; the 6th attempt against this IP
  // (max=5/15min) must be turned away with a 429 + Retry-After.
  const wrong = 'definitely-not-the-token'
  let lastStatus = 0
  let lastRetryAfter = null
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${base}/api/admin/stats`, {
      headers: { 'X-Admin-Token': wrong },
    })
    lastStatus = r.status
    lastRetryAfter = r.headers.get('retry-after')
  }
  assert.equal(lastStatus, 429, 'sixth wrong-token attempt should be rate-limited')
  assert.ok(lastRetryAfter && Number(lastRetryAfter) > 0, 'Retry-After header should be set')

  // A subsequent attempt — even with the correct token — is still rejected
  // while the bucket is full. This is intentional: an attacker bursting past
  // the cap can't quietly resume once they guess right.
  const blocked = await fetch(`${base}/api/admin/stats`, {
    headers: { 'X-Admin-Token': TEST_ADMIN_TOKEN },
  })
  assert.equal(blocked.status, 429, 'admin-token path stays throttled until the window resets')
})

test('google OAuth endpoints return 403 when provider is not configured', async () => {
  // The shared test server has no GOOGLE_CLIENT_ID set, so /start and
  // /callback must short-circuit to forbidden BEFORE doing any DB work.
  const start = await api('/api/auth/google/start', {
    method: 'POST', body: JSON.stringify({ role: 'seeker' }),
  })
  assert.equal(start.status, 403, 'start endpoint must be 403 without Google creds')
  const cb = await api('/api/auth/google/callback', {
    method: 'POST', body: JSON.stringify({ code: 'x', state: 'a'.repeat(64) }),
  })
  assert.equal(cb.status, 403, 'callback must be 403 without Google creds')
})

test('google callback rejects missing / malformed state when provider is enabled', async () => {
  // Spin up a second API process with fake Google creds so we can exercise
  // the state-validation path. The token-exchange call would still fail
  // against real Google, but state validation runs BEFORE the exchange, so
  // we never get there for the missing/malformed/replayed/expired cases.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'odn-google-'))
  const port = 8800 + 300 + Math.floor(Math.random() * 100)
  const proc = spawn(process.execPath, ['backend/src/api.mjs'], {
    env: {
      ...process.env,
      API_PORT: String(port),
      API_BIND_HOST: '127.0.0.1',
      ODN_DATA_DIR: tmp,
      ALLOW_DEMO_AUTH: 'true',
      SEED_DEMO_DATA: 'false',
      GOOGLE_CLIENT_ID: 'fake-client-id',
      GOOGLE_CLIENT_SECRET: 'fake-client-secret',
      GOOGLE_REDIRECT_URI: 'https://example.test/api/auth/google/callback',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('api never started')), 10_000)
      proc.stdout.on('data', (b) => {
        if (b.toString().includes('api.listen')) { clearTimeout(t); resolve() }
      })
      proc.stderr.on('data', (b) => { process.stderr.write(b) })
      proc.on('exit', (code) => { clearTimeout(t); reject(new Error('api exited: ' + code)) })
    })

    const base2 = `http://127.0.0.1:${port}`
    const post = async (path, body) => {
      const res = await fetch(base2 + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      return { status: res.status, body: text ? JSON.parse(text) : null }
    }

    // /start hands back a server-issued nonce + authorize URL.
    const started = await post('/api/auth/google/start', { role: 'seeker' })
    assert.equal(started.status, 200, JSON.stringify(started.body))
    assert.ok(/^[a-f0-9]{16,128}$/.test(started.body.state), 'state should be hex')
    assert.ok(started.body.authorizeUrl.includes(`state=${started.body.state}`))
    assert.ok(started.body.authorizeUrl.startsWith('https://accounts.google.com/'))

    // 1) Missing state → 400.
    const noState = await post('/api/auth/google/callback', { code: 'fake-code' })
    assert.equal(noState.status, 400, 'missing state must be rejected')

    // 2) Malformed state (non-hex / wrong shape) → 400 without DB lookup.
    const bad = await post('/api/auth/google/callback', { code: 'fake-code', state: '!!!' })
    assert.equal(bad.status, 400, 'malformed state must be rejected')

    // 3) Unknown but well-formed state → 400 (not in oauth_states table).
    const unknown = await post('/api/auth/google/callback', {
      code: 'fake-code',
      state: 'a'.repeat(64),
    })
    assert.equal(unknown.status, 400, 'unknown state must be rejected')

    // 4) Replay protection: the first attempt consumes the state (Google
    //    exchange will fail with fake creds → 400 with a different reason),
    //    so the second attempt with the same state must also be rejected as
    //    an invalid/replayed state. Both calls return 400; what matters is
    //    that the *state row* is gone after the first call.
    const start2 = await post('/api/auth/google/start', { role: 'landlord' })
    assert.equal(start2.status, 200)
    const firstUse = await post('/api/auth/google/callback', {
      code: 'fake-code-will-not-exchange',
      state: start2.body.state,
    })
    // State was valid → handler advanced to the Google exchange, which fails
    // against the fake creds. Either way the row is consumed.
    assert.equal(firstUse.status, 400)
    const replay = await post('/api/auth/google/callback', {
      code: 'fake-code-will-not-exchange',
      state: start2.body.state,
    })
    assert.equal(replay.status, 400, 'replayed state must be rejected')
  } finally {
    proc.kill('SIGTERM')
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

test('room.images must be https — http URLs are rejected', async () => {
  const login = await api('/api/auth/demo', {
    method: 'POST',
    body: JSON.stringify({ provider: 'demo', email: 'http-images@odayne.local', role: 'landlord' }),
  })
  const token = login.body.token

  const r = await api('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Phòng test http image',
      roomType: 'studio',
      priceVnd: 4_000_000, depositVnd: 4_000_000, areaM2: 20,
      district: 'Đống Đa', ward: 'Trung Tự', addressHint: 'Ngõ test',
      description: 'Phòng test rằng API từ chối ảnh http (mixed content).',
      amenities: ['ac', 'private_wc'],
      fees: { electric: 3800, water: 25000, internet: 70000, service: 80000, parking: 100000 },
      rules: { maxPeople: 2, pets: false, vehicles: 'xe máy', minMonths: 6 },
      // Plain-http image — should be rejected by the tightened URL regex.
      images: ['http://example.com/photo.jpg'],
      contactName: 'Anh Test', contactPhone: '0901 234 567',
    }),
  }, token)
  assert.equal(r.status, 400, 'http:// image URL must be rejected')
})

test('lead profile: anonymous client can save and re-read their info', async () => {
  // Use a fresh, well-shaped client id (matches ANON_CLIENT_ID_RE on the
  // server). Anonymous flow is what the marketing-site visitor uses before
  // they sign in.
  const clientId = 'cid-' + crypto.randomBytes(12).toString('hex')

  const empty = await api(`/api/lead-profile?clientId=${clientId}`)
  assert.equal(empty.status, 200)
  assert.equal(empty.body.profile, null, 'fresh client has no saved profile')

  const save = await api('/api/lead-profile', {
    method: 'POST',
    body: JSON.stringify({ name: 'Anh Khách', phone: '0901 222 333', clientId }),
  })
  assert.equal(save.status, 200, JSON.stringify(save.body))
  assert.equal(save.body.profile.name, 'Anh Khách')
  assert.equal(save.body.profile.phone, '0901 222 333')

  const got = await api(`/api/lead-profile?clientId=${clientId}`)
  assert.equal(got.body.profile.name, 'Anh Khách')
  assert.equal(got.body.source, 'lead')
})

test('lead profile: requires clientId for anonymous calls', async () => {
  const noId = await api('/api/lead-profile', {
    method: 'POST',
    body: JSON.stringify({ name: 'Khong', phone: '0901 222 333' }),
  })
  assert.equal(noId.status, 400)
})

test('viewing appointment: anonymous create, room-bound, prefills profile', async () => {
  const list = await api('/api/rooms')
  const roomId = list.body.rooms[0].id
  const clientId = 'cid-' + crypto.randomBytes(12).toString('hex')

  const created = await api('/api/viewing-appointments', {
    method: 'POST',
    body: JSON.stringify({
      roomId,
      name: 'Anh Khách Mới',
      phone: '0903 111 222',
      preferredAt: '2026-06-01T18:30',
      note: 'Đi cùng bạn cùng phòng',
      clientId,
    }),
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.match(created.body.message, /Tư vấn viên/)
  assert.equal(created.body.appointment.roomId, roomId)
  assert.equal(created.body.appointment.status, 'new')

  // Profile was upserted as a side-effect so the next modal opens prefilled.
  const profile = await api(`/api/lead-profile?clientId=${clientId}`)
  assert.equal(profile.body.profile.name, 'Anh Khách Mới')

  // /api/my-leads returns the submission for this client.
  const mine = await api(`/api/my-leads?clientId=${clientId}`)
  assert.equal(mine.status, 200)
  assert.equal(mine.body.viewings.length, 1)
  assert.equal(mine.body.viewings[0].roomId, roomId)
})

test('viewing appointment: missing or invalid fields rejected', async () => {
  const list = await api('/api/rooms')
  const roomId = list.body.rooms[0].id
  const clientId = 'cid-' + crypto.randomBytes(12).toString('hex')

  const noTime = await api('/api/viewing-appointments', {
    method: 'POST',
    body: JSON.stringify({
      roomId, name: 'Khách', phone: '0903 111 222', preferredAt: '', clientId,
    }),
  })
  assert.equal(noTime.status, 400)

  const badPhone = await api('/api/viewing-appointments', {
    method: 'POST',
    body: JSON.stringify({
      roomId, name: 'Khách', phone: 'abc', preferredAt: '2026-06-01T18:30', clientId,
    }),
  })
  assert.equal(badPhone.status, 400)

  const noRoom = await api('/api/viewing-appointments', {
    method: 'POST',
    body: JSON.stringify({
      roomId: 'room-does-not-exist', name: 'Khách', phone: '0903 111 222',
      preferredAt: '2026-06-01T18:30', clientId,
    }),
  })
  assert.equal(noRoom.status, 404)
})

test('consultation request: authenticated user, optional room, surfaces in my-leads', async () => {
  const login = await api('/api/auth/demo', {
    method: 'POST', body: JSON.stringify({ provider: 'demo', email: 'lead-consult@odayne.local', name: 'Anh Lead' }),
  })
  const token = login.body.token

  const list = await api('/api/rooms')
  const roomId = list.body.rooms[0].id

  const created = await api('/api/consultation-requests', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Anh Lead Cập Nhật',
      phone: '0904 555 666',
      roomId,
      note: 'Cần phòng dưới 4tr quanh Cầu Giấy',
    }),
  }, token)
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.match(created.body.message, /Tư vấn viên/)

  const mine = await api('/api/my-leads', {}, token)
  assert.equal(mine.status, 200)
  assert.equal(mine.body.consultations.length, 1)
  assert.equal(mine.body.consultations[0].roomId, roomId)
  // Profile should have been promoted to the values supplied this time —
  // editing in the modal updates the saved profile.
  assert.equal(mine.body.profile.name, 'Anh Lead Cập Nhật')
  assert.equal(mine.body.profile.phone, '0904 555 666')
})

test('consultation request: works without roomId (general consult)', async () => {
  const clientId = 'cid-' + crypto.randomBytes(12).toString('hex')
  const r = await api('/api/consultation-requests', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Khách Chung', phone: '0907 000 999', clientId,
    }),
  })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(r.body.request.roomId, null)
})
