/** Standard BGMI scrim points (same table as the server): placement points by position, plus 1 per kill. */
const PLACEMENT_POINTS: Record<number, number> = { 1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1 };

export function placementPoints(placement: number | null | undefined): number {
  return placement && placement >= 1 ? PLACEMENT_POINTS[placement] ?? 0 : 0;
}

export function matchPoints(placement: number | null | undefined, kills: number) {
  const placementPts = placementPoints(placement);
  const killPts = Math.max(0, kills);
  return { placementPts, killPts, total: placementPts + killPts };
}

/** "#3: 5 + 7 kills = 12 pts" */
export function pointsLine(placement: number | null | undefined, kills: number) {
  const p = matchPoints(placement, kills);
  return `${placement ? `#${placement}: ` : ''}${p.placementPts} placement + ${p.killPts} kill pts = ${p.total} pts`;
}
