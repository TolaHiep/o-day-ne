import { useEffect, useRef, useState } from 'react'
import { apiRooms, apiUploads, UPLOAD_ACCEPT, UPLOAD_MAX_BYTES } from '../lib/api'
import { useAuth } from '../lib/auth'
import { goDiscover, goOwner, goRoom } from '../lib/router'
import { AMENITIES, DISTRICTS, ROOM_TYPE_LABEL } from '../lib/format'
import type { Room, RoomFees, RoomType } from '../types'
import { GatedScreen } from '../components/GatedScreen'
import { Icon } from '../components/Icon'

// Importer-sourced fees can arrive as strings like "4.000đ/số". The Post form
// only edits numeric VND amounts, so we strip non-digits before merging into
// the form state — otherwise TS rejects the wider RoomFees union and the
// number inputs would also reject the string at runtime. Drops keys whose
// string had no parseable digits (rather than silently coercing to 0).
function coerceFeesForForm(fees: RoomFees | undefined | null): Partial<Record<keyof RoomFees, number>> {
  const out: Partial<Record<keyof RoomFees, number>> = {}
  if (!fees) return out
  for (const k of ['electric', 'water', 'internet', 'service', 'parking'] as const) {
    const v = fees[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v
    } else if (typeof v === 'string') {
      const n = Number(v.replace(/[^\d]/g, ''))
      if (Number.isFinite(n) && n > 0) out[k] = n
    }
  }
  return out
}

const DEFAULT_FORM = {
  title: '',
  roomType: 'room' as RoomType,
  priceVnd: 3500000,
  depositVnd: 3500000,
  areaM2: 20,
  district: 'Đống Đa',
  ward: '',
  addressHint: '',
  description: '',
  amenities: [] as string[],
  fees: { electric: 3800, water: 25000, internet: 70000, service: 80000, parking: 100000 },
  rules: { maxPeople: 2, pets: false, vehicles: 'xe máy', minMonths: 6 },
  images: [] as string[],
  contactName: '',
  contactPhone: '',
  contactZalo: '',
  source: '',
}

export function PostPage({ editId }: { editId?: string }) {
  const auth = useAuth()
  const [form, setForm] = useState(DEFAULT_FORM)
  const [imgInput, setImgInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<Room | null>(null)
  const [uploads, setUploads] = useState<UploadProgress[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)

  // Count of currently-uploading rows — drives the "(2/12 đang tải…)" hint.
  const uploadingCount = uploads.filter((u) => u.status === 'uploading').length

  useEffect(() => {
    if (!auth.user || !editId) return
    apiRooms.get(editId).then((r) => {
      const x = r.room
      setForm({
        title: x.title, roomType: x.roomType, priceVnd: x.priceVnd, depositVnd: x.depositVnd,
        areaM2: x.areaM2, district: x.district, ward: x.ward, addressHint: x.addressHint,
        description: x.description, amenities: x.amenities,
        fees: { ...DEFAULT_FORM.fees, ...coerceFeesForForm(x.fees) },
        rules: { ...DEFAULT_FORM.rules, ...x.rules },
        images: x.images,
        contactName: x.contactName, contactPhone: x.contactPhone, contactZalo: x.contactZalo || '',
        source: x.source || '',
      })
    }).catch(() => { /* ignore */ })
  }, [editId, auth.user?.id])

  if (!auth.user) {
    return (
      <GatedScreen
        emoji="📝"
        title="Đăng phòng chỉ mất vài phút"
        subtitle="Người tìm phòng ở Hà Nội sẽ thấy tin của bạn ngay trong stack quẹt — phòng ưng là bấm liên hệ liền."
        bullets={[
          { emoji: '⚡', text: 'Tin hiện ngay sau khi đăng, không phải chờ duyệt' },
          { emoji: '🛡', text: 'Chủ trọ được gắn nhãn xác minh để tăng độ tin cậy' },
          { emoji: '📊', text: 'Theo dõi lượt xem, hợp gu và báo cáo tại Phòng của tôi' },
        ]}
        primaryLabel="Đăng nhập để đăng phòng"
        onPrimary={() => auth.openPopup('post')}
        secondaryLabel="← Xem app hoạt động ra sao"
        onSecondary={goDiscover}
        previewTitle="Quy trình đăng phòng"
        previewItems={[
          { emoji: '1️⃣', title: 'Thông tin chính', sub: 'Tiêu đề, loại phòng, diện tích, giá thuê — đủ để người tìm hiểu nhanh.' },
          { emoji: '2️⃣', title: 'Ảnh & tiện nghi', sub: 'Dán link ảnh, chọn tiện nghi nổi bật — phòng sẽ vào stack quẹt.' },
          { emoji: '3️⃣', title: 'Phí & quy định', sub: 'Điện, nước, internet, cọc, người tối đa — minh bạch ngay từ đầu.' },
          { emoji: '4️⃣', title: 'Liên hệ', sub: 'SĐT chỉ hiện khi người dùng bấm — bạn không bị spam.' },
        ]}
        footer={<>Phí: miễn phí trong giai đoạn xem trước. Bạn có thể đóng tin hoặc chỉnh sửa bất cứ lúc nào.</>}
      />
    )
  }

  function update<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }
  function toggleAmenity(k: string) {
    setForm((prev) => ({ ...prev, amenities: prev.amenities.includes(k) ? prev.amenities.filter((a) => a !== k) : [...prev.amenities, k] }))
  }
  function addImage() {
    const url = imgInput.trim()
    if (!url) return
    if (form.images.length >= 12) return
    setForm((prev) => ({ ...prev, images: [...prev.images, url] }))
    setImgInput('')
  }
  function removeImage(i: number) {
    setForm((prev) => ({ ...prev, images: prev.images.filter((_, idx) => idx !== i) }))
  }

  // Handle a FileList from either input (gallery or camera). Each file becomes
  // its own POST so failure is per-image and progress is visible. We cap the
  // batch at the remaining image slots to avoid uploading work that will be
  // rejected by the server validator.
  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    const slotsLeft = Math.max(0, 12 - form.images.length)
    if (slotsLeft === 0) {
      setError('Đã đủ 12 ảnh. Xoá bớt nếu muốn thêm.')
      return
    }
    const incoming = Array.from(list).slice(0, slotsLeft)
    setError(null)
    // Pre-register progress rows so the UI shows them in order.
    const baseId = Date.now()
    const rows: UploadProgress[] = incoming.map((f, i) => ({
      id: `${baseId}-${i}`,
      name: f.name,
      bytes: f.size,
      status: 'uploading',
    }))
    setUploads((prev) => [...prev, ...rows])

    await Promise.all(incoming.map(async (file, i) => {
      const rowId = rows[i].id
      try {
        const { url } = await apiUploads.image(file)
        setForm((prev) => prev.images.length >= 12 ? prev : ({ ...prev, images: [...prev.images, url] }))
        setUploads((prev) => prev.map((r) => r.id === rowId ? { ...r, status: 'done', url } : r))
        // Auto-clear successful rows after a moment so the panel doesn't grow.
        setTimeout(() => {
          setUploads((prev) => prev.filter((r) => r.id !== rowId))
        }, 1800)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload thất bại.'
        setUploads((prev) => prev.map((r) => r.id === rowId ? { ...r, status: 'error', error: msg } : r))
      }
    }))
  }

  function dismissUploadRow(id: string) {
    setUploads((prev) => prev.filter((r) => r.id !== id))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setSubmitting(true)
    try {
      const payload = {
        ...form,
        contactZalo: form.contactZalo.trim() || null,
        // Empty string → null so backend treats it as "clear the tag".
        source: form.source.trim() || null,
      }
      const r = editId
        ? await apiRooms.update(editId, payload)
        : await apiRooms.create(payload)
      setSuccess(r.room)
      // Refresh auth (role may have flipped to landlord on first post).
      await auth.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Đăng phòng thất bại.') }
    finally { setSubmitting(false) }
  }

  if (success) {
    return (
      <div className="card-soft text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-leaf-50 text-leaf-700 ring-1 ring-leaf-100">
          <Icon.Check size={28} strokeWidth={2.2} />
        </div>
        <p className="mt-3 font-display text-2xl font-semibold tracking-tight">{editId ? 'Đã cập nhật phòng!' : 'Đã đăng phòng!'}</p>
        <p className="mt-1 text-sm text-ink-500">Tin sẽ xuất hiện trong stack quẹt cho người tìm phòng ngay bây giờ.</p>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={() => goRoom(success.id)} className="btn-leaf btn-pill">
            <Icon.Eye size={14} /> Xem tin của bạn
          </button>
          <button onClick={goOwner} className="btn-outline btn-pill">
            <Icon.Home size={14} /> Về bảng điều khiển
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-5 md:grid-cols-[1fr_18rem] lg:grid-cols-[1fr_22rem]">
      <div className="min-w-0 space-y-4">
        <header>
          <p className="eyebrow inline-flex items-center gap-1.5"><Icon.Plus size={11} className="text-leaf-500" /> Đăng tin</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">{editId ? 'Sửa phòng' : 'Đăng phòng mới'}</h1>
          <p className="text-sm text-ink-500">Mô tả thật, ảnh thật, giá thật. Tin càng chân thực, càng nhanh ra hàng.</p>
        </header>

        <section className="card-soft">
          <p className="font-display text-lg font-semibold">Thông tin chính</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Tiêu đề" colSpan={2}>
              <input className="input" required maxLength={140} value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="VD: Studio gác lửng Quan Hoa — sát Cầu Giấy" />
            </Field>
            <Field label="Loại phòng">
              <select className="input" value={form.roomType} onChange={(e) => update('roomType', e.target.value as RoomType)}>
                {Object.keys(ROOM_TYPE_LABEL).map((k) => <option key={k} value={k}>{ROOM_TYPE_LABEL[k]}</option>)}
              </select>
            </Field>
            <Field label="Diện tích (m²)">
              <input type="number" min={6} max={500} className="input" required value={form.areaM2} onChange={(e) => update('areaM2', Number(e.target.value))} />
            </Field>
            <Field label="Giá thuê / tháng (VND)">
              <input type="number" min={300_000} max={200_000_000} className="input" required value={form.priceVnd} onChange={(e) => update('priceVnd', Number(e.target.value))} />
            </Field>
            <Field label="Cọc (VND)">
              <input type="number" min={0} max={500_000_000} className="input" value={form.depositVnd} onChange={(e) => update('depositVnd', Number(e.target.value))} />
            </Field>
            <Field label="Quận / Huyện">
              <select className="input" value={form.district} onChange={(e) => update('district', e.target.value)}>
                {DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Phường">
              <input className="input" required value={form.ward} onChange={(e) => update('ward', e.target.value)} placeholder="VD: Hàng Bài" />
            </Field>
            <Field label="Mô tả vị trí (không cần số nhà chính xác)" colSpan={2}>
              <input className="input" required value={form.addressHint} onChange={(e) => update('addressHint', e.target.value)} placeholder="VD: Ngõ 12 Văn Cao, gần Hồ Tây" />
            </Field>
            <Field label="Mô tả phòng" colSpan={2}>
              <textarea rows={5} className="input" required minLength={20} maxLength={4000}
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                placeholder="Hãy mô tả: tầng, hướng, nội thất, hàng xóm, an ninh, gần điểm gì tiện…"
              />
            </Field>
          </div>
        </section>

        <section className="card-soft">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-display text-lg font-semibold">Ảnh phòng</p>
            <p className="text-xs text-ink-500">
              {form.images.length}/12 ảnh
              {uploadingCount > 0 && <span className="text-leaf-700"> · đang tải {uploadingCount}…</span>}
              {' · '}tối đa {(UPLOAD_MAX_BYTES / 1024 / 1024).toFixed(0)} MB / ảnh
            </p>
          </div>
          <p className="mt-1 text-xs text-ink-500">JPG, PNG, WebP, GIF, AVIF. Ảnh HEIC từ iPhone cần đổi định dạng (Cài đặt → Camera → Định dạng → Tương thích nhất).</p>

          {/* Drag-and-drop dropzone wrapping the three input modes. Lets desktop
              users drag a whole folder of photos onto the card to upload at
              once. Phones don't use it but the buttons below still work. */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              if (form.images.length >= 12) return
              handleFiles(e.dataTransfer.files)
            }}
            className={`mt-3 rounded-2xl border-2 border-dashed p-3 transition ${
              dragOver
                ? 'border-leaf-500 bg-leaf-50'
                : 'border-cream-300 bg-cream-100/60'
            }`}
          >
            <div className="grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={form.images.length >= 12}
                className="btn-leaf btn-pill justify-center"
                title="Chọn 1 hoặc nhiều ảnh cùng lúc"
              >
                <Icon.Plus size={14} /> Chọn nhiều ảnh
              </button>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={form.images.length >= 12}
                className="btn-outline btn-pill justify-center"
              >
                <Icon.Camera size={14} /> Chụp ảnh mới
              </button>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="hoặc dán URL ảnh"
                  value={imgInput}
                  onChange={(e) => setImgInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addImage() } }}
                />
                <button
                  type="button"
                  onClick={addImage}
                  className="btn-ghost btn-pill shrink-0"
                  disabled={!imgInput.trim() || form.images.length >= 12}
                >Thêm</button>
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-ink-500">
              <span className="hidden sm:inline">Mẹo: giữ <kbd className="rounded bg-cream-200 px-1 py-0.5 font-mono text-[10px]">Ctrl/⌘</kbd> hoặc <kbd className="rounded bg-cream-200 px-1 py-0.5 font-mono text-[10px]">Shift</kbd> để chọn nhiều ảnh trong cửa sổ. Hoặc <strong>kéo-thả</strong> ảnh vào đây.</span>
              <span className="sm:hidden">Mẹo: chạm và giữ trong thư viện để chọn nhiều ảnh cùng lúc.</span>
            </p>
          </div>

          {/* Hidden inputs. `multiple` lets a single tap pick many photos at
              once; `capture="environment"` makes phones jump straight to the
              rear camera. Desktop browsers ignore `capture` — they show the
              file picker either way. */}
          <input
            ref={fileInputRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              handleFiles(e.target.files)
              // Reset so picking the same file twice re-fires onChange.
              e.target.value = ''
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            capture="environment"
            hidden
            onChange={(e) => {
              handleFiles(e.target.files)
              e.target.value = ''
            }}
          />

          {uploads.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {uploads.map((row) => (
                <li
                  key={row.id}
                  className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs ring-1 ${
                    row.status === 'error'
                      ? 'bg-coral-50 ring-coral-100 text-coral-500'
                      : row.status === 'done'
                        ? 'bg-leaf-50 ring-leaf-100 text-leaf-700'
                        : 'bg-cream-100 ring-cream-200 text-ink-700'
                  }`}
                >
                  <span aria-hidden>
                    {row.status === 'uploading' ? '⏳' : row.status === 'done' ? '✓' : '⚠'}
                  </span>
                  <span className="flex-1 truncate font-mono">{row.name}</span>
                  <span className="text-ink-500">{formatBytes(row.bytes)}</span>
                  {row.status === 'error' && (
                    <>
                      <span className="ml-1 truncate" title={row.error}>{row.error}</span>
                      <button
                        type="button"
                        onClick={() => dismissUploadRow(row.id)}
                        className="ml-1 rounded-full bg-white/70 px-1.5 py-0.5"
                      >×</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {form.images.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {form.images.map((url, i) => (
                <figure key={`${url}-${i}`} className="relative overflow-hidden rounded-2xl bg-cream-200 aspect-square">
                  <img
                    src={url}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      const t = e.currentTarget as HTMLImageElement
                      t.style.display = 'none'
                    }}
                  />
                  {i === 0 && (
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-leaf-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-soft">
                      Ảnh chính
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute right-1 top-1 rounded-full bg-coral-400 px-1.5 py-0.5 text-xs font-bold text-white"
                    aria-label="Xoá ảnh"
                  >✕</button>
                </figure>
              ))}
            </div>
          )}
        </section>

        <section className="card-soft">
          <p className="font-display text-lg font-semibold">Tiện nghi</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {AMENITIES.map((a) => {
              const on = form.amenities.includes(a.key)
              return (
                <button type="button" key={a.key} onClick={() => toggleAmenity(a.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${on ? 'bg-leaf-500 text-white ring-leaf-500' : 'bg-white ring-cream-300 text-ink-700'}`}>
                  {a.emoji} {a.label}
                </button>
              )
            })}
          </div>
        </section>

        <section className="card-soft">
          <p className="font-display text-lg font-semibold">Phí & quy định</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(['electric', 'water', 'internet', 'service', 'parking'] as const).map((k) => (
              <Field key={k} label={feeLabel(k)}>
                <input type="number" min={0} className="input"
                  value={form.fees[k] ?? 0}
                  onChange={(e) => update('fees', { ...form.fees, [k]: Number(e.target.value) })}
                />
              </Field>
            ))}
            <Field label="Tối đa (người)">
              <input type="number" min={1} max={20} className="input"
                value={form.rules.maxPeople ?? 2}
                onChange={(e) => update('rules', { ...form.rules, maxPeople: Number(e.target.value) })} />
            </Field>
            <Field label="Tối thiểu (tháng)">
              <input type="number" min={1} max={24} className="input"
                value={form.rules.minMonths ?? 6}
                onChange={(e) => update('rules', { ...form.rules, minMonths: Number(e.target.value) })} />
            </Field>
            <Field label="Phương tiện">
              <input className="input"
                value={form.rules.vehicles || ''}
                onChange={(e) => update('rules', { ...form.rules, vehicles: e.target.value })}
                placeholder="xe máy, ô tô…" />
            </Field>
            <Field label="Cho nuôi thú cưng">
              <label className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={!!form.rules.pets} onChange={(e) => update('rules', { ...form.rules, pets: e.target.checked })} />
                <span className="text-sm">Được phép nuôi (chó/mèo nhỏ)</span>
              </label>
            </Field>
          </div>
        </section>
      </div>

      <aside className="space-y-4 md:sticky md:top-20 md:self-start lg:top-24">
        <section className="card-soft">
          <p className="font-display text-lg font-semibold">Thông tin liên hệ</p>
          <div className="mt-3 grid gap-3">
            <Field label="Tên hiển thị">
              <input className="input" required value={form.contactName} onChange={(e) => update('contactName', e.target.value)} placeholder="VD: Chị Mai" />
            </Field>
            <Field label="Số điện thoại">
              <input className="input" required value={form.contactPhone} onChange={(e) => update('contactPhone', e.target.value)} placeholder="0903 451 220" />
            </Field>
            <Field label="Zalo (tuỳ chọn)">
              <input className="input" value={form.contactZalo} onChange={(e) => update('contactZalo', e.target.value)} placeholder="0903451220" />
            </Field>
            <Field label="Nguồn / CTV (chỉ bạn thấy)">
              <input
                className="input"
                maxLength={80}
                value={form.source}
                onChange={(e) => update('source', e.target.value)}
                placeholder="VD: CTV Hà, Nhà Nhóm"
              />
              <p className="mt-1 text-[11px] text-ink-500">
                Nhãn riêng để bạn nhớ phòng này thuộc CTV/nguồn nào khi khách hỏi. Người khác không nhìn thấy.
              </p>
            </Field>
          </div>
        </section>
        <section className="card-soft">
          <p className="text-sm text-ink-700">Sau khi đăng, tin xuất hiện trong stack quẹt cho mọi người. Bạn có thể chỉnh sửa hoặc đóng tin bất cứ lúc nào trong <em>Phòng của tôi</em>.</p>
          {error && <p className="mt-3 rounded-2xl bg-coral-50 px-3 py-2 text-sm text-coral-500">{error}</p>}
          <button type="submit" className="btn-leaf btn-lg mt-3 w-full" disabled={submitting}>
            {submitting ? 'Đang đăng…' : editId ? 'Cập nhật phòng' : 'Đăng phòng'}
          </button>
        </section>
      </aside>
    </form>
  )
}

function feeLabel(k: string) {
  return ({
    electric: 'Tiền điện (đ/kWh)',
    water: 'Tiền nước (đ/m³)',
    internet: 'Internet (đ/tháng)',
    service: 'Dịch vụ chung (đ/tháng)',
    parking: 'Gửi xe (đ/tháng)',
  } as Record<string, string>)[k] || k
}

function Field({ label, children, colSpan }: { label: string; children: React.ReactNode; colSpan?: number }) {
  return (
    <div className={colSpan === 2 ? 'sm:col-span-2' : ''}>
      <p className="label">{label}</p>
      {children}
    </div>
  )
}

type UploadProgress = {
  id: string
  name: string
  bytes: number
  status: 'uploading' | 'done' | 'error'
  url?: string
  error?: string
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}
