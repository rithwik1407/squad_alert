/**
 * MVP score for one match. Each metric is divided by the best value in the squad (0..1), then weighted:
 *   finishes 40%, damage 30%, survival time 20%, knockouts 10%.
 * The BGMI results screen has no knockouts column, so assists stand in for knockouts.
 */
export const MVP_WEIGHTS = { kills: 0.4, damage: 0.3, survivalMin: 0.2, assists: 0.1 } as const;

export interface MvpInput { userId: string; kills: number; damage: number; survivalMin: number; assists: number }

export function scoreMvp<T extends MvpInput>(rows: T[]): { rows: (T & { mvpScore: number; mvp: boolean })[]; mvpUserId: string | null } {
  const keys = Object.keys(MVP_WEIGHTS) as (keyof typeof MVP_WEIGHTS)[];
  const max = Object.fromEntries(keys.map((k) => [k, Math.max(0, ...rows.map((r) => r[k] || 0))])) as Record<keyof typeof MVP_WEIGHTS, number>;
  const scored = rows.map((r) => {
    const score = keys.reduce((s, k) => s + (max[k] > 0 ? ((r[k] || 0) / max[k]) * MVP_WEIGHTS[k] : 0), 0);
    return { ...r, mvpScore: Math.round(score * 1000) / 10, mvp: false };
  });
  // Highest score wins; ties go to more finishes, then more damage.
  const best = [...scored].sort((a, b) => b.mvpScore - a.mvpScore || b.kills - a.kills || b.damage - a.damage)[0];
  if (!best || best.mvpScore <= 0) return { rows: scored, mvpUserId: null };
  best.mvp = true;
  return { rows: scored, mvpUserId: best.userId };
}

const SEP = /[|丨｜ǀ┃│]/g;

/** "RARE | BITTU", "RARE丨BITTU", "rare|bittu" → "rarebittu". */
export function normalizeIgn(s: string) {
  // 丨 (U+4E28) is a CJK "letter", so drop the separators explicitly before keeping letters and digits.
  return s.normalize('NFKC').toLowerCase().replace(SEP, '').replace(/[^\p{L}\p{N}]/gu, '');
}

/** Same name without a leading team tag (anything before a | / 丨 separator). */
function stripTag(s: string) {
  const parts = s.normalize('NFKC').split(SEP);
  return normalizeIgn(parts[parts.length - 1]);
}

/** Pick the team member whose IGN matches a name read from the screenshot, or null. */
export function matchPlayer<P extends { id: string; ign: string; name?: string }>(name: string, players: P[]): P | null {
  const n = normalizeIgn(name);
  const t = stripTag(name);
  if (!n) return null;
  return players.find((p) => normalizeIgn(p.ign) === n)
    ?? players.find((p) => t && stripTag(p.ign) === t)
    ?? players.find((p) => t && p.name && normalizeIgn(p.name) === t)
    ?? players.find((p) => t.length >= 3 && (stripTag(p.ign).includes(t) || t.includes(stripTag(p.ign)) && stripTag(p.ign).length >= 3))
    ?? null;
}
