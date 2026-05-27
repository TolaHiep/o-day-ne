import { useEffect, useMemo, useState } from 'react'
import { apiRooms, apiLeads, type ViewingAppointment, type ConsultationRequest } from '../lib/api'
import { useAuth } from '../lib/auth'
import { GatedScreen } from '../components/GatedScreen'
import { Icon } from '../components/Icon'
import { goDiscover, goEdit, goOwner, goPost, goRoom, goSaved } from '../lib/router'
import type { Room, RoomFilters } from '../types'
import { getOrCreateClientId, loadFilters } from '../lib/anonState'
import { ROOM_TYPE_LABEL, formatVND, relativeTime } from '../lib/format'

// Last visit timestamps are stored client-side so the feed can highlight
// "since last visit" without adding a server-side notifications table. One
// key per user so multi-account devices keep separate state.
const LAST_VISIT_KEY = (uid: string) => `odn.inbox.lastVisit.${uid}`

function readLastVisit(uid: string): number {
  try {
    const raw = localStorage.getItem(LAST_VISIT_KEY(uid))
    if (!raw) return 0
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  } catch { return 0 }
}
function writeLastVisit(uid: string, ts: number) {
  try { localStorage.setItem(LAST_VISIT_KEY(uid), String(ts)) } catch { /* ignore */ }
}

type FeedItem = {
  id: string
  kind: 'like' | 'report' | 'status' | 'newMatch' | 'savedClosed' | 'tip'
  title: string
  body: string
  ts: number
  fresh?: boolean
  roomId?: string
  cta?: { label: string; onClick: () => void }
}

export function InboxPage() {
  const auth = useAuth()
  const [mine, setMine] = useState<Room[] | null>(null)
  const [saved, setSaved] = useState<Room[] | null>(null)
  const [recommended, setRecommended] = useState<Room[] | null>(null)
  const [lastVisit, setLastVisit] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const [viewings, setViewings] = useState<ViewingAppointment[]>([])
  const [consultations, setConsultations] = useState<ConsultationRequest[]>([])

  // Snapshot lastVisit on first mount, then bump after load — that way items
  // landed while user was away stay highlighted for this render but show as
  // read the next time the page is opened.
  useEffect(() => {
    if (!auth.user) return
    const uid = auth.user.id
    setLastVisit(readLastVisit(uid))
    let cancelled = false
    Promise.all([
      apiRooms.mine().catch(() => ({ rooms: [] as Room[] })),
      apiRooms.saved().catch(() => ({ rooms: [] as Room[] })),
    ]).then(([m, s]) => {
      if (cancelled) return
      setMine(m.rooms)
      setSaved(s.rooms)
    }).catch((e) => setError(e instanceof Error ? e.message : 'Không tải được hoạt động.'))

    // Recommendations only matter for seekers — fetch the active list filtered
    // by the user's last saved search so we can show "new matches".
    const f = loadFilters<RoomFilters>() || {}
    apiRooms.list(f, { excludeSeen: false })
      .then((r) => { if (!cancelled) setRecommended(r.rooms) })
      .catch(() => { if (!cancelled) setRecommended([]) })

    // Lead history (viewing appointments + consultation requests) keyed off
    // the user id when logged in. We also pass the anonymous clientId so a
    // user who submitted requests before logging in still sees them after
    // upgrading to an account.
    apiLeads.mine(getOrCreateClientId())
      .then((r) => {
        if (cancelled) return
        setViewings(r.viewings || [])
        setConsultations(r.consultations || [])
      })
      .catch(() => { /* ignore — feature optional */ })

    // Mark the inbox as visited *after* the network calls settle so a flaky
    // load doesn't bury notifications that didn't actually surface.
    const stamp = Date.now()
    return () => { cancelled = true; writeLastVisit(uid, stamp) }
  }, [auth.user?.id])

  const feed = useMemo<FeedItem[]>(() => {
    if (!auth.user || !mine || !saved) return []
    const out: FeedItem[] = []
    const isLandlord = auth.user.role !== 'seeker' || mine.length > 0

    // Landlord side — surface tin needing attention.
    for (const r of mine) {
      if (r.likes > 0) {
        out.push({
          id: `like-${r.id}`,
          kind: 'like',
          title: `${r.likes} người đã Hợp gu với "${r.title}"`,
          body: `Cập nhật ${relativeTime(r.updatedAt)} · ${r.views} lượt xem · ${r.district}`,
          ts: r.updatedAt,
          fresh: r.updatedAt > lastVisit,
          roomId: r.id,
          cta: { label: 'Xem tin', onClick: () => goRoom(r.id) },
        })
      }
      if (r.reports >= 1) {
        out.push({
          id: `report-${r.id}`,
          kind: 'report',
          title: `Tin "${r.title}" có ${r.reports} báo cáo`,
          body: 'Kiểm tra lại tin, đảm bảo giá và mô tả khớp thực tế. Báo cáo nhiều dễ khiến tin bị ẩn.',
          ts: r.updatedAt,
          fresh: r.reports >= 2 && r.updatedAt > lastVisit,
          roomId: r.id,
          cta: { label: 'Mở sửa tin', onClick: () => goEdit(r.id) },
        })
      }
      if (r.status === 'hidden') {
        out.push({
          id: `hidden-${r.id}`,
          kind: 'status',
          title: `Tin "${r.title}" đang bị ẩn`,
          body: 'Admin tạm ẩn tin này. Sửa lại nội dung rồi mở lại để tiếp tục lên stack quẹt.',
          ts: r.updatedAt,
          fresh: r.updatedAt > lastVisit,
          roomId: r.id,
          cta: { label: 'Mở sửa tin', onClick: () => goEdit(r.id) },
        })
      }
    }
    if (isLandlord && mine.length === 0) {
      out.push({
        id: 'tip-landlord-first',
        kind: 'tip',
        title: 'Đăng phòng đầu tiên',
        body: 'Tin lên stack quẹt ngay sau khi đăng — không cần duyệt thủ công.',
        ts: Date.now(),
        cta: { label: 'Đăng phòng', onClick: goPost },
      })
    }

    // Seeker side — call out saved rooms that closed and brand-new matches.
    for (const r of saved) {
      if (r.status !== 'active') {
        out.push({
          id: `saved-${r.status}-${r.id}`,
          kind: 'savedClosed',
          title: `"${r.title}" ${r.status === 'closed' ? 'đã được chủ đóng' : 'đang bị ẩn'}`,
          body: 'Cân nhắc liên hệ lại hoặc bỏ khỏi sổ Hợp gu để dọn danh sách.',
          ts: r.updatedAt,
          fresh: r.updatedAt > lastVisit,
          roomId: r.id,
          cta: { label: 'Xem chi tiết', onClick: () => goRoom(r.id) },
        })
      }
    }
    if (recommended && recommended.length) {
      const savedIds = new Set(saved.map((r) => r.id))
      const mineIds = new Set(mine.map((r) => r.id))
      const news = recommended
        .filter((r) => !savedIds.has(r.id) && !mineIds.has(r.id) && r.status === 'active')
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 3)
      for (const r of news) {
        out.push({
          id: `new-${r.id}`,
          kind: 'newMatch',
          title: `Phòng mới khớp gu: ${r.title}`,
          body: `${r.district} · ${ROOM_TYPE_LABEL[r.roomType]} · ${formatVND(r.priceVnd)}/tháng · ${r.areaM2} m²`,
          ts: r.createdAt,
          fresh: r.createdAt > lastVisit,
          roomId: r.id,
          cta: { label: 'Mở quẹt', onClick: () => goRoom(r.id) },
        })
      }
    }
    if (saved.length >= 5) {
      out.push({
        id: 'tip-call-soon',
        kind: 'tip',
        title: `Bạn đã lưu ${saved.length} phòng — gọi sớm nhé`,
        body: 'Phòng tốt thường được chốt trong 24–48h. Gọi nhanh hoặc nhắn Zalo trước khi phòng trôi.',
        ts: Date.now(),
        cta: { label: 'Mở sổ Hợp gu', onClick: goSaved },
      })
    }

    out.sort((a, b) => {
      if (a.fresh !== b.fresh) return a.fresh ? -1 : 1
      return b.ts - a.ts
    })
    return out
  }, [auth.user, mine, saved, recommended, lastVisit])

  if (!auth.user) {
    return (
      <GatedScreen
        emoji="🔔"
        title="Hoạt động của bạn"
        subtitle="Đăng nhập để xem ai vừa hợp gu phòng bạn đăng, phòng mới khớp gu, và nhắc nhở phải gọi chủ."
        bullets={[
          { emoji: '💚', text: 'Ai vừa Hợp gu với tin của bạn (cho chủ trọ)' },
          { emoji: '✨', text: 'Phòng mới khớp với bộ lọc bạn vừa dùng' },
          { emoji: '🚨', text: 'Cảnh báo phòng đã lưu bị đóng hoặc bị ẩn' },
        ]}
        primaryLabel="Đăng nhập"
        onPrimary={() => auth.openPopup('inbox')}
        secondaryLabel="← Tiếp tục quẹt"
        onSecondary={goDiscover}
      />
    )
  }

  const stats = summarize(mine || [])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow inline-flex items-center gap-1.5"><Icon.Sparkles size={11} className="text-leaf-500" /> Hoạt động</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">Thông báo & nhắc nhở</h1>
          <p className="text-sm text-ink-500">
            Gom dữ liệu từ phòng bạn đăng, phòng bạn lưu và bộ lọc gần đây — cập nhật theo thời gian thực.
          </p>
        </div>
        {(mine && mine.length > 0) && (
          <div className="flex shrink-0 gap-2 text-xs text-ink-500">
            <span className="pill pill-leaf"><Icon.Eye size={11} /> {stats.views} lượt xem</span>
            <span className="pill pill-coral"><Icon.HeartFilled size={11} /> {stats.likes} hợp gu</span>
            {stats.reports > 0 && (
              <span className="pill pill-coral"><Icon.Flag size={11} /> {stats.reports} báo cáo</span>
            )}
          </div>
        )}
      </header>

      {error && <p className="rounded-2xl bg-coral-50 px-3 py-2 text-sm text-coral-500">{error}</p>}
      {!mine && !error && <p className="text-ink-500">Đang tải hoạt động…</p>}

      {mine && saved && feed.length === 0 && (
        <div className="card-soft text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-leaf-50 text-leaf-700 ring-1 ring-leaf-100">
            <Icon.Sparkles size={24} />
          </div>
          <p className="mt-3 font-display text-xl font-semibold tracking-tight">Hộp thư trống — quá đẹp.</p>
          <p className="mt-1 text-sm text-ink-500">Khi có lượt hợp gu mới hoặc phòng khớp gu xuất hiện, hệ thống sẽ báo bạn tại đây.</p>
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={goDiscover} className="btn-leaf btn-pill"><Icon.Compass size={14} /> Mở stack quẹt</button>
            {(auth.user.role === 'landlord' || stats.total > 0) && (
              <button onClick={goOwner} className="btn-outline btn-pill"><Icon.Home size={14} /> Phòng của tôi</button>
            )}
          </div>
        </div>
      )}

      {feed.length > 0 && (
        <ul className="space-y-3">
          {feed.map((item) => (
            <li key={item.id}>
              <FeedRow item={item} />
            </li>
          ))}
        </ul>
      )}

      {(viewings.length > 0 || consultations.length > 0) && (
        <section className="space-y-3">
          <div>
            <p className="eyebrow inline-flex items-center gap-1.5">
              <Icon.Phone size={11} className="text-leaf-500" /> Yêu cầu của bạn
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold tracking-tight">Lịch hẹn & yêu cầu tư vấn</h2>
            <p className="text-sm text-ink-500">Các lần bạn để lại liên hệ với tư vấn viên của Ở Đây Nè.</p>
          </div>
          {viewings.length > 0 && (
            <ul className="space-y-2">
              {viewings.map((v) => (
                <li key={v.id} className="card-soft flex items-start gap-3 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-leaf-50 text-leaf-700">
                    <Icon.Eye size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base font-semibold text-ink-900">Hẹn xem phòng</p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      Thời gian: <span className="text-ink-700">{v.preferredAt}</span>
                    </p>
                    <p className="text-sm text-ink-500">
                      Liên hệ: <span className="text-ink-700">{v.name} · {v.phone}</span>
                    </p>
                    {v.note && <p className="mt-1 text-sm text-ink-500">Ghi chú: {v.note}</p>}
                    <p className="mt-1 text-[11px] text-ink-400">Gửi {relativeTime(v.createdAt)}</p>
                  </div>
                  <button onClick={() => goRoom(v.roomId)} className="btn-outline btn-pill shrink-0">
                    Xem phòng <Icon.ArrowRight size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {consultations.length > 0 && (
            <ul className="space-y-2">
              {consultations.map((c) => (
                <li key={c.id} className="card-soft flex items-start gap-3 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-coral-50 text-coral-500">
                    <Icon.Sparkles size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base font-semibold text-ink-900">Yêu cầu tư vấn</p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      Liên hệ: <span className="text-ink-700">{c.name} · {c.phone}</span>
                    </p>
                    {c.note && <p className="mt-1 text-sm text-ink-500">{c.note}</p>}
                    <p className="mt-1 text-[11px] text-ink-400">Gửi {relativeTime(c.createdAt)}</p>
                  </div>
                  {c.roomId && (
                    <button onClick={() => goRoom(c.roomId!)} className="btn-outline btn-pill shrink-0">
                      Xem phòng <Icon.ArrowRight size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function summarize(rooms: Room[]) {
  return rooms.reduce(
    (acc, r) => {
      acc.total++
      acc.views += r.views
      acc.likes += r.likes
      acc.reports += r.reports
      return acc
    },
    { total: 0, views: 0, likes: 0, reports: 0 },
  )
}

function FeedRow({ item }: { item: FeedItem }) {
  const tone = TONE[item.kind]
  return (
    <article
      className={`card-soft flex flex-wrap items-start gap-3 p-4 ${
        item.fresh ? 'ring-2 ring-leaf-300' : ''
      }`}
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${tone.bg} ${tone.fg}`}>
        {tone.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-semibold text-ink-900">
          {item.title}
          {item.fresh && (
            <span className="ml-2 inline-flex items-center rounded-full bg-leaf-500 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-white">
              Mới
            </span>
          )}
        </p>
        <p className="mt-0.5 text-sm text-ink-500">{item.body}</p>
        <p className="mt-1 text-[11px] text-ink-400">{relativeTime(item.ts)}</p>
      </div>
      {item.cta && (
        <button onClick={item.cta.onClick} className="btn-leaf btn-pill shrink-0">
          {item.cta.label} <Icon.ArrowRight size={14} />
        </button>
      )}
    </article>
  )
}

const TONE: Record<FeedItem['kind'], { bg: string; fg: string; icon: React.ReactNode }> = {
  like: { bg: 'bg-coral-50', fg: 'text-coral-500', icon: <Icon.HeartFilled size={18} /> },
  report: { bg: 'bg-coral-50', fg: 'text-coral-500', icon: <Icon.Flag size={18} /> },
  status: { bg: 'bg-cream-200', fg: 'text-ink-700', icon: <Icon.AlertTriangle size={18} /> },
  newMatch: { bg: 'bg-leaf-50', fg: 'text-leaf-700', icon: <Icon.Sparkles size={18} /> },
  savedClosed: { bg: 'bg-cream-200', fg: 'text-ink-700', icon: <Icon.Bookmark size={18} /> },
  tip: { bg: 'bg-leaf-50', fg: 'text-leaf-700', icon: <Icon.Check size={18} /> },
}
