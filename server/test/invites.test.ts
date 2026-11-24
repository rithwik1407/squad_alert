import { describe, expect, it, vi } from 'vitest';
import { deliverInvite, inviteKeyboard } from '../src/lib/invites.js';
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
    expect(out.get('u1')).toEqual(['push', 'telegram']);
    expect(out.get('u2')).toEqual(['push']);
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
});
