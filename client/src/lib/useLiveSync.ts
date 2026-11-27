import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** How often an open, visible app asks whether anything changed. The answer is a few bytes. */
const PULSE_MS = 8_000;

/** Team data that should follow teammates' changes. Chat, inbox and invites poll on their own. */
const LIVE_KEYS = new Set(['matches', 'match', 'calendar', 'teamstats', 'mystats', 'checkin', 'report', 'screenshot', 'scrims', 'session', 'logs', 'notifications']);

/**
 * Real-time feel without sockets: poll the team's revision while the app is on screen, and when it moves
 * (a teammate set a slot, saved results, picked a squad, checked in...), refetch the team data on screen.
 * Hidden tabs don't poll; coming back to the app refetches straight away (refetchOnWindowFocus).
 */
export function useLiveSync(enabled: boolean) {
  const qc = useQueryClient();
  const last = useRef<string | null>(null);
  const q = useQuery({
    queryKey: ['pulse'],
    queryFn: api.pulse,
    enabled,
    refetchInterval: PULSE_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
  });
  const rev = q.data?.rev ?? null;
  useEffect(() => {
    if (!rev) return;
    if (last.current !== null && last.current !== rev) {
      void qc.invalidateQueries({ predicate: (query) => LIVE_KEYS.has(String(query.queryKey[0])) });
    }
    last.current = rev;
  }, [rev, qc]);
}
