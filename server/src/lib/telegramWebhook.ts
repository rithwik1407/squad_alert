import { config } from '../config.js';
import { telegramApi } from '../notifications/telegram.js';

const WANT = ['message', 'callback_query'];

/**
 * Make sure Telegram sends button taps (callback_query) to us, not only messages. A webhook set by hand with
 * allowed_updates=["message"], or never set, means "I'm in" / "I'm joining" taps never reach the server.
 * Uses TELEGRAM_WEBHOOK_URL, else Render's RENDER_EXTERNAL_URL, only when no webhook is set yet.
 */
export async function ensureTelegramWebhook() {
  if (!config.telegram.botToken) return;
  try {
    const info = (await telegramApi('getWebhookInfo', {})) as { result?: { url?: string; allowed_updates?: string[]; last_error_message?: string } };
    const cur = info.result ?? {};
    const fallback = process.env.TELEGRAM_WEBHOOK_URL
      || (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/api/telegram/webhook` : '');
    const url = cur.url || fallback;
    if (cur.last_error_message) console.warn(`[telegram] webhook last error: ${cur.last_error_message}`);
    if (!url) { console.warn('[telegram] no webhook set: set TELEGRAM_WEBHOOK_URL so button taps reach the server'); return; }
    const missing = !cur.url || (cur.allowed_updates?.length && !WANT.every((u) => cur.allowed_updates!.includes(u)));
    if (!missing) return;
    await telegramApi('setWebhook', {
      url, allowed_updates: WANT,
      ...(config.telegram.webhookSecret ? { secret_token: config.telegram.webhookSecret } : {}),
    });
    console.log(`[telegram] webhook set to ${url} (messages and button taps)`);
  } catch (e) {
    console.error('[telegram] could not check the webhook:', (e as Error).message);
  }
}
