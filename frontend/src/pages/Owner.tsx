import { useEffect, useMemo, useState } from 'react'
import { apiRooms } from '../lib/api'
import { useAuth } from '../lib/auth'
import { goEdit, goPost, goRoom } from '../lib/router'
import type { Room } from '../types'
import { ROOM_TYPE_LABEL, formatVND, relativeTime } from '../lib/format'
import { Icon } from '../components/Icon'

type OwnerFilter = 'all' | 'active' | 'closed' | 'hidden'

export function OwnerPage() {
  const auth = useAuth()
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<OwnerFilter>('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function load() {
    try { const r = await apiRooms.mine(); setRooms(r.rooms) }
    catch (err) { setError(err instanceof Error ? err.message : 'Không tải được.') }
  }
  useEffect(() => { if (auth.user) load() }, [auth.user?.id])

  const counts = useMemo(() => {
    const m = { all: 0, active: 0, closed: 0, hidden: 0 }
    if (!rooms) return m
    m.all = rooms.length
    for (const r of rooms) {
      if (r.status === 'active') m.active++
      else if (r.status === 'closed') m.closed++
      else if (r.status === 'hidden') m.hidden++
    }
    return m
  }, [rooms])

  const visible = useMemo(() => {
    if (!rooms) return null
    if (filter === 'all') return rooms
    return rooms.filter((r) => r.status === filter)
  }, [rooms, filter])

  const totalViews = rooms?.reduce((s, r) => s + r.views, 0) || 0
  const totalLikes = rooms?.reduce((s, r) => s + r.likes, 0) || 0
  const totalReports = rooms?.reduce((s, r) => s + r.reports, 0) || 0

  if (!auth.user) {
    return (
      <div className="card-soft text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-leaf-50 text-leaf-700 ring-1 ring-leaf-100">
          <Icon.Home size={24} />
        </div>
        <p className="mt-3 font-display text-xl font-semibold tracking-tight">Bảng điều khiển chủ trọ</p>
        <p className="mt-1 text-sm text-ink-500">Đăng nhập để quản lý các phòng bạn đã đăng.</p>
        <button onClick={() => auth.openPopup('owner')} className="btn-leaf btn-lg mt-4">Đăng nhập</button>
      </div>
    )
  }

  async function setStatus(id: string, status: 'active' | 'closed' | 'hidden') {
    setPendingId(id)
    try {
      if (status === 'closed') await apiRooms.close(id)
      else await apiRooms.setStatus(id, status)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không cập nhật được.')
    } finally { setPendingId(null) }
  }

  async function copyLink(id: string) {
    const url = `${window.location.origin}/#/rooms/${encodeURIComponent(id)}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1800)
    } catch {
      // Fallback: dump into the address bar so the user can copy manually.
      window.prompt('Sao chép liên kết phòng:', url)
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow inline-flex items-center gap-1.5"><Icon.Home size={11} className="text-leaf-500" /> Chủ trọ</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">Phòng của tôi</h1>
          <p className="text-sm text-ink-500">Quản lý tin đã đăng, theo dõi tương tác và phản hồi nhanh.</p>
        </div>
        <button onClick={goPost} className="btn-leaf btn-pill shrink-0">
          <Icon.Plus size={14} /> Đăng phòng mới
        </button>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Tổng tin" value={String(counts.all)} icon={<Icon.Home size={14} />} />
        <Card label="Đang hiện" value={String(counts.active)} hue="leaf" icon={<Icon.Check size={14} />} />
        <Card label="Lượt xem" value={formatStat(totalViews)} icon={<Icon.Eye size={14} />} />
        <Card label="Hợp gu · Báo cáo" value={`${formatStat(totalLikes)} · ${formatStat(totalReports)}`} hue={totalReports > 0 ? 'coral' : undefined} icon={<Icon.HeartFilled size={14} />} />
      </section>

      <nav className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 scrollbar-thin sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <FilterChip on={filter === 'all'} onClick={() => setFilter('all')} label="Tất cả" count={counts.all} />
        <FilterChip on={filter === 'active'} onClick={() => setFilter('active')} label="Đang hiện" count={counts.active} hue="leaf" />
        <FilterChip on={filter === 'closed'} onClick={() => setFilter('closed')} label="Đã đóng" count={counts.closed} hue="coral" />
        <FilterChip on={filter === 'hidden'} onClick={() => setFilter('hidden')} label="Bị ẩn" count={counts.hidden} />
      </nav>

      {error && <p className="rounded-2xl bg-coral-50 px-3 py-2 text-sm text-coral-500">{error}</p>}
      {!rooms && !error && <p className="text-ink-500">Đang tải…</p>}

      {rooms && rooms.length === 0 && (
        <div className="card-soft text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-leaf-50 text-leaf-700 ring-1 ring-leaf-100">
            <Icon.Home size={24} />
          </div>
          <p className="mt-3 font-display text-xl font-semibold tracking-tight">Bạn chưa đăng phòng nào.</p>
          <p className="mt-1 text-sm text-ink-500">Tin của bạn sẽ xuất hiện ngay trong stack quẹt sau khi đăng.</p>
          <button onClick={goPost} className="btn-leaf btn-pill mt-3">
            <Icon.Plus size={14} /> Đăng phòng đầu tiên
          </button>
        </div>
      )}

      {visible && visible.length === 0 && rooms && rooms.length > 0 && (
        <div className="card-soft text-center text-sm text-ink-500">
          Không có tin nào ở trạng thái này.
        </div>
      )}

      {visible && visible.length > 0 && (
        <div className="grid gap-3">
          {visible.map((r) => (
            <article key={r.id} className="card-soft grid overflow-hidden p-0 md:grid-cols-[12rem_minmax(0,1fr)_11rem]">
              <button onClick={() => goRoom(r.id)} className="relative aspect-[5/3] cursor-pointer bg-cream-300 md:aspect-auto">
                {r.images?.[0] && <img src={r.images[0]} alt="" className="h-full w-full object-cover" />}
                {r.reports > 0 && (
                  <span className="absolute left-2 top-2 ribbon bg-coral-500 text-white shadow-soft">
                    <Icon.Flag size={11} /> {r.reports} báo cáo
                  </span>
                )}
              </button>
              <div className="min-w-0 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-display text-base font-semibold tracking-tight text-ink-900 sm:text-lg">{r.title}</p>
                  <span className={`ribbon ${statusClass(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                  {r.featured && (
                    <span className="ribbon bg-coral-400 text-white">
                      <Icon.Sparkles size={11} /> Nổi bật
                    </span>
                  )}
                  {r.verified && (
                    <span className="ribbon bg-leaf-100 text-leaf-700 ring-1 ring-leaf-200">
                      <Icon.Check size={11} /> Đã xác minh
                    </span>
                  )}
                  {r.source && (
                    <span
                      className="ribbon bg-cream-200 text-ink-700 ring-1 ring-cream-300"
                      title="Nhãn nguồn — chỉ bạn và admin nhìn thấy"
                    >
                      Nguồn: {r.source}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink-500">{r.district} · {ROOM_TYPE_LABEL[r.roomType]} · {r.areaM2} m² · {formatVND(r.priceVnd)}/tháng</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                  <span className="inline-flex items-center gap-1"><Icon.Eye size={12} /> {r.views} lượt xem</span>
                  <span className="inline-flex items-center gap-1 text-leaf-700"><Icon.HeartFilled size={12} /> {r.likes} hợp gu</span>
                  {r.reports > 0 && (
                    <span className="inline-flex items-center gap-1 text-coral-500"><Icon.Flag size={12} /> {r.reports}</span>
                  )}
                  <span className="text-ink-400">· cập nhật {relativeTime(r.updatedAt)}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-cream-200 p-4 md:flex-col md:flex-nowrap md:justify-center md:border-l md:border-t-0">
                <button
                  onClick={() => goEdit(r.id)}
                  className="btn-outline btn-pill flex-1 md:flex-none"
                  disabled={pendingId === r.id}
                >
                  <Icon.Edit size={14} /> Sửa
                </button>
                {r.status === 'active' ? (
                  <button
                    onClick={() => setStatus(r.id, 'closed')}
                    className="btn-ghost btn-pill flex-1 md:flex-none"
                    disabled={pendingId === r.id}
                  >
                    Đóng tin
                  </button>
                ) : (
                  <button
                    onClick={() => setStatus(r.id, 'active')}
                    className="btn-leaf btn-pill flex-1 md:flex-none"
                    disabled={pendingId === r.id}
                  >
                    {pendingId === r.id ? 'Đang…' : 'Mở lại'}
                  </button>
                )}
                <button
                  onClick={() => copyLink(r.id)}
                  className="btn-ghost btn-pill flex-1 md:flex-none"
                  title="Sao chép liên kết để chia sẻ"
                >
                  {copiedId === r.id ? (
                    <><Icon.Check size={14} /> Đã copy</>
                  ) : (
                    <><Icon.Send size={14} /> Chia sẻ</>
                  )}
                </button>
                <button onClick={() => goRoom(r.id)} className="btn-ghost btn-pill flex-1 md:flex-none">
                  <Icon.Eye size={14} /> Xem
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function Card({ label, value, hue, icon }: { label: string; value: string; hue?: 'leaf' | 'coral'; icon?: React.ReactNode }) {
  const cl = hue === 'leaf' ? 'text-leaf-700' : hue === 'coral' ? 'text-coral-500' : 'text-ink-900'
  return (
    <div className="card-soft">
      <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-ink-500">
        {icon && <span className={cl}>{icon}</span>}
        {label}
      </p>
      <p className={`mt-1 font-display text-2xl font-bold ${cl}`}>{value}</p>
    </div>
  )
}

function FilterChip({ on, onClick, label, count, hue }: { on: boolean; onClick: () => void; label: string; count: number; hue?: 'leaf' | 'coral' }) {
  const inactiveHue = hue === 'leaf' ? 'text-leaf-700' : hue === 'coral' ? 'text-coral-500' : 'text-ink-700'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition ${
        on
          ? 'bg-leaf-500 text-white ring-leaf-500 shadow-soft'
          : `bg-white ring-cream-300 ${inactiveHue} hover:bg-cream-100`
      }`}
    >
      {label}
      <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${on ? 'bg-white/25 text-white' : 'bg-cream-200 text-ink-500'}`}>
        {count}
      </span>
    </button>
  )
}

function statusLabel(s: string) {
  if (s === 'active') return 'Đang hiện'
  if (s === 'hidden') return 'Ẩn'
  if (s === 'closed') return 'Đã đóng'
  if (s === 'pending') return 'Chờ duyệt'
  return s
}
function statusClass(s: string) {
  if (s === 'active') return 'bg-leaf-100 text-leaf-700'
  if (s === 'closed') return 'bg-coral-50 text-coral-500'
  if (s === 'hidden') return 'bg-cream-300 text-ink-700'
  return 'bg-cream-200 text-ink-700'
}
function formatStat(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}
