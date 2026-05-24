export function formatVND(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1_000_000) {
    const tr = n / 1_000_000
    const fixed = tr % 1 === 0 ? tr.toFixed(0) : tr.toFixed(1)
    return `${fixed} triệu`
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return `${n}đ`
}

export function formatVNDExact(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('vi-VN').format(n) + ' đ'
}

// Fees from the importer arrive as either a plain VND number (e.g. 3800) or a
// pre-formatted string the source already wrote (e.g. "4.000đ/số",
// "120.000đ/người"). Strings already include their unit so we render them
// verbatim; numbers get the VND formatter + the caller's unit suffix. Falsy /
// blank values fall back to the caller-supplied placeholder so we can vary
// "—" vs "Bao gồm" vs "Miễn phí" per field.
export function formatFee(
  value: number | string | null | undefined,
  opts: { unit?: string; missing?: string } = {},
): string {
  const missing = opts.missing ?? '—'
  if (value === null || value === undefined) return missing
  if (typeof value === 'string') {
    const s = value.trim()
    return s || missing
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return missing
    return opts.unit ? `${formatVNDExact(value)}${opts.unit}` : formatVNDExact(value)
  }
  return missing
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'vừa xong'
  if (min < 60) return `${min} phút trước`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} giờ trước`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} ngày trước`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} tháng trước`
  return `${Math.floor(mo / 12)} năm trước`
}

export const ROOM_TYPE_LABEL: Record<string, string> = {
  studio: 'Studio',
  room: 'Phòng trọ',
  mini_apt: 'Căn hộ mini',
  dorm: 'Dorm',
  shared: 'Ở ghép',
}

export const ROOM_TYPE_EMOJI: Record<string, string> = {
  studio: '🛋',
  room: '🏠',
  mini_apt: '🏢',
  dorm: '🛏',
  shared: '👯',
}

export const DISTRICTS = [
  'Hoàn Kiếm', 'Ba Đình', 'Đống Đa', 'Hai Bà Trưng',
  'Cầu Giấy', 'Tây Hồ', 'Thanh Xuân', 'Hoàng Mai',
  'Long Biên', 'Hà Đông', 'Nam Từ Liêm', 'Bắc Từ Liêm',
] as const

export const AMENITIES: { key: string; label: string; emoji: string; group: 'comfort' | 'safety' | 'rules' }[] = [
  { key: 'ac', label: 'Điều hoà', emoji: '❄️', group: 'comfort' },
  { key: 'private_wc', label: 'WC riêng', emoji: '🚿', group: 'comfort' },
  { key: 'balcony', label: 'Ban công', emoji: '🪟', group: 'comfort' },
  { key: 'window', label: 'Cửa sổ', emoji: '☀️', group: 'comfort' },
  { key: 'elevator', label: 'Thang máy', emoji: '🛗', group: 'comfort' },
  { key: 'kitchen', label: 'Bếp riêng', emoji: '🍳', group: 'comfort' },
  { key: 'washer', label: 'Máy giặt', emoji: '🌀', group: 'comfort' },
  { key: 'dryer', label: 'Máy sấy', emoji: '♨️', group: 'comfort' },
  { key: 'furnished', label: 'Đủ nội thất', emoji: '🛋', group: 'comfort' },
  { key: 'parking', label: 'Chỗ để xe', emoji: '🛵', group: 'comfort' },
  { key: 'fire_safety', label: 'PCCC đạt chuẩn', emoji: '🧯', group: 'safety' },
  { key: 'security_cam', label: 'Camera an ninh', emoji: '📹', group: 'safety' },
  { key: 'no_owner', label: 'Chủ không ở cùng', emoji: '🚪', group: 'rules' },
  { key: 'curfew_free', label: 'Không giờ giới nghiêm', emoji: '🌙', group: 'rules' },
  { key: 'pet_ok', label: 'Cho nuôi thú cưng', emoji: '🐶', group: 'rules' },
]

export const AMENITY_LABEL: Record<string, string> = Object.fromEntries(
  AMENITIES.map((a) => [a.key, a.label]),
)
export const AMENITY_EMOJI: Record<string, string> = Object.fromEntries(
  AMENITIES.map((a) => [a.key, a.emoji]),
)

export const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'fake_listing', label: 'Tin ảo, phòng không có thật' },
  { value: 'wrong_price', label: 'Giá không đúng như đăng' },
  { value: 'wrong_address', label: 'Địa chỉ không khớp' },
  { value: 'spam', label: 'Spam, quảng cáo khác' },
  { value: 'rude_owner', label: 'Chủ trọ không nghiêm túc' },
  { value: 'other', label: 'Lý do khác' },
]
