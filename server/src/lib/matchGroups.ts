import { dayKey } from './dailySummary.js';

/**
 * Pure helpers (no DB) for matches added together and for "is this match finished?".
 */

/** Matches before 6 AM belong to the evening before, like the bulk form treats them. */
const NIGHT_CUTOFF_MS = 6 * 3600_000;

/**
 * The scrim night a match belongs to, e.g. "2026-11-27" for 8 PM on the 27th and for 1 AM on the 28th.
 * `tz` is the team's display time zone.
 */
export function nightKey(startAt: Date, tz: string): string {
  return dayKey(new Date(startAt.getTime() - NIGHT_CUTOFF_MS), tz);
}

export interface BatchMatch {
  id: string;
  batchId?: string | null;
  startAt: Date;
  status: string;
  slot?: string | null;
}

/**
 * Matches that should take `source`'s slot: same bulk add (batchId), same scrim night, not finished or
 * cancelled, and not already on that slot. A bulk add that repeats over several days shares one batchId,
 * so each night keeps its own slot.
 */
export function batchSlotTargets(source: BatchMatch, candidates: BatchMatch[], slot: string, tz: string): BatchMatch[] {
  if (!source.batchId) return [];
  const night = nightKey(source.startAt, tz);
  return candidates.filter((m) =>
    m.id !== source.id
    && m.batchId === source.batchId
    && !['done', 'cancelled'].includes(m.status)
    && nightKey(m.startAt, tz) === night
    && (m.slot ?? '') !== slot);
}

/**
 * A match counts toward stats and points tables only once it is finished: the admin marked it done
 * (Finish match / results screenshot / saved stats), or it has started and already has a result saved.
 * Upcoming and still-running matches without a result never count.
 */
export function isCompleted(m: { status: string; startAt: Date; placement?: number | null }, hasStats: boolean, now = Date.now()): boolean {
  if (m.status === 'cancelled') return false;
  if (m.status === 'done') return true;
  return m.startAt.getTime() <= now && (hasStats || (m.placement ?? null) != null);
}
