import type { Channel, LogKind, LogStatus, MatchStatus } from '../models/constants.js';
import type { NotificationPayload, NotificationProvider, Recipient } from '../notifications/types.js';
import { captainAlert, squadNotification } from '../notifications/content.js';
import { fireAt } from '../lib/time.js';

export type Trigger = 'scheduled' | 'manual' | 'resend' | 'substitute';

export interface DispatchMatch {
  id: string;
  teamId: string;
  title: string;
  map: string;
  startAt: Date;
  notifyOffsetMin: number;
  roomId: string;
  roomPassword: string;
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
  outcome: 'squad' | 'captain_alert' | 'skipped';
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

  // Meta's free test number allows only 5 verified recipients (the players), so captain alerts try WhatsApp last.
  const providers = kind === 'captain_alert'
    ? [...deps.providers.filter((p) => p.channel !== 'whatsapp'), ...deps.providers.filter((p) => p.channel === 'whatsapp')]
    : deps.providers;
  for (const provider of providers) {
    if (!provider.canReach(user)) continue;
    attempted = true;
    let res;
    try {
      res = await provider.send(user, payload);
    } catch (e) {
      res = { ok: false, error: (e as Error).message };
    }
    if (res.invalidTokens?.length) await deps.repo.removeFcmTokens(user.id, res.invalidTokens);
    if (res.telegramGone) await deps.repo.clearTelegramChat?.(user.id);

    if (res.ok) {
      const inserted = await deps.repo.writeLog({
        ...base, channel: provider.channel, status: 'sent', sentAt: now(), error: null,
      });
      return inserted ? 'sent' : 'duplicate';
    }
    await deps.repo.writeLog({
      ...base, channel: provider.channel, status: 'failed', sentAt: now(), error: res.error ?? 'unknown error',
    });
  }

  if (!attempted) {
    await deps.repo.writeLog({
      ...base, channel: 'none', status: 'failed', sentAt: now(),
      error: 'No reachable channel: enable push or link Telegram',
    });
  }
  return 'failed';
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
  if (match.status === 'cancelled' || match.status === 'done') return { ...result, reason: `match ${match.status}` };

  if (opts.trigger === 'scheduled') {
    const due = fireAt(match.startAt, match.notifyOffsetMin).getTime();
    if (due - now().getTime() > STALE_TOLERANCE_MS) return { ...result, reason: 'stale job: match was rescheduled' };
  }

  const squad = await deps.repo.getSquad(matchId);

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
