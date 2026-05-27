import { useEffect, useState } from 'react'
import { apiRooms, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { goDiscover } from '../lib/router'
import type { ContributedPhoto, Review, Room } from '../types'
import {
  AMENITIES, REPORT_REASONS,
  ROOM_TYPE_LABEL, formatFee, formatVND, formatVNDExact, relativeTime,
} from '../lib/format'
import { Icon } from '../components/Icon'
import { LeadModal, type LeadModalMode } from '../components/LeadModal'

export function RoomDetailPage({ roomId }: { roomId: string }) {
  const auth = useAuth()
  const [room, setRoom] = useState<Room | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [photos, setPhotos] = useState<ContributedPhoto[]>([])
  const [myAction, setMyAction] = useState<'like' | 'pass' | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [galleryIdx, setGalleryIdx] = useState(0)
  const [showReportForm, setShowReportForm] = useState(false)
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [showPhotoForm, setShowPhotoForm] = useState(false)
  const [contactRevealed, setContactRevealed] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [leadMode, setLeadMode] = useState<LeadModalMode | null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const r = await apiRooms.get(roomId)
      setRoom(r.room); setReviews(r.reviews); setPhotos(r.contributedPhotos); setMyAction(r.myAction)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được phòng.')
    } finally { setLoading(false) }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [roomId])

  if (loading) {
    return <div className="card-soft animate-pulse">Đang tải chi tiết phòng…</div>
  }
  if (error || !room) {
    return (
      <div className="card-soft">
        <p className="text-coral-500">{error || 'Phòng không tồn tại.'}</p>
        <button onClick={goDiscover} className="btn-leaf btn-pill mt-3">Về trang quẹt</button>
      </div>
    )
  }

  const ownerGallery = room.images
  const approvedPhotos = photos.filter((p) => p.status === 'approved')
  const pendingPhotos = photos.filter((p) => p.status === 'pending')

  async function doLike() {
    if (!auth.user) return auth.openPopup('save')
    try {
      await apiRooms.swipe(room!.id, 'like')
      setMyAction('like')
      setActionMsg('Đã lưu vào Hợp gu của bạn.')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) auth.openPopup('save')
    }
  }
  async function doUnsave() {
    if (!auth.user) return
    await apiRooms.unsave(room!.id)
    setMyAction(null)
    setActionMsg('Đã bỏ khỏi danh sách Hợp gu.')
  }

  const phoneTel = room.contactPhone.replace(/[^0-9+]/g, '')
  const isSaved = myAction === 'like'

  return (
    <div className="grid gap-5 pb-36 md:grid-cols-[minmax(0,1fr)_18rem] md:gap-5 md:pb-0 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6">
      <article className="min-w-0">
        <button onClick={goDiscover} className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-ink-500 transition hover:text-leaf-700">
          <Icon.ArrowLeft size={14} /> Quay lại stack quẹt
        </button>

        <div className="relative mt-2 aspect-[4/3] overflow-hidden rounded-2xl bg-ink-900 sm:aspect-[16/9] sm:rounded-3xl">
          {ownerGallery[galleryIdx] ? (
            <img
              src={ownerGallery[galleryIdx]}
              alt={`${room.title} — ảnh ${galleryIdx + 1}`}
              className="h-full w-full object-cover"
            />
          ) : <div className="h-full w-full bg-gradient-to-br from-cream-300 via-leaf-200 to-coral-200" />}

          {ownerGallery.length > 1 && (
            <>
              <button
                onClick={() => setGalleryIdx((i) => Math.max(0, i - 1))}
                className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/90 text-ink-900 shadow-card ring-1 ring-ink-900/10 transition hover:bg-white"
                aria-label="Ảnh trước"
              >
                <Icon.ChevronLeft size={18} />
              </button>
              <button
                onClick={() => setGalleryIdx((i) => Math.min(ownerGallery.length - 1, i + 1))}
                className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/90 text-ink-900 shadow-card ring-1 ring-ink-900/10 transition hover:bg-white"
                aria-label="Ảnh sau"
              >
                <Icon.ChevronRight size={18} />
              </button>
              <div className="absolute bottom-3 left-3 rounded-full bg-ink-900/70 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                {galleryIdx + 1} / {ownerGallery.length}
              </div>
            </>
          )}

          <div className="absolute top-3 left-3 right-3 flex flex-wrap gap-1.5">
            {room.verified && (
              <span className="ribbon bg-white/95 text-leaf-700 ring-1 ring-leaf-200">
                <Icon.Check size={11} /> Đã xác minh
              </span>
            )}
            {room.featured && (
              <span className="ribbon bg-coral-400 text-white">
                <Icon.Sparkles size={11} /> Nổi bật
              </span>
            )}
            {room.reports >= 3 && (
              <span className="ribbon bg-coral-50 text-coral-500 ring-1 ring-coral-100">
                <Icon.AlertTriangle size={11} /> {room.reports} báo cáo
              </span>
            )}
          </div>
        </div>

        {ownerGallery.length > 1 && (
          <div className="mt-2 flex gap-2 overflow-x-auto snap-x-row scrollbar-thin pb-2">
            {ownerGallery.map((url, i) => (
              <button
                key={url + i}
                onClick={() => setGalleryIdx(i)}
                className={`h-16 w-24 shrink-0 overflow-hidden rounded-xl ring-2 transition ${i === galleryIdx ? 'ring-leaf-500' : 'ring-transparent hover:ring-leaf-300'}`}
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <header className="mt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-[2rem]">{room.title}</h1>
              <p className="mt-1 inline-flex flex-wrap items-center gap-x-1.5 text-sm text-ink-500">
                <Icon.MapPin size={13} className="text-leaf-500" />
                {ROOM_TYPE_LABEL[room.roomType]} · {room.areaM2} m² · {room.district} – {room.ward}
                <span className="text-ink-400">· {room.addressHint}</span>
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="font-display text-2xl font-bold text-leaf-700 sm:text-[1.75rem]">{formatVNDExact(room.priceVnd)}<span className="text-sm font-medium text-ink-500"> / tháng</span></p>
              <p className="text-xs text-ink-500">Cọc: {formatVNDExact(room.depositVnd)}</p>
            </div>
          </div>
        </header>

        {/* Mobile-only quick actions: keeps Save + Contact reveal near the top
            so the user doesn't have to scroll through the whole article first. */}
        <section className="mt-4 rounded-3xl bg-white/85 p-4 shadow-soft ring-1 ring-ink-900/[0.04] md:hidden">
          {actionMsg && (
            <div className="mb-3 flex items-start gap-2 rounded-2xl bg-leaf-50 px-3 py-2 text-sm text-leaf-700 ring-1 ring-leaf-200">
              <Icon.Check size={14} className="mt-0.5 shrink-0" /> {actionMsg}
            </div>
          )}
          <p className="text-sm font-semibold text-ink-900">Liên hệ xem phòng</p>
          <p className="mt-0.5 text-xs text-ink-500">{room.contactName}{room.verified ? ' · đã xác minh' : ''}</p>
          {contactRevealed ? (
            <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2">
              <p className="truncate font-mono text-base font-semibold text-leaf-700">{room.contactPhone}</p>
              <a href={`tel:${phoneTel}`} className="btn-leaf btn-pill shrink-0">
                <Icon.Phone size={14} /> Gọi
              </a>
            </div>
          ) : (
            <button onClick={() => setContactRevealed(true)} className="btn-leaf btn-lg mt-2 w-full">
              <Icon.Phone size={16} /> Hiện số điện thoại
            </button>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => setLeadMode('viewing')} className="btn-leaf btn-pill">
              <Icon.Eye size={14} /> Hẹn xem phòng
            </button>
            <button onClick={() => setLeadMode('consultation')} className="btn-outline btn-pill">
              <Icon.Sparkles size={14} /> Nhận tư vấn
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {isSaved ? (
              <button onClick={doUnsave} className="btn-ghost btn-pill">
                <Icon.Trash size={14} /> Bỏ lưu
              </button>
            ) : (
              <button onClick={doLike} className="btn-outline btn-pill">
                <Icon.Heart size={14} /> Lưu hợp gu
              </button>
            )}
            <button
              onClick={() => auth.user ? setShowReportForm((v) => !v) : auth.openPopup('report')}
              className="btn-outline btn-pill"
            >
              <Icon.Flag size={14} /> Báo cáo
            </button>
          </div>
          {showReportForm && (
            <ReportForm
              roomId={room.id}
              onCancel={() => setShowReportForm(false)}
              onSubmitted={() => { setShowReportForm(false); setActionMsg('Cảm ơn báo cáo! Admin sẽ xem xét.') }}
            />
          )}
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Lượt xem" value={String(room.views)} />
          <Stat label="Lượt hợp gu" value={String(room.likes)} />
          <Stat label="Đánh giá" value={room.rating?.avg ? `${room.rating.avg} ★ (${room.rating.count})` : 'Chưa có'} />
          <Stat label="Cập nhật" value={relativeTime(room.updatedAt)} />
        </section>

        <section className="card-soft mt-5">
          <h2 className="font-display text-lg font-semibold">Mô tả</h2>
          <p className="mt-2 whitespace-pre-line text-ink-700">{room.description}</p>
        </section>

        <section className="card-soft mt-5">
          <h2 className="font-display text-lg font-semibold">Tiện nghi & an toàn</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {AMENITIES.filter((a) => room.amenities.includes(a.key)).map((a) => (
              <div key={a.key} className="flex items-center gap-2 rounded-2xl bg-leaf-50 px-3 py-2 text-sm text-leaf-700">
                <span aria-hidden>{a.emoji}</span>
                <span>{a.label}</span>
              </div>
            ))}
            {AMENITIES.filter((a) => room.amenities.includes(a.key)).length === 0 && (
              <p className="text-sm text-ink-500 sm:col-span-2">Chủ phòng chưa khai báo tiện nghi nào.</p>
            )}
          </div>
        </section>

        <section className="card-soft mt-5">
          <h2 className="font-display text-lg font-semibold">Phí & quy định</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <FeeRow label="Điện" value={formatFee(room.fees.electric, { unit: ' / kWh' })} />
            <FeeRow label="Nước" value={formatFee(room.fees.water, { unit: ' / m³' })} />
            <FeeRow label="Internet" value={formatFee(room.fees.internet, { unit: ' / tháng', missing: 'Bao gồm' })} />
            <FeeRow label="Dịch vụ chung" value={formatFee(room.fees.service, { unit: ' / tháng', missing: 'Không có' })} />
            <FeeRow label="Gửi xe" value={formatFee(room.fees.parking, { unit: ' / tháng', missing: 'Miễn phí' })} />
            {/* Rule rows are gated: rules imported from external listings are
                often empty objects, so we only render concrete values. Pet
                status is conveyed by the `pet_ok` amenity chip — we don't
                duplicate it here unless a future model carries a real pet fee
                or a specific pet rule. */}
            {room.rules.maxPeople ? (
              <FeeRow label="Số người tối đa" value={`${room.rules.maxPeople} người`} />
            ) : null}
            {room.rules.minMonths ? (
              <FeeRow label="Hợp đồng tối thiểu" value={`${room.rules.minMonths} tháng`} />
            ) : null}
            {room.rules.vehicles?.trim() ? (
              <FeeRow label="Phương tiện" value={room.rules.vehicles.trim()} />
            ) : null}
          </div>
        </section>

        <section className="card-soft mt-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold tracking-tight">Ảnh thực tế từ người đi xem</h2>
            <button
              onClick={() => auth.user ? setShowPhotoForm((v) => !v) : auth.openPopup('contribute')}
              className="btn-outline btn-pill shrink-0"
            >
              <Icon.Camera size={14} /> Đóng góp
            </button>
          </div>
          <p className="text-xs text-ink-500 mt-1">Ảnh đóng góp được duyệt trước khi hiển thị công khai. Bạn sẽ thấy ảnh chờ duyệt của mình ở đây.</p>
          {showPhotoForm && (
            <ContributePhotoForm
              onCancel={() => setShowPhotoForm(false)}
              onSubmitted={(p) => {
                setPhotos((prev) => [p, ...prev])
                setShowPhotoForm(false)
                setActionMsg('Cảm ơn bạn! Ảnh đang chờ admin duyệt.')
              }}
              roomId={room.id}
            />
          )}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {approvedPhotos.length === 0 && pendingPhotos.length === 0 && (
              <p className="col-span-full text-sm text-ink-500">Chưa có ảnh thực tế. Bạn có thể là người đầu tiên đóng góp.</p>
            )}
            {[...approvedPhotos, ...pendingPhotos].map((p) => (
              <figure key={p.id} className="relative overflow-hidden rounded-2xl bg-cream-200 aspect-[4/3]">
                <img src={p.url} alt={p.caption || ''} className="h-full w-full object-cover" />
                {p.status === 'pending' && (
                  <figcaption className="absolute bottom-1 left-1 right-1 rounded-md bg-coral-300 px-2 py-0.5 text-[10px] font-semibold uppercase text-white text-center">
                    Chờ duyệt
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </section>

        <section className="card-soft mt-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold tracking-tight">Đánh giá ({reviews.length})</h2>
            <button
              onClick={() => auth.user ? setShowReviewForm((v) => !v) : auth.openPopup('review')}
              className="btn-outline btn-pill shrink-0"
            >
              <Icon.Edit size={14} /> Viết đánh giá
            </button>
          </div>
          {showReviewForm && (
            <ReviewForm
              roomId={room.id}
              onCancel={() => setShowReviewForm(false)}
              onSubmitted={(r) => {
                setReviews((prev) => [r, ...prev])
                setShowReviewForm(false)
                setActionMsg('Đã gửi đánh giá.')
              }}
            />
          )}
          <div className="mt-3 space-y-3">
            {reviews.length === 0 && (
              <p className="text-sm text-ink-500">Chưa có đánh giá nào. Bạn đã từng đến xem? Để lại nhận xét giúp cộng đồng.</p>
            )}
            {reviews.map((r) => (
              <article key={r.id} className="rounded-2xl bg-cream-100 px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink-900">{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}</p>
                  <p className="text-xs text-ink-500">{relativeTime(r.createdAt)}</p>
                </div>
                <p className="mt-1 text-sm text-ink-700 whitespace-pre-line">{r.text}</p>
              </article>
            ))}
          </div>
        </section>
      </article>

      <aside className="space-y-4 md:sticky md:top-20 md:self-start lg:top-24">
        {actionMsg && (
          <div className="hidden rounded-2xl bg-leaf-50 px-3 py-2 text-sm text-leaf-700 ring-1 ring-leaf-200 lg:block">{actionMsg}</div>
        )}
        {/* Contact + actions live in the mobile quick-CTA block above on phones,
            so the desktop versions only appear from lg: up to avoid duplication. */}
        <div className="card-soft hidden md:block">
          <p className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
            <Icon.Phone size={18} className="text-leaf-500" /> Liên hệ xem phòng
          </p>
          <p className="mt-2 text-sm text-ink-700">{room.contactName}</p>
          {contactRevealed ? (
            <div className="mt-2 space-y-1">
              <p className="font-mono text-lg font-semibold text-leaf-700">{room.contactPhone}</p>
              {room.contactZalo && <p className="text-sm text-ink-500">Zalo: <span className="font-mono">{room.contactZalo}</span></p>}
              <a href={`tel:${phoneTel}`} className="btn-leaf btn-pill mt-3 w-full">
                <Icon.Phone size={14} /> Gọi ngay
              </a>
            </div>
          ) : (
            <button onClick={() => setContactRevealed(true)} className="btn-leaf btn-pill mt-3 w-full">
              <Icon.Phone size={14} /> Hiện số điện thoại
            </button>
          )}
          <div className="mt-3 grid gap-2">
            <button onClick={() => setLeadMode('viewing')} className="btn-leaf btn-pill">
              <Icon.Eye size={14} /> Hẹn xem phòng
            </button>
            <button onClick={() => setLeadMode('consultation')} className="btn-outline btn-pill">
              <Icon.Sparkles size={14} /> Nhận tư vấn
            </button>
          </div>
          <p className="mt-2 text-[11px] text-ink-500">Nhắn “Em xem phòng từ Ở Đây Nè” để được nhanh hơn.</p>
        </div>

        <div className="card-soft hidden md:block">
          <p className="font-display text-lg font-semibold tracking-tight">Hành động</p>
          <div className="mt-3 grid gap-2">
            {isSaved ? (
              <button onClick={doUnsave} className="btn-ghost btn-lg">
                <Icon.Trash size={16} /> Bỏ khỏi Hợp gu
              </button>
            ) : (
              <button onClick={doLike} className="btn-leaf btn-lg">
                <Icon.Heart size={16} /> Lưu vào Hợp gu
              </button>
            )}
            <button
              onClick={() => auth.user ? setShowReportForm((v) => !v) : auth.openPopup('report')}
              className="btn-outline btn-pill"
            >
              <Icon.Flag size={14} /> Báo cáo tin có vấn đề
            </button>
          </div>
          {showReportForm && (
            <ReportForm
              roomId={room.id}
              onCancel={() => setShowReportForm(false)}
              onSubmitted={() => { setShowReportForm(false); setActionMsg('Cảm ơn báo cáo! Admin sẽ xem xét.') }}
            />
          )}
        </div>

        <div className="card-soft">
          <p className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
            <Icon.MapPin size={18} className="shrink-0 text-leaf-500" />
            <span className="min-w-0">Vị trí</span>
          </p>
          <p className="mt-1 text-sm text-ink-700">{room.addressHint}</p>
          <p className="text-xs text-ink-500">
            {[room.ward, room.district, 'Hà Nội'].filter(Boolean).join(', ')}
          </p>
          <a
            href={buildGoogleMapsUrl({
              lat: room.lat,
              lng: room.lng,
              addressHint: room.addressHint,
              ward: room.ward,
              district: room.district,
            })}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline btn-pill mt-3 w-full"
          >
            <Icon.MapPin size={14} /> Xem trên Google Maps
          </a>
          <MiniMap lat={room.lat} lng={room.lng} />
        </div>

        <div className="card-soft">
          <p className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
            <Icon.Shield size={18} className="text-leaf-500" /> An toàn khi đi xem
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm text-ink-700 space-y-1">
            <li>Xem phòng ban ngày, đi cùng người thân/bạn.</li>
            <li>Yêu cầu xem hợp đồng mẫu, sổ điện nước, ảnh CCCD chủ trọ.</li>
            <li>Không chuyển khoản cọc khi chưa ký hợp đồng giấy.</li>
            <li>Báo cáo phòng có dấu hiệu lừa đảo để cộng đồng cùng tránh.</li>
          </ul>
        </div>
      </aside>

      {/* Sticky mobile CTA — sits above the global bottom tab nav. */}
      <div
        className="fixed left-0 z-30 border-t border-ink-900/[0.06] bg-cream-50/95 px-3 py-2 shadow-card backdrop-blur-xl md:hidden"
        style={{ bottom: 'calc(60px + env(safe-area-inset-bottom, 0px))', width: '100dvw' }}
      >
        <div className="mx-auto flex max-w-7xl items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="eyebrow text-[10px]">Giá / tháng</p>
            <p className="truncate font-display text-base font-bold text-leaf-700">{formatVND(room.priceVnd)}</p>
          </div>
          {isSaved ? (
            <button
              onClick={doUnsave}
              aria-label="Bỏ lưu"
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-cream-200 text-ink-700 ring-1 ring-ink-900/10"
            >
              <Icon.Trash size={18} />
            </button>
          ) : (
            <button
              onClick={doLike}
              aria-label="Lưu vào Hợp gu"
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-coral-50 text-coral-400 ring-1 ring-coral-200"
            >
              <Icon.Heart size={18} />
            </button>
          )}
          {contactRevealed ? (
            <a href={`tel:${phoneTel}`} className="btn-leaf btn-pill shrink-0">
              <Icon.Phone size={14} /> Gọi ngay
            </a>
          ) : (
            <button onClick={() => setContactRevealed(true)} className="btn-leaf btn-pill shrink-0">
              <Icon.Phone size={14} /> Hiện SĐT
            </button>
          )}
        </div>
      </div>

      <LeadModal
        mode={leadMode || 'viewing'}
        open={leadMode !== null}
        onClose={() => setLeadMode(null)}
        room={{ id: room.id, title: room.title }}
        onSubmitted={() => { setActionMsg('Tư vấn viên của chúng tôi sẽ sớm liên hệ với bạn.') }}
      />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <p className="eyebrow text-[10px]">{label}</p>
      <p className="text-sm font-semibold text-ink-900">{value}</p>
    </div>
  )
}
function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl bg-cream-100/80 px-3 py-2 text-sm ring-1 ring-cream-200">
      <span className="text-ink-500">{label}</span>
      <span className="font-semibold text-ink-900">{value}</span>
    </div>
  )
}

function buildGoogleMapsUrl(opts: {
  lat?: number | null
  lng?: number | null
  addressHint?: string
  ward?: string
  district?: string
}): string {
  const hasCoords = typeof opts.lat === 'number' && typeof opts.lng === 'number'
  const query = hasCoords
    ? `${opts.lat},${opts.lng}`
    : [opts.addressHint, opts.ward, opts.district, 'Hà Nội']
        .map((s) => (s || '').trim())
        .filter(Boolean)
        .join(', ')
  const params = new URLSearchParams({ api: '1', query })
  return `https://www.google.com/maps/search/?${params.toString()}`
}

function MiniMap({ lat, lng }: { lat?: number | null; lng?: number | null }) {
  if (!lat || !lng) {
    return <p className="mt-2 text-xs text-ink-400">Toạ độ chính xác sẽ được cung cấp khi liên hệ.</p>
  }
  // Static "compass" indicator — we don't pull a paid map provider, but we
  // show coordinates and an OSM open link for the curious.
  const link = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
  return (
    <div className="mt-3 rounded-2xl bg-leaf-50 p-3 text-sm ring-1 ring-leaf-100">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-leaf-500 text-white shadow-soft">
          <Icon.MapPin size={22} />
        </div>
        <div className="leading-tight">
          <p className="font-semibold text-leaf-700">Khu vực: {lat.toFixed(4)}, {lng.toFixed(4)}</p>
          <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-leaf-700 underline underline-offset-2 hover:text-leaf-600">
            Mở trên OpenStreetMap <Icon.ArrowRight size={11} />
          </a>
        </div>
      </div>
    </div>
  )
}

function ReviewForm({ roomId, onCancel, onSubmitted }: { roomId: string; onCancel: () => void; onSubmitted: (r: Review) => void }) {
  const [stars, setStars] = useState(5)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true); setError(null)
    try {
      const r = await apiRooms.review(roomId, stars, text.trim())
      onSubmitted(r.review)
    } catch (err) { setError(err instanceof Error ? err.message : 'Không gửi được.') }
    finally { setSubmitting(false) }
  }
  return (
    <form onSubmit={submit} className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-cream-300">
      <p className="label">Số sao</p>
      <div className="flex gap-1 text-2xl">
        {[1, 2, 3, 4, 5].map((s) => (
          <button type="button" key={s} onClick={() => setStars(s)} className={s <= stars ? 'text-coral-300' : 'text-cream-300'} aria-label={`${s} sao`}>★</button>
        ))}
      </div>
      <label className="label mt-3">Nhận xét</label>
      <textarea
        value={text} onChange={(e) => setText(e.target.value)}
        rows={3} required minLength={5} maxLength={800}
        placeholder="Bạn đã đến xem? Chia sẻ trải nghiệm thật giúp cộng đồng."
        className="input"
      />
      {error && <p className="mt-2 text-sm text-coral-500">{error}</p>}
      <div className="mt-2 flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="btn-ghost btn-pill">Huỷ</button>
        <button type="submit" className="btn-leaf btn-pill" disabled={submitting}>{submitting ? 'Đang gửi…' : 'Gửi đánh giá'}</button>
      </div>
    </form>
  )
}

function ReportForm({ roomId, onCancel, onSubmitted }: { roomId: string; onCancel: () => void; onSubmitted: () => void }) {
  const [reason, setReason] = useState('fake_listing')
  const [detail, setDetail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true); setError(null)
    try { await apiRooms.report(roomId, reason, detail.trim() || undefined); onSubmitted() }
    catch (err) { setError(err instanceof Error ? err.message : 'Không gửi được.') }
    finally { setSubmitting(false) }
  }
  return (
    <form onSubmit={submit} className="mt-3 rounded-2xl bg-coral-50/60 p-3 ring-1 ring-coral-100">
      <label className="label">Lý do</label>
      <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
        {REPORT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      <label className="label mt-3">Chi tiết (tuỳ chọn)</label>
      <textarea
        rows={3} maxLength={480}
        value={detail} onChange={(e) => setDetail(e.target.value)}
        placeholder="Ví dụ: gọi 5 số máy đều bận, địa chỉ không tồn tại…"
        className="input"
      />
      {error && <p className="mt-2 text-sm text-coral-500">{error}</p>}
      <div className="mt-2 flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="btn-ghost btn-pill">Huỷ</button>
        <button type="submit" className="btn-coral btn-pill" disabled={submitting}>{submitting ? 'Đang gửi…' : 'Gửi báo cáo'}</button>
      </div>
    </form>
  )
}

function ContributePhotoForm({ roomId, onCancel, onSubmitted }: { roomId: string; onCancel: () => void; onSubmitted: (p: ContributedPhoto) => void }) {
  const [url, setUrl] = useState('')
  const [caption, setCaption] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true); setError(null)
    try {
      const r = await apiRooms.contributePhoto(roomId, url.trim(), caption.trim() || undefined)
      onSubmitted(r.photo)
    } catch (err) { setError(err instanceof Error ? err.message : 'Không gửi được.') }
    finally { setSubmitting(false) }
  }
  return (
    <form onSubmit={submit} className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-cream-300">
      <label className="label">URL ảnh (link http/https)</label>
      <input className="input" required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
      <label className="label mt-3">Chú thích (tuỳ chọn)</label>
      <input className="input" maxLength={240} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Ví dụ: Ban công thực tế, chụp lúc 5h chiều" />
      {error && <p className="mt-2 text-sm text-coral-500">{error}</p>}
      <div className="mt-2 flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="btn-ghost btn-pill">Huỷ</button>
        <button type="submit" className="btn-leaf btn-pill" disabled={submitting}>{submitting ? 'Đang gửi…' : 'Gửi ảnh'}</button>
      </div>
    </form>
  )
}
