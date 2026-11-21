import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { syncPush } from '@/lib/push';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, isTransient, retryDelay } from '@/lib/api';
import type { Team, User } from '@/lib/types';

interface AuthState {
  user: User | null;
  team: Team | null;
  loading: boolean;
  /** The server could not be reached or was busy, so we don't know yet whether anyone is signed in. */
  unreachable: boolean;
  isCaptain: boolean;
  refresh: () => Promise<unknown>;
  setSession: (s: { user: User; team: Team | null } | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    // A minute is plenty for teammates' new profile photos, and keeps /auth/me from firing on every tab switch.
    staleTime: 60_000,
    // Keep trying through a busy or sleeping server instead of treating it as "signed out".
    retry: (count, e) => isTransient(e) && count < 5,
    retryDelay,
  });
  const userId = q.data?.user._id;
  const serverHasDevice = q.data?.user.pushEnabled ?? false;
  useEffect(() => {
    if (!userId) return;
    void syncPush(serverHasDevice).then(() => { if (!serverHasDevice) void q.refetch(); });
    // Once per signed-in user per app open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const value: AuthState = {
    user: q.data?.user ?? null,
    team: q.data?.team ?? null,
    loading: q.isLoading,
    unreachable: q.isError && q.data === undefined,
    isCaptain: q.data?.user.role === 'captain',
    refresh: () => q.refetch(),
    setSession: (s) => qc.setQueryData(['session'], s),
    logout: async () => {
      // Ask the server to drop the auth cookie (one retry in case the API was waking up).
      await api.logout().catch(() => api.logout()).catch(() => {});
      await qc.cancelQueries();
      // Set the session to null on the live query first. qc.clear() used to detach it,
      // so the app kept showing the old user and /welcome bounced straight back to the dashboard.
      qc.setQueryData(['session'], null);
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      // Full reload so no screen keeps the previous account's data around.
      window.location.replace('/welcome');
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
