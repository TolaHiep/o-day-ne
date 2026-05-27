import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { apiAuth } from '../lib/api'
import { Brand, Icon } from './Icon'

const INTENT_COPY: Record<string, string> = {
  save: 'Lưu phòng vào danh sách hợp gu',
  review: 'Đánh giá phòng từng ở',
  report: 'Báo cáo phòng có dấu hiệu ảo',
  contribute: 'Đóng góp ảnh thực tế khi đi xem',
  post: 'Đăng phòng cho thuê',
  owner: 'Mở bảng điều khiển chủ trọ',
  admin: 'Vào trang quản trị',
  profile: 'Quản lý hồ sơ cá nhân',
  inbox: 'Xem hoạt động và thông báo',
  about: 'Tìm hiểu Ở Đây Nè và cách hoạt động',
  feedback: 'Gửi góp ý hoặc báo lỗi cho Ở Đây Nè',
}

// Intents that imply the user is acting as a landlord. The seeker/landlord
// choice is no longer surfaced in the UI; we infer it from intent so the
// backend can promote the account at first post.
const LANDLORD_INTENTS = new Set(['post', 'owner'])

export function LoginPopup() {
  const auth = useAuth()
  const role: 'seeker' | 'landlord' =
    auth.popupIntent && LANDLORD_INTENTS.has(auth.popupIntent) ? 'landlord' : 'seeker'
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)

  useEffect(() => {
    if (!auth.popupOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [auth.popupOpen])

  if (!auth.popupOpen) return null

  const subtitleIntent = auth.popupIntent ? INTENT_COPY[auth.popupIntent] : null
  const googleEnabled = !!auth.providers?.google
  // Start the Google OAuth flow by asking the backend to mint a single-use
  // state nonce. The server returns an authorize URL with that state already
  // attached; the callback validates it on return (CSRF protection).
  const onGoogleClick = async () => {
    if (!googleEnabled || googleBusy) return
    setGoogleError(null); setGoogleBusy(true)
    try {
      const r = await apiAuth.googleStart(role)
      window.location.assign(r.authorizeUrl)
    } catch {
      setGoogleBusy(false)
      setGoogleError('Không kết nối được tới Google. Thử lại sau ít giây.')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Đăng nhập Ở Đây Nè"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/55 backdrop-blur-sm animate-fadeIn sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) auth.closePopup() }}
    >
      <div className="relative flex max-h-[92svh] w-full flex-col overflow-hidden rounded-t-[28px] bg-cream-50 shadow-card ring-1 ring-ink-900/[0.06] animate-slideUp sm:max-h-[90vh] sm:w-[26rem] sm:rounded-[28px]">
        <button
          aria-label="Đóng"
          className="absolute right-4 top-4 z-10 grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-cream-200/80 text-ink-700 ring-1 ring-ink-900/[0.04] transition hover:bg-cream-300"
          onClick={() => auth.closePopup()}
        >
          <Icon.Close size={16} />
        </button>

        <div className="overflow-y-auto pb-safe scrollbar-thin">
          <div className="px-6 pt-7 pb-2">
            <div className="flex items-center gap-3">
              <div className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-cream-50 shadow-soft ring-1 ring-ink-900/[0.04]">
                <img
                  src="/logo-odayne.png"
                  alt="Ở Đây Nè"
                  width={56}
                  height={56}
                  className="h-full w-full object-cover"
                  loading="eager"
                  decoding="async"
                />
              </div>
              <div className="leading-tight">
                <p className="font-display text-[1.35rem] font-semibold tracking-tight text-ink-900">Chào mừng tới Ở Đây Nè</p>
                <p className="text-xs text-ink-500">Đăng nhập một chạm — không cần mật khẩu.</p>
              </div>
            </div>
            {subtitleIntent && (
              <p className="mt-4 flex items-start gap-2 rounded-2xl bg-leaf-50 px-3 py-2.5 text-sm text-leaf-700 ring-1 ring-leaf-100">
                <Icon.Sparkles size={14} className="mt-0.5 shrink-0" />
                <span>Đăng nhập để <span className="font-semibold">{subtitleIntent.toLowerCase()}</span>.</span>
              </p>
            )}
          </div>

          <div className="px-6 pt-4 pb-6 space-y-2.5">
            {googleEnabled ? (
              <button
                type="button"
                onClick={onGoogleClick}
                disabled={googleBusy}
                className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-ink-900 ring-1 ring-ink-900/10 transition hover:bg-cream-100 hover:ring-leaf-400/40 disabled:cursor-wait disabled:opacity-70"
              >
                <Brand.Google size={20} />
                <span>{googleBusy ? 'Đang chuyển tới Google…' : 'Đăng nhập bằng Google'}</span>
              </button>
            ) : (
              <div className="flex w-full items-center justify-center gap-3 rounded-2xl bg-cream-100 px-4 py-3 text-sm font-medium text-ink-400 ring-1 ring-ink-900/[0.06]">
                <Brand.Google size={20} />
                <span>Google chưa được cấu hình</span>
              </div>
            )}
            {googleError && (
              <p className="text-center text-xs text-red-600">{googleError}</p>
            )}

            <div
              aria-disabled="true"
              title="Facebook sắp ra mắt"
              className="flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-2xl bg-cream-100 px-4 py-3 text-sm font-medium text-ink-400 opacity-60 ring-1 ring-ink-900/[0.05]"
            >
              <Brand.Facebook size={20} />
              <span>Đăng nhập bằng Facebook</span>
              <span className="ml-1 rounded-full bg-cream-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Sắp ra mắt</span>
            </div>

            <p className="pt-2 text-center text-[11px] text-ink-400">
              Bằng việc đăng nhập, bạn đồng ý sử dụng Ở Đây Nè vì mục đích tìm/đăng phòng cá nhân.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
