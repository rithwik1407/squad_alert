export const TZ = 'Asia/Kolkata';
const IST_OFFSET_MIN = 330;

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, ...o });
const timeF = fmt({ hour: 'numeric', minute: '2-digit', hour12: true });
const dayF = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const fullF = fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const keyF = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });

const up = (s: string) => s.replace(/\b(am|pm)\b/g, (m) => m.toUpperCase());

/** "9:00 PM" (IST) */
export const timeIST = (iso: string | Date) => up(timeF.format(new Date(iso)));
/** "Thu, 19 Nov" (IST) */
export const dayIST = (iso: string | Date) => dayF.format(new Date(iso));
export const fullIST = (iso: string | Date) => up(fullF.format(new Date(iso)));

export const isTodayIST = (iso: string | Date) => keyF.format(new Date(iso)) === keyF.format(new Date());

export function relativeDay(iso: string) {
  const k = keyF.format(new Date(iso));
  if (k === keyF.format(new Date())) return 'Today';
  if (k === keyF.format(new Date(Date.now() + 864e5))) return 'Tomorrow';
  return dayIST(iso);
}

/** UTC ISO -> "YYYY-MM-DDTHH:mm" in IST for <input type="datetime-local">. */
export function toISTInput(iso: string | Date) {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60_000);
  return d.toISOString().slice(0, 16);
}

/** "YYYY-MM-DDTHH:mm" typed in IST -> UTC ISO. */
export function fromISTInput(local: string) {
  return new Date(`${local}:00+05:30`).toISOString();
}

export function splitDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

export function ago(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return dayIST(iso);
}
