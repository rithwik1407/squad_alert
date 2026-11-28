import { Suspense, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { motion } from 'framer-motion';
import { scrollTopNow } from '@/lib/smoothScroll';
import { ErrorBoundary } from './ErrorBoundary';
import { Bell, BookUser, CalendarClock, CalendarDays, Home, LogOut, Medal, Settings, Sparkles, Users, BarChart3 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useJoinRequests } from '@/lib/useJoinRequests';
import { useInbox } from '@/lib/useInbox';
import { useLiveSync } from '@/lib/useLiveSync';
import { aiStore, useAi } from '@/lib/aiStore';
import { Avatar, cx, Skeleton } from './ui';
import { Logo } from './Logo';
import { Crest } from './Crest';
import { TeamChat } from './TeamChat';

export function Layout() {
  const { user, team, isCaptain, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const navType = useNavigationType();
  // New page starts at the top (the old scroll position made pages open half-way down on mobile). Back/forward keeps the browser's position.
  useEffect(() => {
    if (navType !== 'POP') scrollTopNow();
  }, [loc.pathname, navType]);
  // Teammates' changes (slots, results, squads, check-ins) show up without a refresh.
  useLiveSync(Boolean(team));
  const { requests } = useJoinRequests();
  const wide = loc.pathname === '/ai';
  // A Squad AI answer finished while you were on another page.
  const { ready: aiReady, busy: aiBusy } = useAi();
  // Load the saved Squad AI chat once, so an answer still running on the server re-attaches and lights the dot.
  useEffect(() => { void aiStore.init(); }, []);
  const unread = useInbox().data?.unread ?? 0;
  const badges: Record<string, number> = { '/team': requests.length, '/notifications': unread };
  type Item = { to: string; label: string; icon: typeof Home };
  // Desktop sidebar: every page, as before. Scrims opens the Scrims side of the Calendar tab.
  const items: Item[] = isCaptain
    ? [
        { to: '/', label: 'Home', icon: Home },
        { to: '/matches', label: 'Matches', icon: CalendarClock },
        { to: '/calendar', label: 'Calendar', icon: CalendarDays },
        { to: '/ai', label: 'Squad AI', icon: Sparkles },
        { to: '/calendar?view=scrims', label: 'Scrims', icon: BookUser },
        { to: '/challenges', label: 'Challenges', icon: Medal },
        { to: '/team', label: 'Team', icon: Users },
        { to: '/notifications', label: 'Inbox', icon: Bell },
        { to: '/settings', label: 'Settings', icon: Settings },
      ]
    : [
        { to: '/', label: 'Home', icon: Home },
        { to: '/stats', label: 'Stats', icon: BarChart3 },
        { to: '/calendar', label: 'Calendar', icon: CalendarDays },
        { to: '/ai', label: 'Squad AI', icon: Sparkles },
        { to: '/calendar?view=scrims', label: 'Scrims', icon: BookUser },
        { to: '/challenges', label: 'Challenges', icon: Medal },
        { to: '/notifications', label: 'Inbox', icon: Bell },
        { to: '/settings', label: 'Settings', icon: Settings },
      ];
  // Phone bar: 4 tabs for players, 5 for the captain. Calendar holds Scrims too; Squad AI and Settings sit in the top bar.
  const phoneItems: Item[] = isCaptain
    ? [
        { to: '/', label: 'Home', icon: Home },
        { to: '/matches', label: 'Matches', icon: CalendarClock },
        { to: '/calendar', label: 'Calendar', icon: CalendarDays },
        { to: '/team', label: 'Team', icon: Users },
        { to: '/notifications', label: 'Inbox', icon: Bell },
      ]
    : [
        { to: '/', label: 'Home', icon: Home },
        { to: '/calendar', label: 'Calendar', icon: CalendarDays },
        { to: '/stats', label: 'Stats', icon: BarChart3 },
        { to: '/notifications', label: 'Inbox', icon: Bell },
      ];
  const scrimsView = loc.pathname === '/calendar' && new URLSearchParams(loc.search).get('view') === 'scrims';
  /** NavLink only looks at the path, so tell Calendar and Scrims apart by ?view in the sidebar. */
  const sideActive = (to: string, pathActive: boolean) =>
    to === '/calendar' ? pathActive && !scrimsView : to.startsWith('/calendar?') ? scrimsView : pathActive;
  const badgeText = (n: number) => (n > 9 ? '9+' : String(n));

  return (
    <div className="min-h-screen lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] btn-primary">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/[0.06] bg-ink-900 p-5 lg:flex">
        <Logo />
        {team && (
          <div className="glass mt-6 flex items-center gap-3 overflow-hidden p-3">
            <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-ember-500/20 blur-2xl" />
            <Crest size={44} className="relative" glow={false} />
            <div className="relative min-w-0">
              <p className="font-display text-[10px] font-bold uppercase tracking-[0.24em] text-ember-400">Team</p>
              <p className="truncate font-display text-lg font-bold uppercase leading-tight text-white">{team.name}</p>
            </div>
          </div>
        )}
        <nav className="mt-6 flex flex-1 flex-col gap-1" aria-label="Main">
          {items.map(({ to, label, icon: I }) => (
            <NavLink key={to} to={to} end={to === '/'} className="group relative rounded-xl">
              {({ isActive: pathActive }) => { const isActive = sideActive(to, pathActive); return (
                <span className={cx('relative z-10 flex items-center gap-3 rounded-md px-3 py-2.5 font-display text-[15px] font-bold uppercase tracking-wider transition-colors', isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-100')}>
                  {isActive && (
                    <motion.span layoutId="side-active" className="absolute inset-0 -z-10 rounded-md bg-gradient-to-r from-ember-500/25 via-ember-500/[0.06] to-transparent" transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
                      <span className="absolute inset-y-1.5 left-0 w-[3px] bg-ember-400 shadow-glow" />
                    </motion.span>
                  )}
                  <I className={cx('h-[18px] w-[18px] transition-[color,transform] duration-200', isActive ? 'text-ember-400' : 'group-hover:translate-x-0.5')} aria-hidden />
                  {label}
                  {badges[to] ? <span className="ml-auto rounded-full bg-ember-500 px-2 py-0.5 text-[10px] font-bold text-ink-950" aria-label={`${badges[to]} new`}>{badgeText(badges[to])}</span> : null}
                  {to === '/ai' && <AiDot ready={aiReady} busy={aiBusy && !isActive} className="ml-auto" />}
                </span>
              ); }}
            </NavLink>
          ))}
        </nav>
        {user && (
          <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] p-2.5">
            <Avatar name={user.ign} src={user.avatar} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{user.ign}</p>
              <p className="text-xs capitalize text-zinc-500">{user.role}</p>
            </div>
            <button aria-label="Sign out" className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              onClick={async () => { await logout(); nav('/welcome'); }}>
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </aside>

      {/* Mobile top bar */}
      <div data-topbar className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.05] bg-ink-950/90 px-4 py-3 backdrop-blur-md lg:hidden" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <Logo compact />
        <div className="flex items-center gap-2">
          {team && <span className="font-display text-sm font-bold tracking-wider text-zinc-300">{team.name}</span>}
          {/* Squad AI and Settings live up here so the bottom bar stays at 4-5 tabs. */}
          <NavLink to="/ai" aria-label="Squad AI" className={({ isActive }) => cx('relative grid h-10 w-10 place-items-center rounded-lg transition-colors', isActive ? 'bg-ember-500/15 text-ember-400' : 'text-zinc-400 hover:bg-white/5 hover:text-white')}>
            <Sparkles className="h-5 w-5" aria-hidden />
            <AiDot ready={aiReady} busy={aiBusy && !wide} className="absolute right-1.5 top-1.5" />
          </NavLink>
          <NavLink to="/settings" aria-label="Settings" className={({ isActive }) => cx('grid h-10 w-10 place-items-center rounded-lg transition-colors', isActive ? 'bg-ember-500/15 text-ember-400' : 'text-zinc-400 hover:bg-white/5 hover:text-white')}>
            {({ isActive }) => user?.avatar
              ? <span className={cx('rounded-full p-[2px] ring-1', isActive ? 'ring-ember-400' : 'ring-white/15')}><Avatar name={user.ign} src={user.avatar} size={26} /></span>
              : <Settings className={cx('h-5 w-5 transition-transform duration-300', isActive && 'rotate-45')} aria-hidden />}
          </NavLink>
        </div>
      </div>

      <main id="main" className={cx('mx-auto px-4', wide ? 'max-w-[1480px]' : 'max-w-6xl', ' pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10')}>
        {/* Enter-only page transition (opacity + transform). No exit/wait phase, so a lazy page can never get stuck invisible. */}
        <ErrorBoundary resetKey={loc.pathname}>
          <Suspense fallback={<PageSkeleton />}>
            <motion.div key={loc.pathname} initial={{ opacity: 0, y: 18, scale: 0.985, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none', transform: 'none' } }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
              <Outlet />
            </motion.div>
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* The AI page has its own chat box in the same corner. */}
      {!wide && <TeamChat />}

      {/* Mobile bottom nav */}
      <nav data-bottomnav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-ink-900/95 backdrop-blur-md lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <ul className="mx-auto flex max-w-lg justify-around px-1">
          {phoneItems.map(({ to, label, icon: I }) => (
            <li key={to} className="min-w-0 flex-1">
              <NavLink to={to} end={to === '/'} className="relative flex min-h-[56px] flex-col items-center justify-center gap-1 py-2 transition-transform duration-150 active:scale-90">
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="bottom-active" className="absolute top-0 h-[3px] w-10 bg-ember-400 shadow-glow [clip-path:polygon(4px_0,100%_0,calc(100%-4px)_100%,0_100%)]" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <motion.span className="relative" animate={{ scale: isActive ? 1.12 : 1, y: isActive ? -1 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
                      <I className={cx('h-[22px] w-[22px] transition-colors duration-200', isActive ? 'text-ember-400' : 'text-zinc-500')} aria-hidden />
                      {badges[to] ? <span className="absolute -right-3 -top-1.5 min-w-[16px] rounded-full bg-ember-500 px-1 text-center text-[9px] font-bold leading-4 text-ink-950 ring-2 ring-ink-900" aria-label={`${badges[to]} new`}>{badgeText(badges[to])}</span> : null}
                    </motion.span>
                    <span className={cx('whitespace-nowrap font-display text-[11px] font-bold uppercase tracking-wide transition-colors duration-200', isActive ? 'text-white' : 'text-zinc-500')}>{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** Glowing dot on the Squad AI nav: pulsing while an answer is being worked on, solid when it's ready. */
function AiDot({ ready, busy, className }: { ready: boolean; busy: boolean; className?: string }) {
  if (!ready && !busy) return null;
  return (
    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 24 }}
      className={cx('relative flex h-2.5 w-2.5', className)} role="status" aria-label={ready ? 'Squad AI answer ready' : 'Squad AI is working'}>
      <span className={cx('absolute inset-0 rounded-full', ready ? 'animate-ping bg-emerald-400/70' : 'animate-pulse-glow bg-ember-400/60')} />
      <span className={cx('relative h-2.5 w-2.5 rounded-full', ready ? 'bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,.7)]' : 'bg-ember-400 shadow-[0_0_8px_2px_rgb(var(--ember-500)/.6)]')} />
    </motion.span>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-44" />
      <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
    </div>
  );
}
