import { useEffect, useState } from 'react'
import { apiAuth, apiRooms } from '../lib/api'
import { useAuth } from '../lib/auth'
import { GatedScreen } from '../components/GatedScreen'
import { Icon } from '../components/Icon'
import { goAbout, goDiscover, goInbox, goOwner, goPost, goSaved } from '../lib/router'

export function ProfilePage() {
  const auth = useAuth()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [avatar, setAvatar] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ mine: number; saved: number } | null>(null)

  useEffect(() => {
    if (!auth.user) return
    setName(auth.user.name)
    setPhone(auth.user.phone || '')
    setAvatar(auth.user.avatar || '')
  }, [auth.user?.id, auth.user?.name, auth.user?.phone, auth.user?.avatar])

  useEffect(() => {
    if (!auth.user) return
    let cancelled = false
    Promise.all([
      apiRooms.mine().then((r) => r.rooms.length).catch(() => 0),
      apiRooms.saved().then((r) => r.rooms.length).catch(() => 0),
    ]).then(([mine, saved]) => {
      if (!cancelled) setCounts({ mine, saved })
    })
    return () => { cancelled = true }
  }, [auth.user?.id])

  if (!auth.user) {
    return (
      <GatedScreen
        emoji="🙋"
        title="Hồ sơ của bạn"
        subtitle="Đăng nhập để quản lý thông tin liên hệ và đồng bộ phòng đã lưu giữa các thiết bị."
        bullets={[
          { emoji: '📞', text: 'Thêm SĐT / Zalo để chủ trọ liên hệ lại nhanh hơn' },
          { emoji: '💾', text: 'Đồng bộ phòng đã lưu giữa các thiết bị' },
          { emoji: '🔒', text: 'Đăng xuất khỏi mọi thiết bị khi cần' },
        ]}
        primaryLabel="Đăng nhập"
        onPrimary={() => auth.openPopup('profile')}
        secondaryLabel="← Về trang quẹt"
        onSecondary={goDiscover}
      />
    )
  }

  const user = auth.user
  const initial = (user.name || '?').charAt(0).toUpperCase()
  const dirty =
    name.trim() !== (user.name || '') ||
    phone.trim() !== (user.phone || '') ||
    avatar.trim() !== (user.avatar || '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSuccess(null); setSavingProfile(true)
    try {
      await apiAuth.updateMe({
        name: name.trim(),
        phone: phone.trim() || null,
        avatar: avatar.trim() || null,
      })
      await auth.refresh()
      setSuccess('Đã lưu hồ sơ.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu thất bại.')
    } finally { setSavingProfile(false) }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow inline-flex items-center gap-1.5">
              <Icon.Settings size={11} className="text-leaf-500" /> Hồ sơ
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">Cài đặt tài khoản</h1>
            <p className="text-sm text-ink-500">Thông tin này dùng cho liên hệ và đăng tin. Email lấy từ nhà cung cấp đăng nhập, không sửa được tại đây.</p>
          </div>
        </header>

        <section className="card-soft">
          <div className="flex flex-wrap items-center gap-4">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt=""
                className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-1 ring-cream-300"
              />
            ) : (
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-leaf-50 font-display text-2xl font-bold text-leaf-700 ring-1 ring-leaf-100">
                {initial}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-display text-xl font-semibold text-ink-900">{user.name}</p>
              <p className="text-sm text-ink-500">{user.email || 'Chưa có email'}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {user.isAdmin && <span className="pill pill-coral"><Icon.Shield size={11} /> Admin</span>}
                <span className="pill pill-cream">Thành viên từ {fmtDate(user.createdAt)}</span>
              </div>
            </div>
          </div>
        </section>

        <form onSubmit={submit} className="card-soft space-y-4">
          <div>
            <p className="font-display text-lg font-semibold">Thông tin cá nhân</p>
            <p className="text-xs text-ink-500">Chủ trọ thường gọi lại sớm hơn nếu thấy có SĐT hoặc Zalo.</p>
          </div>
          <Field label="Tên hiển thị">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <Field label="Số điện thoại liên hệ">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0903 451 220" />
            <p className="mt-1 text-[11px] text-ink-500">Tuỳ chọn. Chỉ hiển thị cho chủ trọ khi bạn chủ động liên hệ.</p>
          </Field>
          <Field label="Avatar (URL ảnh)">
            <input className="input" value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://..." />
            <p className="mt-1 text-[11px] text-ink-500">Có thể bỏ trống. Hệ thống sẽ dùng chữ cái đầu thay thế.</p>
          </Field>

          {error && <p className="rounded-2xl bg-coral-50 px-3 py-2 text-sm text-coral-500">{error}</p>}
          {success && <p className="rounded-2xl bg-leaf-50 px-3 py-2 text-sm text-leaf-700">{success}</p>}

          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-leaf btn-pill" disabled={!dirty || savingProfile}>
              {savingProfile ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
            {dirty && !savingProfile && (
              <button
                type="button"
                onClick={() => {
                  setName(user.name)
                  setPhone(user.phone || '')
                  setAvatar(user.avatar || '')
                }}
                className="btn-ghost btn-pill"
              >Huỷ</button>
            )}
          </div>
        </form>

      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <section className="card-soft">
          <p className="font-display text-lg font-semibold">Hoạt động nhanh</p>
          <div className="mt-3 grid gap-2">
            <QuickLink onClick={goSaved} icon={<Icon.HeartFilled size={14} className="text-coral-400" />} label="Phòng đã hợp gu" hint={counts ? `${counts.saved} phòng` : undefined} />
            <QuickLink onClick={goOwner} icon={<Icon.Home size={14} className="text-leaf-500" />} label="Phòng đã đăng" hint={counts ? `${counts.mine} tin` : undefined} />
            <QuickLink onClick={goInbox} icon={<Icon.Sparkles size={14} className="text-leaf-500" />} label="Hoạt động" hint="Thông báo & lượt quan tâm" />
            <QuickLink onClick={goPost} icon={<Icon.Plus size={14} />} label="Đăng phòng mới" />
            <QuickLink onClick={goAbout} icon={<Icon.Shield size={14} />} label="An toàn & câu hỏi thường gặp" />
          </div>
        </section>
        <section className="card-soft">
          <p className="font-display text-lg font-semibold">Phiên đăng nhập</p>
          <p className="text-xs text-ink-500">Đăng xuất sẽ chấm dứt phiên trên thiết bị này. Bộ Hợp gu vẫn được lưu trên máy chủ.</p>
          <button onClick={() => { auth.logout() }} className="btn-coral btn-pill mt-3 w-full">
            <Icon.LogOut size={14} /> Đăng xuất khỏi thiết bị này
          </button>
        </section>
      </aside>
    </div>
  )
}

function QuickLink({ onClick, icon, label, hint }: { onClick: () => void; icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between gap-2 rounded-2xl bg-cream-100 px-3 py-2 text-left ring-1 ring-cream-200 transition hover:bg-cream-200/80"
    >
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink-800">
        {icon} {label}
      </span>
      <span className="text-xs text-ink-500">{hint}<Icon.ChevronRight size={14} className="ml-1 inline -translate-y-px text-ink-400" /></span>
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label">{label}</p>
      {children}
    </div>
  )
}

function fmtDate(ts: number) {
  try {
    return new Intl.DateTimeFormat('vi-VN', { month: 'short', year: 'numeric' }).format(new Date(ts))
  } catch { return '' }
}
