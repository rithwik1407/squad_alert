import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Skeleton } from './components/ui';
import Landing from './pages/Landing';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Matches = lazy(() => import('./pages/Matches'));
const MatchForm = lazy(() => import('./pages/MatchForm'));
const MatchDetail = lazy(() => import('./pages/MatchDetail'));
const SquadSelect = lazy(() => import('./pages/SquadSelect'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Settings = lazy(() => import('./pages/Settings'));
const TeamPage = lazy(() => import('./pages/Team'));
const Stats = lazy(() => import('./pages/Stats'));
const Join = lazy(() => import('./pages/Join'));

function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-44" />
      <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
    </div>
  );
}

function Protected({ children, captain }: { children: ReactNode; captain?: boolean }) {
  const { user, loading, isCaptain } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="mx-auto max-w-5xl p-6"><Loading /></div>;
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
        <Route path="/join/:code?" element={<Join />} />
        <Route element={<Protected><Layout /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route path="matches" element={<Protected captain><Matches /></Protected>} />
          <Route path="matches/new" element={<Protected captain><MatchForm /></Protected>} />
          <Route path="matches/:id" element={<MatchDetail />} />
          <Route path="matches/:id/edit" element={<Protected captain><MatchForm /></Protected>} />
          <Route path="matches/:id/squad" element={<Protected captain><SquadSelect /></Protected>} />
          <Route path="team" element={<Protected captain><TeamPage /></Protected>} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="stats" element={<Stats />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
