import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.GEMINI_API_KEY = 'g-key';
const { parseScheduleDate, readSchedule, to24h, toSchedule } = await import('../src/lib/schedule.js');
const { _resetGeminiForTests } = await import('../src/lib/scorecard.js');

const NOW = new Date('2026-11-21T06:00:00Z'); // 11:30 AM IST

describe('to24h', () => {
  it.each([['09:54PM', '21:54'], ['9:20 PM', '21:20'], ['10.40 pm', '22:40'], ['21:05', '21:05'], ['12:10 AM', '00:10'], ['12:30PM', '12:30'], ['', ''], ['soon', '']])(
    '%s -> %s', (a, b) => expect(to24h(a)).toBe(b));
});

describe('parseScheduleDate', () => {
  it('reads "20th NOVEMBER" as this year', () => expect(parseScheduleDate('20th NOVEMBER', NOW)).toEqual({ date: '2026-11-20', note: '' }));
  it('moves a stale year to this year and says so', () => expect(parseScheduleDate('2022-11-20', NOW)).toEqual({ date: '2026-11-20', note: '2022-11-20' }));
  it('reads day/month', () => expect(parseScheduleDate('22/11', NOW).date).toBe('2026-11-22'));
  it('uses today when there is no date', () => expect(parseScheduleDate('', NOW)).toEqual({ date: '2026-11-21', note: '' }));
  it('rolls a long-gone date to next year', () => expect(parseScheduleDate('2nd January', NOW).date).toBe('2027-01-02'));
});

describe('toSchedule', () => {
  it('Discord bot schedule: IDP times, organiser and group', () => {
    const s = toSchedule(JSON.stringify({
      isSchedule: true, eventName: 'TortugaScrims', group: '3254', isTournament: false, date: '20th NOVEMBER',
      matches: [{ number: 1, idp: '09:54PM', start: '10:00PM', map: '' }, { number: 2, idp: '22:34', start: '22:40', map: '' }],
    }), NOW);
    expect(s).toEqual({
      name: 'TortugaScrims · Group 3254', type: 'scrim', date: '2026-11-20', dateNote: '',
      matches: [{ number: 1, time: '21:54', startTime: '22:00', map: 'TBD' }, { number: 2, time: '22:34', startTime: '22:40', map: 'TBD' }],
    });
  });

  it('banner with maps', () => {
    const s = toSchedule('```json\n' + JSON.stringify({
      isSchedule: true, eventName: 'EG Daily Scrims', group: '', isTournament: false, date: '',
      matches: [
        { number: 1, idp: '21:20', start: '21:30', map: 'RONDO' }, { number: 2, idp: '22:00', start: '22:10', map: 'Erangel' },
        { number: 3, idp: '22:40', start: '22:50', map: 'MIRAMAR' }, { number: 4, idp: '23:20', start: '23:30', map: 'Sanhok' },
      ],
    }) + '\n```', NOW);
    expect(s.name).toBe('EG Daily Scrims');
    expect(s.date).toBe('2026-11-21');
    expect(s.matches.map((m) => [m.time, m.map])).toEqual([['21:20', 'Rondo'], ['22:00', 'Erangel'], ['22:40', 'Miramar'], ['23:20', 'TBD']]);
  });

  it('Discord text schedule with typos: stray "Match 3 Start" and "12:10 PM" after midnight', () => {
    // What a reader returns for the EG text schedule when it copies the typos as written.
    const s = toSchedule(JSON.stringify({
      isSchedule: true, eventName: 'EG Daily Scrims', group: '', isTournament: false, date: '',
      matches: [
        { number: 1, idp: '10:50 PM', start: '10:58 PM', map: 'ERANGEL' },
        { number: 2, idp: '11:30 PM', start: '', map: 'MIRAMAR' },
        { number: 3, idp: '', start: '11:38 PM', map: '' },
        { number: 3, idp: '12:10 PM', start: '12:18 PM', map: 'RONDO' },
      ],
    }), NOW);
    expect(s.name).toBe('EG Daily Scrims');
    expect(s.matches).toEqual([
      { number: 1, time: '22:50', startTime: '22:58', map: 'Erangel' },
      { number: 2, time: '23:30', startTime: '23:38', map: 'Miramar' },
      { number: 3, time: '00:10', startTime: '00:18', map: 'Rondo' },
    ]);
  });

  it('keeps a daytime 12 PM as noon', () => {
    const s = toSchedule(JSON.stringify({
      isSchedule: true, eventName: 'Day Scrims', matches: [{ number: 1, idp: '11:20 AM', start: '11:30 AM' }, { number: 2, idp: '12:00 PM', start: '12:10 PM' }],
    }), NOW);
    expect(s.matches.map((m) => m.time)).toEqual(['11:20', '12:00']);
  });

  it('rejects images that are not schedules', () => {
    expect(() => toSchedule(JSON.stringify({ isSchedule: false, matches: [] }), NOW)).toThrow(expect.objectContaining({ name: 'NotScheduleError', status: 422 }));
  });
});

describe('readSchedule', () => {
  beforeEach(() => _resetGeminiForTests());
  afterEach(() => vi.unstubAllGlobals());
  it('asks Gemini with the schedule prompt', async () => {
    const answer = { isSchedule: true, eventName: 'EG Daily Scrims', group: '', isTournament: true, date: '', matches: [{ number: 1, idp: '9:20 PM', start: '9:30 PM', map: 'Rondo' }] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const s = await readSchedule('data:image/png;base64,' + 'A'.repeat(100));
    expect(s.type).toBe('tournament');
    expect(s.matches[0]).toMatchObject({ time: '21:20', map: 'Rondo' });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.contents[0].parts[1].text).toMatch(/IDP/);
    expect(body.generationConfig.responseSchema.required).toContain('isSchedule');
  });
});
