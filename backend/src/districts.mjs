// Central district normalizer for the supported Hanoi catchment.
//
// Used by:
//   - backend/src/api.mjs            — filter parsing + write validation
//   - pipeline/lib/normalize.mjs     — importer free-text extraction
//   - pipeline/lib/sheet-row-mapper  — keyword-driven inference
//   - scripts/backfill-districts.mjs — one-off backfill of dirty rows
//
// Why one place: production DB has dirty active districts (e.g. "Hà Nội",
// "Ha Noi", "Nam Tu Liem", "Dong Da") that came in before write-side
// validation matched read-side filter parsing. Every entry point now goes
// through the same alias map so the divergence can't grow back.
//
// Rules:
//   - Case-insensitive, accent-insensitive lookup; whitespace collapsed.
//   - City-level strings (Hà Nội / Ha Noi / "Hanoi") are NOT districts; they
//     resolve to null so filter/parse logic can refuse them.
//   - Returns the canonical accented Vietnamese spelling on success.
//
// If you add a new supported district, add it to CANONICAL_DISTRICTS and any
// additional unaccented or short-form spelling to EXTRA_ALIASES.

const CANONICAL_DISTRICTS = [
  'Hoàn Kiếm',
  'Ba Đình',
  'Đống Đa',
  'Hai Bà Trưng',
  'Cầu Giấy',
  'Tây Hồ',
  'Thanh Xuân',
  'Hoàng Mai',
  'Long Biên',
  'Hà Đông',
  'Nam Từ Liêm',
  'Bắc Từ Liêm',
]

// Extra accepted spellings that wouldn't normalize to a canonical key on
// their own (typos, common abbreviations, ASCII-fold edge cases). Keys are
// the "folded" form (lowercased, no diacritics, single-spaced).
const EXTRA_ALIASES = {
  // Same fold as canonical, here for clarity / future tweaks
  'dong da': 'Đống Đa',
  'nam tu liem': 'Nam Từ Liêm',
  'bac tu liem': 'Bắc Từ Liêm',
  'cau giay': 'Cầu Giấy',
  'thanh xuan': 'Thanh Xuân',
  'ha dong': 'Hà Đông',
  'hoang mai': 'Hoàng Mai',
  'tay ho': 'Tây Hồ',
  'hai ba trung': 'Hai Bà Trưng',
  'ba dinh': 'Ba Đình',
  'hoan kiem': 'Hoàn Kiếm',
  'long bien': 'Long Biên',
  // Common short-forms / typos seen in importer output
  'q. cau giay': 'Cầu Giấy',
  'quan cau giay': 'Cầu Giấy',
  'quan dong da': 'Đống Đa',
  'q. dong da': 'Đống Đa',
}

// Strings we recognize as city-level (not a district). Folded form.
const CITY_LEVEL_TOKENS = new Set([
  'ha noi',
  'hanoi',
  'tp ha noi',
  'tp.ha noi',
  'thanh pho ha noi',
])

// Build a fold→canonical map from the canonical list plus EXTRA_ALIASES.
const FOLDED_TO_CANONICAL = (() => {
  const m = new Map()
  for (const d of CANONICAL_DISTRICTS) m.set(foldKey(d), d)
  for (const [k, v] of Object.entries(EXTRA_ALIASES)) m.set(foldKey(k), v)
  return m
})()

// Strip diacritics + lower + collapse whitespace. Keeps the original word
// boundaries so "ba dinh" doesn't collide with "badinh".
export function foldKey(s) {
  if (typeof s !== 'string') return ''
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Vietnamese đ/Đ aren't covered by NFD decomposition.
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Returns the canonical district name for an input, or null if the input
// doesn't map to a supported Hanoi district (or refers to the city itself).
//
// Examples:
//   normalizeDistrict('Dong Da')      -> 'Đống Đa'
//   normalizeDistrict('  Cầu  Giấy ') -> 'Cầu Giấy'
//   normalizeDistrict('Hà Nội')       -> null     (city-level)
//   normalizeDistrict('Ha Noi')       -> null
//   normalizeDistrict('')             -> null
//   normalizeDistrict('Long Bien')    -> 'Long Biên'
export function normalizeDistrict(input) {
  const k = foldKey(input)
  if (!k) return null
  if (CITY_LEVEL_TOKENS.has(k)) return null
  return FOLDED_TO_CANONICAL.get(k) || null
}

// True if the input is a recognized supported district (canonical or alias).
export function isSupportedDistrict(input) {
  return normalizeDistrict(input) !== null
}

// True if the input matches a Hanoi city-level token rather than a district.
export function isCityLevel(input) {
  return CITY_LEVEL_TOKENS.has(foldKey(input))
}

// Returns the canonical district list (defensive copy).
export function listCanonicalDistricts() {
  return CANONICAL_DISTRICTS.slice()
}

// Tries every alias the room might have been stored under. Useful when
// comparing a filter value to a stored district that may already be
// canonical, unaccented, or otherwise dirty. Returns true if both fold to
// the same canonical name.
export function districtsMatch(a, b) {
  const ka = normalizeDistrict(a)
  const kb = normalizeDistrict(b)
  if (ka && kb) return ka === kb
  // Either side may be a yet-unrecognized typo; fall back to a raw fold
  // match so a row stored as e.g. "Foo District" still matches a filter
  // typed the same way.
  return foldKey(a) !== '' && foldKey(a) === foldKey(b)
}
