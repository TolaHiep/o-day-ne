import { useEffect, useRef, useState } from 'react'
import { apiFeedback, apiUploads, UPLOAD_ACCEPT, UPLOAD_MAX_BYTES } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Icon } from '../components/Icon'
import type { Feedback } from '../types'

const MAX_IMAGES = 6
const MAX_TITLE = 140
const MAX_CONTENT = 4000

export function FeedbackPage() {
  const auth = useAuth()
  const [items, setItems] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  async function refresh() {
    setLoading(true); setListError(null)
    try {
      const r = await apiFeedback.list()
      setItems(r.feedbacks)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Không tải được danh sách góp ý.')
    } finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  async function handleFiles(list: FileList | File[]) {
    const incoming = Array.from(list).slice(0, MAX_IMAGES - images.length)
    if (incoming.length === 0) {
      if (images.length >= MAX_IMAGES) setFormError(`Tối đa ${MAX_IMAGES} ảnh.`)
      return
    }
    setFormError(null)
    setUploading((n) => n + incoming.length)
    await Promise.all(incoming.map(async (file) => {
      try {
        const { url } = await apiUploads.image(file)
        setImages((prev) => prev.length >= MAX_IMAGES ? prev : [...prev, url])
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Tải ảnh thất bại.')
      } finally {
        setUploading((n) => Math.max(0, n - 1))
      }
    }))
  }

  // Paste handler — clipboard with image items (screenshot, copied photo) uploads
  // them as attachments instead of pasting binary into the textarea.
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files: File[] = []
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length === 0) return
    e.preventDefault()
    handleFiles(files)
  }

  function removeImage(i: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!auth.user) { auth.openPopup('feedback'); return }
    setFormError(null)
    const t = title.trim()
    const c = content.trim()
    if (!t) { setFormError('Tiêu đề không được trống.'); return }
    if (!c) { setFormError('Nội dung không được trống.'); return }
    if (uploading > 0) { setFormError('Đợi ảnh tải xong rồi gửi.'); return }
    setSubmitting(true)
    try {
      const r = await apiFeedback.create({ title: t, content: c, images })
      setItems((prev) => [r.feedback, ...prev])
      setTitle(''); setContent(''); setImages([])
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gửi góp ý thất bại.')
    } finally { setSubmitting(false) }
  }

  async function deleteOne(id: string) {
    if (!confirm('Xoá góp ý này? Không khôi phục được.')) return
    setDeletingId(id)
    try {
      await apiFeedback.remove(id)
      setItems((prev) => prev.filter((f) => f.id !== id))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Xoá thất bại.')
    } finally { setDeletingId(null) }
  }

  async function exportCsv() {
    setExporting(true)
    try {
      const { blob, filename } = await apiFeedback.exportCsv()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Tải CSV thất bại.')
    } finally { setExporting(false) }
  }

  const isAdmin = !!auth.user?.isAdmin
  const canSubmit = !!auth.user && !submitting && uploading === 0

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Intro — story + value props for seekers vs landlords/CTV. */}
      <section className="card-soft space-y-4">
        <div className="space-y-1.5">
          <p className="eyebrow inline-flex items-center gap-1.5"><Icon.Sparkles size={11} className="text-leaf-500" /> Giới thiệu Ở Đây Nè</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">Giới thiệu & góp ý</h1>
        </div>

        <p className="text-sm leading-relaxed text-ink-600">
          Tìm phòng trọ ở Hà Nội mệt vì bạn phải lướt rất nhiều bài đăng, nhắn tin
          cho hàng loạt chủ trọ và môi giới. Sau vài chục lượt như thế, ai cũng dễ
          nhầm phòng này với phòng kia — quên mất phòng nào giá bao nhiêu, ảnh nào
          là của phòng nào, ở khu vực nào, đã hỏi chưa hay đã ưng chưa. <strong>Ở Đây Nè</strong> sinh
          ra để mọi thứ gọn lại trong một chỗ.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-cream-100 p-3.5 ring-1 ring-ink-900/[0.04]">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-leaf-700">
              <Icon.Heart size={12} /> Cho người tìm phòng
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
              Lướt phòng gọn gàng, so sánh nhanh giá – ảnh – vị trí ngay tại chỗ,
              lưu lại những phòng ưng để theo dõi tiếp mà không bị rối hay nhầm
              phòng nào với phòng nào.
            </p>
          </div>
          <div className="rounded-2xl bg-cream-100 p-3.5 ring-1 ring-ink-900/[0.04]">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-leaf-700">
              <Icon.Home size={12} /> Cho chủ trọ & cộng tác viên
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
              Đăng phòng đơn giản, kèm trường <strong>nguồn</strong> riêng để ghi chú
              phòng do CTV/đối tác nào đem về.
            </p>
          </div>
        </div>

        <p className="text-xs text-ink-500">
          Đang ở giai đoạn preview — mọi góp ý phía dưới mình đọc hết và phản hồi 💚
        </p>
      </section>

      {/* Feedback form */}
      <section className="card-soft space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="eyebrow inline-flex items-center gap-1.5"><Icon.Send size={11} className="text-leaf-500" /> Góp ý & báo lỗi</p>
            <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink-900">Gửi nhận xét, đề xuất hoặc báo lỗi cho tụi mình</h2>
            <p className="mt-1 text-xs text-ink-500">Cứ thoải mái — khen, chê, kể trải nghiệm, hoặc dán ảnh chụp màn hình lỗi vào nội dung.</p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={exportCsv}
              disabled={exporting}
              className="btn-outline btn-pill shrink-0"
              title="Xuất toàn bộ góp ý ra CSV (Excel mở được)"
            >
              <Icon.Send size={14} className="rotate-90" />
              {exporting ? 'Đang xuất…' : 'Xuất Excel'}
            </button>
          )}
        </header>

        {!auth.user ? (
          <div className="rounded-2xl bg-cream-100 px-4 py-6 text-center ring-1 ring-ink-900/[0.04]">
            <p className="text-sm text-ink-600">Bạn cần đăng nhập trước khi gửi góp ý.</p>
            <button onClick={() => auth.openPopup('feedback')} className="btn-leaf btn-pill mt-3">
              Đăng nhập để góp ý
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label" htmlFor="fb-title">Tiêu đề</label>
              <input
                id="fb-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
                placeholder="VD: Nút lưu phòng khó thấy trên màn hình điện thoại"
                className="input"
                maxLength={MAX_TITLE}
              />
              <p className="mt-1 text-[11px] text-ink-400">{title.length}/{MAX_TITLE}</p>
            </div>
            <div>
              <label className="label" htmlFor="fb-content">Nội dung</label>
              <textarea
                id="fb-content"
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value.slice(0, MAX_CONTENT))}
                onPaste={onPaste}
                placeholder="Bạn thấy gì? Dán ảnh (Ctrl+V) hoặc bấm 'Đính kèm ảnh' bên dưới."
                className="input min-h-[140px] resize-y"
                maxLength={MAX_CONTENT}
              />
              <p className="mt-1 text-[11px] text-ink-400">{content.length}/{MAX_CONTENT} · Mẹo: dán ảnh trực tiếp từ clipboard (Ctrl+V).</p>
            </div>

            {/* Image attachments */}
            {(images.length > 0 || uploading > 0) && (
              <div>
                <p className="label mb-1">Ảnh đính kèm ({images.length}/{MAX_IMAGES})</p>
                <div className="flex flex-wrap gap-2">
                  {images.map((url, i) => (
                    <div key={i} className="group relative h-20 w-20 overflow-hidden rounded-xl ring-1 ring-ink-900/[0.06]">
                      <img src={url} alt={`Ảnh ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute right-1 top-1 grid h-6 w-6 cursor-pointer place-items-center rounded-full bg-ink-900/70 text-white opacity-0 transition group-hover:opacity-100"
                        aria-label={`Xoá ảnh ${i + 1}`}
                      >
                        <Icon.Close size={12} />
                      </button>
                    </div>
                  ))}
                  {uploading > 0 && (
                    <div className="grid h-20 w-20 place-items-center rounded-xl bg-cream-100 text-[11px] text-ink-500 ring-1 ring-ink-900/[0.06]">
                      Đang tải… ({uploading})
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept={UPLOAD_ACCEPT}
                multiple
                hidden
                onChange={(e) => { handleFiles(e.target.files || []); if (fileRef.current) fileRef.current.value = '' }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={images.length >= MAX_IMAGES}
                className="btn-outline btn-pill"
              >
                <Icon.Camera size={14} />
                Đính kèm ảnh
              </button>
              <span className="text-[11px] text-ink-400">
                Tối đa {MAX_IMAGES} ảnh · {(UPLOAD_MAX_BYTES / 1024 / 1024).toFixed(0)} MB / ảnh
              </span>
              <button
                type="submit"
                disabled={!canSubmit}
                className="btn-leaf btn-pill ml-auto"
              >
                <Icon.Send size={14} />
                {submitting ? 'Đang gửi…' : 'Gửi góp ý'}
              </button>
            </div>

            {formError && (
              <p className="flex items-start gap-2 rounded-xl bg-coral-50 px-3 py-2 text-sm text-coral-500 ring-1 ring-coral-100">
                <Icon.AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{formError}</span>
              </p>
            )}
          </form>
        )}
      </section>

      {/* Feed */}
      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold tracking-tight text-ink-900">
            Góp ý gần đây {!loading && <span className="text-ink-400">({items.length})</span>}
          </h2>
        </header>

        {loading && (
          <p className="text-sm text-ink-500">Đang tải…</p>
        )}
        {listError && (
          <p className="rounded-xl bg-coral-50 px-3 py-2 text-sm text-coral-500 ring-1 ring-coral-100">{listError}</p>
        )}
        {!loading && !listError && items.length === 0 && (
          <p className="card-soft text-sm text-ink-500">Chưa có góp ý nào — bạn là người đầu tiên 🌱</p>
        )}

        <div className="space-y-3">
          {items.map((f) => (
            <article key={f.id} className="card-soft space-y-3">
              <header className="flex items-start gap-3">
                <Avatar name={f.author?.name || '?'} avatar={f.author?.avatar || null} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="font-semibold text-ink-900">{f.author?.name || 'Ẩn danh'}</span>
                    {f.author?.isAdmin && (
                      <span className="rounded-full bg-leaf-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-leaf-700 ring-1 ring-leaf-100">Admin</span>
                    )}
                  </p>
                  <p className="text-[11px] text-ink-400">{formatTime(f.createdAt)}</p>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => deleteOne(f.id)}
                    disabled={deletingId === f.id}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-cream-200/80 px-2.5 py-1 text-xs font-semibold text-ink-700 ring-1 ring-ink-900/[0.04] transition hover:bg-coral-50 hover:text-coral-500"
                    title="Xoá góp ý này"
                  >
                    <Icon.Trash size={12} />
                    {deletingId === f.id ? 'Đang xoá…' : 'Xoá'}
                  </button>
                )}
              </header>
              <h3 className="font-display text-lg font-semibold leading-tight text-ink-900">{f.title}</h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{f.content}</p>
              {f.images.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {f.images.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block aspect-[4/3] overflow-hidden rounded-xl ring-1 ring-ink-900/[0.06] transition hover:ring-leaf-400/40"
                    >
                      <img src={url} alt={`Ảnh đính kèm ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function Avatar({ name, avatar }: { name: string; avatar: string | null }) {
  if (avatar) return <img src={avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-ink-900/[0.06]" />
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-leaf-500 font-display text-[14px] font-bold text-white">
      {(name || '?').charAt(0).toUpperCase()}
    </span>
  )
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const diff = Date.now() - ts
  if (diff < 60_000) return 'vừa xong'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} phút trước`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} giờ trước`
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} ngày trước`
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
