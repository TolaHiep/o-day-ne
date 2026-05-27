import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SwipeCard } from '../components/SwipeCard'
import { FiltersPanel } from '../components/FiltersPanel'
import { Icon } from '../components/Icon'
import { apiRooms, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { loadAnonPasses, saveAnonPasses, loadFilters, saveFilters } from '../lib/anonState'
import { goRoom } from '../lib/router'
import type { Room, RoomFilters } from '../types'
import { AMENITY_EMOJI, AMENITY_LABEL, formatFee, formatVND, ROOM_TYPE_LABEL, relativeTime } from '../lib/format'

const DEFAULT_FILTERS: RoomFilters = { sort: 'match', amenities: [] }

export function DiscoverPage() {
  const auth = useAuth()
  const [filters, setFilters] = useState<RoomFilters>(() => loadFilters<RoomFilters>() || DEFAULT_FILTERS)
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [topIdx, setTopIdx] = useState(0)
  const [forcedDir, setForcedDir] = useState<'like' | 'pass' | null>(null)
  const [lastLikedTitle, setLastLikedTitle] = useState<string | null>(null)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  // True when the current deck was fetched WITHOUT the excludeSeen filter
  // — i.e. the user reset the deck and is intentionally re-seeing rooms
  // they already swiped on. Surfaced in the empty state so the user
  // understands why a "reset" still produced no rooms when there genuinely
  // are no listings matching the filter at all.
  const [showingSeen, setShowingSeen] = useState(false)
  // Bumped whenever a swipe was animated-out but couldn't be committed
  // (e.g. like requires login). The top SwipeCard listens and snaps back.
  const [bounceKey, setBounceKey] = useState(0)
  const anonPasses = useRef<Set<string>>(loadAnonPasses())

  useEffect(() => { saveFilters(filters) }, [filters])

  const loadRooms = useCallback(async (opts: { includeSeen?: boolean } = {}) => {
    setLoading(true)
    setError(null)
    const includeSeen = !!opts.includeSeen
    try {
      // When the caller asks for includeSeen we also drop the anon-pass
      // filter, otherwise the user clicks "Dọn lại" and STILL sees an
      // empty stack because every room is in localStorage's pass set.
      const r = await apiRooms.list(filters, { excludeSeen: !includeSeen })
      const passed = includeSeen ? new Set<string>() : anonPasses.current
      let list = passed.size === 0 ? r.rooms : r.rooms.filter((rm) => !passed.has(rm.id))

      // Auto-refill: an authenticated user whose first fetch comes back
      // empty solely because their seen-history covers everything would
      // otherwise be stuck on a blank deck on initial page-load. Try once
      // more with excludeSeen=false so they see something — labelled as
      // "already swiped" via showingSeen.
      let landedShowingSeen = includeSeen
      if (!includeSeen && list.length === 0 && auth.user) {
        const refill = await apiRooms.list(filters, { excludeSeen: false })
        if (refill.rooms.length > 0) {
          list = refill.rooms
          landedShowingSeen = true
        }
      }
      setRooms(list)
      setTopIdx(0)
      setShowingSeen(landedShowingSeen)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được danh sách phòng.')
    } finally { setLoading(false) }
  }, [filters, auth.user])

  useEffect(() => { loadRooms() }, [loadRooms, auth.user?.id])

  const top = rooms[topIdx]
  const stack = useMemo(() => rooms.slice(topIdx, topIdx + 3), [rooms, topIdx])
  const activeFilterCount =
    (filters.districts?.length || 0) +
    (filters.roomType ? 1 : 0) +
    (filters.priceMin || filters.priceMax ? 1 : 0) +
    (filters.areaMin ? 1 : 0) +
    (filters.amenities?.length || 0)

  const advance = useCallback((dir: 'like' | 'pass') => {
    if (!top) return
    setForcedDir(null)
    setTopIdx((i) => i + 1)
    if (dir === 'like') setLastLikedTitle(top.title)
  }, [top])

  // Reject the in-flight swipe and tell the SwipeCard to undo its exit
  // animation. Used when "like" needs login — without this, the top card
  // stays animated off-screen and subsequent taps do nothing.
  const bounce = useCallback(() => {
    setForcedDir(null)
    setBounceKey((k) => k + 1)
  }, [])

  const swipe = useCallback(async (dir: 'like' | 'pass') => {
    if (!top) return
    if (dir === 'like') {
      if (!auth.user) { auth.openPopup('save'); bounce(); return }
      try { await apiRooms.swipe(top.id, 'like') } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          auth.openPopup('save'); bounce(); return
        }
      }
    } else {
      anonPasses.current.add(top.id)
      saveAnonPasses(anonPasses.current)
      try { await apiRooms.swipe(top.id, 'pass') } catch { /* anon ok */ }
    }
    advance(dir)
  }, [top, advance, auth, bounce])

  function trigger(dir: 'like' | 'pass') {
    if (!top) return
    setForcedDir(dir)
  }

  // Responsive grid breakdown:
  //   <md  : single column, page-scrolls, filters in a slide-up sheet
  //   md   : 2 cols [deck · insight rail], viewport-locked, filters in sheet
  //   lg   : 3 cols [filter · deck · insight], viewport-locked
  //   xl   : 3 cols, wider rails, card max-w-2xl
  //   2xl  : 3 cols, widest rails, card max-w-4xl — main goes up to 1600px
  //          so the rails grow to consume the ultra-wide canvas (rather
  //          than leaving big cream margins outside max-w-7xl).
  return (
    <div className="grid gap-4 sm:gap-6 md:h-full md:grid-cols-[minmax(0,1fr)_15rem] md:min-h-0 md:overflow-hidden lg:grid-cols-[15rem_minmax(0,1fr)_17rem] xl:grid-cols-[16rem_minmax(0,1fr)_20rem] 2xl:grid-cols-[19rem_minmax(0,1fr)_24rem]">
      {/* Left rail: only at lg+. On md the filters live in the slide-up sheet
          to keep more horizontal room for the deck on tablets. */}
      <div className="hidden lg:block lg:min-h-0 lg:overflow-y-auto lg:pr-1 scrollbar-thin">
        <FiltersPanel value={filters} onChange={setFilters} />
      </div>

      <div className="flex min-w-0 flex-col md:min-h-0">
        {/* Title + stack count header removed by request — frees vertical
            room so the card photo can dominate. The filter button still
            needs a home for mobile/tablet (lg+ has the filter rail), so a
            compact bar with only the button stays. */}
        <div className="mb-2 flex flex-none items-center justify-end lg:hidden">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            className="btn-outline btn-pill relative shrink-0"
          >
            <Icon.Sliders size={15} />
            Bộ lọc
            {activeFilterCount > 0 && (
              <span className="ml-1 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-leaf-500 px-1 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {error && (
          <p className="flex-none rounded-2xl bg-coral-50 px-4 py-3 text-sm text-coral-500 ring-1 ring-coral-100">{error}</p>
        )}

        {/* Card box.
            On phones (<md) we keep a fixed aspect ratio so the card sizes
            off width. From md up we drop aspect-ratio: `flex-1 min-h-0`
            lets the card grow to fill whatever vertical space is left
            between header and ActionBar — guaranteeing action buttons stay
            above the fold across tablet → ultra-wide. */}
        <div className="relative mx-auto aspect-[3/4] w-full max-w-md max-h-[min(70svh,720px)] sm:aspect-[4/5] sm:max-w-lg sm:max-h-[680px] md:aspect-auto md:max-w-xl md:max-h-none md:min-h-0 md:flex-1 lg:max-w-2xl xl:max-w-3xl 2xl:max-w-4xl">
          {loading && (
            <div className="skeleton absolute inset-0 grid place-items-center rounded-[28px]">
              <p className="relative z-10 text-ink-500">Đang chuẩn bị bộ bài…</p>
            </div>
          )}

          {!loading && stack.length === 0 && (
            <EmptyDeck
              showingSeen={showingSeen}
              loggedIn={!!auth.user}
              onReset={() => {
                // Clear the anon-pass localStorage cache too — without this
                // an authenticated user who used the app anonymously first
                // would still be filtered against their old anon set.
                anonPasses.current = new Set()
                saveAnonPasses(anonPasses.current)
                // For logged-in users, includeSeen=true asks the backend to
                // skip the seen-filter so already-swiped rooms reappear.
                // Anonymous users just refetch normally (the backend has no
                // seen-history for them).
                loadRooms({ includeSeen: !!auth.user })
              }}
            />
          )}

          {stack.map((r, i) => (
            <SwipeCard
              key={r.id}
              room={r}
              stackIndex={i}
              forcedDir={i === 0 ? forcedDir : undefined}
              resetSignal={i === 0 ? bounceKey : undefined}
              onSwipe={swipe}
              onOpen={() => goRoom(r.id)}
            />
          ))}
        </div>

        <ActionBar
          disabled={!top || loading}
          onPass={() => trigger('pass')}
          onLike={() => trigger('like')}
          onOpen={top ? () => goRoom(top.id) : undefined}
          lastLikedTitle={lastLikedTitle}
          loggedIn={!!auth.user}
        />

        <KeyboardHint />
      </div>

      {/* Right rail: appears from md+ (tablets get the insight panel even
          without the filter rail). Scrolls internally to preserve the
          viewport lock. */}
      <div className="hidden space-y-4 md:block md:min-h-0 md:overflow-y-auto md:pr-1 scrollbar-thin">
        <TopRoomInsight room={top} loading={loading} onOpen={top ? () => goRoom(top.id) : undefined} />
        <ShortlistPreview />
      </div>

      {mobileFiltersOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/45 backdrop-blur-sm sm:items-center lg:hidden"
          onClick={() => setMobileFiltersOpen(false)}
        >
          {/* Slide-up on phones; centered modal on tablet so the sheet
              doesn't stretch awkwardly wide across the screen. */}
          <div
            className="h-[88svh] w-full overflow-y-auto rounded-t-3xl bg-cream-100 p-4 pb-safe scrollbar-thin animate-slideUp sm:h-auto sm:max-h-[85svh] sm:max-w-md sm:rounded-3xl md:max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <FiltersPanel value={filters} onChange={setFilters} compact onClose={() => setMobileFiltersOpen(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

function ActionBar({ disabled, onPass, onLike, onOpen, lastLikedTitle, loggedIn }: {
  disabled?: boolean
  onPass: () => void
  onLike: () => void
  onOpen?: () => void
  lastLikedTitle: string | null
  loggedIn: boolean
}) {
  // All three buttons share the same diameter — hierarchy is conveyed by
  // colour, not size. The row sits below the card on every breakpoint
  // (mobile overlap attempted earlier looked half-clipped behind the card
  // edge and was reverted by user request).
  return (
    <div className="mt-2 flex flex-none flex-col items-center gap-2 md:mt-3 md:gap-2.5">
      <div className="flex items-center gap-3 sm:gap-4 md:gap-5">
        <CircleBtn label="Bỏ qua" onClick={onPass} disabled={disabled} variant="coral">
          <Icon.Close size={22} strokeWidth={2.4} />
        </CircleBtn>
        <CircleBtn label="Chi tiết" onClick={onOpen} disabled={!onOpen} variant="cream">
          <Icon.Eye size={18} />
        </CircleBtn>
        <CircleBtn label="Hợp gu" onClick={onLike} disabled={disabled} variant="leaf">
          <Icon.HeartFilled size={22} />
        </CircleBtn>
      </div>
      <div className="px-2 text-center text-xs text-ink-500">
        {lastLikedTitle && (
          <p>
            <Icon.Check size={12} className="mr-1 inline -translate-y-px text-leaf-700" />
            Bạn vừa Hợp gu với <span className="font-semibold text-leaf-700">{lastLikedTitle}</span>.{' '}
            {loggedIn ? 'Xem ở Hợp gu →' : 'Đăng nhập để lưu vĩnh viễn.'}
          </p>
        )}
      </div>
    </div>
  )
}

function CircleBtn({ children, onClick, label, disabled, variant }: {
  children: React.ReactNode
  onClick?: () => void
  label: string
  disabled?: boolean
  variant: 'leaf' | 'coral' | 'cream'
}) {
  const palette = variant === 'leaf'
    // Like keeps its filled jade fill so the "primary" feeling survives
    // even though all three buttons are now the same size — color carries
    // the hierarchy now, not diameter.
    ? 'bg-leaf-500 text-white hover:bg-leaf-600 ring-leaf-400/50 shadow-[0_18px_40px_-14px_rgba(19,138,79,0.55)] hover:shadow-[0_22px_46px_-12px_rgba(19,138,79,0.65)]'
    : variant === 'coral'
      ? 'bg-white text-coral-400 hover:bg-coral-50 ring-coral-200 hover:ring-coral-300'
      : 'bg-white text-ink-700 hover:bg-cream-100 ring-ink-900/10'
  // Single equal-sized scale across all 3 buttons. Capped at 64px on 2xl
  // — previous scale up to 96px felt oversized for the swipe deck context.
  // Minimum 44px on mobile preserves the WCAG touch-target floor.
  const sizeClass = 'h-11 w-11 sm:h-12 sm:w-12 lg:h-14 lg:w-14 2xl:h-16 2xl:w-16'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid cursor-pointer place-items-center rounded-full shadow-card ring-2 transition-all duration-200 hover:-translate-y-0.5 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${palette} ${sizeClass}`}
    >
      {children}
    </button>
  )
}

function KeyboardHint() {
  // Two hints with different audiences: desktop users see keyboard shortcuts
  // (Tinder-on-keyboard parity), phone users see the gesture cheatsheet.
  return (
    <>
      <p className="mt-2 hidden flex-none text-center text-[11px] text-ink-500 md:block">
        <kbd className="rounded bg-cream-200 px-1.5 py-0.5 text-[10px] font-semibold text-ink-700">←</kbd>
        <kbd className="mx-1 rounded bg-cream-200 px-1.5 py-0.5 text-[10px] font-semibold text-ink-700">→</kbd>
        quẹt ·
        <kbd className="mx-1 rounded bg-cream-200 px-1.5 py-0.5 text-[10px] font-semibold text-ink-700">↑</kbd>
        <kbd className="rounded bg-cream-200 px-1.5 py-0.5 text-[10px] font-semibold text-ink-700">↓</kbd>
        ảnh ·
        <kbd className="mx-1 rounded bg-cream-200 px-1.5 py-0.5 text-[10px] font-semibold text-ink-700">Enter</kbd>
        chi tiết
      </p>
      <p className="mt-1.5 flex-none text-center text-[11px] text-ink-500 md:hidden">
        Vuốt <span className="font-semibold text-coral-500">← bỏ qua</span> ·{' '}
        <span className="font-semibold text-leaf-700">→ hợp gu</span> ·{' '}
        <span className="font-semibold text-ink-800">↑ chi tiết</span>
      </p>
    </>
  )
}

function EmptyDeck({ onReset, showingSeen, loggedIn }: {
  onReset: () => void
  showingSeen?: boolean
  loggedIn?: boolean
}) {
  // Two empty states, distinguished by whether the user has already asked
  // to re-see swiped rooms. Before reset → "you've gone through every room
  // in this filter" copy with a CTA that re-includes already-swiped rooms.
  // After reset → "even with seen rooms, none match" copy that tells the
  // user to widen the filter instead.
  const headline = showingSeen
    ? 'Không có phòng nào khớp bộ lọc.'
    : 'Bạn đã quẹt hết phòng trong bộ lọc này.'
  const hint = showingSeen
    ? 'Bạn đã xem mọi phòng phù hợp. Nới bộ lọc để thấy phòng ở quận/khu khác.'
    : loggedIn
      ? 'Tất cả phòng phù hợp đã được quẹt qua. Bấm bên dưới để xem lại những phòng bạn đã bỏ qua hoặc đã hợp gu trước đó.'
      : 'Tất cả phòng phù hợp đã được quẹt qua. Bấm bên dưới để xem lại những phòng bạn đã bỏ qua trước đó.'
  return (
    <div className="absolute inset-0 grid place-items-center rounded-[28px] bg-cream-50 ring-1 ring-cream-300 p-6 text-center dot-grid">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-leaf-50 text-leaf-700">
          <Icon.Compass size={28} />
        </div>
        <p className="mt-3 font-display text-xl font-semibold tracking-tight">{headline}</p>
        <p className="mt-1 text-sm text-ink-500">{hint}</p>
        {!showingSeen && (
          <button onClick={onReset} className="btn-leaf btn-pill mt-4">Xem lại các phòng trước</button>
        )}
      </div>
    </div>
  )
}

function TopRoomInsight({ room, loading, onOpen }: { room?: Room; loading: boolean; onOpen?: () => void }) {
  if (loading && !room) {
    return (
      <aside className="card-soft">
        <div className="skeleton h-4 w-24 rounded" />
        <div className="skeleton mt-3 h-6 w-2/3 rounded" />
        <div className="skeleton mt-2 h-4 w-1/2 rounded" />
      </aside>
    )
  }
  if (!room) return null
  // Compressed: only the 2 strongest match hints — the rest live on the
  // detail page. Right rail has to fit in one viewport without scroll, so
  // every section earns its pixels.
  const matchHints = buildMatchHints(room).slice(0, 2)
  const safety = collectSafetyChips(room)
  const fees = buildFeeRows(room.fees)
  // Cap amenity chips at 8 — wraps to 2 rows on a 19rem rail at most. A
  // "+N" overflow chip preserves the total count without blowing height.
  const amenityShown = room.amenities.slice(0, 8)
  const amenityRest = Math.max(0, room.amenities.length - amenityShown.length)
  return (
    <aside className="card-soft">
      {/* Anchor label — arrow points left to make the relationship to the
          card explicit, instead of an ambiguous "currently viewing" header
          that users could mistake for a second room. */}
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-leaf-700">
          <Icon.ArrowLeft size={12} /> Phòng bạn đang quẹt
        </p>
        {typeof room.matchScore === 'number' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-leaf-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-soft">
            <Icon.Sparkles size={11} /> {room.matchScore}% hợp gu
          </span>
        )}
      </div>

      {/* Hero cost block — Rent + Deposit read as one decision unit. */}
      <div className="mt-3 rounded-2xl bg-leaf-50 px-4 py-3 ring-1 ring-leaf-100">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow text-[10px] text-leaf-700/80">Giá thuê / tháng</p>
            <p className="mt-0.5 truncate font-display text-2xl font-bold text-leaf-700">{formatVND(room.priceVnd)}</p>
          </div>
          <div className="text-right">
            <p className="eyebrow text-[10px] text-ink-500">Cọc</p>
            <p className="mt-0.5 font-display text-sm font-semibold text-ink-900">{formatVND(room.depositVnd)}</p>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-500">Cập nhật {relativeTime(room.updatedAt)}</p>
      </div>

      {fees.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow">Phí dịch vụ</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {fees.map((f) => (
              <div
                key={f.label}
                className="flex items-center justify-between gap-1 rounded-lg bg-cream-100/70 px-2 py-1 text-[11px] ring-1 ring-cream-200/70"
              >
                <span className="text-ink-500">{f.label}</span>
                <span className="font-semibold text-ink-900">{f.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {amenityShown.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow">Tiện nghi</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {amenityShown.map((a) => (
              <span key={a} className="pill pill-cream text-[10px]">
                <span aria-hidden>{AMENITY_EMOJI[a] || '✓'}</span>
                {AMENITY_LABEL[a] || a}
              </span>
            ))}
            {amenityRest > 0 && (
              <span className="pill pill-cream text-[10px] text-ink-500">+{amenityRest}</span>
            )}
          </div>
        </div>
      )}

      {(() => {
        const locationLine = joinLocation(room.ward, room.district)
        const addressHint = room.addressHint?.trim() || ''
        const showHint = addressHint && addressHint !== locationLine
        if (!locationLine && !showHint) return null
        return (
          <div className="mt-3 flex items-start gap-2 rounded-2xl bg-cream-100/80 px-3 py-2 text-xs ring-1 ring-cream-200">
            <Icon.MapPin size={16} className="mt-0.5 shrink-0 text-leaf-500" />
            <div className="min-w-0 flex-1">
              <p className="eyebrow whitespace-nowrap text-[10px]">Vị trí</p>
              {locationLine && (
                <p
                  className="line-clamp-2 break-words font-semibold leading-snug text-ink-900"
                  title={locationLine}
                >
                  {locationLine}
                </p>
              )}
              {showHint && (
                <p className="line-clamp-1 break-words text-ink-500" title={addressHint}>
                  {addressHint}
                </p>
              )}
            </div>
          </div>
        )
      })()}

      {matchHints.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow">Vì sao phù hợp</p>
          <ul className="mt-1 space-y-0.5 text-[13px] text-ink-700">
            {matchHints.map((h) => (
              <li key={h} className="flex items-start gap-1.5">
                <Icon.Check size={13} className="mt-1 shrink-0 text-leaf-500" />
                <span className="line-clamp-1">{h}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {safety.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {safety.map((s) => (
            <span key={s.label} className="pill pill-leaf text-[10px]">
              {s.icon}
              {s.label}
            </span>
          ))}
        </div>
      )}

      <button
        onClick={onOpen}
        disabled={!onOpen}
        className="btn-outline btn-pill mt-3 w-full"
      >
        Xem chi tiết & liên hệ
        <Icon.ArrowRight size={14} />
      </button>
    </aside>
  )
}

// Skip electric — it's now folded into the hero block's secondary line on
// some designs; keeping it out of this rollup avoids duplication. Returns
// only fees the landlord actually filled in. Importer values may be strings
// (e.g. "4.000đ/số"), so we route everything through formatFee + drop rows
// whose formatted value is the "missing" sentinel.
function buildFeeRows(fees: Room['fees']): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  const push = (label: string, value: number | string | null | undefined) => {
    const v = formatFee(value, { missing: '' })
    if (v) out.push({ label, value: v })
  }
  push('Điện / kWh', fees.electric)
  push('Nước / m³', fees.water)
  push('Internet', fees.internet)
  push('Dịch vụ', fees.service)
  push('Gửi xe', fees.parking)
  return out
}

function joinLocation(...parts: (string | null | undefined)[]): string {
  return parts
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0)
    .join(', ')
}

function buildMatchHints(room: Room): string[] {
  const out: string[] = []
  if (room.verified) out.push('Đã xác minh chủ phòng / địa chỉ')
  if (room.featured) out.push('Tin nổi bật của tuần, lượt xem cao')
  if (room.rating?.avg && room.rating.count > 0) {
    out.push(`${room.rating.avg.toFixed(1)} ★ từ ${room.rating.count} người đã đánh giá`)
  }
  if (room.amenities.includes('private_wc')) out.push('Có WC riêng — không dùng chung')
  if (room.amenities.includes('no_owner')) out.push('Chủ không ở cùng — tự do giờ giấc')
  if (room.amenities.includes('curfew_free')) out.push('Không giờ giới nghiêm')
  if (room.amenities.includes('balcony')) out.push('Có ban công thoáng')
  if (room.amenities.includes('ac')) out.push('Có điều hoà')
  if (room.amenities.includes('kitchen')) out.push('Bếp riêng')
  return out.slice(0, 4)
}

function collectSafetyChips(room: Room): { label: string; icon: React.ReactNode }[] {
  const out: { label: string; icon: React.ReactNode }[] = []
  if (room.amenities.includes('fire_safety')) out.push({ label: 'PCCC đạt chuẩn', icon: <Icon.Shield size={11} /> })
  if (room.amenities.includes('security_cam')) out.push({ label: 'Có camera', icon: <Icon.Camera size={11} /> })
  if (room.verified) out.push({ label: 'Đã xác minh', icon: <Icon.Check size={11} /> })
  return out
}

function ShortlistPreview() {
  const auth = useAuth()
  const [list, setList] = useState<Room[] | null>(null)
  useEffect(() => {
    if (!auth.user) { setList(null); return }
    apiRooms.saved().then((r) => setList(r.rooms.slice(0, 5))).catch(() => setList([]))
  }, [auth.user?.id])
  if (!auth.user) return null
  return (
    <aside className="card-soft">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display text-lg font-semibold tracking-tight text-ink-900">Hợp gu gần đây</p>
          <p className="text-xs text-ink-500">Quẹt phải = lưu vào đây.</p>
        </div>
        <span className="pill pill-coral">
          <Icon.HeartFilled size={12} />
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {!list && <p className="text-sm text-ink-500">Đang tải…</p>}
        {list && list.length === 0 && (
          <p className="text-sm text-ink-500">Chưa có phòng nào. Quẹt phải để lưu nhé!</p>
        )}
        {list?.map((r) => (
          <button
            key={r.id}
            onClick={() => goRoom(r.id)}
            className="group flex w-full cursor-pointer gap-3 rounded-2xl bg-white p-2 text-left ring-1 ring-cream-200 transition hover:bg-cream-100 hover:ring-leaf-300"
          >
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-cream-300">
              {r.images?.[0] && <img src={r.images[0]} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0">
              <p className="line-clamp-1 text-sm font-semibold text-ink-900 group-hover:text-leaf-700">{r.title}</p>
              <p className="line-clamp-1 text-xs text-ink-500">
                {r.district} · {ROOM_TYPE_LABEL[r.roomType]} · {formatVND(r.priceVnd)}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.amenities.slice(0, 3).map((a) => (
                  <span key={a} className="pill pill-cream text-[10px]">
                    <span aria-hidden>{AMENITY_EMOJI[a]}</span>
                    {AMENITY_LABEL[a]}
                  </span>
                ))}
              </div>
              <p className="mt-0.5 text-[11px] text-ink-400">{relativeTime(r.updatedAt)}</p>
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}
