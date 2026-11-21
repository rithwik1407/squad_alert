import { Router } from 'express';
import { ah } from '../middleware/handlers.js';
import { User } from '../models/index.js';
import { config } from '../config.js';
import { telegramApi } from '../notifications/telegram.js';
import { markJoining } from '../lib/availability.js';
import { Match } from '../models/index.js';

/**
 * Telegram webhook. Set it once with:
 *   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=$API_URL/api/telegram/webhook&secret_token=$TELEGRAM_WEBHOOK_SECRET"
 * A user taps the deep link from Settings, Telegram sends "/start <token>", and we store their chat id.
 */
export const telegramRouter = Router();

/**
 * Send the SquadSync alert sound so the player can set it as this chat's notification sound
 * (Telegram: long-press → Save for notifications; then chat → Notifications → Sound).
 */
async function sendAlertSound(chatId: number | string) {
  const url = new URL('/sounds/squadsync-alert.mp3', config.clientUrl).toString();
  if (!url.startsWith('https://')) return;
  await telegramApi('sendAudio', {
    chat_id: chatId,
    audio: url,
    title: 'squadsync-alert',
    performer: 'SquadSync',
    caption: '🔊 Make match alerts loud and different: long-press this sound → "Save for notifications". Then tap this chat\'s name → Notifications → Sound → squadsync-alert.',
  }).catch((e) => console.error('[telegram] could not send alert sound:', (e as Error).message));
}

telegramRouter.post('/webhook', ah(async (req, res) => {
  if (config.telegram.webhookSecret && req.get('x-telegram-bot-api-secret-token') !== config.telegram.webhookSecret) {
    return res.sendStatus(401);
  }
  // Inline "I'm joining" button under a match alert.
  const cb = req.body?.callback_query;
  if (cb) {
    res.sendStatus(200);
    const m = String(cb.data ?? '').match(/^join:([a-f0-9]{24})$/);
    const user = m ? await User.findOne({ telegramChatId: String(cb.from?.id ?? cb.message?.chat?.id) }) : null;
    let text = 'Could not record that. Open SquadSync instead.';
    if (m && user && (await markJoining(m[1], String(user._id), 'telegram'))) {
      const match = await Match.findById(m[1]).lean();
      text = `Got it, ${user.ign}. Captain knows you're joining${match ? ` ${match.title}` : ''}.`;
    }
    await telegramApi('answerCallbackQuery', { callback_query_id: cb.id, text }).catch(() => {});
    return;
  }

  const msg = req.body?.message;
  const text: string = msg?.text ?? '';
  const chatId = msg?.chat?.id;
  res.sendStatus(200); // always ack fast so Telegram does not retry

  if (!chatId) return;
  // "/start <code>" from the deep link, "/start@Bot <code>", or the code pasted on its own.
  const m = text.trim().match(/^(?:\/start(?:@\w+)?\s+)?([a-f0-9]{32})$/i);
  if (m) {
    const user = await User.findOneAndUpdate(
      { telegramLinkToken: m[1].toLowerCase() },
      { $set: { telegramChatId: String(chatId), telegramLinkToken: null } },
      { new: true },
    );
    const reply = user
      ? `✅ Linked to SquadSync as ${user.ign}. You'll get match alerts here when push isn't available.`
      : '⚠️ That link has expired. Open SquadSync → Settings → Link Telegram again.';
    await telegramApi('sendMessage', { chat_id: chatId, text: reply }).catch(() => {});
    if (user) await sendAlertSound(chatId);
  } else if (/^\/sound(@\w+)?$/i.test(text.trim())) {
    await sendAlertSound(chatId);
  } else if (text.startsWith('/start')) {
    await telegramApi('sendMessage', {
      chat_id: chatId,
      text: 'Hi! Open SquadSync → Settings → Link Telegram, then send me the code shown there to connect this chat.',
    }).catch(() => {});
  }
}));
