import { useEffect, useMemo, useState } from 'react'
import { apiLeads } from '../lib/api'
import { getOrCreateClientId } from '../lib/anonState'
import { useAuth } from '../lib/auth'
import { Icon } from './Icon'

// Two-mode modal shared by the two CTAs on the room detail page. We keep
// both flows in one component because they share 90% of the form (name +
// phone + a small "we'll call you back" outcome screen) and differ only in
// whether a preferred date/time is collected.

export type LeadModalMode = 'viewing' | 'consultation'

const NAME_RE = /^[\p{L}\p{M}0-9 .,'\-]{2,80}$/u
const PHONE_RE = /^[0-9 +().\-]{8,20}$/

const CONFIRM_MSG = 'Tư vấn viên của chúng tôi sẽ sớm liên hệ với bạn.'

export function LeadModal({
  mode,
  open,
  onClose,
  room,
  onSubmitted,
}: {
  mode: LeadModalMode
  open: boolean
  onClose: () => void
  room: { id: string; title: string }
  onSubmitted?: () => void
}) {
  const auth = useAuth()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [preferredAt, setPreferredAt] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(false)

  const clientId = useMemo(() => getOrCreateClientId(), [])

  // Lock body scroll while modal is up — mirrors LoginPopup behaviour.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Prefill on open: prefer the saved lead profile (DB), then fall back to
  // the user's auth profile, then leave it blank. The endpoint already
  // handles that selection on the server side.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null); setDone(false); setSubmitting(false)
    setLoadingProfile(true)
    apiLeads.profile(clientId)
      .then((r) => {
        if (cancelled) return
        if (r.profile) {
          setName(r.profile.name || auth.user?.name || '')
          setPhone(r.profile.phone || auth.user?.phone || '')
        } else if (auth.user) {
          setName(auth.user.name || '')
          setPhone(auth.user.phone || '')
        }
      })
      .catch(() => {
        if (cancelled) return
        if (auth.user) {
          setName(auth.user.name || '')
          setPhone(auth.user.phone || '')
        }
      })
      .finally(() => { if (!cancelled) setLoadingProfile(false) })
    return () => { cancelled = true }
  }, [open, clientId, auth.user])

  if (!open) return null

  const title = mode === 'viewing' ? 'Hẹn xem phòng' : 'Nhận tư vấn'
  const subtitle = mode === 'viewing'
    ? `Để lại số và thời gian mong muốn — tư vấn viên sẽ liên hệ và sắp xếp giúp bạn xem phòng "${room.title}".`
    : 'Để lại tên và số điện thoại, tư vấn viên sẽ liên hệ trong thời gian sớm nhất.'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    const trimmedName = name.trim()
    const trimmedPhone = phone.trim()
    if (!NAME_RE.test(trimmedName)) { setError('Tên không hợp lệ.'); return }
    if (!PHONE_RE.test(trimmedPhone)) { setError('Số điện thoại không hợp lệ.'); return }
    if (mode === 'viewing' && !preferredAt.trim()) {
      setError('Vui lòng chọn thời gian xem phòng.'); return
    }
    setError(null); setSubmitting(true)
    try {
      if (mode === 'viewing') {
        await apiLeads.createViewing({
          roomId: room.id,
          name: trimmedName,
          phone: trimmedPhone,
          preferredAt: preferredAt.trim(),
          note: note.trim() || undefined,
          clientId: auth.user ? undefined : clientId,
        })
      } else {
        await apiLeads.createConsultation({
          name: trimmedName,
          phone: trimmedPhone,
          roomId: room.id,
          note: note.trim() || undefined,
          clientId: auth.user ? undefined : clientId,
        })
      }
      setDone(true)
      onSubmitted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không gửi được. Thử lại sau.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/55 backdrop-blur-sm animate-fadeIn sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative flex max-h-[92svh] w-full flex-col overflow-hidden rounded-t-[28px] bg-cream-50 shadow-card ring-1 ring-ink-900/[0.06] animate-slideUp sm:max-h-[90vh] sm:w-[26rem] sm:rounded-[28px]">
        <button
          aria-label="Đóng"
          className="absolute right-4 top-4 z-10 grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-cream-200/80 text-ink-700 ring-1 ring-ink-900/[0.04] transition hover:bg-cream-300"
          onClick={onClose}
        >
          <Icon.Close size={16} />
        </button>

        <div className="overflow-y-auto pb-safe scrollbar-thin">
          <div className="px-6 pt-7 pb-2">
            <p className="eyebrow inline-flex items-center gap-1.5">
              {mode === 'viewing' ? <Icon.Eye size={11} className="text-leaf-500" /> : <Icon.Sparkles size={11} className="text-leaf-500" />}
              {mode === 'viewing' ? 'Đặt lịch' : 'Tư vấn'}
            </p>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-ink-500">{subtitle}</p>
          </div>

          <div className="px-6 pt-3 pb-7">
            {done ? (
              <div className="rounded-3xl bg-leaf-50 px-4 py-5 text-center ring-1 ring-leaf-100">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-leaf-500 text-white shadow-soft">
                  <Icon.Check size={22} />
                </div>
                <p className="mt-3 font-display text-base font-semibold text-leaf-700">{CONFIRM_MSG}</p>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-leaf btn-pill mt-4"
                >
                  Đóng
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="label" htmlFor="lead-name">Họ và tên</label>
                  <input
                    id="lead-name"
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    minLength={2}
                    maxLength={80}
                    placeholder="Ví dụ: Nguyễn Văn A"
                    disabled={submitting || loadingProfile}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="lead-phone">Số điện thoại</label>
                  <input
                    id="lead-phone"
                    className="input"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    placeholder="Ví dụ: 0901 234 567"
                    disabled={submitting || loadingProfile}
                  />
                </div>
                {mode === 'viewing' && (
                  <>
                    <div>
                      <label className="label" htmlFor="lead-when">Thời gian mong muốn</label>
                      <input
                        id="lead-when"
                        className="input"
                        type="datetime-local"
                        value={preferredAt}
                        onChange={(e) => setPreferredAt(e.target.value)}
                        required
                        disabled={submitting}
                      />
                      <p className="mt-1 text-[11px] text-ink-400">
                        Bạn có thể chọn thời gian gần đúng — tư vấn viên sẽ gọi xác nhận.
                      </p>
                    </div>
                    <div>
                      <label className="label" htmlFor="lead-note">Ghi chú (tuỳ chọn)</label>
                      <textarea
                        id="lead-note"
                        className="input"
                        rows={2}
                        maxLength={500}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Ví dụ: muốn xem kèm bạn cùng phòng"
                        disabled={submitting}
                      />
                    </div>
                  </>
                )}
                {mode === 'consultation' && (
                  <div>
                    <label className="label" htmlFor="lead-note">Bạn muốn tư vấn gì? (tuỳ chọn)</label>
                    <textarea
                      id="lead-note"
                      className="input"
                      rows={2}
                      maxLength={500}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Ví dụ: tìm phòng dưới 4 triệu, gần Cầu Giấy"
                      disabled={submitting}
                    />
                  </div>
                )}
                {error && (
                  <p className="rounded-2xl bg-coral-50 px-3 py-2 text-sm text-coral-500">{error}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="btn-ghost btn-pill flex-1"
                    disabled={submitting}
                  >
                    Huỷ
                  </button>
                  <button
                    type="submit"
                    className="btn-leaf btn-pill flex-1"
                    disabled={submitting || loadingProfile}
                  >
                    {submitting ? 'Đang gửi…' : (mode === 'viewing' ? 'Đặt lịch' : 'Gửi yêu cầu')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
