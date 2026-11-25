import { describe, expect, it } from 'vitest';
import {
  attendanceRows, compareTool, matchReportTool, performanceTool, recommendSquad, timeSlotsTool, type TeamData,
} from '../src/ai/analytics.js';
import { pickOfflineTools } from '../src/ai/agent.js';
import { zonedToUtc } from '../src/ai/tools.js';

const ids = ['a', 'b', 'c', 'd', 'e'].map((c) => c.repeat(24));
const [REX, SHADOW, GHOST, BLAZE, VENOM] = ids;

function fixture(): TeamData {
  const now = new Date('2026-11-25T12:00:00Z');
  const members = [
    { id: REX, ign: 'Rex', gameRole: 'IGL' }, { id: SHADOW, ign: 'Shadow', gameRole: 'Assaulter' }, { id: GHOST, ign: 'Ghost', gameRole: 'Sniper' },
    { id: BLAZE, ign: 'Blaze', gameRole: 'Support' }, { id: VENOM, ign: 'Venom', gameRole: 'Assaulter' },
  ].map((m) => ({ ...m, name: m.ign, avatar: '', role: m.ign === 'Rex' ? 'captain' : 'player', inPool: true }));
  // 6 matches, newest first, at 9 PM IST (15:30 UTC) on consecutive days. Erangel good, Miramar bad.
  const matches = Array.from({ length: 6 }, (_, i) => ({
    id: `m${i}`.padEnd(24, '0'), title: `Scrim ${i}`, tournamentName: 'Daily', type: 'scrim',
    map: i % 2 ? 'Miramar' : 'Erangel', startAt: new Date(Date.UTC(2026, 10, 24 - i, 15, 30)), status: 'done', placement: i % 2 ? 12 : 2,
  }));
  const stats = matches.flatMap((m, i) => [REX, SHADOW, GHOST, BLAZE].map((u, j) => ({
    matchId: m.id, userId: u, kills: (i < 3 ? 2 : 4) + j, damage: 300 + 100 * j, assists: u === BLAZE ? 4 : 1,
    survivalMin: m.map === 'Miramar' ? 8 : 22, mvp: j === 3, mvpScore: 50 + 10 * j,
  })));
  const squads = matches.map((m) => ({ matchId: m.id, selectedIds: [REX, SHADOW, GHOST, BLAZE], confirmed: true }));
  const attendance = matches.flatMap((m) => [REX, SHADOW, GHOST, BLAZE].map((u) => ({ matchId: m.id, userId: u, joined: !(u === GHOST && m.id === matches[0].id) })));
  const availability = matches.flatMap((m) => ids.map((u) => ({
    matchId: m.id, userId: u, status: u === VENOM ? 'unavailable' : 'available',
    joiningAt: u === SHADOW ? new Date(m.startAt.getTime() + 10 * 60_000) : null, updatedAt: new Date(m.startAt.getTime() - 30 * 60_000),
  })));
  return { tz: 'Asia/Kolkata', now, members, matches, stats, attendance, availability, squads };
}

describe('Squad AI analytics', () => {
  it('finds kill trend and map strength from real rows', () => {
    const out = performanceTool(fixture());
    const f = out.facts as { matches: number; killChangePct: number; maps: { map: string }[] };
    expect(f.matches).toBe(6);
    expect(f.killChangePct).toBeLessThan(0); // newer matches have fewer kills
    expect(f.maps[0].map).toBe('Erangel');
    expect(out.summary).toMatch(/Weakest on Miramar/);
    expect(out.blocks.map((b) => b.type)).toEqual(['kpis', 'line', 'bar', 'insights']);
  });

  it('tracks no-shows, late joins and last-minute drops', () => {
    const rows = attendanceRows(fixture());
    expect(rows.get(GHOST)!.missed).toBe(1);
    expect(rows.get(SHADOW)!.late).toBe(6);
    expect(rows.get(VENOM)!.lastMinute).toBe(6);
    expect(rows.get(VENOM)!.benched).toBe(6);
  });

  it('recommends 4 players, skips unavailable ones and names a substitute', () => {
    const data = fixture();
    const avail = new Map([[VENOM, 'unavailable'], [REX, 'available'], [SHADOW, 'available'], [GHOST, 'available'], [BLAZE, 'maybe']]);
    const out = recommendSquad(data, { match: null, availability: avail });
    const block = out.blocks[0];
    expect(block.type).toBe('squad');
    if (block.type !== 'squad') return;
    expect(block.players).toHaveLength(4);
    expect(block.players.map((p) => p.id)).not.toContain(VENOM);
    expect(block.substitute?.ign).toBe('Venom');
    expect(block.players.every((p) => p.score >= 0 && p.score <= 100)).toBe(true);
  });

  it('builds a match report against team averages', () => {
    const data = fixture();
    const out = matchReportTool(data, data.matches[1].id);
    const b = out.blocks[0];
    expect(b.type).toBe('report');
    if (b.type !== 'report') return;
    expect(b.placement).toBe(12);
    expect(b.kills).toBe(2 + 3 + 4 + 5);
    expect(b.recommendation).toMatch(/rotations/);
  });

  it('compares two players', () => {
    const data = fixture();
    const out = compareTool(data, data.members[1], data.members[3]);
    expect(out.summary).toMatch(/Blaze/);
    expect(out.blocks.map((b) => b.type)).toEqual(['table', 'radar']);
  });

  it('picks the best start time in the team time zone', () => {
    const out = timeSlotsTool(fixture());
    expect((out.facts as { best: string }).best).toBe('9 PM');
  });
});

describe('Squad AI helpers', () => {
  it('routes questions to tools without a model', () => {
    expect(pickOfflineTools('Suggest the best four players for today', []).map((t) => t.name)).toContain('recommend_squad');
    expect(pickOfflineTools('Compare Rex and Shadow based on their last 15 matches', ['Rex', 'Shadow'])[0])
      .toEqual({ name: 'compare_players', args: { player_a: 'Rex', player_b: 'Shadow', last_matches: 15 } });
    expect(pickOfflineTools('Who misses scrims frequently?', []).map((t) => t.name)).toEqual(['analyze_attendance']);
    expect(pickOfflineTools('Which time is best for our daily scrims?', []).map((t) => t.name)).toEqual(['best_time_slots']);
    expect(pickOfflineTools('hello', []).map((t) => t.name)).toEqual(['analyze_performance']);
  });

  it('converts a team-local date and time to UTC', () => {
    expect(zonedToUtc('2026-11-26', '21:00', 'Asia/Kolkata')?.toISOString()).toBe('2026-11-26T15:30:00.000Z');
    expect(zonedToUtc('26/11', '21:00')).toBeNull();
  });
});
