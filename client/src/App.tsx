import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Button, Skeleton } from './components/ui';
import Landing from './pages/Landing';
import { WakingNote } from './components/WakingNote';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Matches = lazy(() => import('./pages/Matches'));
const MatchForm = lazy(() => import('./pages/MatchForm'));
const BulkMatchForm = lazy(() => import('./pages/BulkMatchForm'));
const MatchDetail = lazy(() => import('./pages/MatchDetail'));
const SquadSelect = lazy(() => import('./pages/SquadSelect'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Settings = lazy(() => import('./pages/Settings'));
const TeamPage = lazy(() => import('./pages/Team'));
const Stats = lazy(() => import('./pages/Stats'));
const Join = lazy(() => import('./pages/Join'));
const Scrims = lazy(() => import('./pages/Scrims'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const Classic = lazy(() => import('./pages/Classic'));
const Assistant = lazy(() => import('./pages/Assistant'));

function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-44" />
      <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
    </div>
  );
}

const AUTO_RETRY_SECONDS = 10;

function Unreachable({ onRetry }: { onRetry: () => void }) {
  // Keep trying on our own so nobody has to sit and tap "Try again" while the server wakes up.
  const [left, setLeft] = useState(AUTO_RETRY_SECONDS);
  useEffect(() => {
    const t = setInterval(() => setLeft((n) => {
      if (n > 1) return n - 1;
      onRetry();
      return AUTO_RETRY_SECONDS;
    }), 1000);
    return () => clearInterval(t);
  }, [onRetry]);
  return (
    <div className="mx-auto max-w-md p-6 pt-24 text-center">
      <h1 className="text-lg font-semibold text-white">Can't reach the server yet</h1>
      <p className="mt-2 text-sm text-zinc-400">It may be busy or waking up. You are still signed in. Trying again in {left}s.</p>
      <Button className="mt-5" onClick={() => { setLeft(AUTO_RETRY_SECONDS); onRetry(); }}>Try now</Button>
    </div>
  );
}

function Protected({ children, captain }: { children: ReactNode; captain?: boolean }) {
  const { user, loading, unreachable, refresh, isCaptain } = useAuth();
  const loc = useLocation();
  const retry = useCallback(() => void refresh(), [refresh]);
  if (loading) return <div className="mx-auto max-w-5xl p-6"><WakingNote active className="mb-4" /><Loading /></div>;
  // A busy server is not the same as signed out: don't bounce people to the sign-in page for it.
  if (unreachable) return <Unreachable onRetry={retry} />;
  if (!user) return <Navigate to="/welcome" state={{ from: loc.pathname }} replace />;
  if (!user.teamId && !loc.pathname.startsWith('/join') && !loc.pathname.startsWith('/settings')) return <Navigate to="/join" replace />;
  if (captain && !isCaptain) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl p-6"><Loading /></div>}>
      <Routes>
        <Route path="/welcome" element={<Landing />} />
        <Route path="/join/*" element={<Join />} />
        <Route element={<Protected><Layout /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route path="matches" element={<Protected captain><Matches /></Protected>} />
          <Route path="matches/new" element={<Protected captain><MatchForm /></Protected>} />
          <Route path="matches/bulk" element={<Protected captain><BulkMatchForm /></Protected>} />
          <Route path="matches/:id" element={<MatchDetail />} />
          <Route path="matches/:id/edit" element={<Protected captain><MatchForm /></Protected>} />
          <Route path="matches/:id/squad" element={<Protected captain><SquadSelect /></Protected>} />
          <Route path="team" element={<Protected captain><TeamPage /></Protected>} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="stats" element={<Stats />} />
          <Route path="scrims" element={<Scrims />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="classic/:id" element={<Classic />} />
          <Route path="ai" element={<Assistant />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
