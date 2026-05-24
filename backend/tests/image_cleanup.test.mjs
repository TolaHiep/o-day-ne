import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

import {
  parseCloudinaryPublicId,
  deleteLocalUpload,
  cleanupImage,
  cleanupRoomImages,
} from '../src/image_cleanup.mjs'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'odn-cleanup-'))
const uploadDir = path.join(TMP, 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ }
})

function makeLocalUpload(ext = 'jpg') {
  const name = `${crypto.randomBytes(8).toString('hex')}.${ext}`
  fs.writeFileSync(path.join(uploadDir, name), Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
  return { name, url: `/uploads/${name}` }
}

test('parseCloudinaryPublicId returns null for non-Cloudinary URLs', () => {
  assert.equal(parseCloudinaryPublicId('https://picsum.photos/seed/x/600/400', 'odn-cloud'), null)
  assert.equal(parseCloudinaryPublicId('/uploads/abc.jpg', 'odn-cloud'), null)
  assert.equal(parseCloudinaryPublicId('', 'odn-cloud'), null)
})

test('parseCloudinaryPublicId only matches the configured cloud', () => {
  const url = 'https://res.cloudinary.com/other-cloud/image/upload/v123/foo.jpg'
  assert.equal(parseCloudinaryPublicId(url, 'odn-cloud'), null)
})

test('parseCloudinaryPublicId extracts public_id with version + folder', () => {
  const url = 'https://res.cloudinary.com/odn-cloud/image/upload/v1700000000/odayne/rooms/abc123.jpg'
  assert.equal(parseCloudinaryPublicId(url, 'odn-cloud'), 'odayne/rooms/abc123')
})

test('parseCloudinaryPublicId strips transformations', () => {
  const url = 'https://res.cloudinary.com/odn-cloud/image/upload/c_fill,h_300,w_400/v1700000000/odayne/rooms/abc.jpg'
  assert.equal(parseCloudinaryPublicId(url, 'odn-cloud'), 'odayne/rooms/abc')
})

test('parseCloudinaryPublicId strips chained transformation segments', () => {
  const url = 'https://res.cloudinary.com/odn-cloud/image/upload/f_auto/q_auto/v1700000000/odayne/rooms/abc.webp'
  assert.equal(parseCloudinaryPublicId(url, 'odn-cloud'), 'odayne/rooms/abc')
})

test('parseCloudinaryPublicId works without a version segment', () => {
  const url = 'https://res.cloudinary.com/odn-cloud/image/upload/abc123.jpg'
  assert.equal(parseCloudinaryPublicId(url, 'odn-cloud'), 'abc123')
})

test('deleteLocalUpload removes a file inside uploadDir', async () => {
  const { name, url } = makeLocalUpload()
  assert.ok(fs.existsSync(path.join(uploadDir, name)))
  await deleteLocalUpload(url, uploadDir)
  assert.equal(fs.existsSync(path.join(uploadDir, name)), false)
})

test('deleteLocalUpload is a no-op when the file is already gone', async () => {
  await deleteLocalUpload('/uploads/' + 'a'.repeat(16) + '.jpg', uploadDir)
})

test('deleteLocalUpload rejects non-upload URL shapes', async () => {
  await assert.rejects(deleteLocalUpload('https://example.com/foo.jpg', uploadDir), /not-a-local-upload/)
  await assert.rejects(deleteLocalUpload('/uploads/../etc/passwd', uploadDir), /not-a-local-upload/)
  await assert.rejects(deleteLocalUpload('/uploads/foo.jpg.exe', uploadDir), /not-a-local-upload/)
})

test('cleanupImage returns skipped for external URLs', async () => {
  const r = await cleanupImage('https://picsum.photos/seed/x/600/400', {
    uploadDir, cloudinaryEnabled: false,
  })
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'external')
  assert.equal(r.skipped, true)
})

test('cleanupImage removes local /uploads/ files', async () => {
  const { name, url } = makeLocalUpload('png')
  const r = await cleanupImage(url, { uploadDir })
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'local')
  assert.equal(fs.existsSync(path.join(uploadDir, name)), false)
})

test('cleanupImage destroys Cloudinary assets via a mocked HTTP layer', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: 'ok' }),
    }
  }
  const r = await cleanupImage(
    'https://res.cloudinary.com/odn-cloud/image/upload/v1700000000/odayne/rooms/xyz.jpg',
    {
      uploadDir,
      cloudinaryEnabled: true,
      cloudName: 'odn-cloud',
      apiKey: 'key',
      apiSecret: 'secret',
      fetchImpl,
    },
  )
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'cloudinary')
  assert.equal(r.publicId, 'odayne/rooms/xyz')
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/v1_1\/odn-cloud\/image\/destroy$/)
  const body = calls[0].init.body
  // URLSearchParams toString form
  assert.match(body.toString(), /public_id=odayne%2Frooms%2Fxyz/)
  assert.match(body.toString(), /api_key=key/)
  assert.match(body.toString(), /signature=[a-f0-9]{40}/)
})

test('cleanupImage records failures instead of throwing', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) })
  const r = await cleanupImage(
    'https://res.cloudinary.com/odn-cloud/image/upload/v1/folder/x.jpg',
    {
      uploadDir,
      cloudinaryEnabled: true,
      cloudName: 'odn-cloud',
      apiKey: 'k', apiSecret: 's',
      fetchImpl,
    },
  )
  assert.equal(r.ok, false)
  assert.equal(r.kind, 'cloudinary')
  assert.match(r.error, /cloudinary-destroy-http-500/)
})

test('cleanupImage skips Cloudinary cleanup when disabled', async () => {
  let called = false
  const fetchImpl = async () => { called = true; return { ok: true, status: 200, json: async () => ({ result: 'ok' }) } }
  const r = await cleanupImage(
    'https://res.cloudinary.com/odn-cloud/image/upload/v1/x.jpg',
    { uploadDir, cloudinaryEnabled: false, fetchImpl },
  )
  assert.equal(called, false)
  // Treated as external since we don't own its storage in this config.
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'external')
})

test('cleanupRoomImages reports per-image outcomes and aggregates failures', async () => {
  const { name: localName, url: localUrl } = makeLocalUpload('webp')
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({ result: 'not allowed' }) })
  const { results, failed } = await cleanupRoomImages(
    [
      localUrl,
      'https://res.cloudinary.com/odn-cloud/image/upload/v1/folder/dead.jpg',
      'https://example.com/external.jpg',
    ],
    {
      uploadDir,
      cloudinaryEnabled: true,
      cloudName: 'odn-cloud',
      apiKey: 'k', apiSecret: 's',
      fetchImpl,
    },
  )
  assert.equal(results.length, 3)
  assert.equal(results[0].ok, true)
  assert.equal(results[0].kind, 'local')
  assert.equal(results[1].ok, false)
  assert.equal(results[1].kind, 'cloudinary')
  assert.equal(results[2].ok, true)
  assert.equal(results[2].kind, 'external')
  assert.equal(failed.length, 1)
  assert.equal(fs.existsSync(path.join(uploadDir, localName)), false)
})
