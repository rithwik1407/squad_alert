import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface PlayerLine {
  matches: number;
  kills: number;
  damage: number;
  assists: number;
  mvps: number;
  /** Kills per match. */
  kpm: number;
  /** Average damage per match. */
  adr: number;
  bestKills: number;
}

export const EMPTY_LINE: PlayerLine = { matches: 0, kills: 0, damage: 0, assists: 0, mvps: 0, kpm: 0, adr: 0, bestKills: 0 };

/** Career numbers per player, built from the same team stats the Stats page uses (shares its cache). */
export function usePlayerStats() {
  const q = useQuery({ queryKey: ['teamstats'], queryFn: api.teamStats, staleTime: 5 * 60_000 });
  const lines = useMemo(() => {
    const by = new Map<string, PlayerLine>();
    for (const m of q.data?.matches ?? []) {
      for (const s of m.stats) {
        const l = by.get(s.userId) ?? { ...EMPTY_LINE };
        l.matches += 1;
        l.kills += s.kills;
        l.damage += s.damage;
        l.assists += s.assists;
        l.mvps += s.mvp ? 1 : 0;
        l.bestKills = Math.max(l.bestKills, s.kills);
        by.set(s.userId, l);
      }
    }
    for (const l of by.values()) {
      l.kpm = l.matches ? l.kills / l.matches : 0;
      l.adr = l.matches ? l.damage / l.matches : 0;
    }
    return by;
  }, [q.data]);
  return { lines, loading: q.isLoading };
}
