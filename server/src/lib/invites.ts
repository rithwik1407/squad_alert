import { Types } from 'mongoose';
import { config } from '../config.js';
import { ClassicInvite, User, type InviteResponse } from '../models/index.js';
import { FcmProvider } from '../notifications/fcm.js';
import { isGoneChat, telegramApi } from '../notifications/telegram.js';
import type { Recipient } from '../notifications/types.js';
import { mongoDispatchRepo } from '../scheduler/repo.js';

/** Classic-match invites: send to the picked teammates on every channel they have, and record I'm in / I'm out. */

export const INVITE_TITLE = 'Can we play a classic match?';
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export const inviteKeyboard = (id: string, url: string) => ({
  inline_keyboard: [
    [{ text: "✅ I'm in", callback_data: `ci:${id}:in` }, { text: "❌ I'm out", callback_data: `ci:${id}:out` }],
    ...(url.startsWith('https://') ? [[{ text: 'Open SquadSync', url }]] : []),
  ],
});

export interface ChannelDeps {
  push: (r: Recipient, p: { title: string; body: string; url: string; tag: string; inviteId: string }) => Promise<boolean>;
  telegram: (chatId: string, html: string, keyboard?: unknown) => Promise<boolean>;
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
      await telegramApi('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) });
      return true;
    } catch (e) {
      if (isGoneChat(e)) await User.updateOne({ telegramChatId: chatId }, { $set: { telegramChatId: null } });
      console.error('[invite] telegram failed:', (e as Error).message);
      return false;
    }
  },
};

/** Send one invite to each recipient on push and Telegram (both, not either). Returns channels per user. */
export async function deliverInvite(
  invite: { id: string; message: string; fromIgn: string },
  recipients: Recipient[],
  ch: ChannelDeps = defaultChannels,
): Promise<Map<string, string[]>> {
  const path = `/classic/${invite.id}`;
  const url = new URL(path, config.clientUrl).toString();
  const body = invite.message ? `${invite.fromIgn}: ${invite.message}` : `${invite.fromIgn} wants to play a classic match.`;
  const out = new Map<string, string[]>();
  await Promise.all(recipients.map(async (r) => {
    const got: string[] = [];
    const [p, t] = await Promise.all([
      ch.push(r, { title: INVITE_TITLE, body, url: path, tag: `classic-${invite.id}`, inviteId: invite.id }),
      r.telegramChatId && r.notifyPrefs.telegram !== false
        ? ch.telegram(r.telegramChatId, `🎮 <b>${esc(INVITE_TITLE)}</b>\n${esc(body)}`, inviteKeyboard(invite.id, url))
        : Promise.resolve(false),
    ]);
    if (p) got.push('push');
    if (t) got.push('telegram');
    out.set(r.id, got);
  }));
  return out;
}

/**
 * Record a teammate's answer. Returns the updated invite, or null when they weren't invited.
 * The sender is told on Telegram/push (best effort).
 */
export async function respondToInvite(inviteId: string, userId: string, response: InviteResponse, via: string, ch: ChannelDeps = defaultChannels) {
  if (!Types.ObjectId.isValid(inviteId)) return null;
  const invite = await ClassicInvite.findOneAndUpdate(
    { _id: inviteId, 'recipients.userId': new Types.ObjectId(userId) },
    { $set: { 'recipients.$.response': response, 'recipients.$.respondedAt': new Date(), 'recipients.$.via': via } },
    { new: true },
  );
  if (!invite) return null;
  const [who] = await mongoDispatchRepo.getRecipients([userId]);
  const [sender] = await mongoDispatchRepo.getRecipients([String(invite.fromId)]);
  if (who && sender && sender.id !== who.id) {
    const ins = invite.recipients.filter((r) => r.response === 'in').length;
    const line = `${who.ign || who.name} is ${response === 'in' ? 'in ✅' : 'out ❌'} for the classic match (${ins} in so far).`;
    await Promise.all([
      ch.push(sender, { title: response === 'in' ? `${who.ign || who.name} is in` : `${who.ign || who.name} is out`, body: line, url: `/classic/${inviteId}`, tag: `classic-reply-${inviteId}`, inviteId }),
      sender.telegramChatId && sender.notifyPrefs.telegram !== false ? ch.telegram(sender.telegramChatId, esc(line)) : Promise.resolve(false),
    ]).catch(() => undefined);
  }
  return invite;
}
