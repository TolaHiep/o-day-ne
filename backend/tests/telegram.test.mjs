import test from 'node:test'
import assert from 'node:assert/strict'

import {
  escapeMarkdown,
  formatLeadAccount,
  buildViewingAppointmentMessage,
  buildConsultationRequestMessage,
} from '../src/telegram.mjs'

// Builders are pure — these tests assert text shape without touching the
// Telegram API or spinning up the HTTP server.

test('formatLeadAccount: prefers email over name for logged-in users', () => {
  const out = formatLeadAccount({
    user: { id: 'user-1', email: 'jane@gmail.com', name: 'Jane' },
  })
  assert.equal(out, 'jane@gmail.com')
})

test('formatLeadAccount: falls back to name when email missing', () => {
  const out = formatLeadAccount({
    user: { id: 'user-2', email: '', name: 'Anh Tâm' },
  })
  assert.equal(out, 'Anh Tâm')
})

test('formatLeadAccount: falls back to user:id when both blank', () => {
  const out = formatLeadAccount({ user: { id: 'user-3', email: '', name: '' } })
  assert.equal(out, 'user:user-3')
})

test('formatLeadAccount: anonymous with clientId shows opaque id, no PII leak', () => {
  const out = formatLeadAccount({ clientId: 'cid-abcdef0123456789' })
  assert.equal(out, 'Khách vãng lai (mã: cid-abcdef0123456789)')
})

test('formatLeadAccount: anonymous without clientId shows label only', () => {
  assert.equal(formatLeadAccount({}), 'Khách vãng lai')
  assert.equal(formatLeadAccount(null), 'Khách vãng lai')
})

test('buildViewingAppointmentMessage: includes room source when present', () => {
  const msg = buildViewingAppointmentMessage({
    room: {
      id: 'room-1',
      title: 'Phòng đẹp 25m2',
      district: 'Cầu Giấy',
      ward: 'Dịch Vọng',
      source: 'CTV Hà',
    },
    publicUrl: 'https://odayne.example/',
    name: 'Anh Khách',
    phone: '0903 111 222',
    preferredAt: '2026-06-01T18:30',
    note: 'Đi cùng bạn',
    account: 'jane@gmail.com',
  })
  assert.match(msg, /^\*Hẹn xem phòng mới\*$/m)
  assert.match(msg, /Phòng đẹp 25m2/)
  // Link uses publicUrl with trailing slash stripped.
  assert.match(msg, /\(https:\/\/odayne\.example\/room\/room-1\)/)
  assert.match(msg, /• Quận: Cầu Giấy — Dịch Vọng/)
  assert.match(msg, /• Khách: Anh Khách — 0903 111 222/)
  assert.match(msg, /• Thời gian mong muốn: 2026-06-01T18:30/)
  assert.match(msg, /• Ghi chú: Đi cùng bạn/)
  assert.match(msg, /• Nguồn phòng: CTV Hà/)
  assert.match(msg, /• Tài khoản: jane@gmail\.com/)
})

test('buildViewingAppointmentMessage: omits source line when room.source is empty', () => {
  const msg = buildViewingAppointmentMessage({
    room: { id: 'r2', title: 'P', district: 'D', ward: 'W', source: null },
    publicUrl: '',
    name: 'N', phone: 'P',
    preferredAt: 'T',
    note: '',
    account: 'a@b.c',
  })
  assert.ok(!/Nguồn phòng/.test(msg), 'no source line should appear')
  assert.ok(!/Ghi chú/.test(msg), 'no note line when empty')
})

test('buildViewingAppointmentMessage: escapes markdown chars in source and account', () => {
  const msg = buildViewingAppointmentMessage({
    room: { id: 'r3', title: 'T', district: 'D', ward: 'W', source: 'CTV_Hà*nội' },
    publicUrl: '',
    name: 'Khách',
    phone: '0900',
    preferredAt: 'T',
    note: '',
    account: 'user_test*name',
  })
  assert.match(msg, /Nguồn phòng: CTV\\_Hà\\\*nội/)
  assert.match(msg, /Tài khoản: user\\_test\\\*name/)
})

test('buildConsultationRequestMessage: includes room + source when roomId attached', () => {
  const msg = buildConsultationRequestMessage({
    room: { id: 'room-9', title: 'Studio A', source: 'Nhóm Zalo' },
    publicUrl: 'https://odayne.example',
    name: 'Anh Lead',
    phone: '0904 555 666',
    note: 'Cần dưới 4tr',
    account: 'lead@gmail.com',
  })
  assert.match(msg, /^\*Yêu cầu tư vấn mới\*$/m)
  assert.match(msg, /Phòng tham khảo: \[Studio A\]\(https:\/\/odayne\.example\/room\/room-9\)/)
  assert.match(msg, /Nguồn phòng: Nhóm Zalo/)
  assert.match(msg, /Ghi chú: Cần dưới 4tr/)
  assert.match(msg, /Tài khoản: lead@gmail\.com/)
})

test('buildConsultationRequestMessage: omits room and source lines when no room', () => {
  const msg = buildConsultationRequestMessage({
    room: null,
    publicUrl: '',
    name: 'Khách Chung',
    phone: '0907 000 999',
    note: '',
    account: 'Khách vãng lai (mã: cid-xyz)',
  })
  assert.ok(!/Phòng tham khảo/.test(msg))
  assert.ok(!/Nguồn phòng/.test(msg))
  assert.match(msg, /Khách Chung — 0907 000 999/)
  assert.match(msg, /Tài khoản: Khách vãng lai \(mã: cid-xyz\)/)
})

test('buildConsultationRequestMessage: room without source still shows room link only', () => {
  const msg = buildConsultationRequestMessage({
    room: { id: 'room-10', title: 'Phòng X', source: '' },
    publicUrl: '',
    name: 'N', phone: 'P', note: '',
    account: 'a@b.c',
  })
  assert.match(msg, /Phòng tham khảo: \[Phòng X\]/)
  assert.ok(!/Nguồn phòng/.test(msg))
})

test('escapeMarkdown: still escapes the documented characters', () => {
  assert.equal(escapeMarkdown('a_b*c`d[e'), 'a\\_b\\*c\\`d\\[e')
  assert.equal(escapeMarkdown(''), '')
  assert.equal(escapeMarkdown(null), '')
})
