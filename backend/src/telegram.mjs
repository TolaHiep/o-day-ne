// Minimal Telegram bot notifier. Bot token is read from the environment at
// call time (TELEGRAM_BOT_TOKEN) and never logged or echoed in responses. The
// chat ids the API broadcasts to come from TELEGRAM_NOTIFY_CHAT_IDS (comma
// separated). If either env var is missing the helpers are no-ops, so the
// rest of the app behaves the same in dev as it does after the owner provides
// the token.
//
// The corresponding scripts/telegram-chat-ids.mjs helper calls getUpdates so
// the owner can discover their chat id after they message the bot once. We
// kept that path out of the main API to avoid binding chat-id discovery to a
// long-running HTTP route.

const TG_API = 'https://api.telegram.org'

function getToken() {
  const t = (process.env.TELEGRAM_BOT_TOKEN || '').trim()
  return t || null
}

function getChatIds() {
  const raw = (process.env.TELEGRAM_NOTIFY_CHAT_IDS || '').trim()
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export function telegramEnabled() {
  return !!getToken() && getChatIds().length > 0
}

// Send a Markdown-formatted message to every configured chat id. Returns a
// summary object — callers should not block business logic on the result; we
// log delivery failures separately so a Telegram outage doesn't 500 the lead
// submission.
export async function sendTelegramMessage(text, { parseMode = 'Markdown' } = {}) {
  const token = getToken()
  const chatIds = getChatIds()
  if (!token || chatIds.length === 0) {
    return { ok: false, reason: 'not-configured' }
  }
  const results = []
  for (const chatId of chatIds) {
    try {
      const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        }),
      })
      const data = await res.json().catch(() => null)
      results.push({ chatId, ok: res.ok && data?.ok === true, status: res.status })
    } catch (err) {
      results.push({ chatId, ok: false, error: String(err?.message || err) })
    }
  }
  return { ok: results.every((r) => r.ok), results }
}

// Wrapper used by the API — fire-and-forget; never throws. Logs the failure
// reason to stderr so ops can see why a lead never reached Telegram, but the
// caller's HTTP response is unaffected.
export function notifyTelegram(text) {
  if (!telegramEnabled()) return
  sendTelegramMessage(text).then((r) => {
    if (!r.ok) {
      const detail = r.results
        ? r.results.filter((x) => !x.ok).map((x) => `${x.chatId}:${x.status || x.error}`).join(',')
        : r.reason
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'warn',
        event: 'telegram.notify.fail',
        detail,
      }))
    }
  }).catch((err) => {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'telegram.notify.exception',
      err: String(err?.message || err),
    }))
  })
}

export function escapeMarkdown(s) {
  if (typeof s !== 'string') return ''
  return s.replace(/[_*`\[]/g, (c) => '\\' + c)
}

// Render the submitter for a lead notification. Logged-in users with an email
// (e.g. Google login) get their email; otherwise their display name; for
// anonymous submitters we show "Khách vãng lai" plus the opaque client id so
// admin can correlate repeat anonymous leads — no other PII leaks here.
export function formatLeadAccount(ident) {
  if (ident && ident.user) {
    const email = typeof ident.user.email === 'string' ? ident.user.email.trim() : ''
    if (email) return email
    const name = typeof ident.user.name === 'string' ? ident.user.name.trim() : ''
    if (name) return name
    return `user:${ident.user.id}`
  }
  if (ident && ident.clientId) {
    return `Khách vãng lai (mã: ${ident.clientId})`
  }
  return 'Khách vãng lai'
}

function trimSlash(s) {
  return typeof s === 'string' ? s.replace(/\/$/, '') : ''
}

// Pure builder for the "viewing appointment" Telegram message. Kept here so
// tests can assert text shape without going through the network or the API
// server. Owner-private `room.source` is included because Telegram delivery
// is admin-side only (configured via TELEGRAM_NOTIFY_CHAT_IDS).
export function buildViewingAppointmentMessage({
  room, publicUrl, name, phone, preferredAt, note, account,
}) {
  const base = trimSlash(publicUrl)
  const source = room && typeof room.source === 'string' ? room.source.trim() : ''
  const lines = [
    '*Hẹn xem phòng mới*',
    `• Phòng: [${escapeMarkdown(room.title)}](${base}/room/${room.id})`,
    `• Quận: ${escapeMarkdown(room.district)} — ${escapeMarkdown(room.ward)}`,
    `• Khách: ${escapeMarkdown(name)} — ${escapeMarkdown(phone)}`,
    `• Thời gian mong muốn: ${escapeMarkdown(preferredAt)}`,
    note ? `• Ghi chú: ${escapeMarkdown(note)}` : null,
    source ? `• Nguồn phòng: ${escapeMarkdown(source)}` : null,
    `• Tài khoản: ${escapeMarkdown(account)}`,
  ]
  return lines.filter(Boolean).join('\n')
}

// Pure builder for the "consultation request" Telegram message. When the
// request isn't tied to a room we omit the room/source lines entirely; we
// don't print "không có phòng" because that's already clear from the
// surrounding context.
export function buildConsultationRequestMessage({
  room, publicUrl, name, phone, note, account,
}) {
  const base = trimSlash(publicUrl)
  const source = room && typeof room.source === 'string' ? room.source.trim() : ''
  const lines = [
    '*Yêu cầu tư vấn mới*',
    `• Khách: ${escapeMarkdown(name)} — ${escapeMarkdown(phone)}`,
    room ? `• Phòng tham khảo: [${escapeMarkdown(room.title)}](${base}/room/${room.id})` : null,
    room && source ? `• Nguồn phòng: ${escapeMarkdown(source)}` : null,
    note ? `• Ghi chú: ${escapeMarkdown(note)}` : null,
    `• Tài khoản: ${escapeMarkdown(account)}`,
  ]
  return lines.filter(Boolean).join('\n')
}
