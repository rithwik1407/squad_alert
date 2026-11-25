/**
 * Standard BGMI scrim points, used by the calendar points tables and the daily Telegram report:
 * placement points by finishing position (#1 10, #2 6, #3 5, #4 4, #5 3, #6 2, #7-8 1, #9-16 0) plus 1 per kill.
 */
export const PLACEMENT_POINTS: Record<number, number> = { 1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1 };
export const POINTS_PER_KILL = 1;

export function placementPoints(placement: number | null | undefined): number {
  if (!placement || placement < 1) return 0;
  return PLACEMENT_POINTS[placement] ?? 0;
}

/** Position points plus kill points for one match. */
export function matchPoints(placement: number | null | undefined, kills: number | null | undefined) {
  const placementPts = placementPoints(placement);
  const killPts = Math.max(0, kills ?? 0) * POINTS_PER_KILL;
  return { placementPts, killPts, total: placementPts + killPts };
}
