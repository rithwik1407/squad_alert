import { Suspense, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ErrorBoundary } from './ErrorBoundary';
import { Bell, BookUser, CalendarClock, CalendarDays, Home, LogOut, Settings, Sparkles, Users, BarChart3 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useJoinRequests } from '@/lib/useJoinRequests';
import { Avatar, cx, Skeleton } from './ui';
import { Logo } from './Logo';
import { TeamChat } from './TeamChat';

export function Layout() {
  const { user, team, isCaptain, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const navType = useNavigationType();
  // New page starts at the top (the old scroll position made pages open half-way down on mobile). Back/forward keeps the browser's position.
  useEffect(() => {
    if (navType !== 'POP') window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [loc.pathname, navType]);
  const { requests } = useJoinRequests();
  const wide = loc.pathname === '/ai';
  const badges: Record<string, number> = { '/team': requests.length };
  // The captain's phone bar is already full, so Calendar sits in the top bar there instead (phoneBar: false).
  const items: { to: string; label: string; icon: typeof Home; phoneBar?: boolean }[] = isCaptain
    ? [
        { to: '/', label: 'Home', icon: Home },
        { to: '/matches', label: 'Matches', icon: CalendarClock },
        { to: '/calendar', label: 'Calendar', icon: CalendarDays, phoneBar: false },
        { to: '/ai', label: 'Squad AI', icon: Sparkles, phoneBar: false },
        { to: '/scrims', label: 'Scrims', icon: BookUser },
        { to: '/team', label: 'Team', icon: Users },
        { to: '/notifications', label: 'Alerts', icon: Bell },
        { to: '/settings', label: 'Settings', icon: Settings },
      ]
    : [
        { to: '/', label: 'Home', icon: Home },
        { to: '/stats', label: 'Stats', icon: BarChart3 },
        { to: '/calendar', label: 'Calendar', icon: CalendarDays },
        { to: '/ai', label: 'Squad AI', icon: Sparkles, phoneBar: false },
        { to: '/scrims', label: 'Scrims', icon: BookUser },
        { to: '/notifications', label: 'Inbox', icon: Bell },
        { to: '/settings', label: 'Settings', icon: Settings },
      ];

  return (
    <div className="min-h-screen lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] btn-primary">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/[0.06] bg-ink-900 p-5 lg:flex">
        <Logo />
        {team && (
          <div className="glass mt-6 flex items-center gap-3 overflow-hidden p-3">
            <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-ember-500/20 blur-2xl" />
            <img src="/icons/logo.png" alt="" width={40} height={40} className="relative rounded-md ring-1 ring-ember-400/30" />
            <div className="relative min-w-0">
              <p className="font-display text-[10px] font-bold uppercase tracking-[0.24em] text-ember-400">Team</p>
              <p className="truncate font-display text-lg font-bold uppercase leading-tight text-white">{team.name}</p>
            </div>
          </div>
        )}
        <nav className="mt-6 flex flex-1 flex-col gap-1" aria-label="Main">
          {items.map(({ to, label, icon: I }) => (
            <NavLink key={to} to={to} end={to === '/'} className="group relative rounded-xl">
              {({ isActive }) => (
                <span className={cx('relative z-10 flex items-center gap-3 rounded-md px-3 py-2.5 font-display text-[15px] font-bold uppercase tracking-wider transition-colors', isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-100')}>
                  {isActive && (
                    <motion.span layoutId="side-active" className="absolute inset-0 -z-10 rounded-md bg-gradient-to-r from-ember-500/25 via-ember-500/[0.06] to-transparent" transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
                      <span className="absolute inset-y-1.5 left-0 w-[3px] bg-ember-400 shadow-glow" />
                    </motion.span>
                  )}
                  <I className={cx('h-[18px] w-[18px] transition-[color,transform] duration-200', isActive ? 'text-ember-400' : 'group-hover:translate-x-0.5')} aria-hidden />
                  {label}
                  {badges[to] ? <span className="ml-auto rounded-full bg-ember-500 px-2 py-0.5 text-[10px] font-bold text-ink-950" aria-label={`${badges[to]} waiting`}>{badges[to]}</span> : null}
                </span>
              )}
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
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.05] bg-ink-950/90 px-4 py-3 backdrop-blur-md lg:hidden" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <Logo compact />
        <div className="flex items-center gap-2">
          {team && <span className="font-display text-sm font-bold tracking-wider text-zinc-300">{team.name}</span>}
          {/* The phone bar is full, so Squad AI lives in the top bar. */}
          <NavLink to="/ai" aria-label="Squad AI" className={({ isActive }) => cx('relative rounded-lg p-2 transition-colors', isActive ? 'bg-ember-500/15 text-ember-400' : 'text-zinc-400 hover:bg-white/5 hover:text-white')}>
            <Sparkles className="h-5 w-5" aria-hidden />
          </NavLink>
          {isCaptain && (
            <NavLink to="/calendar" aria-label="Calendar" className={({ isActive }) => cx('rounded-lg p-2 transition-colors', isActive ? 'bg-ember-500/15 text-ember-400' : 'text-zinc-400 hover:bg-white/5 hover:text-white')}>
              <CalendarDays className="h-5 w-5" aria-hidden />
            </NavLink>
          )}
        </div>
      </div>

      <main id="main" className={cx('mx-auto px-4', wide ? 'max-w-[1480px]' : 'max-w-6xl', ' pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10')}>
        {/* Enter-only page transition (opacity + transform). No exit/wait phase, so a lazy page can never get stuck invisible. */}
        <ErrorBoundary resetKey={loc.pathname}>
          <Suspense fallback={<PageSkeleton />}>
            <motion.div key={loc.pathname} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}>
              <Outlet />
            </motion.div>
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* The AI page has its own chat box in the same corner. */}
      {!wide && <TeamChat />}

      {/* Mobile bottom nav */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-ink-900/95 backdrop-blur-md lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <ul className="mx-auto flex max-w-lg justify-around px-2">
          {items.filter((i) => i.phoneBar !== false).map(({ to, label, icon: I }) => (
            <li key={to} className="flex-1">
              <NavLink to={to} end={to === '/'} className="relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-transform duration-150 active:scale-90">
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="bottom-active" className="absolute top-0 h-[3px] w-10 bg-ember-400 shadow-glow [clip-path:polygon(4px_0,100%_0,calc(100%-4px)_100%,0_100%)]" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <motion.span className="relative" animate={{ scale: isActive ? 1.12 : 1, y: isActive ? -1 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
                      <I className={cx('h-5 w-5 transition-colors duration-200', isActive ? 'text-ember-400' : 'text-zinc-500')} aria-hidden />
                      {badges[to] ? <span className="absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-ember-500 px-1 text-center text-[9px] font-bold leading-4 text-ink-950" aria-label={`${badges[to]} waiting`}>{badges[to]}</span> : null}
                    </motion.span>
                    <span className={cx('font-display text-[11px] font-bold uppercase tracking-wider transition-colors duration-200', isActive ? 'text-white' : 'text-zinc-500')}>{label}</span>
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

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-44" />
      <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
    </div>
  );
}
