import type { QueryClient } from '@tanstack/react-query';
import { ApiError, readScorecardWithProgress } from './api';
import type { ScorecardRow } from './types';

/**
 * Screenshot reads in progress, by match. They live outside the page so a read keeps going (and its
 * results still land) when the admin opens Settings or another page meanwhile. The server also saves the
 * numbers itself as soon as it has read them.
 */
type Read = { seconds: number; listeners: Set<(s: number) => void>; promise: Promise<ScorecardRow[]> };
const reads = new Map<string, Read>();

export const isNotResultsError = (e: unknown) =>
  e instanceof ApiError && Boolean(e.details?.some((d) => d.message === 'not_results'));

export function pendingRead(matchId: string) {
  return reads.get(matchId) ?? null;
}

export function startRead(
  matchId: string, image: string, qc: QueryClient,
  notify: { success: (m: string) => void; error: (e: unknown) => void },
): Read {
  const existing = reads.get(matchId);
  if (existing) return existing;
  const read: Read = { seconds: 0, listeners: new Set(), promise: Promise.resolve([]) };
  read.promise = readScorecardWithProgress(matchId, image, (s) => {
    read.seconds = s;
    read.listeners.forEach((l) => l(s));
  }).then(({ rows }) => rows).finally(() => {
    reads.delete(matchId);
    // The server already saved the matched players: refresh what the pages show.
    qc.invalidateQueries({ queryKey: ['report', matchId] });
    qc.invalidateQueries({ queryKey: ['mystats'] });
    qc.invalidateQueries({ queryKey: ['teamstats'] });
  });
  // If nobody is on the match page any more, still tell the admin how it went.
  read.promise.then(
    (rows) => { if (!read.listeners.size) notify.success(`Match results read: ${rows.filter((r) => r.userId).length} players' stats saved.`); },
    (e) => { if (!read.listeners.size) notify.error(e); },
  );
  reads.set(matchId, read);
  return read;
}
