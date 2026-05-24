import { Icon } from '../components/Icon'
import { goAbout, goDiscover, goSaved } from '../lib/router'

export function NotFoundPage({ path }: { path: string }) {
  return (
    <div className="grid place-items-center py-10">
      <div className="card-soft max-w-lg text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-coral-50 text-coral-400 ring-1 ring-coral-100">
          <Icon.Compass size={28} />
        </div>
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.24em] text-ink-500">404 · không tìm thấy</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
          Hình như bạn lạc đường rồi.
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Đường dẫn <code className="rounded bg-cream-200 px-1.5 py-0.5 font-mono text-[12px] text-ink-700">/{path}</code> không khớp với trang nào trong Ở Đây Nè.
          Có thể bạn copy thiếu, hoặc tin phòng đã bị đóng.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button onClick={goDiscover} className="btn-leaf btn-pill">
            <Icon.Compass size={14} /> Về trang quẹt
          </button>
          <button onClick={goSaved} className="btn-outline btn-pill">
            <Icon.HeartFilled size={14} /> Sổ Hợp gu
          </button>
          <button onClick={goAbout} className="btn-ghost btn-pill">
            <Icon.Shield size={14} /> Cách app hoạt động
          </button>
        </div>
      </div>
    </div>
  )
}
