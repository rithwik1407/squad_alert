import { Types } from 'mongoose';
import { ChallengeRun } from '../models/index.js';
import type { Recipient } from '../notifications/types.js';
import { mongoDispatchRepo } from '../scheduler/repo.js';
import { ANSWER_WINDOW_MS, askAtFor, challengeByKey, dailyChallenge, dayKeyIST, type Challenge } from './challengeCatalog.js';
import { defaultChannels, INVITE_TTL_MS, type ChannelDeps } from './invites.js';

/** Challenge runs: create one with a classic invite, ask the squad after the match, award badges. */

const oid = (id: string) => new Types.ObjectId(id);
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export const BEGUN_QUESTION = 'Did the match begin?';
export const DONE_QUESTION = 'Was the challenge completed?';

export const begunKeyboard = (id: string) => ({
  inline_keyboard: [[{ text: '✅ Yes, we played', callback_data: `chb:${id}:y` }, { text: "❌ Didn't happen", callback_data: `chb:${id}:n` }]],
});
export const doneKeyboard = (id: string) => ({
  inline_keyboard: [[{ text: '🏅 Completed', callback_data: `chd:${id}:y` }, { text: '😤 Not this time', callback_data: `chd:${id}:n` }]],
});

/** The Telegram text for the first check. */
export const begunText = (c: Challenge) => `🎯 <b>Challenge check</b>\n${esc(c.title)} (${c.mode})\n\n${BEGUN_QUESTION}`;
export const doneText = (c: Challenge) => `🎯 <b>Challenge check</b>\n${esc(c.title)} (${c.mode})\n\n${DONE_QUESTION}`;

/** Start a challenge for a classic invite. Only the sender is on it until teammates say "I'm in". */
export async function startChallengeRun(p: { teamId: string; inviteId: string; fromId: string; challengeKey: string; invitedIds: string[]; sentAt?: Date }) {
  const c = challengeByKey(p.challengeKey);
  if (!c) return null;
  const sentAt = p.sentAt ?? new Date();
  const dayKey = dayKeyIST(sentAt);
  return ChallengeRun.create({
    teamId: p.teamId, inviteId: p.inviteId, fromId: p.fromId, challengeKey: c.key,
    daily: dailyChallenge(String(p.teamId), dayKey).key === c.key, dayKey,
    invitedIds: p.invitedIds.map(oid), playerIds: [oid(p.fromId)],
    askAt: askAtFor(sentAt, c.matches, INVITE_TTL_MS),
  });
}

/** Keep the run's players in step with invite answers: "I'm in" joins, "I'm out" leaves. */
export async function syncChallengePlayers(inviteId: string, userId: string, response: 'in' | 'out') {
  if (!Types.ObjectId.isValid(inviteId)) return;
  const update = response === 'in' ? { $addToSet: { playerIds: oid(userId) } } : { $pull: { playerIds: oid(userId) } };
  await ChallengeRun.updateOne({ inviteId: oid(inviteId), status: 'waiting', fromId: { $ne: oid(userId) } }, update);
}

/** The invite was deleted before anyone played: drop its challenge too. */
export async function cancelChallengeForInvite(inviteId: string) {
  await ChallengeRun.updateMany({ inviteId: oid(inviteId), status: 'waiting' }, { $set: { status: 'cancelled' } });
}

/** Ask one squad "Did the match begin?" on push, Telegram and the Inbox. */
export async function deliverBegunPrompt(runId: string, c: Challenge, people: Recipient[], ch: ChannelDeps = defaultChannels) {
  const path = `/challenges?check=${runId}`;
  const body = `${c.title}. Tap to answer.`;
  await ch.inbox?.(people.map((p) => p.id), { kind: 'challenge', title: `🎯 ${BEGUN_QUESTION}`, body, url: path }).catch(() => undefined);
  await Promise.all(people.map((p) => Promise.all([
    ch.push(p, { title: `🎯 ${BEGUN_QUESTION}`, body, url: path, tag: `challenge-${runId}`, inviteId: '' }),
    p.telegramChatId && p.notifyPrefs.telegram !== false ? ch.telegram(p.telegramChatId, begunText(c), begunKeyboard(runId)) : Promise.resolve(false),
  ]).catch(() => undefined)));
}

/** Tell the squad how it went. A completed challenge earns everyone on it the badge. */
export async function announceResult(runId: string, c: Challenge, outcome: 'completed' | 'failed' | 'not_played', byName: string, people: Recipient[], ch: ChannelDeps = defaultChannels) {
  const path = `/challenges?check=${runId}`;
  const title = outcome === 'completed' ? `🏅 Badge earned: ${c.badge.emoji} ${c.badge.name}` : outcome === 'failed' ? 'Challenge not completed' : 'Match did not happen';
  const body = outcome === 'completed' ? `${c.title}: done! (${byName} confirmed)`
    : outcome === 'failed' ? `${c.title}: not this time. (${byName} answered)`
      : `${byName} said the match didn't begin. No challenge this time.`;
  await ch.inbox?.(people.map((p) => p.id), { kind: 'challenge', title, body, url: path }).catch(() => undefined);
  if (outcome !== 'completed') return;
  await Promise.all(people.map((p) => Promise.all([
    ch.push(p, { title, body, url: path, tag: `challenge-done-${runId}`, inviteId: '' }),
    p.telegramChatId && p.notifyPrefs.telegram !== false ? ch.telegram(p.telegramChatId, `🏅 <b>${esc(title)}</b>\n${esc(body)}`) : Promise.resolve(false),
  ]).catch(() => undefined)));
}

/**
 * Runs whose match time is over: ask the squad (or cancel when nobody joined), and close checks
 * nobody answered for a day. Returns how many runs changed.
 */
export async function sweepChallenges(now = new Date(), ch: ChannelDeps = defaultChannels) {
  let changed = 0;
  const due = await ChallengeRun.find({ status: 'waiting', askAt: { $lte: now } }).limit(25).lean();
  for (const r of due) {
    const c = challengeByKey(r.challengeKey);
    // Nobody tapped "I'm in": there was no squad, so there's nothing to ask.
    if (!c || r.playerIds.length < 2) {
      await ChallengeRun.updateOne({ _id: r._id, status: 'waiting' }, { $set: { status: 'cancelled' } });
      changed++;
      continue;
    }
    const claimed = await ChallengeRun.updateOne({ _id: r._id, status: 'waiting' }, { $set: { status: 'asking', askedAt: now } });
    if (!claimed.modifiedCount) continue;
    changed++;
    const people = await mongoDispatchRepo.getRecipients(r.playerIds.map(String));
    await deliverBegunPrompt(String(r._id), c, people, ch).catch((e) => console.error('[challenge] prompt failed:', (e as Error).message));
  }
  const stale = await ChallengeRun.updateMany(
    { status: { $in: ['asking', 'begun'] }, askAt: { $lte: new Date(now.getTime() - ANSWER_WINDOW_MS) } },
    { $set: { status: 'expired' } },
  );
  return changed + stale.modifiedCount;
}

export type AnswerStep = 'begun' | 'done';

/**
 * A player on the run answers. The first answer for each step counts for the whole squad.
 * Returns the updated run, or null when they aren't on it or that step was already answered.
 */
export async function answerChallenge(runId: string, userId: string, step: AnswerStep, yes: boolean, now = new Date(), ch: ChannelDeps = defaultChannels) {
  if (!Types.ObjectId.isValid(runId)) return null;
  const me = oid(userId);
  const answer = { by: me, at: now, yes };
  const run = step === 'begun'
    ? await ChallengeRun.findOneAndUpdate(
        // The check opens once the match time is over, even if the reminder hasn't gone out yet.
        { _id: runId, playerIds: me, status: { $in: ['waiting', 'asking'] }, askAt: { $lte: now } },
        { $set: { begun: answer, status: yes ? 'begun' : 'not_played', askedAt: now } },
        { new: true },
      )
    : await ChallengeRun.findOneAndUpdate(
        { _id: runId, playerIds: me, status: 'begun' },
        { $set: { done: answer, status: yes ? 'completed' : 'failed', ...(yes ? { completedAt: now } : {}) } },
        { new: true },
      );
  if (!run) return null;
  if (run.status !== 'begun') {
    const c = challengeByKey(run.challengeKey);
    if (c) {
      const people = await mongoDispatchRepo.getRecipients(run.playerIds.map(String));
      const by = people.find((p) => p.id === userId);
      await announceResult(String(run._id), c, run.status as 'completed' | 'failed' | 'not_played', by?.ign || by?.name || 'A teammate', people, ch)
        .catch(() => undefined);
    }
  }
  return run;
}

/** Run the challenge sweep every 30 seconds. Returns a stop function. */
export function startChallengeSweep(everyMs = 30_000) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await sweepChallenges(); } catch (e) { console.error('[challenge] sweep failed:', (e as Error).message); } finally { busy = false; }
  }, everyMs);
  t.unref?.();
  return () => clearInterval(t);
}
