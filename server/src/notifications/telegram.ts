import type { NotificationProvider, NotificationPayload, Recipient, SendResult } from './types.js';
import { config } from '../config.js';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export async function telegramApi(method: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!res.ok || !json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
  return json;
}

export class TelegramProvider implements NotificationProvider {
  readonly channel = 'telegram' as const;

  isConfigured() {
    return Boolean(config.telegram.botToken);
  }

  canReach(r: Recipient) {
    return r.notifyPrefs.telegram !== false && Boolean(r.telegramChatId);
  }

  async send(r: Recipient, p: NotificationPayload): Promise<SendResult> {
    const url = new URL(p.url, config.clientUrl).toString();
    try {
      await telegramApi('sendMessage', {
        chat_id: r.telegramChatId,
        text: `🎮 <b>${esc(p.title)}</b>\n${esc(p.body)}`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            // Captain alerts get no "joining" button.
            ...(p.tag.startsWith('match-') ? [{ text: "✅ I'm joining", callback_data: `join:${p.matchId}` }] : []),
            // Telegram rejects localhost URLs in buttons.
            ...(url.startsWith('https://') ? [{ text: 'Open match', url }] : []),
          ]],
        },
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
