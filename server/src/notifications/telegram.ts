import type { NotificationProvider, NotificationPayload, Recipient, SendResult } from './types.js';
import { config } from '../config.js';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export class TelegramError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) { super(message); }
}

export async function telegramApi(method: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; parameters?: { retry_after?: number } };
  if (!res.ok || !json.ok) throw new TelegramError(`Telegram ${method}: ${json.description ?? res.status}`, res.status, json.parameters?.retry_after);
  return json;
}

/** Telegram says this chat can never get messages again until the player links it afresh. */
export function isGoneChat(e: unknown) {
  const msg = (e as Error).message ?? '';
  return e instanceof TelegramError && (e.status === 403 || (e.status === 400 && /chat not found|user is deactivated/i.test(msg)));
}

/** One retry for flood limits, Telegram hiccups and network timeouts (Render free instances wake up slowly). */
async function sendWithRetry(body: unknown) {
  try {
    return await telegramApi('sendMessage', body);
  } catch (e) {
    if (isGoneChat(e)) throw e;
    const wait = e instanceof TelegramError && e.retryAfter ? Math.min(e.retryAfter, 10) * 1000 : 1500;
    if (e instanceof TelegramError && e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
    await new Promise((r) => setTimeout(r, wait));
    return telegramApi('sendMessage', body);
  }
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
      await sendWithRetry({
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
      if (isGoneChat(e)) {
        return {
          ok: false,
          telegramGone: true,
          error: `${(e as Error).message}. ${r.ign || r.name} blocked or deleted the bot chat, so Telegram was unlinked. Link it again in Settings.`,
        };
      }
      return { ok: false, error: (e as Error).message };
    }
  }
}
