import { describe, expect, it, vi } from 'vitest';
import { announceReply, deliverInvite, inviteEndsAt, inviteKeyboard, INVITE_TTL_MS } from '../src/lib/invites.js';
import { user } from './fakes.js';

describe('classic match invites', () => {
  it('sends on both push and Telegram, with I\'m in / I\'m out buttons', async () => {
    const push = vi.fn(async () => true);
    const telegram = vi.fn(async () => true);
    const out = await deliverInvite(
      { id: 'a'.repeat(24), message: 'Classic at 9?', fromIgn: 'RARE | VIVEK' },
      [user('u1'), user('u2', { telegramChatId: null }), user('u3', { fcmTokens: [] })],
      { push, telegram },
    );
    expect(push).toHaveBeenCalledTimes(3);
    expect(telegram).toHaveBeenCalledTimes(2);
    const [, html, kb] = telegram.mock.calls[0] as unknown as [string, string, { inline_keyboard: { callback_data?: string }[][] }];
    expect(html).toContain('Can we play a classic match?');
    expect(html).toContain('RARE | VIVEK: Classic at 9?');
    expect(kb.inline_keyboard[0].map((b) => b.callback_data)).toEqual([`ci:${'a'.repeat(24)}:in`, `ci:${'a'.repeat(24)}:out`]);
    expect(out.get('u1')).toEqual({ delivered: ['push', 'telegram'], tgMessageId: null });
    expect(out.get('u2')).toEqual({ delivered: ['push'], tgMessageId: null });
  });

  it('skips Telegram for players who turned it off', async () => {
    const telegram = vi.fn(async () => true);
    await deliverInvite({ id: 'b'.repeat(24), message: '', fromIgn: 'X' },
      [user('u1', { notifyPrefs: { push: true, telegram: false, whatsapp: false } })], { push: async () => false, telegram });
    expect(telegram).not.toHaveBeenCalled();
  });

  it('only adds a link button for https URLs', () => {
    expect(inviteKeyboard('c'.repeat(24), 'http://localhost/x').inline_keyboard).toHaveLength(1);
    expect(inviteKeyboard('c'.repeat(24), 'https://app/x').inline_keyboard).toHaveLength(2);
  });

  it('keeps the Telegram message id so the invite can be deleted later', async () => {
    const out = await deliverInvite({ id: 'd'.repeat(24), message: '', fromIgn: 'X' }, [user('u1')],
      { push: async () => true, telegram: async () => 4242 });
    expect(out.get('u1')).toEqual({ delivered: ['push', 'telegram'], tgMessageId: 4242 });
  });

  it('runs out 7 minutes after it is sent', () => {
    expect(INVITE_TTL_MS).toBe(7 * 60_000);
    expect(inviteEndsAt('2026-11-25T10:00:00Z').toISOString()).toBe('2026-11-25T10:07:00.000Z');
  });

  it('tells the sender and every other invited teammate about an answer, on push and Telegram', async () => {
    const push = vi.fn(async () => true);
    const telegram = vi.fn(async () => true);
    const sender = user('s1');
    const who = user('u1');
    const other = user('u2');
    const noTg = user('u3', { telegramChatId: null });
    await announceReply({ id: 'e'.repeat(24), recipientsIn: 1 }, who, 'in', [sender, who, other, noTg], { push, telegram });
    expect(push.mock.calls.map((c) => (c as unknown as [{ id: string }])[0].id).sort()).toEqual(['s1', 'u2', 'u3']);
    expect(telegram.mock.calls.map((c) => (c as unknown as [string])[0]).sort()).toEqual(['chat-s1', 'chat-u2']);
    expect((telegram.mock.calls[0] as unknown as [string, string])[1]).toContain('RARE丨U1 is in ✅ for the classic match (1 in so far)');
  });
});
