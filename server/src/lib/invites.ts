import { Types } from 'mongoose';
import { config } from '../config.js';
import { ClassicInvite, User, type InviteResponse } from '../models/index.js';
import { FcmProvider } from '../notifications/fcm.js';
import { isGoneChat, telegramApi } from '../notifications/telegram.js';
import type { Recipient } from '../notifications/types.js';
import { mongoDispatchRepo } from '../scheduler/repo.js';
import { saveToInbox, type InboxEntry } from './inbox.js';

/** Classic-match invites: send to the picked teammates on every channel they have, and record I'm in / I'm out. */

export const INVITE_TITLE = 'Can we play a classic match?';
/** An invite lives for 7 minutes after it is sent, then it is gone for everyone. */
export const INVITE_TTL_MS = 7 * 60_000;
/** MongoDB removes it this long after it runs out (the Telegram cleanup runs in between). */
const PURGE_GRACE_MS = 10 * 60_000;
export const inviteEndsAt = (createdAt: Date | string | number) => new Date(new Date(createdAt).getTime() + INVITE_TTL_MS);
export const purgeAt = (createdAt: Date | string | number) => new Date(inviteEndsAt(createdAt).getTime() + PURGE_GRACE_MS);
/** Mongo filter: invites that have not run out yet. */
export const liveInvite = () => ({ createdAt: { $gt: new Date(Date.now() - INVITE_TTL_MS) } });
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export const inviteKeyboard = (id: string, url: string) => ({
  inline_keyboard: [
    [{ text: "✅ I'm in", callback_data: `ci:${id}:in` }, { text: "❌ I'm out", callback_data: `ci:${id}:out` }],
    ...(url.startsWith('https://') ? [[{ text: 'Open SquadSync', url }]] : []),
  ],
});

export interface ChannelDeps {
  push: (r: Recipient, p: { title: string; body: string; url: string; tag: string; inviteId: string }) => Promise<boolean>;
  /** Resolves to the Telegram message id when sent (truthy), false otherwise. */
  telegram: (chatId: string, html: string, keyboard?: unknown) => Promise<number | boolean>;
  /** Delete a Telegram message (best effort). */
  removeTelegram?: (chatId: string, messageId: number) => Promise<void>;
  /** Copy the notification into these members' Inbox (best effort). */
  inbox?: (userIds: string[], entry: InboxEntry) => Promise<void>;
}

const fcm = new FcmProvider();
export const defaultChannels: ChannelDeps = {
  async push(r, p) {
    if (!fcm.isConfigured() || !fcm.canReach(r)) return false;
    try {
      const res = await fcm.send(r, { title: p.title, body: p.body, url: p.url, tag: p.tag, matchId: '', extra: { inviteId: p.inviteId } });
      if (res.invalidTokens?.length) await mongoDispatchRepo.removeFcmTokens(r.id, res.invalidTokens);
      return res.ok;
    } catch (e) {
      console.error('[invite] push failed:', (e as Error).message);
      return false;
    }
  },
  async telegram(chatId, html, keyboard) {
    if (!config.telegram.botToken) return false;
    try {
      const res = await telegramApi('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) }) as { result?: { message_id?: number } };
      return res.result?.message_id ?? true;
    } catch (e) {
      if (isGoneChat(e)) await User.updateOne({ telegramChatId: chatId }, { $set: { telegramChatId: null } });
      console.error('[invite] telegram failed:', (e as Error).message);
      return false;
    }
  },
  inbox: saveToInbox,
  async removeTelegram(chatId, messageId) {
    if (!config.telegram.botToken) return;
    await telegramApi('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(async () => {
      // Too old or already gone: at least take the buttons away.
      await telegramApi('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    });
  },
};

export interface Delivery { delivered: string[]; tgMessageId: number | null }

/** Send one invite to each recipient on push and Telegram (both, not either). Returns channels (and the Telegram message) per user. */
export async function deliverInvite(
  invite: { id: string; message: string; fromIgn: string },
  recipients: Recipient[],
  ch: ChannelDeps = defaultChannels,
): Promise<Map<string, Delivery>> {
  const path = `/classic/${invite.id}`;
  const url = new URL(path, config.clientUrl).toString();
  const body = invite.message ? `${invite.fromIgn}: ${invite.message}` : `${invite.fromIgn} wants to play a classic match.`;
  const out = new Map<string, Delivery>();
  await ch.inbox?.(recipients.map((r) => r.id), { kind: 'invite', title: INVITE_TITLE, body, url: path }).catch(() => undefined);
  await Promise.all(recipients.map(async (r) => {
    const got: string[] = [];
    const [p, t] = await Promise.all([
      ch.push(r, { title: INVITE_TITLE, body, url: path, tag: `classic-${invite.id}`, inviteId: invite.id }),
      r.telegramChatId && r.notifyPrefs.telegram !== false
        ? ch.telegram(r.telegramChatId, `🎮 <b>${esc(INVITE_TITLE)}</b>\n${esc(body)}\n<i>Answer within 7 minutes.</i>`, inviteKeyboard(invite.id, url))
        : Promise.resolve(false),
    ]);
    if (p) got.push('push');
    if (t) got.push('telegram');
    out.set(r.id, { delivered: got, tgMessageId: typeof t === 'number' ? t : null });
  }));
  return out;
}

/**
 * Tell everyone else on the invite (the sender and the other invited teammates) about an answer,
 * on both push and Telegram.
 */
export async function announceReply(
  invite: { id: string; recipientsIn: number },
  who: Recipient,
  response: InviteResponse,
  people: Recipient[],
  ch: ChannelDeps = defaultChannels,
) {
  const name = who.ign || who.name;
  const line = `${name} is ${response === 'in' ? 'in ✅' : 'out ❌'} for the classic match (${invite.recipientsIn} in so far).`;
  const title = response === 'in' ? `${name} is in` : `${name} is out`;
  const others = people.filter((p) => p.id !== who.id);
  await ch.inbox?.(others.map((p) => p.id), { kind: 'invite', title, body: line, url: `/classic/${invite.id}` }).catch(() => undefined);
  await Promise.all(people.filter((p) => p.id !== who.id).map((p) => Promise.all([
    ch.push(p, { title, body: line, url: `/classic/${invite.id}`, tag: `classic-reply-${invite.id}`, inviteId: invite.id }),
    p.telegramChatId && p.notifyPrefs.telegram !== false ? ch.telegram(p.telegramChatId, esc(line)) : Promise.resolve(false),
  ]).catch(() => undefined)));
}

/**
 * Record a teammate's answer. Returns the updated invite, or null when they weren't invited or it ran out.
 * Everyone else on the invite is told on push and Telegram (best effort).
 */
export async function respondToInvite(inviteId: string, userId: string, response: InviteResponse, via: string, ch: ChannelDeps = defaultChannels) {
  if (!Types.ObjectId.isValid(inviteId)) return null;
  const invite = await ClassicInvite.findOneAndUpdate(
    { _id: inviteId, 'recipients.userId': new Types.ObjectId(userId), ...liveInvite() },
    { $set: { 'recipients.$.response': response, 'recipients.$.respondedAt': new Date(), 'recipients.$.via': via } },
    { new: true },
  );
  if (!invite) return null;
  const ids = [...new Set([String(invite.fromId), ...invite.recipients.map((r) => String(r.userId))])];
  const people = await mongoDispatchRepo.getRecipients(ids);
  const who = people.find((p) => p.id === userId);
  if (who) {
    const recipientsIn = invite.recipients.filter((r) => r.response === 'in').length;
    await announceReply({ id: String(invite._id), recipientsIn }, who, response, people, ch).catch(() => undefined);
  }
  return invite;
}

/** Delete the Telegram messages of invites that ran out. Returns how many invites were cleaned. */
export async function clearExpiredInvites(ch: ChannelDeps = defaultChannels) {
  const due = await ClassicInvite.find({ createdAt: { $lte: new Date(Date.now() - INVITE_TTL_MS) }, tgCleared: { $ne: true } })
    .select('recipients').limit(50).lean();
  for (const inv of due) {
    const withMsg = inv.recipients.filter((r) => r.tgMessageId);
    if (withMsg.length && ch.removeTelegram) {
      const users = await User.find({ _id: { $in: withMsg.map((r) => r.userId) } }).select('telegramChatId').lean();
      const chat = new Map(users.map((u) => [String(u._id), u.telegramChatId]));
      await Promise.all(withMsg.map((r) => {
        const c = chat.get(String(r.userId));
        return c ? ch.removeTelegram!(c, r.tgMessageId!).catch(() => undefined) : undefined;
      }));
    }
    await ClassicInvite.updateOne({ _id: inv._id }, { $set: { tgCleared: true } });
  }
  return due.length;
}

/** Run the cleanup every 30 seconds. Returns a stop function. */
export function startInviteSweep(everyMs = 30_000) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await clearExpiredInvites(); } catch (e) { console.error('[invite] sweep failed:', (e as Error).message); } finally { busy = false; }
  }, everyMs);
  t.unref?.();
  return () => clearInterval(t);
}
