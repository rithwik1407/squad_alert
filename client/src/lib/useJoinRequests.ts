import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from '@/context/AuthContext';

/** Pending signups. Only the admin can load them; everyone else gets an empty list without a request. */
export function useJoinRequests() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const q = useQuery({
    queryKey: ['join-requests'],
    queryFn: () => api.joinRequests(),
    enabled: isAdmin,
    refetchInterval: isAdmin ? 60_000 : false,
  });
  return { isAdmin, requests: q.data?.requests ?? [], loading: q.isLoading && isAdmin, refetch: q.refetch };
}
