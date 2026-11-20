import { Suspense } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ErrorBoundary } from './ErrorBoundary';
import { Bell, CalendarClock, Home, LogOut, Settings, Users, BarChart3 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useJoinRequests } from '@/lib/useJoinRequests';
import { Avatar, cx, Skeleton } from './ui';
import { Logo } from './Logo';
import { TeamChat } from './TeamChat';

export function Layout() {
  const { user, team, isCaptain, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const { requests } = useJoinRequests();
  const badges: Record<string, number> = { '/team': requests.length };
  const items = isCaptain
    ? [
        { to: '/', label: 'Home', icon: Home },
        { to: '/matches', label: 'Matches', icon: CalendarClock },
        { to: '/team', label: 'Team', icon: Users },
        { to: '/notifications', label: 'Alerts', icon: Bell },
        { to: '/settings', label: 'Settings', icon: Settings },
      ]
    : [
        { to: '/', label: 'Home', icon: Home },
        { to: '/stats', label: 'Stats', icon: BarChart3 },
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
          <div className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Team</p>
            <p className="font-display text-lg font-bold text-white">{team.name}</p>
          </div>
        )}
        <nav className="mt-6 flex flex-1 flex-col gap-1" aria-label="Main">
          {items.map(({ to, label, icon: I }) => (
            <NavLink key={to} to={to} end={to === '/'} className="relative">
              {({ isActive }) => (
                <span className={cx('relative z-10 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors', isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-100')}>
                  {isActive && (
                    <motion.span layoutId="side-active" className="absolute inset-0 -z-10 rounded-xl bg-gradient-to-r from-ember-500/20 to-transparent ring-1 ring-ember-400/25" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />
                  )}
                  <I className={cx('h-[18px] w-[18px]', isActive && 'text-ember-400')} aria-hidden />
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
        {team && <span className="font-display text-sm font-bold tracking-wider text-zinc-300">{team.name}</span>}
      </div>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
        {/* Enter-only page transition (opacity + transform). No exit/wait phase, so a lazy page can never get stuck invisible. */}
        <ErrorBoundary resetKey={loc.pathname}>
          <Suspense fallback={<PageSkeleton />}>
            <motion.div key={loc.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
              <Outlet />
            </motion.div>
          </Suspense>
        </ErrorBoundary>
      </main>

      <TeamChat />

      {/* Mobile bottom nav */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-ink-900/95 backdrop-blur-md lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <ul className="mx-auto flex max-w-lg justify-around px-2">
          {items.map(({ to, label, icon: I }) => (
            <li key={to} className="flex-1">
              <NavLink to={to} end={to === '/'} className="relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium">
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="bottom-active" className="absolute top-0 h-0.5 w-8 rounded-full bg-ember-400 shadow-glow" />}
                    <motion.span className="relative" animate={{ scale: isActive ? 1.12 : 1, y: isActive ? -1 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
                      <I className={cx('h-5 w-5', isActive ? 'text-ember-400' : 'text-zinc-500')} aria-hidden />
                      {badges[to] ? <span className="absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-ember-500 px-1 text-center text-[9px] font-bold leading-4 text-ink-950" aria-label={`${badges[to]} waiting`}>{badges[to]}</span> : null}
                    </motion.span>
                    <span className={isActive ? 'text-white' : 'text-zinc-500'}>{label}</span>
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
