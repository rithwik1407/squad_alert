/**
 * Who played a match. Pure (no DB) so the stats page, the calendar and the AI all agree.
 *
 * Once results are posted (any Stats row for the match), the posted results are the answer: a teammate played
 * only if the admin kept them in the results. Anyone in the squad the admin left out (or un-ticked "Joined")
 * did not play, so their matches-played count doesn't go up.
 * Before any results are posted, the confirmed squad counts, minus anyone explicitly marked as not joined.
 */
export function playedUserIds(input: {
  /** Users with a Stats row for this match. */
  statsUserIds: string[];
  /** The confirmed squad's picked players (empty when no squad was confirmed). */
  squadIds: string[];
  /** Attendance marks for this match: userId → joined. */
  attendance: Map<string, boolean> | Record<string, boolean>;
}): string[] {
  const att = input.attendance instanceof Map ? input.attendance : new Map(Object.entries(input.attendance));
  const base = input.statsUserIds.length ? input.statsUserIds : input.squadIds;
  return [...new Set(base.map(String))].filter((id) => att.get(id) !== false);
}

export interface GuestStat { name: string; kills: number; damage: number; survivalMin: number; assists: number }

export const guestKills = (guests: GuestStat[] | null | undefined) => (guests ?? []).reduce((a, g) => a + (g.kills || 0), 0);

/** The same rule as playedUserIds, for one player when only their own rows are loaded. */
export function didPlay(p: { matchHasStats: boolean; hasStats: boolean; inSquad: boolean; joined: boolean | null | undefined }): boolean {
  if (p.joined === false) return false;
  return p.matchHasStats ? p.hasStats : p.inSquad;
}
