import { useEffect, useState, type ReactNode } from 'react'
import type { RoomFilters, RoomType } from '../types'
import { AMENITIES, DISTRICTS, ROOM_TYPE_LABEL, formatVND } from '../lib/format'
import { Icon } from './Icon'

const ROOM_TYPES: { value: RoomType; label: string }[] = [
  { value: 'studio', label: ROOM_TYPE_LABEL.studio },
  { value: 'room', label: ROOM_TYPE_LABEL.room },
  { value: 'mini_apt', label: ROOM_TYPE_LABEL.mini_apt },
  { value: 'dorm', label: ROOM_TYPE_LABEL.dorm },
  { value: 'shared', label: ROOM_TYPE_LABEL.shared },
]

const PRICE_BUCKETS = [
  { label: 'Dưới 3tr', max: 3_000_000 },
  { label: '3 – 5tr', min: 3_000_000, max: 5_000_000 },
  { label: '5 – 8tr', min: 5_000_000, max: 8_000_000 },
  { label: 'Trên 8tr', min: 8_000_000 },
]

export function FiltersPanel({ value, onChange, compact, onClose }: {
  value: RoomFilters
  onChange: (v: RoomFilters) => void
  compact?: boolean
  onClose?: () => void
}) {
  const [local, setLocal] = useState<RoomFilters>(value)
  useEffect(() => setLocal(value), [value])

  function update(patch: Partial<RoomFilters>) {
    const next = { ...local, ...patch }
    setLocal(next)
    onChange(next)
  }

  function toggleAmenity(key: string) {
    const a = new Set(local.amenities || [])
    if (a.has(key)) a.delete(key); else a.add(key)
    update({ amenities: [...a] })
  }

  function toggleDistrict(name: string) {
    const d = new Set(local.districts || [])
    if (d.has(name)) d.delete(name); else d.add(name)
    update({ districts: d.size ? [...d] : undefined })
  }

  function setPriceBucket(b: typeof PRICE_BUCKETS[number]) {
    if (local.priceMin === b.min && local.priceMax === b.max) {
      update({ priceMin: undefined, priceMax: undefined })
    } else {
      update({ priceMin: b.min, priceMax: b.max })
    }
  }

  function reset() {
    update({
      districts: undefined, roomType: undefined, priceMin: undefined, priceMax: undefined,
      areaMin: undefined, amenities: [], sort: 'match', text: '',
    })
  }

  const amenityCount = local.amenities?.length || 0
  const districtCount = local.districts?.length || 0
  const sortLabel = SORT_LABEL[local.sort || 'match']

  return (
    <aside className={`card-soft ${compact ? '' : 'sticky top-24'}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-ink-900">
            <Icon.Sliders size={18} className="text-leaf-500" />
            Lọc theo gu
          </p>
          <p className="text-xs text-ink-500">Áp dụng tức thì lên stack quẹt.</p>
        </div>
        {onClose && (
          <button
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-cream-200/80 text-ink-700 ring-1 ring-ink-900/[0.04] transition hover:bg-cream-300"
            onClick={onClose}
            aria-label="Đóng bộ lọc"
          >
            <Icon.Close size={16} />
          </button>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="label">Tìm kiếm</p>
          <div className="relative">
            <Icon.Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="input pl-10"
              placeholder="Tên phòng, phường, đường…"
              value={local.text || ''}
              onChange={(e) => update({ text: e.target.value || undefined })}
            />
          </div>
        </div>

        <Section title="Khu vực" defaultOpen badge={districtBadge(local.districts)}>
          <div className="flex flex-wrap gap-1.5">
            <Chip active={districtCount === 0} onClick={() => update({ districts: undefined })}>Tất cả</Chip>
            {DISTRICTS.map((d) => (
              <Chip
                key={d}
                active={(local.districts || []).includes(d)}
                onClick={() => toggleDistrict(d)}
              >
                {d}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="Giá / tháng" defaultOpen badge={priceBadge(local)}>
          <div className="flex flex-wrap gap-1.5">
            {PRICE_BUCKETS.map((b) => {
              const active = local.priceMin === b.min && local.priceMax === b.max
              return <Chip key={b.label} active={active} onClick={() => setPriceBucket(b)}>{b.label}</Chip>
            })}
            <Chip active={!local.priceMin && !local.priceMax} onClick={() => update({ priceMin: undefined, priceMax: undefined })}>
              Tất cả
            </Chip>
          </div>
          {(local.priceMin || local.priceMax) && (
            <p className="mt-1.5 text-[11px] text-ink-500">
              {local.priceMin ? `Từ ${formatVND(local.priceMin)}` : 'Không giới hạn dưới'}
              {' – '}
              {local.priceMax ? `Tới ${formatVND(local.priceMax)}` : 'Không giới hạn trên'}
            </p>
          )}
        </Section>

        <Section title="Loại phòng" defaultOpen badge={local.roomType ? ROOM_TYPE_LABEL[local.roomType] : undefined}>
          <div className="flex flex-wrap gap-1.5">
            <Chip active={!local.roomType} onClick={() => update({ roomType: undefined })}>Tất cả</Chip>
            {ROOM_TYPES.map((t) => (
              <Chip key={t.value} active={local.roomType === t.value} onClick={() => update({ roomType: t.value })}>
                {t.label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="Diện tích tối thiểu" badge={local.areaMin ? `≥ ${local.areaMin} m²` : undefined}>
          <div className="flex flex-wrap gap-1.5">
            {[12, 18, 24, 30, 40].map((a) => (
              <Chip key={a} active={local.areaMin === a} onClick={() => update({ areaMin: local.areaMin === a ? undefined : a })}>
                ≥ {a} m²
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="Tiện nghi" badge={amenityCount > 0 ? `${amenityCount} chọn` : undefined}>
          <div className="flex flex-wrap gap-1.5">
            {AMENITIES.map((a) => {
              const active = (local.amenities || []).includes(a.key)
              return (
                <Chip key={a.key} active={active} onClick={() => toggleAmenity(a.key)}>
                  <span aria-hidden>{a.emoji}</span> {a.label}
                </Chip>
              )
            })}
          </div>
        </Section>

        <Section title="Sắp xếp" badge={sortLabel}>
          <select
            className="input"
            value={local.sort || 'match'}
            onChange={(e) => update({ sort: e.target.value as RoomFilters['sort'] })}
          >
            <option value="match">Hợp gu nhất</option>
            <option value="newest">Mới nhất</option>
            <option value="price-asc">Giá thấp → cao</option>
            <option value="price-desc">Giá cao → thấp</option>
            <option value="area">Diện tích lớn nhất</option>
          </select>
        </Section>

        <button onClick={reset} className="btn-ghost btn-pill mt-2 w-full">Đặt lại bộ lọc</button>
      </div>
    </aside>
  )
}

const SORT_LABEL: Record<string, string> = {
  match: 'Hợp gu nhất',
  newest: 'Mới nhất',
  'price-asc': 'Giá ↑',
  'price-desc': 'Giá ↓',
  area: 'Diện tích lớn',
}

function districtBadge(districts?: string[]): string | undefined {
  if (!districts || districts.length === 0) return undefined
  if (districts.length === 1) return districts[0]
  return `${districts.length} quận`
}

function priceBadge(f: RoomFilters): string | undefined {
  if (!f.priceMin && !f.priceMax) return undefined
  if (f.priceMin && f.priceMax) return `${formatVND(f.priceMin)}–${formatVND(f.priceMax)}`
  if (f.priceMin) return `≥ ${formatVND(f.priceMin)}`
  if (f.priceMax) return `≤ ${formatVND(f.priceMax)}`
  return undefined
}

// Native <details> accordion — keyboard accessible, no extra state needed.
// Header shows a chevron rotated when open, and a badge summarizing the
// current selection so users see what's filtered even when collapsed.
function Section({ title, badge, defaultOpen, children }: {
  title: string
  badge?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details
      className="group rounded-2xl bg-cream-100/60 ring-1 ring-cream-200/80 open:bg-white open:ring-cream-300"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold text-ink-800 transition hover:bg-cream-100/90 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          {title}
          {badge && (
            <span className="rounded-full bg-leaf-50 px-2 py-0.5 text-[10px] font-semibold text-leaf-700 ring-1 ring-leaf-100">
              {badge}
            </span>
          )}
        </span>
        <Icon.ChevronRight size={16} className="text-ink-400 transition-transform group-open:rotate-90" />
      </summary>
      <div className="px-3 pb-3 pt-1">{children}</div>
    </details>
  )
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition duration-200
        ${active
          ? 'bg-leaf-500 text-white ring-leaf-500 shadow-soft'
          : 'bg-white ring-cream-300 text-ink-700 hover:ring-leaf-400/60 hover:text-ink-900'}`}
    >
      {children}
    </button>
  )
}
