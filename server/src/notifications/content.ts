import { formatDateTimeIST, formatTimeIST } from '../lib/time.js';

export interface MatchForContent {
  id: string;
  title: string;
  map: string;
  startAt: Date;
  roomId?: string | null;
  roomPassword?: string | null;
}

const mapLabel = (map: string) => (map === 'TBD' ? 'Map TBD' : map);

function minutesLabel(min: number) {
  if (min <= 0) return 'Match starting now!';
  return `Match in ${min} minute${min === 1 ? '' : 's'}!`;
}

/** "Match in 2 minutes!" / "Scrim 1 · Erangel · 9:00 PM. Join the lobby now. Room: 1234 / Pass: abc" */
export function squadNotification(m: MatchForContent, now: Date, tz?: string) {
  const mins = Math.max(0, Math.round((m.startAt.getTime() - now.getTime()) / 60_000));
  const room = m.roomId ? `Room: ${m.roomId} / Pass: ${m.roomPassword || '-'}` : 'Room: TBA';
  return {
    title: minutesLabel(mins),
    body: `${m.title} · ${mapLabel(m.map)} · ${formatTimeIST(m.startAt, tz)}. Join the lobby now. ${room}`,
    url: `/matches/${m.id}`,
    matchId: m.id,
    tag: `match-${m.id}`,
  };
}

/** Sent the moment the captain confirms the squad: "You're in the squad" with the date and IDP time. */
export function selectedNotification(m: MatchForContent & { notifyOffsetMin?: number }, tz?: string) {
  const alertNote = m.notifyOffsetMin !== undefined ? ` You'll get the room ID ${m.notifyOffsetMin} min before.` : '';
  return {
    title: "You're in the squad! 🎯",
    body: `${m.title} · ${mapLabel(m.map)} · ${formatDateTimeIST(m.startAt, tz)}.${alertNote}`,
    url: `/matches/${m.id}`,
    matchId: m.id,
    tag: `selected-${m.id}`,
  };
}

export function captainAlert(m: MatchForContent, now: Date, tz?: string) {
  const mins = Math.max(0, Math.round((m.startAt.getTime() - now.getTime()) / 60_000));
  return {
    title: 'Squad not confirmed!',
    body: `${m.title} · ${mapLabel(m.map)} · ${formatTimeIST(m.startAt, tz)} starts in ${mins} min. Confirm your 4 and hit Send now.`,
    url: `/matches/${m.id}/squad`,
    matchId: m.id,
    tag: `captain-${m.id}`,
  };
}
