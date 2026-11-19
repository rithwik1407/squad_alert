import { Router } from 'express';
import { ah } from '../middleware/handlers.js';
import { User } from '../models/index.js';
import { config } from '../config.js';
import { telegramApi } from '../notifications/telegram.js';

/**
 * Telegram webhook. Set it once with:
 *   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=$API_URL/api/telegram/webhook&secret_token=$TELEGRAM_WEBHOOK_SECRET"
 * A user taps the deep link from Settings, Telegram sends "/start <token>", and we store their chat id.
 */
export const telegramRouter = Router();

telegramRouter.post('/webhook', ah(async (req, res) => {
  if (config.telegram.webhookSecret && req.get('x-telegram-bot-api-secret-token') !== config.telegram.webhookSecret) {
    return res.sendStatus(401);
  }
  const msg = req.body?.message;
  const text: string = msg?.text ?? '';
  const chatId = msg?.chat?.id;
  res.sendStatus(200); // always ack fast so Telegram does not retry

  if (!chatId) return;
  const m = text.match(/^\/start\s+([a-f0-9]{32})$/);
  if (m) {
    const user = await User.findOneAndUpdate(
      { telegramLinkToken: m[1] },
      { $set: { telegramChatId: String(chatId), telegramLinkToken: null } },
      { new: true },
    );
    const reply = user
      ? `✅ Linked to SquadSync as ${user.ign}. You'll get match alerts here when push isn't available.`
      : '⚠️ That link has expired. Open SquadSync → Settings → Link Telegram again.';
    await telegramApi('sendMessage', { chat_id: chatId, text: reply }).catch(() => {});
  } else if (text.startsWith('/start')) {
    await telegramApi('sendMessage', {
      chat_id: chatId,
      text: 'Hi! Open SquadSync → Settings → Link Telegram to connect this chat.',
    }).catch(() => {});
  }
}));
