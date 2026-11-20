/** Chat open-hours math, in the team's display time zone. Pure so it can be unit tested. */

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Minutes since midnight of `now` in time zone `tz`. */
export function minutesInTz(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export interface ChatSchedule { mode: 'always' | 'hours' | 'closed'; openFrom: string; openTo: string }

/** Is chat open right now? If from === to the window is the whole day. */
export function isChatOpen(s: ChatSchedule, now: Date, tz: string): boolean {
  if (s.mode === 'always') return true;
  if (s.mode === 'closed') return false;
  const from = toMin(s.openFrom);
  const to = toMin(s.openTo);
  if (from === to) return true;
  const cur = minutesInTz(now, tz);
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}
