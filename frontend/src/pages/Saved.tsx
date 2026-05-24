import { useEffect, useMemo, useState } from 'react'
import { apiRooms } from '../lib/api'
import { useAuth } from '../lib/auth'
import { goDiscover, goRoom } from '../lib/router'
import type { Room } from '../types'
import { AMENITY_EMOJI, AMENITY_LABEL, ROOM_TYPE_LABEL, formatVND } from '../lib/format'
import { GatedScreen } from '../components/GatedScreen'
import { Icon } from '../components/Icon'

type SortKey = 'recent' | 'price-asc' | 'price-desc' | 'area-desc' | 'district'

const SORT_LABEL: Record<SortKey, string> = {
  recent: 'Mới cập nhật',
  'price-asc': 'Giá thấp → cao',
  'price-desc': 'Giá cao → thấp',
  'area-desc': 'Rộng → hẹp',
  district: 'Theo quận',
}

export function SavedPage() {
  const auth = useAuth()
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => {
    if (!auth.user) return
    apiRooms.saved().then((r) => setRooms(r.rooms)).catch((err) => setError(err.message))
  }, [auth.user?.id])

  const filtered = useMemo(() => {
    if (!rooms) return null
    const q = query.trim().toLowerCase()
    const list = q
      ? rooms.filter((r) =>
          r.title.toLowerCase().includes(q) ||
          r.district.toLowerCase().includes(q) ||
          r.ward.toLowerCase().includes(q) ||
          r.addressHint.toLowerCase().includes(q),
        )
      : [...rooms]
    list.sort((a, b) => {
      switch (sort) {
        case 'price-asc': return a.priceVnd - b.priceVnd
        case 'price-desc': return b.priceVnd - a.priceVnd
        case 'area-desc': return b.areaM2 - a.areaM2
        case 'district': return a.district.localeCompare(b.district, 'vi') || b.updatedAt - a.updatedAt
        case 'recent':
        default:
          return b.updatedAt - a.updatedAt
      }
    })
    return list
  }, [rooms, query, sort])

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  async function removeOne(id: string) {
    try { await apiRooms.unsave(id) }
    catch { /* server already gone is fine */ }
    setRooms((prev) => prev?.filter((x) => x.id !== id) ?? null)
    setSelected((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev); next.delete(id); return next
    })
  }

  async function bulkRemove() {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    setBulkBusy(true)
    try {
      await Promise.allSettled(ids.map((id) => apiRooms.unsave(id)))
      setRooms((prev) => prev?.filter((x) => !selected.has(x.id)) ?? null)
      exitSelectMode()
    } finally { setBulkBusy(false) }
  }

  if (!auth.user) {
    return (
      <GatedScreen
        emoji="💚"
        title="Sổ tay Hợp gu của bạn"
        subtitle="Mọi phòng bạn quẹt phải sẽ ở đây — sẵn sàng để gọi chủ khi tới giờ."
        bullets={[
          { emoji: '📌', text: 'Giữ lại phòng ưng ý, không lo trôi mất giữa stack' },
          { emoji: '📞', text: 'Một chạm để mở số điện thoại, gọi hoặc nhắn Zalo chủ' },
          { emoji: '🔄', text: 'Đồng bộ trên cả điện thoại và máy tính khi đăng nhập' },
        ]}
        primaryLabel="Đăng nhập để mở Hợp gu"
        onPrimary={() => auth.openPopup('save')}
        secondaryLabel="← Tiếp tục quẹt phòng"
        onSecondary={goDiscover}
        previewTitle="Hợp gu sẽ trông như thế này"
        previewItems={[
          { emoji: '🏠', title: 'Studio gác lửng Quan Hoa', sub: 'Cầu Giấy · 4.5 triệu · Đã xác minh' },
          { emoji: '🪟', title: 'Phòng ban công Tây Hồ', sub: 'Tây Hồ · 3.8 triệu · WC riêng, không giờ giới nghiêm' },
          { emoji: '🛵', title: 'Mini apt Trung Liệt', sub: 'Đống Đa · 5.2 triệu · Có chỗ để xe & camera an ninh' },
          { emoji: '✨', title: '+ phòng bạn vừa quẹt phải', sub: 'Lưu vĩnh viễn sau khi đăng nhập — không trôi mất' },
        ]}
        footer={<>Chưa đăng nhập? Bạn vẫn quẹt được — chỉ cần đăng nhập khi muốn lưu lại.</>}
      />
    )
  }

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow inline-flex items-center gap-1.5"><Icon.HeartFilled size={11} className="text-coral-400" /> Sổ tay hợp gu</p>
          <h1 className="mt-1 line-clamp-2 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">Hợp gu của {auth.user.name}</h1>
          <p className="text-sm text-ink-500">
            {rooms?.length
              ? `${rooms.length} phòng đã lưu — liên hệ xem phòng trước khi quá muộn nhé.`
              : 'Bộ sưu tập các phòng bạn đã quẹt phải.'}
          </p>
        </div>
        <button onClick={goDiscover} className="btn-outline btn-pill shrink-0">
          <Icon.ArrowLeft size={14} /> Quẹt thêm
        </button>
      </header>

      {rooms && rooms.length > 0 && (
        <section className="mb-5 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <label className="relative block">
            <span className="sr-only">Tìm trong sổ tay</span>
            <Icon.Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo tên, quận, phường…"
              className="input pl-9"
            />
          </label>
          <label className="inline-flex items-center gap-2">
            <span className="hidden text-xs font-semibold uppercase tracking-wide text-ink-500 sm:inline">Sắp xếp</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="input min-w-[10rem]">
              {Object.entries(SORT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            className={`btn-pill shrink-0 ${selectMode ? 'btn-coral' : 'btn-outline'}`}
          >
            {selectMode ? <><Icon.Close size={14} /> Thoát chọn</> : <><Icon.Check size={14} /> Chọn nhiều</>}
          </button>
        </section>
      )}

      {selectMode && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-leaf-50 px-4 py-3 ring-1 ring-leaf-100">
          <p className="text-sm font-semibold text-leaf-700">
            Đã chọn {selected.size}/{filtered?.length || 0} phòng
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set(filtered?.map((r) => r.id) ?? []))}
              className="btn-ghost btn-pill"
              disabled={!filtered || filtered.length === 0}
            >Chọn tất cả</button>
            <button
              type="button"
              onClick={bulkRemove}
              disabled={selected.size === 0 || bulkBusy}
              className="btn-coral btn-pill"
            >
              <Icon.Trash size={14} /> {bulkBusy ? 'Đang xoá…' : `Bỏ khỏi hợp gu (${selected.size})`}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-coral-500">{error}</p>}
      {!rooms && !error && <p className="text-ink-500">Đang tải…</p>}
      {rooms && rooms.length === 0 && (
        <div className="card-soft text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-coral-50 text-coral-400 ring-1 ring-coral-100">
            <Icon.Heart size={24} />
          </div>
          <p className="mt-3 font-display text-xl font-semibold tracking-tight">Chưa có phòng nào hợp gu.</p>
          <p className="mt-1 text-sm text-ink-500">Quay lại trang quẹt và để cảm xúc dẫn lối.</p>
          <button onClick={goDiscover} className="btn-leaf btn-pill mt-4">
            <Icon.Compass size={14} /> Mở stack quẹt
          </button>
        </div>
      )}

      {rooms && rooms.length > 0 && filtered?.length === 0 && (
        <div className="card-soft text-center text-sm text-ink-500">
          Không tìm thấy phòng nào khớp với "{query}".
        </div>
      )}

      {filtered && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => {
            const isSelected = selected.has(r.id)
            return (
              <article
                key={r.id}
                className={`card-soft group flex flex-col overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-card ${
                  isSelected ? 'ring-2 ring-leaf-500' : ''
                }`}
              >
                <button
                  onClick={() => (selectMode ? toggleSelected(r.id) : goRoom(r.id))}
                  className="relative aspect-[5/3] cursor-pointer overflow-hidden bg-cream-300 text-left"
                  aria-pressed={selectMode ? isSelected : undefined}
                >
                  {r.images?.[0] && (
                    <img src={r.images[0]} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                  )}
                  <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
                    {r.verified && (
                      <span className="ribbon bg-white/95 text-leaf-700 ring-1 ring-leaf-200">
                        <Icon.Check size={11} /> Đã xác minh
                      </span>
                    )}
                    {r.featured && (
                      <span className="ribbon bg-coral-400 text-white">
                        <Icon.Sparkles size={11} /> Nổi bật
                      </span>
                    )}
                  </div>
                  {selectMode && (
                    <span
                      className={`absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full ring-2 ${
                        isSelected
                          ? 'bg-leaf-500 text-white ring-leaf-500'
                          : 'bg-white/90 text-ink-400 ring-white'
                      }`}
                    >
                      {isSelected ? <Icon.Check size={14} strokeWidth={2.5} /> : null}
                    </span>
                  )}
                </button>
                <div className="p-4 flex-1 flex flex-col">
                  <p className="line-clamp-2 font-display text-base font-semibold tracking-tight text-ink-900">{r.title}</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-500">
                    <Icon.MapPin size={11} className="text-ink-400" />
                    {r.district} · {ROOM_TYPE_LABEL[r.roomType]} · {r.areaM2} m²
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.amenities.slice(0, 4).map((a) => (
                      <span key={a} className="pill pill-cream text-[10px]">
                        <span aria-hidden>{AMENITY_EMOJI[a]}</span> {AMENITY_LABEL[a]}
                      </span>
                    ))}
                  </div>
                  <div className="mt-auto pt-3 flex items-end justify-between gap-2">
                    <div>
                      <p className="eyebrow text-[10px]">Giá</p>
                      <p className="font-display text-lg font-bold text-leaf-700">{formatVND(r.priceVnd)}/th</p>
                    </div>
                    {!selectMode && (
                      <div className="flex gap-2">
                        {r.contactPhone && (
                          <a
                            href={`tel:${r.contactPhone.replace(/\s+/g, '')}`}
                            onClick={(e) => e.stopPropagation()}
                            className="btn-ghost btn-pill"
                            aria-label={`Gọi ${r.contactPhone}`}
                            title="Gọi nhanh chủ phòng"
                          >
                            <Icon.Phone size={14} />
                          </a>
                        )}
                        <button
                          onClick={() => removeOne(r.id)}
                          className="btn-ghost btn-pill"
                          aria-label="Bỏ khỏi hợp gu"
                        >
                          <Icon.Trash size={14} />
                        </button>
                        <button onClick={() => goRoom(r.id)} className="btn-leaf btn-pill">
                          Xem <Icon.ArrowRight size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
