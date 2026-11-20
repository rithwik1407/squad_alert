import { describe, expect, it } from 'vitest';
import { isChatOpen, minutesInTz } from '../src/lib/chatHours.js';

const TZ = 'Asia/Kolkata';
// 2026-11-20 15:00 UTC = 20:30 IST
const at = (utc: string) => new Date(utc);

describe('chat open hours', () => {
  it('reads minutes in IST', () => {
    expect(minutesInTz(at('2026-11-20T15:00:00Z'), TZ)).toBe(20 * 60 + 30);
  });
  it('always and closed ignore the clock', () => {
    expect(isChatOpen({ mode: 'always', openFrom: '10:00', openTo: '11:00' }, at('2026-11-20T15:00:00Z'), TZ)).toBe(true);
    expect(isChatOpen({ mode: 'closed', openFrom: '00:00', openTo: '00:00' }, at('2026-11-20T15:00:00Z'), TZ)).toBe(false);
  });
  it('same-day window', () => {
    const s = { mode: 'hours' as const, openFrom: '18:00', openTo: '22:00' };
    expect(isChatOpen(s, at('2026-11-20T15:00:00Z'), TZ)).toBe(true); // 20:30
    expect(isChatOpen(s, at('2026-11-20T17:00:00Z'), TZ)).toBe(false); // 22:30
    expect(isChatOpen(s, at('2026-11-20T16:30:00Z'), TZ)).toBe(false); // 22:00 exactly closes
  });
  it('window past midnight', () => {
    const s = { mode: 'hours' as const, openFrom: '22:00', openTo: '02:00' };
    expect(isChatOpen(s, at('2026-11-20T17:00:00Z'), TZ)).toBe(true); // 22:30
    expect(isChatOpen(s, at('2026-11-20T19:30:00Z'), TZ)).toBe(true); // 01:00
    expect(isChatOpen(s, at('2026-11-20T15:00:00Z'), TZ)).toBe(false); // 20:30
  });
});
