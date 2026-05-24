// Map a single live-sheet row to a room candidate suitable for upserting
// into backend/data/db.sqlite.
//
// Conventions for missing fields (per import task spec):
//   - text fields the schema requires but the sheet leaves blank → 'liên hệ'
//   - area_m2 if not parseable → 20 (conservative default; flagged in notes)
//   - district inferred from address keywords when confident, else 'liên hệ'
//   - room_type inferred from "P\d+" / "gác|studio" / "ở ghép|dorm"
//   - amenities: "Thang máy" → ['elevator']; "Thang bộ" or unknown → []
//   - Images: when the sync script has resolved the "Ảnh phòng" Drive folder
//     into thumbnail URLs (record.__resolvedImages), use those — the frontend
//     renders room.images as <img src>. Folder URLs alone are kept only as a
//     last-resort fallback with a note so reviewers can spot unresolved rows.
//
// Source key for dedup: gsheet:<spreadsheetId>:<gid>:<rowNumber>. Stable
// across runs as long as the sheet writer doesn't reshuffle rows, which is
// the same trade-off the existing sheet-drive connector accepts.

import { extractPriceVnd, extractAreaM2 } from './normalize.mjs'

const TEXT_PLACEHOLDER = 'liên hệ'
const DEFAULT_AREA_M2 = 20

// Public contact for imported sheet rooms — the owner publishes a single
// hotline + Zalo across every listing, not a per-row contact column.
const SHEET_CONTACT_NAME = 'Anh Hiệp'
const SHEET_CONTACT_PHONE = '0978618337'
const SHEET_CONTACT_ZALO = '0978618337'

// User-visible "nguồn" tag stamped on every imported sheet row so the owner
// can tell at a glance that a question is about a Nhà Nhóm listing. This is
// separate from pipeline_source_map (which is internal dedup keying) and
// only shown to the room owner / admins.
const SHEET_SOURCE_LABEL = 'Nhà Nhóm'

// Locality keywords → Hanoi district. Only keys we're confident about.
// "Định Công" is in Hoàng Mai; "Trường Chinh" straddles Thanh Xuân/Đống Đa
// (left out as a fuzzy match per task spec); Yên Phúc / Phúc La are in Hà
// Đông; Trung Văn is in Nam Từ Liêm; Tân Triều is in Thanh Trì.
//
// JS regex `\b` only sees ASCII word chars, so we can't anchor on Vietnamese
// letters. We rely on the keywords themselves being distinctive enough — and
// match against a normalized (lowercased) address.
const DISTRICT_HINTS = [
  { re: /định\s*công/i, district: 'Hoàng Mai' },
  { re: /trung\s*văn/i, district: 'Nam Từ Liêm' },
  { re: /tân\s*triều/i, district: 'Thanh Trì' },
  { re: /(phúc\s*la|yên\s*phúc|mỗ\s*lao|văn\s*quán|hà\s*đông)/i, district: 'Hà Đông' },
  { re: /(mỹ\s*đình|mễ\s*trì|cầu\s*diễn|nam\s*từ\s*liêm)/i, district: 'Nam Từ Liêm' },
  { re: /(xuân\s*đỉnh|phú\s*diễn|cổ\s*nhuế|bắc\s*từ\s*liêm)/i, district: 'Bắc Từ Liêm' },
  { re: /(linh\s*đàm|hoàng\s*mai|tân\s*mai|tam\s*trinh)/i, district: 'Hoàng Mai' },
  { re: /(khương\s*đình|khương\s*trung|thanh\s*xuân|hạ\s*đình|kim\s*giang)/i, district: 'Thanh Xuân' },
  { re: /(cầu\s*giấy|quan\s*hoa|nghĩa\s*đô|dịch\s*vọng|trần\s*duy\s*hưng)/i, district: 'Cầu Giấy' },
  { re: /(đống\s*đa|láng|kim\s*liên|trung\s*tự|văn\s*chương)/i, district: 'Đống Đa' },
  { re: /(hai\s*bà\s*trưng|bạch\s*mai|đại\s*la|lê\s*đại\s*hành|vĩnh\s*tuy)/i, district: 'Hai Bà Trưng' },
  { re: /(ba\s*đình|kim\s*mã|đội\s*cấn|liễu\s*giai|văn\s*cao)/i, district: 'Ba Đình' },
  { re: /(hoàn\s*kiếm|tạ\s*hiện|phố\s*cổ|hàng\s*[a-zA-Zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]+)/i, district: 'Hoàn Kiếm' },
  { re: /(tây\s*hồ|quảng\s*an|nhật\s*tân|xuân\s*la)/i, district: 'Tây Hồ' },
  { re: /(long\s*biên|ngọc\s*lâm|gia\s*lâm|bồ\s*đề)/i, district: 'Long Biên' },
]

function inferDistrict(address) {
  if (!address) return null
  for (const h of DISTRICT_HINTS) if (h.re.test(address)) return h.district
  return null
}

function inferRoomType(text) {
  if (!text) return 'room'
  const t = text.toLowerCase()
  if (/\b(dorm|ở\s*ghép|giường\s*tầng)\b/.test(t)) return 'shared'
  if (/\b(studio|gác\s*xép|gác\s*lửng)\b/.test(t)) return 'studio'
  if (/\b(căn\s*hộ|mini\s*apt|mini\s*apartment|nguyên\s*căn)\b/.test(t)) return 'mini_apt'
  if (/\bp\d+\b/i.test(text)) return 'room'
  return 'room'
}

function inferAmenities(thangMayBo) {
  if (!thangMayBo) return []
  const s = String(thangMayBo).toLowerCase()
  if (/thang\s*máy/.test(s)) return ['elevator']
  return []
}

function parseAvailableAt(thoiGianVaoO) {
  if (!thoiGianVaoO) return null
  const s = String(thoiGianVaoO).trim().toLowerCase()
  if (!s) return null
  if (/luôn|ngay|free|trống|còn\s*trống/.test(s)) return Date.now()
  // dd/mm or dd/mm/yyyy
  const dm = s.match(/(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{2,4}))?/)
  if (dm) {
    const d = Number(dm[1])
    const m = Number(dm[2]) - 1
    const y = dm[3] ? (Number(dm[3]) < 100 ? 2000 + Number(dm[3]) : Number(dm[3])) : new Date().getFullYear()
    const t = Date.UTC(y, m, d)
    return Number.isFinite(t) ? t : null
  }
  return null
}

// Light area extraction from any text that might contain "25m2" etc.
function inferArea(...sources) {
  for (const src of sources) {
    if (!src) continue
    const { value } = extractAreaM2(String(src))
    if (value) return value
  }
  return null
}

function trimOrNull(s) {
  if (s == null) return null
  const t = String(s).trim()
  return t === '' ? null : t
}

// Parse the Tình trạng cell. Sheet uses leading space and Vietnamese
// diacritics — normalize to lowercase no-diacritics for the match.
function normalizeStatus(s) {
  if (!s) return ''
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function isAvailableStatus(rawStatus) {
  return normalizeStatus(rawStatus) === 'con trong'
}

export function mapSheetRow(record, ctx) {
  const address = trimOrNull(record['Địa chỉ'])
  const priceCell = trimOrNull(record['Giá phòng'])
  const titleCell = trimOrNull(record['Thông tin'])
  const imageLabel = trimOrNull(record['Ảnh phòng'])
  const statusCell = record['Tình trạng']
  const availableCell = record['Thời gian vào ở']
  const stairsCell = record['Thang máy/bộ']

  const imageUrl = (record.__hyperlinks || {})[ctx.imageColIndex] || null
  const resolvedImages = Array.isArray(record.__resolvedImages) ? record.__resolvedImages : null
  const resolveReason = record.__resolvedImagesReason || null

  const priceParsed = priceCell ? extractPriceVnd(priceCell) : { value: null }
  const district = inferDistrict(address) || TEXT_PLACEHOLDER
  const ward = TEXT_PLACEHOLDER
  const roomType = inferRoomType(`${titleCell || ''} ${imageLabel || ''} ${address || ''}`)
  const amenities = inferAmenities(stairsCell)
  const area = inferArea(titleCell, imageLabel, address, priceCell)
  const availableAt = parseAvailableAt(availableCell)

  const baseTitle = titleCell || 'Phòng cho thuê'
  const fullTitle = address ? `${baseTitle} — ${address}` : baseTitle

  const description = [
    titleCell ? `Mã phòng: ${titleCell}` : null,
    address ? `Địa chỉ: ${address}` : null,
    priceCell ? `Giá: ${priceCell}` : null,
    availableCell ? `Thời gian vào ở: ${availableCell}` : null,
    stairsCell ? `Lối lên: ${stairsCell}` : null,
    imageLabel && !imageUrl ? `Album ảnh: ${imageLabel}` : null,
  ].filter(Boolean).join('\n')

  // Prefer resolved per-image URLs; if the sync script could not expand the
  // folder (network error, private folder, empty grid), fall back to the
  // folder URL alone and tag the row so it's easy to find in the dry-run
  // sample.
  let images
  if (resolvedImages && resolvedImages.length) {
    images = resolvedImages.slice()
  } else if (imageUrl) {
    images = [imageUrl]
  } else {
    images = []
  }

  const notes = []
  if (!priceParsed.value) notes.push('no-price')
  if (!address) notes.push('no-address')
  if (district === TEXT_PLACEHOLDER) notes.push('district-unknown')
  if (!area) notes.push('area-defaulted')
  if (!imageUrl) notes.push('no-image-link')
  else if (!resolvedImages || resolvedImages.length === 0) {
    notes.push(resolveReason ? `image-folder-unresolved:${resolveReason}` : 'image-folder-unresolved')
  }

  const sourceKey = `gsheet:${ctx.spreadsheetId}:${ctx.gid}:${record.__rowNumber}`

  return {
    sourceKey,
    rowNumber: record.__rowNumber,
    rawStatus: typeof statusCell === 'string' ? statusCell : '',
    isAvailable: isAvailableStatus(statusCell),
    room: {
      // id is assigned by upsert (re-uses existing on conflict)
      title: fullTitle.slice(0, 140),
      roomType,
      priceVnd: priceParsed.value || 0,
      depositVnd: 0,
      areaM2: area || DEFAULT_AREA_M2,
      district,
      ward,
      addressHint: address || TEXT_PLACEHOLDER,
      lat: null,
      lng: null,
      description,
      amenities,
      fees: {},
      rules: {},
      images,
      contactName: SHEET_CONTACT_NAME,
      contactPhone: SHEET_CONTACT_PHONE,
      contactZalo: SHEET_CONTACT_ZALO,
      verified: false,
      status: 'active',
      featured: false,
      reports: 0,
      views: 0,
      likes: 0,
      ownerId: null,
      isSeed: false,
      availableAt: availableAt ?? Date.now(),
      source: SHEET_SOURCE_LABEL,
    },
    notes,
  }
}

export const SHEET_ROW_MAPPER = {
  TEXT_PLACEHOLDER,
  DEFAULT_AREA_M2,
  SHEET_CONTACT_NAME,
  SHEET_CONTACT_PHONE,
  SHEET_CONTACT_ZALO,
  SHEET_SOURCE_LABEL,
}
