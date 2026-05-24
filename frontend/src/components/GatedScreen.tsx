import type { ReactNode } from 'react'
import { Icon } from './Icon'

type Bullet = { emoji: string; text: string }
type PreviewItem = { emoji: string; title: string; sub: string }

export function GatedScreen({
  emoji,
  title,
  subtitle,
  bullets,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  tone = 'leaf',
  previewTitle,
  previewItems,
  footer,
}: {
  emoji: string
  title: string
  subtitle: string
  bullets: Bullet[]
  primaryLabel: string
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  tone?: 'leaf' | 'coral'
  previewTitle?: string
  previewItems?: PreviewItem[]
  footer?: ReactNode
}) {
  const accent = tone === 'coral' ? 'bg-coral-50 text-coral-500 ring-coral-100' : 'bg-leaf-50 text-leaf-700 ring-leaf-100'
  return (
    <div className="mx-auto max-w-2xl">
      <div className="card-soft relative overflow-hidden text-center">
        <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-leaf-100/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-coral-100/40 blur-3xl" aria-hidden />

        <div className={`relative mx-auto grid h-16 w-16 place-items-center rounded-3xl text-3xl ring-1 ${accent}`}>
          <span aria-hidden>{emoji}</span>
        </div>
        <h1 className="relative mt-4 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">{title}</h1>
        <p className="relative mt-1.5 text-sm text-ink-500 sm:text-base">{subtitle}</p>

        <ul className="relative mx-auto mt-6 grid max-w-md gap-2 text-left">
          {bullets.map((b) => (
            <li key={b.text} className="flex items-start gap-3 rounded-2xl bg-cream-100/80 px-4 py-3 text-sm text-ink-700 ring-1 ring-cream-200">
              <span aria-hidden className="text-base leading-6">{b.emoji}</span>
              <span>{b.text}</span>
            </li>
          ))}
        </ul>

        <div className="relative mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <button onClick={onPrimary} className="btn-leaf btn-lg w-full sm:w-auto">{primaryLabel}</button>
          {secondaryLabel && onSecondary && (
            <button onClick={onSecondary} className="btn-outline btn-pill w-full sm:w-auto">{secondaryLabel}</button>
          )}
        </div>

        {previewItems && previewItems.length > 0 && (
          <section className="relative mt-7 rounded-3xl bg-cream-100/60 p-4 text-left ring-1 ring-cream-300/60">
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow inline-flex items-center gap-1.5">
                <Icon.Sparkles size={11} />
                {previewTitle || 'Xem trước'}
              </p>
              <span className="pill pill-cream text-[10px]">Mô phỏng</span>
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {previewItems.map((p) => (
                <li
                  key={p.title}
                  className="flex items-start gap-3 rounded-2xl bg-white/85 px-3 py-2.5 ring-1 ring-cream-200"
                >
                  <span aria-hidden className="mt-0.5 text-lg leading-none">{p.emoji}</span>
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-semibold text-ink-900">{p.title}</p>
                    <p className="line-clamp-2 text-[12px] text-ink-500">{p.sub}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {footer && (
          <div className="relative mt-4 text-[12px] text-ink-500">{footer}</div>
        )}
      </div>
    </div>
  )
}
