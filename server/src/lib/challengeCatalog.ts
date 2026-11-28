/**
 * Squad challenges: a fixed pool of BGMI goals (Classic, WOW, TDM). Each one awards a badge to the players who
 * finish it. Pure data and helpers only, so the client-facing picks are easy to test.
 */

export type ChallengeMode = 'Classic' | 'WOW' | 'TDM';
export type BadgeTier = 'bronze' | 'silver' | 'gold';

export interface Challenge {
  key: string;
  mode: ChallengeMode;
  /** Short goal, e.g. "25 kills in 3 matches". */
  title: string;
  /** One line explaining what counts. */
  text: string;
  /** How many matches the challenge spans. */
  matches: number;
  tier: BadgeTier;
  badge: { name: string; emoji: string };
}

export const CHALLENGES: Challenge[] = [
  // Classic
  { key: 'kills-25-in-3', mode: 'Classic', title: '25 kills in 3 matches', text: 'Get 25 combined squad kills across three Classic matches.', matches: 3, tier: 'gold', badge: { name: 'Kill Factory', emoji: '🏭' } },
  { key: 'everyone-3-kills', mode: 'Classic', title: 'Everyone gets 3 kills', text: 'Every player on the squad finishes the match with at least 3 kills.', matches: 1, tier: 'silver', badge: { name: 'No Passengers', emoji: '🎯' } },
  { key: 'chicken-dinner', mode: 'Classic', title: 'Winner Winner Chicken Dinner', text: 'Win a Classic match.', matches: 1, tier: 'gold', badge: { name: 'Chicken Dinner', emoji: '🍗' } },
  { key: 'squad-15-kills', mode: 'Classic', title: '15 squad kills', text: 'Get 15 combined kills in a single Classic match.', matches: 1, tier: 'gold', badge: { name: 'Squad Wipers', emoji: '💀' } },
  { key: 'top5-3-in-row', mode: 'Classic', title: 'Top 5, three times', text: 'Finish top 5 in three Classic matches in a row.', matches: 3, tier: 'silver', badge: { name: 'Mr. Consistent', emoji: '📈' } },
  { key: 'damage-2000', mode: 'Classic', title: '2,000 squad damage', text: 'Deal 2,000 combined damage in one Classic match.', matches: 1, tier: 'silver', badge: { name: 'Damage Dealers', emoji: '💥' } },
  { key: 'full-squad-top3', mode: 'Classic', title: 'Top 3, all four alive', text: 'Reach the top 3 with all four players still alive.', matches: 1, tier: 'gold', badge: { name: 'Full Squad Finish', emoji: '🛡️' } },
  { key: 'hot-drop-top10', mode: 'Classic', title: 'Hot drop, top 10', text: 'Land at a hot spot (Pochinki, School, Pecado, Georgopol) and still make top 10.', matches: 1, tier: 'silver', badge: { name: 'Hot Drop Heroes', emoji: '🔥' } },
  { key: 'pistol-kill-each', mode: 'Classic', title: 'Pistol kill each', text: 'Every player gets at least one kill with a pistol.', matches: 1, tier: 'silver', badge: { name: 'Sidearm Club', emoji: '🔫' } },
  { key: 'sniper-3', mode: 'Classic', title: '3 sniper kills', text: 'Get 3 squad kills with a bolt-action sniper (Kar98k, M24, AWM, Mosin) in one match.', matches: 1, tier: 'silver', badge: { name: 'Long Range', emoji: '🔭' } },
  { key: 'nade-2', mode: 'Classic', title: '2 grenade kills', text: 'Get 2 squad kills with frag grenades in one match.', matches: 1, tier: 'bronze', badge: { name: 'Frag Out', emoji: '💣' } },
  { key: 'vehicle-kill', mode: 'Classic', title: 'Vehicle kill', text: 'Get a kill by running someone over, or by shooting from a moving vehicle.', matches: 1, tier: 'bronze', badge: { name: 'Road Rage', emoji: '🚗' } },
  { key: 'pan-kill', mode: 'Classic', title: 'Pan kill', text: 'Anyone on the squad gets a melee kill with the pan.', matches: 1, tier: 'bronze', badge: { name: 'Pan Masters', emoji: '🍳' } },
  { key: 'airdrop-2', mode: 'Classic', title: 'Loot 2 airdrops', text: 'Loot two airdrops in one match and live to the next zone.', matches: 1, tier: 'bronze', badge: { name: 'Crate Raiders', emoji: '📦' } },
  { key: 'revive-5', mode: 'Classic', title: '5 revives', text: 'Pick each other up 5 times in one match.', matches: 1, tier: 'bronze', badge: { name: 'Medic Squad', emoji: '🩹' } },
  { key: 'no-knock-top10', mode: 'Classic', title: 'Top 10 with no knocks', text: 'Make the top 10 without any teammate getting knocked.', matches: 1, tier: 'gold', badge: { name: 'Untouchable', emoji: '👻' } },
  { key: 'kills-40-in-3', mode: 'Classic', title: '40 kills in 3 matches', text: 'Get 40 combined squad kills across three Classic matches.', matches: 3, tier: 'gold', badge: { name: 'Lobby Cleaners', emoji: '🧹' } },
  { key: 'two-dinners', mode: 'Classic', title: '2 Chicken Dinners', text: 'Win two Classic matches out of three.', matches: 3, tier: 'gold', badge: { name: 'Double Dinner', emoji: '🏆' } },
  // WOW (World of Wonder)
  { key: 'wow-all-alive', mode: 'WOW', title: 'WOW, nobody dies', text: 'Finish a WOW map without any teammate dying.', matches: 1, tier: 'silver', badge: { name: 'WOW Survivors', emoji: '🌀' } },
  { key: 'wow-30-in-2', mode: 'WOW', title: '30 kills in 2 WOW games', text: 'Get 30 combined kills across two WOW matches.', matches: 2, tier: 'silver', badge: { name: 'WOW Wreckers', emoji: '🎢' } },
  { key: 'wow-3-maps', mode: 'WOW', title: '3 different WOW maps', text: 'Play three different WOW maps together and win at least one.', matches: 3, tier: 'bronze', badge: { name: 'Map Explorers', emoji: '🗺️' } },
  // TDM / Arena
  { key: 'tdm-win-40', mode: 'TDM', title: 'Win TDM by 10+', text: 'Win a Team Deathmatch by 10 kills or more.', matches: 1, tier: 'silver', badge: { name: 'Deathmatch Kings', emoji: '👑' } },
  { key: 'tdm-each-10', mode: 'TDM', title: '10 kills each in TDM', text: 'Every player gets 10 or more kills in one Team Deathmatch.', matches: 1, tier: 'gold', badge: { name: 'Arena Legends', emoji: '⚔️' } },
  { key: 'tdm-3-wins', mode: 'TDM', title: '3 TDM wins in a row', text: 'Win three Team Deathmatches back to back.', matches: 3, tier: 'silver', badge: { name: 'Win Streak', emoji: '⚡' } },
];

const BY_KEY = new Map(CHALLENGES.map((c) => [c.key, c]));
export const challengeByKey = (key: string | null | undefined) => (key ? BY_KEY.get(key) ?? null : null);

/** "2026-11-28" in India time. A new daily challenge starts at midnight IST. */
export const dayKeyIST = (d: Date | number = Date.now()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

/** FNV-1a: a small stable hash, so the same team gets the same daily challenge all day. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Today's squad challenge: random across every mode, fixed for the whole IST day, different per team. */
export function dailyChallenge(teamId: string, dayKey = dayKeyIST()): Challenge {
  return CHALLENGES[hash(`${teamId}|${dayKey}`) % CHALLENGES.length];
}

/**
 * Challenges to pick from when sending a classic-match invite: today's daily challenge first (when it is a Classic
 * one), then random Classic picks. `rand` is injectable for tests.
 */
export function challengeOptions(teamId: string, count = 4, dayKey = dayKeyIST(), rand: () => number = Math.random): Challenge[] {
  const daily = dailyChallenge(teamId, dayKey);
  const pool = CHALLENGES.filter((c) => c.mode === 'Classic' && c.key !== daily.key);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const head = daily.mode === 'Classic' ? [daily] : [];
  return [...head, ...pool].slice(0, count);
}

/** How long one match takes, roughly: the "did it begin?" check comes after this many minutes per match. */
export const MINUTES_PER_MATCH = 25;

/** When to ask the squad about the challenge: after the 7-minute invite window plus the match time. */
export function askAtFor(sentAt: Date | number, matches: number, inviteWindowMs: number) {
  return new Date(new Date(sentAt).getTime() + inviteWindowMs + Math.max(1, matches) * MINUTES_PER_MATCH * 60_000);
}

/** After this long without an answer, the check closes on its own (no badge). */
export const ANSWER_WINDOW_MS = 24 * 3600_000;

export interface BadgeCount {
  key: string;
  name: string;
  emoji: string;
  tier: BadgeTier;
  mode: ChallengeMode;
  count: number;
  /** Times it was earned on the daily challenge. */
  daily: number;
  lastAt: string | null;
}

/** Group completed challenges into a badge shelf: one entry per badge, with how many times it was earned. */
export function badgeShelf(done: { challengeKey: string; daily?: boolean | null; completedAt?: Date | string | null }[]): BadgeCount[] {
  const shelf = new Map<string, BadgeCount>();
  for (const r of done) {
    const c = challengeByKey(r.challengeKey);
    if (!c) continue;
    const at = r.completedAt ? new Date(r.completedAt).toISOString() : null;
    const b = shelf.get(c.key) ?? { key: c.key, name: c.badge.name, emoji: c.badge.emoji, tier: c.tier, mode: c.mode, count: 0, daily: 0, lastAt: null };
    b.count += 1;
    if (r.daily) b.daily += 1;
    if (at && (!b.lastAt || at > b.lastAt)) b.lastAt = at;
    shelf.set(c.key, b);
  }
  const rank = { gold: 0, silver: 1, bronze: 2 } as const;
  return [...shelf.values()].sort((a, b) => rank[a.tier] - rank[b.tier] || b.count - a.count || a.name.localeCompare(b.name));
}
