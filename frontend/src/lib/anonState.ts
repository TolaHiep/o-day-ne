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
