import type { Channel, LogKind, LogStatus, MatchStatus } from '../models/constants.js';
import type { NotificationPayload, NotificationProvider, Recipient } from '../notifications/types.js';
import { captainAlert, resultsNotification, roomNotification, selectedNotification, squadNotification, type PlayerResult } from '../notifications/content.js';
import { fireAt } from '../lib/time.js';

export type Trigger = 'scheduled' | 'manual' | 'resend' | 'substitute' | 'selected' | 'results' | 'room';

export interface DispatchMatch {
  id: string;
  teamId: string;
  title: string;
  map: string;
  startAt: Date;
  notifyOffsetMin: number;
  roomId: string;
  roomPassword: string;
  slot?: string;
  status: MatchStatus;
  notifiedAt: Date | null;
}

export interface DispatchSquad {
  selectedIds: string[];
  confirmed: boolean;
}

export interface LogEntry {
  matchId: string;
  userId: string;
  kind: LogKind;
  channel: Channel;
  status: LogStatus;
  trigger: Trigger;
  title: string;
  body: string;
  sentAt: Date;
  error: string | null;
  /** Extra channels that also delivered it. */
  alsoVia?: Channel[];
  /** Alerts that are sent again on every change (room updates): replace the previous "sent" row. */
  repeatable?: boolean;
}

/** Storage the dispatcher needs. Mongo implementation in repo.ts; in-memory one in the tests. */
export interface DispatchRepo {
  getMatch(matchId: string): Promise<DispatchMatch | null>;
  getSquad(matchId: string): Promise<DispatchSquad | null>;
  getCaptainId(teamId: string): Promise<string | null>;
  getRecipients(userIds: string[]): Promise<Recipient[]>;
  hasSent(matchId: string, userId: string, kind: LogKind): Promise<boolean>;
  /**
   * Atomically reserve the right to deliver to this user. Returns false if another run holds it,
   * so two overlapping runs (scheduled job + Send now) can never both send.
   */
  claim(matchId: string, userId: string, kind: LogKind): Promise<boolean>;
  /** Give up a claim after a failed delivery so "Resend to failed" can retry. */
  release(matchId: string, userId: string, kind: LogKind): Promise<void>;
  /** Must return false (not throw) if a "sent" row for this (match, user, kind) already exists. */
  writeLog(entry: LogEntry): Promise<boolean>;
  markNotified(matchId: string, at: Date): Promise<void>;
  markCaptainAlerted(matchId: string, at: Date): Promise<void>;
  removeFcmTokens(userId: string, tokens: string[]): Promise<void>;
  /** Optional: forget a Telegram chat that can no longer receive messages. */
  clearTelegramChat?(userId: string): Promise<void>;
  /** Saved per-player stats for a match (kills, damage, MVP...). */
  getResults?(matchId: string): Promise<(PlayerResult & { userId: string })[]>;
}

export interface DispatchDeps {
  repo: DispatchRepo;
  providers: NotificationProvider[];
  now?: () => Date;
  timeZone?: string;
}

export interface DispatchOptions {
  trigger: Trigger;
  /** Restrict to these users (used for emergency substitutes). */
  onlyUserIds?: string[];
}

export interface DispatchResult {
  outcome: 'squad' | 'captain_alert' | 'selected' | 'results' | 'room' | 'skipped';
  reason?: string;
  sent: string[];
  failed: string[];
  alreadySent: string[];
}

/** A scheduled job that fires earlier than this before its target is treated as stale (match was moved). */
const STALE_TOLERANCE_MS = 30_000;

/**
 * Deliver one payload to one user: try each provider in order, log every attempt,
 * stop at the first success.
 */
async function deliver(
  deps: DispatchDeps,
  matchId: string,
  user: Recipient,
  kind: LogKind,
  trigger: Trigger,
  payload: NotificationPayload,
): Promise<'sent' | 'failed' | 'duplicate'> {
  if (await deps.repo.hasSent(matchId, user.id, kind)) return 'duplicate';
  if (!(await deps.repo.claim(matchId, user.id, kind))) return 'duplicate';
  const status = await attemptDelivery(deps, matchId, user, kind, trigger, payload);
  if (status === 'failed') await deps.repo.release(matchId, user.id, kind);
  return status;
}

async function attemptDelivery(
  deps: DispatchDeps,
  matchId: string,
  user: Recipient,
  kind: LogKind,
  trigger: Trigger,
  payload: NotificationPayload,
): Promise<'sent' | 'failed' | 'duplicate'> {
  const now = deps.now ?? (() => new Date());
  const base = { matchId, userId: user.id, kind, trigger, title: payload.title, body: payload.body };
  let attempted = false;

  const reachable = deps.providers.filter((p) => p.canReach(user));
  if (!reachable.length) {
    await deps.repo.writeLog({
      ...base, channel: 'none', status: 'failed', sentAt: now(),
      error: 'No reachable channel: enable push or link Telegram',
    });
    return 'failed';
  }

  // Send on every channel the player has turned on (push AND Telegram), not just the first that works,
  // so a push that lands silently on a sleeping phone is backed up by Telegram.
  const sendAll = (list: NotificationProvider[]) => Promise.all(list.map(async (provider) => {
    let res;
    try {
      res = await provider.send(user, payload);
    } catch (e) {
      res = { ok: false, error: (e as Error).message } as const;
    }
    if (res.invalidTokens?.length) await deps.repo.removeFcmTokens(user.id, res.invalidTokens);
    if (res.telegramGone) await deps.repo.clearTelegramChat?.(user.id);
    return { channel: provider.channel, res };
  }));

  // Meta's free test number allows only 5 verified recipients (the players), so captain alerts use WhatsApp
  // only when nothing else reached the captain.
  let outcomes;
  if (kind === 'captain_alert') {
    const first = reachable.filter((p) => p.channel !== 'whatsapp');
    outcomes = await sendAll(first);
    if (!outcomes.some((o) => o.res.ok)) outcomes.push(...(await sendAll(reachable.filter((p) => p.channel === 'whatsapp'))));
  } else {
    outcomes = await sendAll(reachable);
  }

  for (const o of outcomes) {
    if (o.res.ok) continue;
    await deps.repo.writeLog({
      ...base, channel: o.channel, status: 'failed', sentAt: now(), error: o.res.error ?? 'unknown error',
    });
  }
  const ok = outcomes.filter((o) => o.res.ok).map((o) => o.channel);
  if (!ok.length) return 'failed';
  const inserted = await deps.repo.writeLog({
    ...base, channel: ok[0], alsoVia: ok.slice(1), status: 'sent', sentAt: now(), error: null,
    ...(kind === 'room' ? { repeatable: true } : {}),
  });
  return inserted ? 'sent' : 'duplicate';
}

/**
 * The heart of SquadSync. Called by the worker when a match's delayed job fires,
 * and by "Send now" / "Resend to failed" / substitutions.
 *
 * - No confirmed squad: alert the captain only (and leave the squad unlocked).
 * - Otherwise: notify the 4 selected players. The benched player gets nothing.
 * - Idempotent: anyone who already has a "sent" log for this match is skipped.
 */
export async function dispatchMatch(matchId: string, opts: DispatchOptions, deps: DispatchDeps): Promise<DispatchResult> {
  const now = deps.now ?? (() => new Date());
  const result: DispatchResult = { outcome: 'skipped', sent: [], failed: [], alreadySent: [] };

  const match = await deps.repo.getMatch(matchId);
  if (!match) return { ...result, reason: 'match not found' };

  // Room ID / password saved or changed: every squad player, every time (no once-only dedupe).
  if (opts.trigger === 'room') {
    if (match.status === 'cancelled' || match.status === 'done') return { ...result, reason: `match ${match.status}` };
    if (!match.roomId) return { ...result, reason: 'no room id' };
    const squad = await deps.repo.getSquad(matchId);
    if (!squad?.confirmed) return { ...result, reason: 'squad not confirmed' };
    result.outcome = 'room';
    let ids = squad.selectedIds.map(String);
    if (opts.onlyUserIds) ids = ids.filter((id) => opts.onlyUserIds!.includes(id));
    const payload = roomNotification(match, deps.timeZone);
    const users = await deps.repo.getRecipients(ids);
    await Promise.all(ids.map(async (id) => {
      const u = users.find((x) => x.id === id);
      if (!u) return void result.failed.push(id);
      const status = await attemptDelivery(deps, matchId, u, 'room', opts.trigger, payload);
      (status === 'failed' ? result.failed : result.sent).push(id);
    }));
    return result;
  }

  // After the admin saves results: each player gets only their own stats.
  if (opts.trigger === 'results') {
    if (match.status === 'cancelled') return { ...result, reason: 'match cancelled' };
    result.outcome = 'results';
    let rows = (await deps.repo.getResults?.(matchId)) ?? [];
    if (opts.onlyUserIds) rows = rows.filter((r) => opts.onlyUserIds!.includes(r.userId));
    const users = await deps.repo.getRecipients(rows.map((r) => r.userId));
    await Promise.all(rows.map(async (row) => {
      const u = users.find((x) => x.id === row.userId);
      if (!u) return void result.failed.push(row.userId);
      const status = await deliver(deps, matchId, u, 'results', opts.trigger, resultsNotification(match, row));
      (status === 'sent' ? result.sent : status === 'duplicate' ? result.alreadySent : result.failed).push(row.userId);
    }));
    return result;
  }

  if (match.status === 'cancelled' || match.status === 'done') return { ...result, reason: `match ${match.status}` };

  if (opts.trigger === 'scheduled') {
    const due = fireAt(match.startAt, match.notifyOffsetMin).getTime();
    if (due - now().getTime() > STALE_TOLERANCE_MS) return { ...result, reason: 'stale job: match was rescheduled' };
  }

  const squad = await deps.repo.getSquad(matchId);

  // "You're in the squad" the moment the captain confirms. Only before the room-ID alert goes out.
  if (opts.trigger === 'selected') {
    if (!squad?.confirmed) return { ...result, reason: 'squad not confirmed' };
    if (match.notifiedAt) return { ...result, reason: 'room alert already sent' };
    if (match.startAt.getTime() <= now().getTime()) return { ...result, reason: 'match already started' };
    result.outcome = 'selected';
    let ids = squad.selectedIds.map(String);
    if (opts.onlyUserIds) ids = ids.filter((id) => opts.onlyUserIds!.includes(id));
    const payload = selectedNotification(match, deps.timeZone);
    const users = await deps.repo.getRecipients(ids);
    await Promise.all(ids.map(async (id) => {
      const u = users.find((x) => x.id === id);
      if (!u) return void result.failed.push(id);
      const status = await deliver(deps, matchId, u, 'selected', opts.trigger, payload);
      (status === 'sent' ? result.sent : status === 'duplicate' ? result.alreadySent : result.failed).push(id);
    }));
    return result;
  }

  if (!squad || !squad.confirmed) {
    if (opts.trigger !== 'scheduled') return { ...result, reason: 'squad not confirmed' };
    const captainId = await deps.repo.getCaptainId(match.teamId);
    if (!captainId) return { ...result, reason: 'no captain' };
    result.outcome = 'captain_alert';
    if (await deps.repo.hasSent(matchId, captainId, 'captain_alert')) {
      result.alreadySent.push(captainId);
      return result;
    }
    const [captain] = await deps.repo.getRecipients([captainId]);
    if (!captain) return { ...result, reason: 'captain not found' };
    const status = await deliver(deps, matchId, captain, 'captain_alert', opts.trigger, captainAlert(match, now(), deps.timeZone));
    (status === 'sent' ? result.sent : status === 'duplicate' ? result.alreadySent : result.failed).push(captainId);
    await deps.repo.markCaptainAlerted(matchId, now());
    return result;
  }

  result.outcome = 'squad';
  let targets = squad.selectedIds.map(String);
  if (opts.onlyUserIds) targets = targets.filter((id) => opts.onlyUserIds!.includes(id));

  const pending: string[] = [];
  for (const id of targets) {
    if (await deps.repo.hasSent(matchId, id, 'squad')) result.alreadySent.push(id);
    else pending.push(id);
  }

  const payload = squadNotification(match, now(), deps.timeZone);
  const recipients = await deps.repo.getRecipients(pending);
  const byId = new Map(recipients.map((r) => [r.id, r]));

  await Promise.all(
    pending.map(async (id) => {
      const user = byId.get(id);
      if (!user) {
        result.failed.push(id);
        return;
      }
      const status = await deliver(deps, matchId, user, 'squad', opts.trigger, payload);
      (status === 'sent' ? result.sent : status === 'duplicate' ? result.alreadySent : result.failed).push(id);
    }),
  );

  if (!match.notifiedAt) await deps.repo.markNotified(matchId, now());
  return result;
}
