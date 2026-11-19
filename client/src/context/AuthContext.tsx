import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { Team, User } from '@/lib/types';

interface AuthState {
  user: User | null;
  team: Team | null;
  loading: boolean;
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
    staleTime: 60_000,
    retry: 1,
  });
  const value: AuthState = {
    user: q.data?.user ?? null,
    team: q.data?.team ?? null,
    loading: q.isLoading,
    isCaptain: q.data?.user.role === 'captain',
    refresh: () => q.refetch(),
    setSession: (s) => qc.setQueryData(['session'], s),
    logout: async () => {
      await api.logout().catch(() => {});
      qc.clear();
      qc.setQueryData(['session'], null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
