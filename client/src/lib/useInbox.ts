import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from '@/context/AuthContext';

/** Your inbox (own copies of every alert sent to you). Shared by the Inbox page and the nav badge. */
export function useInbox() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.inbox(),
    enabled: Boolean(user?.teamId),
    refetchInterval: 30_000,
  });
}
