import { describe, expect, it } from 'vitest';
import { buildDailySummary, dayRange, dueReportDay, renderDailySummary, type SummaryMatch, type SummaryStat } from '../src/lib/dailySummary.js';
import { runDailySummaries, type DailySummaryRepo, type LockRefused, type ReportState } from '../src/scheduler/dailySummary.js';
import { TelegramError } from '../src/notifications/telegram.js';

const TZ = 'Asia/Kolkata';
const ist = (s: string) => new Date(`${s}+05:30`);

describe('report day in IST', () => {
  it('is yesterday from midnight until noon, nothing after', () => {
    expect(dueReportDay(ist('2026-11-22T00:00:30'), TZ)).toBe('2026-11-21');
    expect(dueReportDay(ist('2026-11-22T03:15:00'), TZ)).toBe('2026-11-21');
    expect(dueReportDay(ist('2026-11-22T12:00:00'), TZ)).toBeNull();
    expect(dueReportDay(ist('2026-11-21T23:59:00'), TZ)).toBeNull();
    expect(dueReportDay(ist('2026-12-01T00:01:00'), TZ)).toBe('2026-11-30');
  });
  it('covers the IST calendar day', () => {
    const { start, end } = dayRange('2026-11-21', TZ);
    expect(start.toISOString()).toBe('2026-11-20T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-11-21T18:30:00.000Z');
  });
});

const matches: SummaryMatch[] = [
  { id: 'm1', title: 'Evening scrims', type: 'scrim', map: 'Erangel', startAt: ist('2026-11-21T18:00:00'), placement: 3 },
  { id: 'm2', title: 'Pro League', type: 'tournament', map: 'Miramar', startAt: ist('2026-11-21T21:00:00'), placement: 1 },
  { id: 'm3', title: 'Late scrim', type: 'scrim', map: 'TBD', startAt: ist('2026-11-21T23:00:00'), placement: null },
];
const st = (matchId: string, userId: string, kills: number, damage: number, mvp = false): SummaryStat =>
  ({ matchId, userId, kills, damage, survivalMin: 20, assists: 1, mvp });
const stats: SummaryStat[] = [
  st('m1', 'a', 6, 900, true), st('m1', 'b', 2, 400), st('m1', 'c', 1, 200),
  st('m2', 'a', 3, 700), st('m2', 'b', 8, 800, true), st('m2', 'c', 2, 300),
];
const players = [{ id: 'a', ign: 'RARE丨BITTU' }, { id: 'b', ign: 'RARE | ACE' }, { id: 'c', ign: 'Zed' }];

describe('daily summary', () => {
  const s = buildDailySummary({ teamName: 'TEAM RARE', day: '2026-11-21', matches, stats, players });

  it('counts matches, totals, MVP and top fragger', () => {
    expect(s.matchesPlayed).toBe(3);
    expect(s.scrims).toBe(2);
    expect(s.tournaments).toBe(1);
    expect(s.withResults).toBe(2);
    expect(s.totalKills).toBe(22);
    expect(s.totalDamage).toBe(3300);
    expect(s.bestPlacement).toEqual({ placement: 1, title: 'Pro League' });
    expect(s.topFragger?.name).toBe('ACE'); // 10 finishes vs 9
    expect(s.mvp?.name).toBe('BITTU'); // both have 1 MVP; BITTU's day score is higher
  });

  it('adds placement points and kill points together', () => {
    // m1: #3 = 5 + 9 kills; m2: #1 = 10 + 13 kills; m3: no result
    expect(s.points).toEqual({ placement: 15, kills: 22, total: 37 });
    expect(s.matches.map((m) => m.points)).toEqual([14, 23, 0]);
    const html = renderDailySummary(s, TZ);
    expect(html).toContain('Points:</b> 37 (15 placement + 22 kills)');
    expect(html).toContain('#3 · 9 K · 14 pts');
  });

  it('renders a neat Telegram message', () => {
    const html = renderDailySummary(s, TZ);
    expect(html).toContain('<b>TEAM RARE · Daily Report</b>');
    expect(html).toContain('Saturday, 21 Nov 2026');
    expect(html).toContain('Matches played:</b> 3 (2 scrims, 1 tournament)');
    expect(html).toContain('MVP of the day: BITTU');
    expect(html).toContain('Top fragger: ACE');
    expect(html).toContain('<pre>');
    expect(html).toContain('results pending');
    expect(html.length).toBeLessThan(4096);
  });

  it('still reports matches with no results uploaded', () => {
    const empty = buildDailySummary({ teamName: 'T', day: '2026-11-21', matches, stats: [], players });
    expect(empty.mvp).toBeNull();
    expect(renderDailySummary(empty, TZ)).toContain('No results uploaded yet');
  });
});

class MemRepo implements DailySummaryRepo {
  rows = new Map<string, { sentTo: string[]; done: boolean; attempts: number; locked: boolean }>();
  unlinked: string[] = [];
  teamMatches: Record<string, SummaryMatch[]> = { t1: matches, t2: [] };
  async listTeams() { return [{ id: 't1', name: 'TEAM RARE' }, { id: 't2', name: 'Idle' }]; }
  async getMatches(teamId: string, start: Date, end: Date) {
    return (this.teamMatches[teamId] ?? []).filter((m) => m.startAt >= start && m.startAt < end);
  }
  async getStats() { return stats; }
  async getPlayers() {
    return [
      { ...players[0], chatId: '1', telegramOn: true },
      { ...players[1], chatId: '2', telegramOn: true },
      { ...players[2], chatId: null, telegramOn: true },
    ];
  }
  async acquire(teamId: string, day: string): Promise<ReportState | LockRefused> {
    const k = `${teamId}|${day}`;
    const r = this.rows.get(k) ?? { sentTo: [], done: false, attempts: 0, locked: false };
    if (r.done) return 'done';
    if (r.locked) return 'locked';
    r.locked = true;
    r.attempts++;
    this.rows.set(k, r);
    return { sentTo: [...r.sentTo], attempts: r.attempts };
  }
  async markSent(teamId: string, day: string, userId: string) { this.rows.get(`${teamId}|${day}`)!.sentTo.push(userId); }
  async release(teamId: string, day: string, r: { done: boolean }) {
    const row = this.rows.get(`${teamId}|${day}`)!;
    row.done = r.done;
    row.locked = false;
  }
  async unlinkTelegram(id: string) { this.unlinked.push(id); }
}

describe('nightly run', () => {
  const midnight = ist('2026-11-22T00:00:10');

  it('sends once per player, skips idle teams, and never repeats', async () => {
    const repo = new MemRepo();
    const sent: string[] = [];
    const deps = { repo, tz: TZ, send: async (chat: string) => void sent.push(chat) };
    const first = await runDailySummaries(midnight, deps);
    expect(first.day).toBe('2026-11-21');
    expect(first.teams.map((t) => t.outcome)).toEqual(['sent', 'skipped']);
    expect(sent).toEqual(['1', '2']);
    const again = await runDailySummaries(ist('2026-11-22T00:01:10'), deps);
    expect(again.teams.map((t) => t.outcome)).toEqual(['already_done', 'already_done']);
    expect(sent).toEqual(['1', '2']);
  });

  it('retries only the player whose send failed', async () => {
    const repo = new MemRepo();
    const sent: string[] = [];
    let fail = true;
    const deps = {
      repo, tz: TZ,
      send: async (chat: string) => {
        if (chat === '2' && fail) throw new Error('network');
        sent.push(chat);
      },
    };
    expect((await runDailySummaries(midnight, deps)).teams[0].outcome).toBe('partial');
    fail = false;
    expect((await runDailySummaries(midnight, deps)).teams[0].outcome).toBe('sent');
    expect(sent).toEqual(['1', '2']);
  });

  it('unlinks a chat that blocked the bot instead of retrying it', async () => {
    const repo = new MemRepo();
    const deps = {
      repo, tz: TZ,
      send: async (chat: string) => { if (chat === '1') throw new TelegramError('Forbidden: bot was blocked by the user', 403); },
    };
    const r = await runDailySummaries(midnight, deps);
    expect(r.teams[0].outcome).toBe('sent');
    expect(repo.unlinked).toEqual(['a']);
  });

  it('does nothing in the afternoon', async () => {
    const r = await runDailySummaries(ist('2026-11-22T15:00:00'), { repo: new MemRepo(), tz: TZ, send: async () => {} });
    expect(r.day).toBeNull();
  });
});
