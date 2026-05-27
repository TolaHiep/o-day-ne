// Local-only swipe pass state for anonymous users. Likes always require login,
// so they never end up here — only "pass" decisions, and we keep them on the
// device so a guest can browse the deck without seeing the same room twice.

const PASS_KEY = 'odn.anon.passes.v1'
const FILTER_KEY = 'odn.filters.v1'

export function loadAnonPasses(): Set<string> {
  try {
    const raw = localStorage.getItem(PASS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return new Set(arr.filter((x) => typeof x === 'string'))
  } catch { /* ignore */ }
  return new Set()
}

export function saveAnonPasses(set: Set<string>) {
  try { localStorage.setItem(PASS_KEY, JSON.stringify([...set])) } catch { /* ignore */ }
}

export function clearAnonPasses() {
  try { localStorage.removeItem(PASS_KEY) } catch { /* ignore */ }
}

// Stable anonymous client identifier used to attach lead submissions
// (viewing appointments / consultation requests) to a returning anonymous
// user. We generate it on first read and persist it forever — clearing
// localStorage resets it, but otherwise the same browser will keep the same
// lead history across visits.
const CLIENT_ID_KEY = 'odn.client.id.v1'
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

export function getOrCreateClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY)
    if (existing && CLIENT_ID_RE.test(existing)) return existing
  } catch { /* ignore */ }
  // crypto.randomUUID exists in every browser we ship to; fall back to a
  // Math.random + Date.now combo just in case the page is loaded in an exotic
  // environment without it (jsdom under Vitest, old WebViews).
  const fresh = (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).slice(0, 48)
  try { localStorage.setItem(CLIENT_ID_KEY, fresh) } catch { /* ignore */ }
  return fresh
}

export function loadFilters<T>(): T | null {
  try {
    const raw = localStorage.getItem(FILTER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Legacy v1 filters stored district as a single string. The current
    // RoomFilters type uses districts:string[] for multi-select, so promote
    // the old shape on load — keeping the user's prior choice intact.
    if (parsed && typeof parsed === 'object' && typeof parsed.district === 'string') {
      const single: string = parsed.district
      delete parsed.district
      if (!Array.isArray(parsed.districts) || parsed.districts.length === 0) {
        parsed.districts = single ? [single] : []
      }
    }
    return parsed as T
  } catch { return null }
}

export function saveFilters<T>(f: T) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)) } catch { /* ignore */ }
}
