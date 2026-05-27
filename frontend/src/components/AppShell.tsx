import { type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import {
  goAbout, goAdmin, goDiscover, goFeedback, goInbox, goOwner, goPost, goProfile, goSaved, useRoute,
} from '../lib/router'
import { Icon } from './Icon'

export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const route = useRoute()

  function need(intent: string, ifOk: () => void) {
    if (auth.user) ifOk()
    else auth.openPopup(intent)
  }

  // App-like viewport-lock kicks in at md+ on the swipe deck so the deck +
  // action buttons stay above the fold on every tablet/desktop size. Phones
  // (<md) keep page-scroll behaviour for natural touch interaction. Other
  // pages always page-scroll because their content is intentionally long.
  const lockToViewport = route.name === 'discover'

  return (
    <div className={`flex min-h-screen flex-col ${lockToViewport ? 'md:h-screen md:min-h-0 md:overflow-hidden' : ''}`}>
      <header className="sticky top-0 z-30 border-b border-ink-900/[0.06] bg-cream-100/85 backdrop-blur-xl">
        {/* 3-column grid: logo pinned far left, nav centered inside the
            max-w-7xl content track (matches the swipe deck's centerline),
            actions pinned far right. The side columns are `minmax(0,1fr)`
            so they share remaining space equally, which is what keeps the
            middle (auto-sized) nav optically centered regardless of how
            wide the logo or actions get. Each child explicitly sets its
            `col-start-*` because the nav uses `display:none` on phones —
            a hidden grid child is skipped by auto-placement, so without
            explicit columns the actions would slide into column 2. */}
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
          <button
            onClick={() => goDiscover()}
            className="col-start-1 flex shrink-0 cursor-pointer items-center gap-2.5 justify-self-start"
            aria-label="Về trang quẹt phòng"
          >
            <span className="relative block h-11 w-11 shrink-0 overflow-hidden rounded-2xl bg-cream-50 shadow-soft ring-1 ring-ink-900/[0.04] sm:h-12 sm:w-12">
              <img
                src="/logo-odayne.png"
                alt="Ở Đây Nè"
                width={48}
                height={48}
                className="h-full w-full object-cover"
                loading="eager"
                decoding="async"
              />
            </span>
            <div className="text-left leading-tight">
              <p className="whitespace-nowrap font-display text-base font-extrabold sm:text-[1.05rem]">
                <span className="text-coral-400">Ở</span>{' '}
                <span className="text-leaf-500">Đây</span>{' '}
                <span className="text-coral-400">Nè</span>
              </p>
              {/* Subtitle only on large screens — keeps header tight on tablet
                  where top nav items already compete for space. */}
              <p className="hidden whitespace-nowrap text-[11px] text-ink-500 lg:block">Quẹt là thấy nhà — Hà Nội của bạn</p>
            </div>
          </button>

          {/* Top nav appears from md (tablet) up; phones use the bottom tab
              bar instead. On md we trim long labels via responsive show/hide
              spans so the nav fits within the available header width. The
              parent grid centers this nav inside the max-w-7xl track, so it
              lines up with the swipe deck centerline regardless of how wide
              the logo or actions get. */}
          <nav className="col-start-2 hidden flex-nowrap items-center gap-0.5 justify-self-center text-sm font-medium text-ink-700 md:flex lg:gap-1">
            <NavItem
              active={route.name === 'discover'}
              onClick={() => goDiscover()}
              icon={<Icon.Compass size={16} />}
            >
              Quẹt
            </NavItem>
            <NavItem
              active={route.name === 'saved'}
              onClick={() => need('save', () => goSaved())}
              icon={<Icon.Heart size={16} />}
              locked={!auth.user}
            >
              Hợp gu
            </NavItem>
            <NavItem
              active={route.name === 'post'}
              onClick={() => need('post', () => goPost())}
              icon={<Icon.Plus size={16} />}
            >
              <span className="lg:hidden">Đăng</span>
              <span className="hidden lg:inline">Đăng phòng</span>
            </NavItem>
            {auth.user && (
              <NavItem
                active={route.name === 'owner'}
                onClick={() => goOwner()}
                icon={<Icon.Home size={16} />}
              >
                <span className="lg:hidden">Của tôi</span>
                <span className="hidden lg:inline">Phòng của tôi</span>
              </NavItem>
            )}
            <NavItem
              active={route.name === 'feedback'}
              onClick={() => goFeedback()}
              icon={<Icon.Sparkles size={16} />}
            >
              <span className="lg:hidden">Góp ý</span>
              <span className="hidden lg:inline">Giới thiệu & góp ý</span>
            </NavItem>
            {auth.user?.isAdmin && (
              <NavItem
                active={route.name === 'admin'}
                onClick={() => goAdmin()}
                icon={<Icon.Shield size={16} />}
              >
                <span className="lg:hidden">Quản trị</span>
                <span className="hidden lg:inline">Quản trị</span>
              </NavItem>
            )}
          </nav>

          {auth.ready && (
            auth.user ? (
              <div className="col-start-3 flex shrink-0 flex-nowrap items-center gap-2 justify-self-end">
                <button
                  onClick={() => goInbox()}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-cream-200/80 px-2.5 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-ink-900/[0.04] transition hover:bg-cream-300 sm:px-3"
                  title="Hoạt động & thông báo"
                  aria-current={route.name === 'inbox' ? 'page' : undefined}
                >
                  <Icon.Sparkles size={14} />
                  <span className="hidden lg:inline">Hoạt động</span>
                </button>
                <button
                  onClick={() => goProfile()}
                  className="hidden max-w-[14rem] cursor-pointer items-center gap-2 rounded-full bg-cream-200/80 px-3 py-1.5 text-left leading-tight ring-1 ring-ink-900/[0.04] transition hover:bg-cream-300 lg:flex"
                  title="Hồ sơ của tôi"
                  aria-current={route.name === 'profile' ? 'page' : undefined}
                >
                  {auth.user.avatar ? (
                    <img src={auth.user.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-leaf-500 font-display text-[12px] font-bold text-white">
                      {(auth.user.name || '?').charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink-900">{auth.user.name}</span>
                    {auth.user.isAdmin && (
                      <span className="block truncate text-[11px] text-coral-500">Admin</span>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => goProfile()}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-cream-200/80 px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-ink-900/[0.04] transition hover:bg-cream-300 lg:hidden"
                  title="Hồ sơ"
                  aria-current={route.name === 'profile' ? 'page' : undefined}
                >
                  <Icon.Settings size={14} />
                </button>
                <button
                  onClick={() => auth.logout()}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-cream-200/80 px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-ink-900/[0.04] transition hover:bg-cream-300"
                  title="Đăng xuất"
                >
                  <Icon.LogOut size={14} />
                  <span className="hidden lg:inline">Thoát</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => auth.openPopup('save')}
                className="btn-leaf btn-pill col-start-3 shrink-0 justify-self-end"
              >
                Đăng nhập
              </button>
            )
          )}
        </div>
      </header>

      {/* Main content. Bottom padding reserves room for the fixed phone tab
          bar. On the Discover route we lock main to flex-fill + overflow at
          md+ so the swipe deck always fits the viewport on tablet/desktop.
          Discover also widens beyond max-w-7xl on 2xl so the rails/card use
          the empty horizontal space on ultra-wide screens instead of
          leaving 300+px of cream margin on each side. */}
      <main
        className={`mx-auto w-full flex-1 px-3 pb-24 pt-3 sm:px-6 sm:pb-8 sm:pt-6 ${
          lockToViewport
            ? 'max-w-7xl 2xl:max-w-[100rem] md:min-h-0 md:overflow-hidden md:pb-6 md:pt-4 lg:pt-5'
            : 'max-w-7xl'
        }`}
      >
        {children}
      </main>

      <footer className={`mt-8 border-t border-ink-900/[0.06] bg-cream-100/60 ${lockToViewport ? 'hidden' : 'hidden md:block'}`}>
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-8 w-8 shrink-0 overflow-hidden rounded-md bg-cream-50 ring-1 ring-ink-900/[0.04]">
              <img
                src="/logo-odayne.png"
                alt=""
                width={32}
                height={32}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </span>
            <p>© {new Date().getFullYear()} Ở Đây Nè · Quẹt tìm phòng trọ Hà Nội thông minh hơn</p>
          </div>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button onClick={() => goAbout()} className="hover:text-ink-800">Cách hoạt động</button>
            <button onClick={() => goAbout()} className="hover:text-ink-800">An toàn & FAQ</button>
            <button onClick={() => goFeedback()} className="hover:text-ink-800">Giới thiệu & góp ý</button>
            {auth.user && (
              <button onClick={() => goProfile()} className="hover:text-ink-800">Hồ sơ</button>
            )}
            <span className="text-ink-400">Phòng thật, người thật, ảnh thật — làm tại Hà Nội.</span>
          </nav>
        </div>
      </footer>

      <MobileTabs route={route} authOpen={() => auth.openPopup('save')} user={!!auth.user} isAdmin={!!auth.user?.isAdmin} />
    </div>
  )
}

function MobileTabs({ route, user, isAdmin, authOpen }: {
  route: ReturnType<typeof useRoute>
  user: boolean
  isAdmin: boolean
  authOpen: () => void
}) {
  const cols = isAdmin ? 'grid-cols-6' : 'grid-cols-5'
  return (
    <nav
      // Phones (and small tablets up to 767px) get the bottom tab bar; from
      // md (768px) onward the top nav takes over.
      className="fixed bottom-0 left-0 z-30 border-t border-ink-900/[0.06] bg-cream-100/95 backdrop-blur-xl pb-safe md:hidden"
      style={{ width: '100dvw' }}
      aria-label="Thanh điều hướng chính"
    >
      <div className={`mx-auto grid ${cols} text-xs`}>
        <TabBtn active={route.name === 'discover'} onClick={() => (location.hash = '/')} label="Quẹt" icon={<Icon.Compass size={20} />} />
        <TabBtn active={route.name === 'saved'} onClick={() => { if (user) location.hash = '/saved'; else authOpen() }} label="Hợp gu" icon={<Icon.Heart size={20} />} />
        <TabBtn active={route.name === 'post'} onClick={() => { if (user) location.hash = '/post'; else authOpen() }} label="Đăng" icon={<Icon.Plus size={20} />} />
        <TabBtn active={route.name === 'owner'} onClick={() => { if (user) location.hash = '/owner'; else authOpen() }} label="Của tôi" icon={<Icon.Home size={20} />} />
        <TabBtn active={route.name === 'feedback'} onClick={() => (location.hash = '/feedback')} label="Góp ý" icon={<Icon.Sparkles size={20} />} />
        {isAdmin && (
          <TabBtn active={route.name === 'admin'} onClick={() => (location.hash = '/admin')} label="Quản trị" icon={<Icon.Shield size={20} />} />
        )}
      </div>
    </nav>
  )
}

function TabBtn({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex cursor-pointer flex-col items-center gap-1 py-2.5 font-medium transition ${active ? 'text-leaf-700' : 'text-ink-500 hover:text-ink-800'}`}
    >
      {active && (
        <span aria-hidden className="absolute inset-x-7 top-0 h-0.5 rounded-full bg-leaf-500" />
      )}
      <span className={active ? 'text-leaf-700' : 'text-ink-400'}>{icon}</span>
      <span className="whitespace-nowrap text-[11px]">{label}</span>
    </button>
  )
}

function NavItem({ active, onClick, icon, locked, children }: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  locked?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1.5 text-sm font-medium transition lg:px-3
        ${active
          ? 'bg-leaf-500 text-white shadow-soft'
          : 'text-ink-700 hover:bg-cream-200/80'}`}
    >
      <span className={active ? 'text-white' : 'text-ink-500'}>{icon}</span>
      <span className="whitespace-nowrap">{children}</span>
      {locked && !active && (
        <span aria-hidden className="ml-0.5 text-[10px] text-ink-400">●</span>
      )}
    </button>
  )
}

