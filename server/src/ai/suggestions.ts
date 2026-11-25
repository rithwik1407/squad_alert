/**
 * Suggested questions for the empty chat. A pool of templates across categories, filled with the team's
 * real players, maps and next match. Each visit shows a fresh set: the app sends the ids it showed on the
 * last few visits and those are skipped while enough others remain.
 */
export type SuggestionCat = 'Squad' | 'Performance' | 'Attendance' | 'Strategy' | 'Schedule' | 'Players' | 'Actions';
export interface Suggestion { id: string; cat: SuggestionCat; q: string }

interface Template { id: string; cat: SuggestionCat; q: string; who?: 'captain' | 'player'; needs?: ('a' | 'b' | 'map' | 'next')[] }

export const TEMPLATES: Template[] = [
  { id: 'sq1', cat: 'Squad', q: "Suggest today's best four players" },
  { id: 'sq2', cat: 'Squad', q: 'Who should play {next}?', needs: ['next'] },
  { id: 'sq3', cat: 'Squad', q: 'Who should we field on {map} tonight?', needs: ['map'] },
  { id: 'sq4', cat: 'Squad', q: 'Who should be our substitute this week?' },
  { id: 'sq5', cat: 'Squad', q: 'Who has been benched the most lately?' },
  { id: 'sq6', cat: 'Squad', q: 'Build the most balanced lineup by role' },
  { id: 'pf1', cat: 'Performance', q: 'Analyze our last 10 matches' },
  { id: 'pf2', cat: 'Performance', q: 'How did we do this week?' },
  { id: 'pf3', cat: 'Performance', q: 'Are our kills going up or down?' },
  { id: 'pf4', cat: 'Performance', q: 'Which map are we strongest on?' },
  { id: 'pf5', cat: 'Performance', q: 'How do we play on {map}?', needs: ['map'] },
  { id: 'pf6', cat: 'Performance', q: 'Generate a report for our last match' },
  { id: 'pf7', cat: 'Performance', q: 'How was our placement this month?' },
  { id: 'at1', cat: 'Attendance', q: 'Who misses scrims frequently?' },
  { id: 'at2', cat: 'Attendance', q: 'Who joins late most often?' },
  { id: 'at3', cat: 'Attendance', q: 'Who drops out at the last minute?' },
  { id: 'at4', cat: 'Attendance', q: "Who hasn't checked in for {next}?", needs: ['next'] },
  { id: 'at5', cat: 'Attendance', q: 'Who is our most reliable player?' },
  { id: 'st1', cat: 'Strategy', q: 'What are our biggest weaknesses and how do we fix them?' },
  { id: 'st2', cat: 'Strategy', q: 'Why do we die early on {map}?', needs: ['map'] },
  { id: 'st3', cat: 'Strategy', q: 'What should we practise this week?' },
  { id: 'st4', cat: 'Strategy', q: 'How can we survive longer in late zones?' },
  { id: 'st5', cat: 'Strategy', q: 'Tips for a better third-zone rotation' },
  { id: 'sc1', cat: 'Schedule', q: 'Which time is best for our daily scrims?' },
  { id: 'sc2', cat: 'Schedule', q: 'Which weekday do most of us show up?' },
  { id: 'sc3', cat: 'Schedule', q: "What's coming up this week?" },
  { id: 'sc4', cat: 'Schedule', q: 'Is tomorrow 9 PM free for a scrim?' },
  { id: 'pl1', cat: 'Players', q: 'Who is our MVP this month?' },
  { id: 'pl2', cat: 'Players', q: 'Compare {a} and {b}', needs: ['a', 'b'] },
  { id: 'pl3', cat: 'Players', q: 'How is {a} doing lately?', needs: ['a'] },
  { id: 'pl4', cat: 'Players', q: 'Who is our top fragger?' },
  { id: 'pl5', cat: 'Players', q: 'Who deals the most damage per match?' },
  { id: 'pl6', cat: 'Players', q: 'Compare {a} and {b} over the last 15 matches', needs: ['a', 'b'] },
  { id: 'ac1', cat: 'Actions', q: 'Schedule a scrim tomorrow at 9 PM', who: 'captain' },
  { id: 'ac2', cat: 'Actions', q: "Remind everyone who hasn't checked in", who: 'captain' },
  { id: 'ac3', cat: 'Actions', q: 'Tell {a} and {b} to be online by 8:45 PM', who: 'captain', needs: ['a', 'b'] },
  { id: 'ac4', cat: 'Actions', q: 'Set the map for {next} to {map}', who: 'captain', needs: ['next', 'map'] },
  { id: 'ac5', cat: 'Actions', q: 'Move {next} one hour later', who: 'captain', needs: ['next'] },
  { id: 'ac6', cat: 'Actions', q: 'Confirm the recommended squad for {next}', who: 'captain', needs: ['next'] },
  { id: 'ac7', cat: 'Actions', q: 'Message the team: GG today, rest up for tomorrow', who: 'captain' },
  { id: 'ap1', cat: 'Actions', q: "I'll join {next} late, around 9:15", who: 'player', needs: ['next'] },
  { id: 'ap2', cat: 'Actions', q: "Mark me unavailable for {next}", who: 'player', needs: ['next'] },
  { id: 'ap3', cat: 'Actions', q: 'Ask the captain if I can play on {map}', who: 'player', needs: ['map'] },
];

export interface SuggestionContext { isCaptain: boolean; players: string[]; maps: string[]; next: string | null; selfIgn?: string }

const shuffle = <T,>(xs: T[], rnd: () => number) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/** Pick `count` suggestions from different categories, skipping recently shown ids while enough remain. */
export function pickSuggestions(ctx: SuggestionContext, seen: string[], count = 4, rnd: () => number = Math.random): Suggestion[] {
  const players = ctx.players.filter((p) => p && p !== ctx.selfIgn);
  const usable = TEMPLATES.filter((t) => {
    if (t.who === 'captain' && !ctx.isCaptain) return false;
    if (t.who === 'player' && ctx.isCaptain) return false;
    const n = t.needs ?? [];
    if (n.includes('a') && players.length < (n.includes('b') ? 2 : 1)) return false;
    if (n.includes('map') && !ctx.maps.length) return false;
    if (n.includes('next') && !ctx.next) return false;
    return true;
  });
  const seenSet = new Set(seen);
  const fresh = usable.filter((t) => !seenSet.has(t.id));
  const pool = shuffle(fresh.length >= count ? fresh : usable, rnd);
  // One per category first, so a set never shows four squad questions.
  const picked: Template[] = [];
  for (const t of pool) if (picked.length < count && !picked.some((p) => p.cat === t.cat)) picked.push(t);
  for (const t of pool) if (picked.length < count && !picked.includes(t)) picked.push(t);
  return picked.map((t) => {
    const [a, b] = shuffle(players, rnd);
    const map = shuffle(ctx.maps, rnd)[0] ?? '';
    return { id: t.id, cat: t.cat, q: t.q.replace('{a}', a ?? '').replace('{b}', b ?? '').replace('{map}', map).replace(/\{next\}/g, ctx.next ?? 'the next match') };
  });
}
