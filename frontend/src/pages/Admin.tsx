import { useCallback, useEffect, useState } from 'react'
import { apiAdmin } from '../lib/api'
import { useAuth } from '../lib/auth'
import { goDiscover, goRoom } from '../lib/router'
import type { AdminStats, ContributedPhoto, Report, Room, User } from '../types'
import { ROOM_TYPE_LABEL, formatVND, relativeTime } from '../lib/format'
import { GatedScreen } from '../components/GatedScreen'
import { Icon } from '../components/Icon'

type Tab = 'stats' | 'rooms' | 'reports' | 'photos' | 'users'

export function AdminPage() {
  const auth = useAuth()
  const [tab, setTab] = useState<Tab>('stats')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [photos, setPhotos] = useState<ContributedPhoto[]>([])
  const [admUsers, setAdmUsers] = useState<User[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true); setErr(null)
    try {
      if (tab === 'stats') setStats((await apiAdmin.stats()).stats)
      if (tab === 'rooms') setRooms((await apiAdmin.rooms()).rooms)
      if (tab === 'reports') setReports((await apiAdmin.reports()).reports)
      if (tab === 'photos') setPhotos((await apiAdmin.photos()).photos)
      if (tab === 'users') setAdmUsers((await apiAdmin.users()).users)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Tải dữ liệu lỗi.') }
    finally { setBusy(false) }
  }, [tab])
  useEffect(() => { if (auth.user?.isAdmin) refresh() }, [refresh, auth.user?.isAdmin])

  if (!auth.user) {
    return (
      <GatedScreen
        emoji="🛡"
        title="Khu vực quản trị Ở Đây Nè"
        subtitle="Trang dành cho admin để giữ chất lượng tin phòng và bảo vệ người tìm trọ."
        bullets={[
          { emoji: '🏠', text: 'Duyệt, ẩn, gắn nổi bật hoặc xác minh từng phòng' },
          { emoji: '🚩', text: 'Xử lý báo cáo của cộng đồng và ảnh chờ duyệt' },
          { emoji: '👥', text: 'Theo dõi tài khoản, tạm khoá người dùng vi phạm' },
        ]}
        primaryLabel="Đăng nhập admin"
        onPrimary={() => auth.openPopup('admin')}
        secondaryLabel="← Về trang quẹt"
        onSecondary={goDiscover}
        tone="coral"
        previewTitle="Công cụ bạn sẽ có"
        previewItems={[
          { emoji: '📊', title: 'Thống kê tổng quan', sub: 'Phòng đang hiện, báo cáo mở, ảnh chờ duyệt — cập nhật theo thời gian thực.' },
          { emoji: '🏠', title: 'Bảng phòng', sub: 'Lọc, ẩn, gắn nổi bật và verify từng tin.' },
          { emoji: '🚩', title: 'Báo cáo cộng đồng', sub: 'Xử lý tin ảo, sai giá, sai địa chỉ chỉ với một cú bấm.' },
          { emoji: '📷', title: 'Ảnh đóng góp', sub: 'Duyệt / từ chối ảnh thật từ người đi xem trước khi hiển thị công khai.' },
        ]}
        footer={<>Chỉ tài khoản có cờ <code className="rounded bg-cream-200 px-1 py-0.5">isAdmin</code> mới vào được khu vực này.</>}
      />
    )
  }
  if (!auth.user.isAdmin) {
    return (
      <div className="card-soft">
        <p className="font-display text-xl font-semibold">Không đủ quyền truy cập</p>
        <p className="mt-1 text-sm text-ink-500">Tài khoản này không có quyền admin. Liên hệ admin chính nếu cần cấp quyền.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow inline-flex items-center gap-1.5"><Icon.Shield size={11} className="text-coral-400" /> Khu vực admin</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">Bảng quản trị</h1>
          <p className="text-sm text-ink-500">Duyệt phòng, xử lý báo cáo, kiểm tra ảnh đóng góp, quản lý tài khoản.</p>
        </div>
        <button onClick={refresh} className="btn-outline btn-pill shrink-0">
          <Icon.Sparkles size={14} /> Tải lại
        </button>
      </header>

      <nav className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 scrollbar-thin sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {(['stats', 'rooms', 'reports', 'photos', 'users'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold ${tab === t ? 'bg-leaf-500 text-white' : 'bg-cream-200 text-ink-700 hover:bg-cream-300'}`}>
            {tabLabel(t)}
          </button>
        ))}
      </nav>

      {err && <p className="rounded-2xl bg-coral-50 px-3 py-2 text-sm text-coral-500">{err}</p>}
      {busy && <p className="text-sm text-ink-500">Đang tải…</p>}

      {tab === 'stats' && stats && <StatsTab stats={stats} />}
      {tab === 'rooms' && <RoomsTab rooms={rooms} refresh={refresh} />}
      {tab === 'reports' && <ReportsTab reports={reports} refresh={refresh} />}
      {tab === 'photos' && <PhotosTab photos={photos} refresh={refresh} />}
      {tab === 'users' && <UsersTab users={admUsers} refresh={refresh} />}
    </div>
  )
}

function tabLabel(t: string) {
  return ({ stats: 'Thống kê', rooms: 'Phòng', reports: 'Báo cáo', photos: 'Ảnh chờ duyệt', users: 'Người dùng' } as Record<string, string>)[t]
}

function StatsTab({ stats }: { stats: AdminStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Người dùng" value={String(stats.activeUsers)} />
      <Stat label="Phòng đang hiện" value={String(stats.rooms.active || 0)} hue="leaf" />
      <Stat label="Phòng bị ẩn" value={String((stats.rooms.hidden || 0) + (stats.rooms.closed || 0))} />
      <Stat label="Phòng bị flag" value={String(stats.flaggedRooms)} hue="coral" />
      <Stat label="Báo cáo mở" value={String(stats.openReports)} hue="coral" />
      <Stat label="Ảnh chờ duyệt" value={String(stats.pendingPhotos)} />
    </div>
  )
}
function Stat({ label, value, hue }: { label: string; value: string; hue?: 'leaf' | 'coral' }) {
  const cl = hue === 'leaf' ? 'text-leaf-700' : hue === 'coral' ? 'text-coral-500' : 'text-ink-900'
  return (
    <div className="card-soft">
      <p className="text-[11px] uppercase tracking-widest text-ink-500">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold ${cl}`}>{value}</p>
    </div>
  )
}

function RoomsTab({ rooms, refresh }: { rooms: Room[]; refresh: () => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white/80 shadow-soft">
      <table className="min-w-full text-sm">
        <thead className="text-left text-ink-500">
          <tr>
            <th className="px-3 py-2">Phòng</th>
            <th className="px-3 py-2">Khu vực</th>
            <th className="px-3 py-2">Giá</th>
            <th className="px-3 py-2">Trạng thái</th>
            <th className="px-3 py-2">Báo cáo</th>
            <th className="px-3 py-2">Hành động</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.id} className="border-t border-cream-200">
              <td className="px-3 py-2 max-w-xs">
                <button onClick={() => goRoom(r.id)} className="font-semibold text-ink-900 hover:text-leaf-700 line-clamp-2 text-left">{r.title}</button>
                <p className="text-[11px] text-ink-400">{r.id}</p>
              </td>
              <td className="px-3 py-2">{r.district}<br /><span className="text-ink-500">{r.ward}</span></td>
              <td className="px-3 py-2 font-semibold">{formatVND(r.priceVnd)}</td>
              <td className="px-3 py-2">{r.status}</td>
              <td className="px-3 py-2">{r.reports}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  {r.status !== 'hidden' && (
                    <button onClick={async () => { await apiAdmin.patchRoom(r.id, { status: 'hidden' }); refresh() }} className="btn-ghost btn-pill">Ẩn</button>
                  )}
                  {r.status !== 'active' && (
                    <button onClick={async () => { await apiAdmin.patchRoom(r.id, { status: 'active' }); refresh() }} className="btn-leaf btn-pill">Hiện</button>
                  )}
                  <button onClick={async () => { await apiAdmin.patchRoom(r.id, { featured: !r.featured }); refresh() }}
                    className={r.featured ? 'btn-coral btn-pill' : 'btn-outline btn-pill'}>
                    {r.featured ? '★ Nổi bật' : 'Đánh nổi bật'}
                  </button>
                  <button onClick={async () => { await apiAdmin.patchRoom(r.id, { verified: !r.verified }); refresh() }}
                    className={r.verified ? 'btn-leaf btn-pill' : 'btn-outline btn-pill'}>
                    {r.verified ? '✓ Đã verify' : 'Verify'}
                  </button>
                  <button onClick={async () => {
                    if (confirm('Xoá phòng này vĩnh viễn?')) { await apiAdmin.deleteRoom(r.id); refresh() }
                  }} className="btn-coral btn-pill">Xoá</button>
                </div>
              </td>
            </tr>
          ))}
          {rooms.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-500">Chưa có phòng nào.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function ReportsTab({ reports, refresh }: { reports: Report[]; refresh: () => void }) {
  return (
    <div className="space-y-3">
      {reports.length === 0 && <p className="text-ink-500">Không có báo cáo nào đang mở.</p>}
      {reports.map((r) => (
        <article key={r.id} className="card-soft flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm">
              <span className="font-semibold text-coral-500">{reasonLabel(r.reason)}</span>{' '}
              · phòng <button onClick={() => goRoom(r.roomId)} className="font-mono text-leaf-700 underline">{r.roomId}</button>
            </p>
            {r.detail && <p className="mt-1 text-sm text-ink-700">{r.detail}</p>}
            <p className="text-xs text-ink-500">{relativeTime(r.createdAt)}</p>
          </div>
          <button onClick={async () => { await apiAdmin.resolveReport(r.id); refresh() }} className="btn-leaf btn-pill">Đã xử lý</button>
        </article>
      ))}
    </div>
  )
}
function reasonLabel(r: string) {
  return ({
    fake_listing: 'Tin ảo', wrong_price: 'Sai giá', wrong_address: 'Sai địa chỉ',
    spam: 'Spam', rude_owner: 'Chủ trọ không nghiêm túc', other: 'Khác',
  } as Record<string, string>)[r] || r
}

function PhotosTab({ photos, refresh }: { photos: ContributedPhoto[]; refresh: () => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {photos.length === 0 && <p className="text-ink-500">Không còn ảnh nào chờ duyệt 🎉</p>}
      {photos.map((p) => (
        <article key={p.id} className="card-soft p-0 overflow-hidden">
          <div className="aspect-[4/3] bg-cream-300">
            <img src={p.url} alt={p.caption || ''} className="h-full w-full object-cover" />
          </div>
          <div className="p-3">
            <p className="text-sm">
              <button onClick={() => goRoom(p.roomId)} className="font-mono text-leaf-700 underline">{p.roomId}</button>
              · {relativeTime(p.createdAt)}
            </p>
            {p.caption && <p className="mt-1 text-sm text-ink-700">{p.caption}</p>}
            <div className="mt-3 flex gap-2">
              <button onClick={async () => { await apiAdmin.reviewPhoto(p.id, 'approved'); refresh() }} className="btn-leaf btn-pill flex-1">Duyệt</button>
              <button onClick={async () => { await apiAdmin.reviewPhoto(p.id, 'rejected'); refresh() }} className="btn-coral btn-pill flex-1">Từ chối</button>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

function UsersTab({ users, refresh }: { users: User[]; refresh: () => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white/80 shadow-soft">
      <table className="min-w-full text-sm">
        <thead className="text-left text-ink-500">
          <tr>
            <th className="px-3 py-2">Người dùng</th>
            <th className="px-3 py-2">Vai trò</th>
            <th className="px-3 py-2">Trạng thái</th>
            <th className="px-3 py-2">Hành động</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-cream-200">
              <td className="px-3 py-2">
                <p className="font-semibold">{u.name}</p>
                <p className="text-xs text-ink-500">{u.email || '—'}</p>
                <p className="text-[11px] text-ink-400 font-mono">{u.id}</p>
              </td>
              <td className="px-3 py-2">{u.role}{u.isAdmin ? ' · admin' : ''}</td>
              <td className="px-3 py-2">{u.suspendedAt ? <span className="text-coral-500">Đã tạm khoá</span> : 'Bình thường'}</td>
              <td className="px-3 py-2 space-x-2">
                {u.suspendedAt ? (
                  <button onClick={async () => { await apiAdmin.patchUser(u.id, { suspended: false }); refresh() }} className="btn-leaf btn-pill">Mở lại</button>
                ) : (
                  <button onClick={async () => { if (confirm('Tạm khoá tài khoản này?')) { await apiAdmin.patchUser(u.id, { suspended: true }); refresh() } }} className="btn-coral btn-pill">Khoá</button>
                )}
                <button onClick={async () => { await apiAdmin.patchUser(u.id, { isAdmin: !u.isAdmin }); refresh() }}
                  className={u.isAdmin ? 'btn-ghost btn-pill' : 'btn-outline btn-pill'}>
                  {u.isAdmin ? 'Bỏ admin' : 'Cấp admin'}
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-500">Chưa có người dùng.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
