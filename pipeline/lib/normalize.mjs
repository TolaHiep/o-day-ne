// Vietnamese rental-text parser heuristics.
//
// Everything here is intentionally regex-based and forgiving — landlords on
// Zalo and Facebook write in a casual, abbreviation-heavy style ("3tr5",
// "3500k", "25m2 có đh, wc khép kín"). We don't try to be perfect; we try
// to extract enough signal to route a record through a human reviewer.
//
// Each extractor returns { value, confidence } and the caller decides how to
// combine them into a final candidate confidence score.

const HANOI_DISTRICTS = [
  'Ba Đình', 'Hoàn Kiếm', 'Tây Hồ', 'Long Biên', 'Cầu Giấy',
  'Đống Đa', 'Hai Bà Trưng', 'Hoàng Mai', 'Thanh Xuân',
  'Nam Từ Liêm', 'Bắc Từ Liêm', 'Hà Đông', 'Sơn Tây',
  'Ba Vì', 'Phúc Thọ', 'Đan Phượng', 'Hoài Đức', 'Mê Linh',
  'Thanh Trì', 'Gia Lâm', 'Đông Anh', 'Thường Tín', 'Sóc Sơn',
  'Thạch Thất', 'Quốc Oai', 'Chương Mỹ', 'Phú Xuyên',
  'Ứng Hòa', 'Mỹ Đức',
]

// amenities vocab is the same set the backend rooms table accepts.
// (Kept here as a literal to keep pipeline standalone — see
// backend/src/storage.mjs VALID_AMENITY_KEYS for the source of truth.)
const AMENITY_VOCAB = {
  ac: [/điều\s*hoà|điều\s*hòa|máy\s*lạnh|\bđh\b|\bac\b|aircon/i],
  private_wc: [/wc\s*riêng|vệ sinh riêng|khép\s*kín|toilet\s*riêng/i],
  balcony: [/ban\s*công|logia/i],
  elevator: [/thang\s*máy/i],
  washer: [/máy\s*giặt/i],
  dryer: [/máy\s*sấy/i],
  kitchen: [/bếp\s*(riêng|chung|nấu)|có\s*bếp/i],
  parking: [/(chỗ|nơi|hầm)\s*để\s*xe|gửi\s*xe|gara|garage|parking/i],
  fire_safety: [/pccc|phòng\s*cháy/i],
  security_cam: [/camera|cctv|an\s*ninh\s*24/i],
  pet_ok: [/nuôi\s*(thú|chó|mèo|pet)|pet\s*friendly|pet\s*ok/i],
  no_owner: [/chủ\s*không\s*(ở|sống)|không\s*ở\s*cùng\s*chủ/i],
  curfew_free: [/tự\s*do\s*giờ\s*giấc|không\s*giờ\s*giấc|không\s*giới\s*nghiêm/i],
  window: [/cửa\s*sổ|thoáng\s*sáng|view\b/i],
  furnished: [/full\s*nội\s*thất|nội\s*thất\s*đầy\s*đủ|có\s*nội\s*thất/i],
}

// ---------- price ----------
// Accepts: "3.5 triệu", "3,5tr", "3tr5", "3500k", "3500K/tháng", "giá 4tr"
// Rejects ambiguous bare numbers like "25" (could be m²) — only counts if a
// unit hint is nearby.
export function extractPriceVnd(text) {
  if (!text) return { value: null, confidence: 0 }
  const t = text.replace(/\s+/g, ' ')

  // "3tr5" / "3tr500" — Vietnamese shorthand where "tr" sits inside the number.
  const tr5 = t.match(/(\d{1,2})\s*tr\s*(\d{1,3})\b/i)
  if (tr5) {
    const head = Number(tr5[1])
    const tail = tr5[2]
    // "3tr5" → 3,500,000; "3tr500" → 3,500,000; "3tr50" → 3,050,000
    let fraction
    if (tail.length === 1) fraction = Number(tail) / 10
    else if (tail.length === 2) fraction = Number(tail) / 100
    else fraction = Number(tail) / 1000
    return { value: Math.round((head + fraction) * 1_000_000), confidence: 0.95 }
  }

  // "3.5 triệu" / "3,5tr" / "4 triệu"
  const tr = t.match(/(\d+(?:[.,]\d+)?)\s*(?:triệu|tr)\b/i)
  if (tr) {
    const n = Number(tr[1].replace(',', '.'))
    if (Number.isFinite(n) && n > 0 && n < 200) {
      return { value: Math.round(n * 1_000_000), confidence: 0.9 }
    }
  }

  // "3500k" / "3500 k/tháng" → thousand VND
  const k = t.match(/(\d{3,5})\s*k\b/i)
  if (k) {
    const n = Number(k[1])
    if (n >= 500 && n <= 99000) {
      return { value: n * 1_000, confidence: 0.8 }
    }
  }

  // "5.000.000đ" / "5,000,000 vnd" — explicit VND amounts
  const vnd = t.match(/(\d{1,3}(?:[.,]\d{3}){1,3})\s*(?:đ|đồng|vnd)\b/i)
  if (vnd) {
    const digits = vnd[1].replace(/[.,]/g, '')
    const n = Number(digits)
    if (n >= 500_000 && n <= 100_000_000) {
      return { value: n, confidence: 0.85 }
    }
  }

  return { value: null, confidence: 0 }
}

// ---------- area ----------
export function extractAreaM2(text) {
  if (!text) return { value: null, confidence: 0 }
  // "25m2", "25 m²", "diện tích 25m2"
  // Note: no trailing \b — "m²" ends with a non-word char so \b would fail.
  const m = text.match(/(\d{1,3})\s*(?:m\s*2|m²|m vuông|mét\s*vuông)/i)
  if (!m) return { value: null, confidence: 0 }
  const n = Number(m[1])
  if (n >= 6 && n <= 500) return { value: n, confidence: 0.9 }
  return { value: null, confidence: 0 }
}

// ---------- phone ----------
// Vietnamese mobile: 10 digits starting with 0, often broken by spaces, dots,
// dashes. Also accept +84 prefix.
export function extractPhone(text) {
  if (!text) return { value: null, confidence: 0 }
  const candidates = []
  const re = /(?:\+?84|0)[\s.\-]?(\d[\s.\-]?){8,9}\d/g
  for (const m of text.matchAll(re)) {
    const digits = m[0].replace(/\D/g, '')
    // Normalize +84... → 0...
    const local = digits.startsWith('84') && digits.length === 11
      ? '0' + digits.slice(2)
      : digits
    if (local.length === 10 && local.startsWith('0')) candidates.push(local)
  }
  if (candidates.length === 0) return { value: null, confidence: 0 }
  // Use first match — usually contact phone is the first phone in the post.
  return { value: candidates[0], confidence: 0.95 }
}

// ---------- district ----------
// Vietnamese diacritics matter. Match longest district name first so
// "Bắc Từ Liêm" doesn't get swallowed by "Từ Liêm" partial logic.
export function extractDistrict(text) {
  if (!text) return { value: null, confidence: 0 }
  const sorted = [...HANOI_DISTRICTS].sort((a, b) => b.length - a.length)
  for (const d of sorted) {
    if (text.toLowerCase().includes(d.toLowerCase())) {
      return { value: d, confidence: 0.85 }
    }
  }
  // "quận X" or "Q.X" — rough fallback (we don't try to map numeric → name
  // because Hà Nội districts are mostly named, not numbered).
  return { value: null, confidence: 0 }
}

// ---------- address hint ----------
// Pulls the first line that looks address-like (ngõ/ngách/phố/đường + name).
export function extractAddress(text) {
  if (!text) return { value: null, confidence: 0 }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const cue = /\b(?:ngõ|ngách|hẻm|phố|đường|số|khu|tòa|toà|khu đô thị|kđt)\b/i
  for (const line of lines) {
    if (cue.test(line) && line.length <= 200) return { value: line, confidence: 0.6 }
  }
  return { value: null, confidence: 0 }
}

// ---------- title ----------
// First non-empty line, capped at 120 chars.
export function extractTitle(text) {
  if (!text) return { value: null, confidence: 0 }
  const first = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
  if (!first) return { value: null, confidence: 0 }
  const title = first.length > 120 ? first.slice(0, 117) + '…' : first
  return { value: title, confidence: 0.5 }
}

// ---------- images / Drive URLs ----------
// Accepts:
//   https://drive.google.com/file/d/{ID}/view
//   https://drive.google.com/open?id={ID}
//   https://drive.google.com/uc?id={ID}
// and rewrites to a stable direct-view form: uc?export=view&id={ID}.
// Also catches generic http(s) image URLs (.jpg/.jpeg/.png/.webp).
export function extractImages(text) {
  if (!text) return { value: [], confidence: 0 }
  const out = new Set()

  for (const m of text.matchAll(/https?:\/\/drive\.google\.com\/[^\s)\]]+/gi)) {
    const url = m[0]
    const id =
      (url.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/) || [])[1] ||
      (url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/) || [])[1]
    if (id) out.add(`https://drive.google.com/uc?export=view&id=${id}`)
    else out.add(url)
  }

  for (const m of text.matchAll(/https?:\/\/[^\s)\]]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s)\]]*)?/gi)) {
    out.add(m[0])
  }

  return { value: [...out], confidence: out.size > 0 ? 0.7 : 0 }
}

// ---------- amenities ----------
export function extractAmenities(text) {
  if (!text) return { value: [], confidence: 0 }
  const hits = []
  for (const [key, patterns] of Object.entries(AMENITY_VOCAB)) {
    if (patterns.some((p) => p.test(text))) hits.push(key)
  }
  return { value: hits, confidence: hits.length ? 0.6 : 0 }
}

// ---------- combiner ----------
// Pull every signal from a single raw text blob into a partial candidate.
// Caller is expected to merge the result onto `emptyCandidate()`.
export function parseListingText(text) {
  const price = extractPriceVnd(text)
  const area = extractAreaM2(text)
  const phone = extractPhone(text)
  const district = extractDistrict(text)
  const address = extractAddress(text)
  const title = extractTitle(text)
  const images = extractImages(text)
  const amenities = extractAmenities(text)

  const signals = [price, area, phone, district, address, title, images, amenities]
  const totalConfidence = signals.reduce((a, s) => a + s.confidence, 0) / signals.length

  const notes = []
  if (!price.value) notes.push('no-price')
  if (!phone.value) notes.push('no-phone')
  if (!district.value) notes.push('no-district')
  if (!area.value) notes.push('no-area')

  return {
    title: title.value,
    priceVnd: price.value,
    areaM2: area.value,
    district: district.value,
    address: address.value,
    phone: phone.value,
    images: images.value,
    amenities: amenities.value,
    confidence: Number(totalConfidence.toFixed(3)),
    notes,
  }
}

export { HANOI_DISTRICTS, AMENITY_VOCAB }
