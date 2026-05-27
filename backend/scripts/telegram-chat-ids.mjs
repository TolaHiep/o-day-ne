#!/usr/bin/env node
// Discover the Telegram chat ids of users who have already messaged the bot.
//
// Usage:
//   TELEGRAM_BOT_TOKEN=... node backend/scripts/telegram-chat-ids.mjs
//
// Send a message to the bot first (any text — `/start` works) before running
// this script. Telegram only retains updates that haven't been acknowledged,
// so a fresh DM is the simplest way to make the chat id appear in
// getUpdates. The script never prints the token; it only prints chat ids,
// chat titles, and the most recent message body so the operator can match
// the chat to a real person.
//
// Add the printed chat id to TELEGRAM_NOTIFY_CHAT_IDS (comma-separated) so
// the API broadcasts new lead submissions to it.

const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim()
if (!token) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN is not set. Put it in your environment (or .env) and retry.')
  process.exit(2)
}

// Safety: refuse to print or hint at the token even on accidental log lines.
// The fetch URL is the only place the token appears — keep it scoped here.
async function main() {
  const url = `https://api.telegram.org/bot${token}/getUpdates`
  let body
  try {
    const res = await fetch(url, { method: 'GET' })
    body = await res.json().catch(() => null)
    if (!res.ok || !body) {
      console.error(`ERROR: Telegram getUpdates returned HTTP ${res.status}.`)
      // Avoid dumping `body` directly — Telegram sometimes echoes parts of the
      // request URL in error messages, which can re-expose the token.
      if (body && typeof body === 'object') {
        const safe = { ok: body.ok, error_code: body.error_code, description: body.description }
        console.error('Response (sanitised):', JSON.stringify(safe))
      }
      process.exit(1)
    }
  } catch (err) {
    console.error('ERROR: Could not reach Telegram:', err?.message || err)
    process.exit(1)
  }

  if (!body.ok) {
    console.error('Telegram refused the request:', body.description || body)
    process.exit(1)
  }

  const updates = Array.isArray(body.result) ? body.result : []
  if (updates.length === 0) {
    console.log('No updates yet — open Telegram, send the bot any message (or /start), then re-run this script.')
    return
  }

  // De-dupe by chat.id; keep the most recent text we saw per chat.
  const byChat = new Map()
  for (const upd of updates) {
    const msg = upd.message || upd.edited_message || upd.channel_post
    if (!msg || !msg.chat) continue
    const chat = msg.chat
    const id = chat.id
    const prev = byChat.get(id)
    const at = msg.date || 0
    if (!prev || at > prev.at) {
      byChat.set(id, {
        id,
        type: chat.type,
        title: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '',
        username: chat.username || null,
        text: msg.text || msg.caption || '',
        at,
      })
    }
  }

  const rows = [...byChat.values()].sort((a, b) => b.at - a.at)
  console.log(`Found ${rows.length} unique chat(s):\n`)
  for (const r of rows) {
    const when = r.at ? new Date(r.at * 1000).toISOString() : ''
    const handle = r.username ? `@${r.username}` : ''
    console.log(`chat_id: ${r.id}`)
    console.log(`  type:   ${r.type}`)
    if (r.title) console.log(`  name:   ${r.title}`)
    if (handle)  console.log(`  handle: ${handle}`)
    if (when)    console.log(`  last:   ${when}`)
    if (r.text)  console.log(`  text:   ${r.text.slice(0, 120)}`)
    console.log()
  }

  console.log('Add the chat_id(s) above to TELEGRAM_NOTIFY_CHAT_IDS (comma-separated) in your .env, then restart the API.')
}

main().catch((err) => {
  console.error('Unexpected failure:', err?.message || err)
  process.exit(1)
})
