import { Types } from 'mongoose';
import { config } from '../config.js';
import { DailyReport, Match, Stats, Team, User } from '../models/index.js';
import { isGoneChat, telegramApi } from '../notifications/telegram.js';
import {
  buildDailySummary, dayRange, dueReportDay, renderDailySummary,
  type SummaryMatch, type SummaryPlayer, type SummaryStat,
} from '../lib/dailySummary.js';

/**
 * Nightly team summary on Telegram.
 *
 * Every minute (and whenever /api/cron/daily-summary is hit) we check whether yesterday's report is
 * due (12:00 AM to 11:59 AM in the display time zone). For each team that played that day, every member
 * with Telegram linked gets one message. A DailyReport row per (team, day) records who already got it,
 * so restarts, the minute loop and the cron URL never send it twice. Teams that played nothing are skipped.
 */

export interface SummaryRecipient { userId: string; chatId: string }
export interface ReportState { sentTo: string[]; attempts: number }
/** Why the lock could not be taken: the day is finished, or another run is sending right now. */
export type LockRefused = 'done' | 'locked';

export interface DailySummaryRepo {
  listTeams(): Promise<{ id: string; name: string }[]>;
  /** Non-cancelled matches of the team that started in [start, end) and before `now`. */
  getMatches(teamId: string, start: Date, end: Date, now: Date): Promise<SummaryMatch[]>;
  getStats(matchIds: string[]): Promise<SummaryStat[]>;
  getPlayers(teamId: string): Promise<(SummaryPlayer & { chatId: string | null; telegramOn: boolean })[]>;
  /** Take the (team, day) lock, or say why not. */
  acquire(teamId: string, day: string, now: Date, lockMs: number): Promise<ReportState | LockRefused>;
  markSent(teamId: string, day: string, userId: string): Promise<void>;
  release(teamId: string, day: string, result: { done: boolean; skipped?: boolean; error?: string | null }): Promise<void>;
  unlinkTelegram(userId: string): Promise<void>;
}

export type SendFn = (chatId: string, html: string) => Promise<void>;

export interface TeamRunResult {
  teamId: string;
  outcome: 'sent' | 'partial' | 'skipped' | 'already_done' | 'busy' | 'no_recipients';
  matches?: number;
  sent?: number;
  failed?: number;
  error?: string;
}

const LOCK_MS = 5 * 60_000;
/** After this many runs with failures, stop retrying that day. */
const MAX_ATTEMPTS = 5;

export async function runDailySummaries(
  now: Date,
  deps: { repo: DailySummaryRepo; send: SendFn; tz: string },
  opts: { day?: string } = {},
): Promise<{ day: string | null; teams: TeamRunResult[] }> {
  const day = opts.day ?? dueReportDay(now, deps.tz);
  if (!day) return { day: null, teams: [] };
  const { start, end } = dayRange(day, deps.tz);
  const results: TeamRunResult[] = [];

  for (const team of await deps.repo.listTeams()) {
    const state = await deps.repo.acquire(team.id, day, now, LOCK_MS);
    if (typeof state === 'string') {
      results.push({ teamId: team.id, outcome: state === 'done' ? 'already_done' : 'busy' });
      continue;
    }
    try {
      const matches = await deps.repo.getMatches(team.id, start, end, now);
      if (!matches.length) {
        await deps.repo.release(team.id, day, { done: true, skipped: true });
        results.push({ teamId: team.id, outcome: 'skipped', matches: 0 });
        continue;
      }
      const [stats, players] = await Promise.all([deps.repo.getStats(matches.map((m) => m.id)), deps.repo.getPlayers(team.id)]);
      const html = renderDailySummary(buildDailySummary({ teamName: team.name, day, matches, stats, players }), deps.tz);

      const already = new Set(state.sentTo);
      const todo = players.filter((p) => p.chatId && p.telegramOn && !already.has(p.id));
      if (!todo.length && !already.size) {
        await deps.repo.release(team.id, day, { done: true, error: 'Nobody on the team has Telegram linked' });
        results.push({ teamId: team.id, outcome: 'no_recipients', matches: matches.length });
        continue;
      }

      let sent = 0;
      const errors: string[] = [];
      for (const p of todo) {
        try {
          await deps.send(p.chatId!, html);
          await deps.repo.markSent(team.id, day, p.id);
          sent++;
        } catch (e) {
          // A blocked/deleted bot chat will never work again: unlink it and don't retry.
          if (isGoneChat(e)) {
            await deps.repo.unlinkTelegram(p.id).catch(() => {});
            continue;
          }
          errors.push(`${p.ign}: ${(e as Error).message}`);
        }
      }
      const giveUp = state.attempts >= MAX_ATTEMPTS;
      await deps.repo.release(team.id, day, { done: !errors.length || giveUp, error: errors.length ? errors.join('; ') : null });
      results.push({
        teamId: team.id, outcome: errors.length ? 'partial' : 'sent', matches: matches.length, sent, failed: errors.length,
        ...(errors.length ? { error: errors.join('; ') } : {}),
      });
    } catch (e) {
      await deps.repo.release(team.id, day, { done: false, error: (e as Error).message }).catch(() => {});
      results.push({ teamId: team.id, outcome: 'partial', error: (e as Error).message });
    }
  }
  return { day, teams: results };
}

// ── Mongo + Telegram wiring ──────────────────────────────────────────────────

const oid = (id: string) => new Types.ObjectId(id);

export const mongoDailySummaryRepo: DailySummaryRepo = {
  async listTeams() {
    const teams = await Team.find().select({ name: 1, tag: 1 }).lean();
    return teams.map((t) => ({ id: String(t._id), name: t.name }));
  },
  async getMatches(teamId, start, end, now) {
    const rows = await Match.find({
      teamId: oid(teamId),
      status: { $ne: 'cancelled' },
      startAt: { $gte: start, $lt: end.getTime() < now.getTime() ? end : now },
    }).lean();
    return rows.map((m) => ({
      id: String(m._id), title: m.title, type: m.type ?? 'scrim', map: m.map ?? 'TBD', startAt: m.startAt,
      placement: m.placement ?? null, tournamentName: m.tournamentName ?? '',
    }));
  },
  async getStats(matchIds) {
    const rows = await Stats.find({ matchId: { $in: matchIds.map(oid) } }).lean();
    return rows.map((s) => ({
      matchId: String(s.matchId), userId: String(s.userId), kills: s.kills ?? 0, damage: s.damage ?? 0,
      survivalMin: s.survivalMin ?? 0, assists: s.assists ?? 0, mvp: Boolean(s.mvp),
    }));
  },
  async getPlayers(teamId) {
    const team = await Team.findById(teamId).select({ captainId: 1, memberIds: 1 }).lean();
    const ids = team ? [team.captainId, ...(team.memberIds ?? [])] : [];
    const users = await User.find({ $or: [{ _id: { $in: ids } }, { teamId: oid(teamId) }], status: 'active' })
      .select({ ign: 1, telegramChatId: 1, notifyPrefs: 1 })
      .lean();
    return users.map((u) => ({
      id: String(u._id), ign: u.ign, chatId: u.telegramChatId ?? null, telegramOn: u.notifyPrefs?.telegram !== false,
    }));
  },
  async acquire(teamId, day, now, lockMs) {
    try {
      const doc = await DailyReport.findOneAndUpdate(
        { teamId: oid(teamId), day, done: false, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
        { $set: { lockedUntil: new Date(now.getTime() + lockMs) }, $inc: { attempts: 1 } },
        { upsert: true, new: true },
      ).lean();
      return { sentTo: (doc!.sentTo ?? []).map(String), attempts: doc!.attempts ?? 1 };
    } catch (e) {
      // Upsert hit the unique (team, day) index: the row exists and is done or locked.
      if ((e as { code?: number }).code !== 11000) throw e;
      const row = await DailyReport.findOne({ teamId: oid(teamId), day }).select({ done: 1 }).lean();
      return row?.done ? 'done' : 'locked';
    }
  },
  async markSent(teamId, day, userId) {
    await DailyReport.updateOne({ teamId: oid(teamId), day }, { $addToSet: { sentTo: oid(userId) } });
  },
  async release(teamId, day, r) {
    await DailyReport.updateOne(
      { teamId: oid(teamId), day },
      { $set: { done: r.done, skipped: Boolean(r.skipped), lastError: r.error ?? null, lockedUntil: null } },
    );
  },
  async unlinkTelegram(userId) {
    await User.updateOne({ _id: oid(userId) }, { $set: { telegramChatId: null } });
  },
};

export const telegramSummarySend: SendFn = async (chatId, html) => {
  const url = new URL('/stats', config.clientUrl).toString();
  const body = {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(url.startsWith('https://') ? { reply_markup: { inline_keyboard: [[{ text: '📈 Open team stats', url }]] } } : {}),
  };
  try {
    await telegramApi('sendMessage', body);
  } catch (e) {
    if (isGoneChat(e)) throw e;
    await new Promise((r) => setTimeout(r, 1500));
    await telegramApi('sendMessage', body);
  }
};

export const defaultSummaryDeps = () => ({ repo: mongoDailySummaryRepo, send: telegramSummarySend, tz: config.displayTimeZone });

/** Check every `everyMs` whether last night's report is due and send it. Returns a stop function. */
export function startDailySummaryLoop(everyMs = 60_000) {
  if (!config.telegram.botToken || !config.dailySummary.enabled) {
    console.log('[summary] nightly Telegram summary is off (no bot token or DAILY_SUMMARY_ENABLED=false)');
    return () => {};
  }
  let running = false;
  let finishedDay: string | null = null;
  const tick = async () => {
    if (running) return;
    const due = dueReportDay(new Date(), config.displayTimeZone);
    if (!due || due === finishedDay) return;
    running = true;
    try {
      const { day, teams } = await runDailySummaries(new Date(), defaultSummaryDeps());
      for (const t of teams) {
        if (t.outcome === 'sent' || t.outcome === 'partial' || t.outcome === 'no_recipients') {
          console.log(`[summary] ${day} team=${t.teamId} ${t.outcome} matches=${t.matches ?? '?'} sent=${t.sent ?? 0}` + (t.error ? ` error="${t.error}"` : ''));
        }
      }
      // Once every team is finished there's no need to hit the DB again until tomorrow.
      if (teams.every((t) => t.outcome !== 'partial' && t.outcome !== 'busy')) finishedDay = day;
    } catch (e) {
      console.error('[summary] run failed:', (e as Error).message);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** The message each team would get for `day`, without sending anything or touching the lock. */
export async function previewDailySummaries(day: string, deps: { repo: DailySummaryRepo; tz: string }, now = new Date()) {
  const { start, end } = dayRange(day, deps.tz);
  const out: { teamId: string; team: string; matches: number; recipients: number; message: string | null }[] = [];
  for (const team of await deps.repo.listTeams()) {
    const matches = await deps.repo.getMatches(team.id, start, end, now);
    const players = await deps.repo.getPlayers(team.id);
    const recipients = players.filter((p) => p.chatId && p.telegramOn).length;
    if (!matches.length) {
      out.push({ teamId: team.id, team: team.name, matches: 0, recipients, message: null });
      continue;
    }
    const stats = await deps.repo.getStats(matches.map((m) => m.id));
    const message = renderDailySummary(buildDailySummary({ teamName: team.name, day, matches, stats, players }), deps.tz);
    out.push({ teamId: team.id, team: team.name, matches: matches.length, recipients, message });
  }
  return out;
}
