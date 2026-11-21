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

/** The admin saved or changed the room ID / password: tell the squad straight away, with a send-off. */
export function roomNotification(m: MatchForContent, tz?: string) {
  return {
    title: `🎮 IDP updated · ${m.title}`,
    body: `${mapLabel(m.map)} · ${formatTimeIST(m.startAt, tz)}. Room ID: ${m.roomId || '-'} / Pass: ${m.roomPassword || '-'}. ` +
      'Join the lobby now. All the best, squad! Play smart, stay together and bring home the chicken dinner 🍗🔥',
    url: `/matches/${m.id}`,
    matchId: m.id,
    tag: `match-${m.id}`,
  };
}

export interface PlayerResult { kills: number; damage: number; assists: number; survivalMin: number; mvp: boolean }

/** After the results are saved: this player's own numbers only. */
export function resultsNotification(m: MatchForContent, r: PlayerResult) {
  const surv = r.survivalMin ? ` · Survived ${Math.round(r.survivalMin)} min` : '';
  return {
    title: r.mvp ? `🏆 You're the MVP of ${m.title}!` : `Your stats · ${m.title}`,
    body: `Kills ${r.kills} · Damage ${Math.round(r.damage)} · Assists ${r.assists}${surv}${r.mvp ? ' · MVP 🏆' : ''}`,
    url: `/matches/${m.id}`,
    matchId: m.id,
    tag: `results-${m.id}`,
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
