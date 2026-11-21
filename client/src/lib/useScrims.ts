import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { ScrimSeries } from './types';

/** Same rule as the server: case, spaces and punctuation don't matter when matching series names. */
export function seriesKey(name: string | null | undefined) {
  return (name ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function useScrims() {
  return useQuery({ queryKey: ['scrims'], queryFn: api.scrims, staleTime: 60_000 });
}

/** The organizer card for a match's scrim/tournament name, if one is saved. */
export function useSeriesFor(name: string | null | undefined): { series: ScrimSeries | null; canEdit: boolean; loading: boolean } {
  const q = useScrims();
  const key = seriesKey(name);
  return {
    series: key ? q.data?.series.find((s) => s.key === key) ?? null : null,
    canEdit: Boolean(q.data?.canEdit),
    loading: q.isLoading,
  };
}
