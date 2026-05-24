import { useEffect, useRef, useState } from 'react'
import type { Room } from '../types'
import { ROOM_TYPE_LABEL, formatVND } from '../lib/format'
import { Icon } from './Icon'

type Direction = 'like' | 'pass' | null

export type SwipeCardProps = {
  room: Room
  stackIndex: number // 0 = top, 1 = behind, 2 = behind further
  onSwipe: (dir: 'like' | 'pass') => void
  onOpen?: () => void
  forcedDir?: Direction
  disabled?: boolean
  // Bumped by the parent when a swipe is rejected (e.g. login required) so
  // the card can undo its exit animation and stay interactive for retry.
  // Without this, exit + forcedDir stay set and the top card gets stuck
  // off-screen the next time the user tries to like.
  resetSignal?: number
}

export function SwipeCard({ room, stackIndex, onSwipe, onOpen, forcedDir, disabled, resetSignal }: SwipeCardProps) {
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [exit, setExit] = useState<Direction>(null)
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const [photoIdx, setPhotoIdx] = useState(0)
  const [showPhotoHint, setShowPhotoHint] = useState(false)
  const photos = room.images.length ? room.images : ['']

  useEffect(() => { setPhotoIdx(0); setExit(null); setDrag(null) }, [room.id])

  // Once a card sits on top, warm the rest of its photos so the next/prev
  // arrows feel instant — without this, the first arrow press waits on the
  // image's full fetch+decode round-trip (Cloudinary originals can be 2–3s
  // on a cold cache). The first image of upcoming rooms is warmed by the
  // behind cards' <img> below (eager + low priority), so the deck also
  // paints the next room without a flash.
  useEffect(() => {
    if (stackIndex !== 0) return
    const urls = Array.isArray(room.images) ? room.images.filter(Boolean) : []
    for (const url of urls) {
      const img = new Image()
      img.src = url
      img.decode?.().catch(() => { /* best-effort warm; some browsers reject on broken URLs */ })
    }
  }, [stackIndex, room.id, room.images])

  // One-time visible "tap left/right to change photo" hint for the top card.
  useEffect(() => {
    if (stackIndex !== 0 || photos.length <= 1) return
    try {
      if (sessionStorage.getItem('odn:photoHintSeen')) return
    } catch { /* private mode → just show it */ }
    setShowPhotoHint(true)
    const t = setTimeout(() => {
      setShowPhotoHint(false)
      try { sessionStorage.setItem('odn:photoHintSeen', '1') } catch { /* ok */ }
    }, 2600)
    return () => clearTimeout(t)
  }, [stackIndex, room.id, photos.length])

  function dismissPhotoHint() {
    setShowPhotoHint(false)
    try { sessionStorage.setItem('odn:photoHintSeen', '1') } catch { /* ok */ }
  }
  function changePhoto(next: number) {
    setPhotoIdx(next)
    dismissPhotoHint()
  }

  useEffect(() => {
    if (!forcedDir) return
    // `exit` is intentionally NOT in deps. If it were, the setExit() below
    // would re-run this effect, which fires the cleanup → clearTimeout(t)
    // before the 240ms ever elapses, and onSwipe would never be called.
    // That's why the button-driven swipe got stuck after the first press.
    setExit(forcedDir)
    const t = setTimeout(() => onSwipe(forcedDir), 240)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcedDir, onSwipe])

  // Parent bumps resetSignal when a swipe was animated-out but the deck
  // didn't advance (login popup intercepted the like). Snap the card back so
  // the user can swipe again instead of staring at an empty stack.
  useEffect(() => {
    if (resetSignal == null) return
    setExit(null)
    setDrag(null)
    startRef.current = null
  }, [resetSignal])

  const interactive = stackIndex === 0 && !disabled && !exit

  function onPointerDown(e: React.PointerEvent) {
    if (!interactive) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() }
    setDrag({ x: 0, y: 0 })
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!startRef.current || !interactive) return
    const dx = e.clientX - startRef.current.x
    const dy = e.clientY - startRef.current.y
    setDrag({ x: dx, y: dy })
  }
  function endDrag(e?: React.PointerEvent) {
    if (!startRef.current) return
    const d = drag || { x: 0, y: 0 }
    startRef.current = null
    // Swipe-up = open detail. We require vertical motion to *dominate*
    // (|dy| > 1.2·|dx|) so a diagonal flick still resolves to a horizontal
    // like/pass — that's the dominant gesture and users shouldn't lose
    // their card by mistake when their thumb drifts upward.
    if (d.y < -110 && Math.abs(d.y) > Math.abs(d.x) * 1.2 && onOpen) {
      setDrag(null)
      onOpen()
    } else if (Math.abs(d.x) > 120) {
      const dir: 'like' | 'pass' = d.x > 0 ? 'like' : 'pass'
      setExit(dir)
      setTimeout(() => onSwipe(dir), 200)
    } else {
      setDrag(null)
    }
    e?.currentTarget?.releasePointerCapture?.(e.pointerId)
  }

  const x = drag?.x ?? 0
  const y = drag?.y ?? 0
  const rot = x / 16
  const likeOpacity = Math.max(0, Math.min(1, x / 120))
  const passOpacity = Math.max(0, Math.min(1, -x / 120))
  // Vertical stamp opacity is gated on vertical dominance — otherwise a
  // horizontal swipe with slight upward drift would flash "Chi tiết" too.
  const verticalDominant = Math.abs(y) > Math.abs(x) * 1.2
  const detailOpacity = verticalDominant ? Math.max(0, Math.min(1, -y / 110)) : 0

  let transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`
  let opacity = 1
  const z = 30 - stackIndex
  if (exit === 'like') { transform = 'translate(140%, -20%) rotate(28deg)'; opacity = 0 }
  if (exit === 'pass') { transform = 'translate(-140%, -20%) rotate(-28deg)'; opacity = 0 }
  if (stackIndex > 0) {
    const scale = 1 - stackIndex * 0.04
    const ty = stackIndex * 12
    transform = `translateY(${ty}px) scale(${scale})`
    opacity = stackIndex === 1 ? 0.92 : 0.78
    if (stackIndex >= 3) opacity = 0
  }

  const transitionClass = exit ? 'transition-transform duration-200' : drag ? '' : 'transition-transform duration-300'

  useEffect(() => {
    if (!interactive) return
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      if (e.key === 'ArrowRight' || e.key === 'l') { setExit('like'); setTimeout(() => onSwipe('like'), 180) }
      if (e.key === 'ArrowLeft' || e.key === 'h') { setExit('pass'); setTimeout(() => onSwipe('pass'), 180) }
      if (e.key === 'Enter' && onOpen) onOpen()
      if (e.key === 'ArrowUp') { setPhotoIdx((i) => Math.min(photos.length - 1, i + 1)); dismissPhotoHint() }
      if (e.key === 'ArrowDown') { setPhotoIdx((i) => Math.max(0, i - 1)); dismissPhotoHint() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interactive, onSwipe, onOpen, photos.length])

  return (
    <article
      className={`absolute inset-0 select-none touch-none ${transitionClass}`}
      style={{ transform, opacity, zIndex: z }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      aria-roledescription="Phòng trong stack quẹt"
      aria-label={room.title}
    >
      <div className="relative h-full w-full overflow-hidden rounded-[28px] bg-cream-50 shadow-card ring-1 ring-ink-900/10">
        <div className="relative h-full w-full overflow-hidden rounded-[28px] bg-ink-900">
          {/* Stamp overlays */}
          {(likeOpacity > 0 || exit === 'like') && (
            <span className="stamp stamp-like match-stamp" style={{ opacity: exit === 'like' ? 1 : likeOpacity }}>
              Hợp gu
            </span>
          )}
          {(passOpacity > 0 || exit === 'pass') && (
            <span className="stamp stamp-pass match-stamp" style={{ opacity: exit === 'pass' ? 1 : passOpacity }}>
              Hẹn bữa khác
            </span>
          )}
          {detailOpacity > 0 && (
            <span className="stamp stamp-detail match-stamp" style={{ opacity: detailOpacity }}>
              Chi tiết
            </span>
          )}

          {/* Photo. Fallback gradient sits behind the <img> so that, if a URL
              fails or hasn't loaded yet, users still see brand color rather
              than a black void. object-position keeps faces / focal points
              roughly centered on both portrait and landscape inputs. */}
          <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-cream-300 via-leaf-200 to-coral-200" />
          {photos[photoIdx] && (
            <img
              src={photos[photoIdx]}
              alt={`${room.title} — ảnh ${photoIdx + 1}`}
              draggable={false}
              // Behind cards stay eager (just deprioritised) so their first
              // photo is already in the disk cache when the deck advances —
              // lazy would defer the fetch until they scroll into view and
              // produce a 1s flash on every swipe.
              loading="eager"
              decoding="async"
              fetchPriority={stackIndex === 0 ? 'high' : 'low'}
              className="relative h-full w-full object-cover"
              style={{ objectPosition: '50% 35%' }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          )}

          {/* Top gradient — keeps the photo strip + counter legible even on
              very bright skies / white walls. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink-900/70 via-ink-900/25 to-transparent" />

          {/* Photo strip dots + counter — top */}
          {photos.length > 1 && (
            <div className="absolute top-3 left-3 right-3 flex items-center gap-2">
              <div className="flex flex-1 gap-1.5">
                {photos.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full transition ${i === photoIdx ? 'bg-white' : 'bg-white/35'}`}
                  />
                ))}
              </div>
              <span className="shrink-0 rounded-full bg-ink-900/55 px-2 py-0.5 text-[10px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-sm">
                {photoIdx + 1}/{photos.length}
              </span>
            </div>
          )}

          {/* Photo navigation — large invisible tap zones + visible chevrons. */}
          {photos.length > 1 && (
            <>
              <button
                aria-label="Ảnh trước"
                onClick={(e) => { e.stopPropagation(); changePhoto(Math.max(0, photoIdx - 1)) }}
                className="group absolute inset-y-14 left-0 z-10 w-1/3 cursor-pointer"
              >
                <span
                  aria-hidden
                  className={`pointer-events-none absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-ink-900/55 text-white ring-1 ring-white/25 backdrop-blur-sm transition ${photoIdx === 0 ? 'opacity-30' : 'opacity-95 group-hover:opacity-100 group-hover:bg-ink-900/70'}`}
                >
                  <Icon.ChevronLeft size={20} />
                </span>
              </button>
              <button
                aria-label="Ảnh sau"
                onClick={(e) => { e.stopPropagation(); changePhoto(Math.min(photos.length - 1, photoIdx + 1)) }}
                className="group absolute inset-y-14 right-0 z-10 w-1/3 cursor-pointer"
              >
                <span
                  aria-hidden
                  className={`pointer-events-none absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-ink-900/55 text-white ring-1 ring-white/25 backdrop-blur-sm transition ${photoIdx === photos.length - 1 ? 'opacity-30' : 'opacity-95 group-hover:opacity-100 group-hover:bg-ink-900/70'}`}
                >
                  <Icon.ChevronRight size={20} />
                </span>
              </button>
              {showPhotoHint && stackIndex === 0 && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-1/3 z-20 -translate-x-1/2 rounded-full bg-ink-900/85 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white shadow-card backdrop-blur-sm animate-fadeIn"
                >
                  Chạm hai bên để xem ảnh
                </div>
              )}
            </>
          )}

          {/* Bottom scrim — single soft band, just enough contrast for the
              compact info line. We deliberately keep it shallow so the photo
              dominates the card (the detail page already shows title, full
              amenity list, etc.). */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[28%] bg-gradient-to-t from-black/75 via-black/35 to-transparent"
          />
          <div
            className="absolute inset-x-0 bottom-0 px-4 pb-3 text-white sm:px-5 sm:pb-4"
            style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
          >
            {/* Single compact line: location · area · room type · price.
                Bigger title + amenity pills were removed by request — they
                were covering most of the photo. */}
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs sm:text-sm">
              <span className="inline-flex items-center gap-1">
                <Icon.MapPin size={12} className="text-white/80" />
                <span className="truncate font-medium">
                  {room.district}{room.ward ? ` · ${room.ward}` : ''}
                </span>
              </span>
              <span className="text-white/50">·</span>
              <span>{room.areaM2} m²</span>
              <span className="text-white/50">·</span>
              <span>{ROOM_TYPE_LABEL[room.roomType] || room.roomType}</span>
              <span className="text-white/50">·</span>
              <span className="font-display font-bold">
                {formatVND(room.priceVnd)}
                <span className="ml-0.5 text-[11px] font-medium text-white/85 sm:text-xs">/tháng</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
