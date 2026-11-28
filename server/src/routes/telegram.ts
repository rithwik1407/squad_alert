import { Router } from 'express';
import { ah } from '../middleware/handlers.js';
import { User } from '../models/index.js';
import { config } from '../config.js';
import { telegramApi } from '../notifications/telegram.js';
import { markJoining } from '../lib/availability.js';
import { Match } from '../models/index.js';
import { respondToInvite } from '../lib/invites.js';
import { answerChallenge, begunText, doneKeyboard, doneText } from '../lib/challenges.js';
import { challengeByKey } from '../lib/challengeCatalog.js';
import { ChallengeRun } from '../models/index.js';

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
    // I'm in / I'm out under a classic-match invite.
    const ci = String(cb.data ?? '').match(/^ci:([a-f0-9]{24}):(in|out)$/);
    if (ci) {
      const who = await User.findOne({ telegramChatId: String(cb.from?.id ?? cb.message?.chat?.id) }).lean();
      const invite = who ? await respondToInvite(ci[1], String(who._id), ci[2] as 'in' | 'out', 'telegram') : null;
      const answer = !who ? 'This Telegram is not linked to SquadSync. Link it in Settings.'
        : !invite ? 'That invite has expired or was not for you.'
        : ci[2] === 'in' ? "You're in ✅" : "You're out ❌";
      await telegramApi('answerCallbackQuery', { callback_query_id: cb.id, text: answer }).catch(() => {});
      // Show the answer under the invite so the chat reads clearly.
      if (invite && cb.message?.message_id) {
        const base: string = cb.message.text ?? '';
        await telegramApi('editMessageText', {
          chat_id: cb.message.chat.id, message_id: cb.message.message_id,
          text: `${base.split('\n\nYour answer:')[0]}\n\nYour answer: ${ci[2] === 'in' ? "I'm in ✅" : "I'm out ❌"}`,
          reply_markup: cb.message.reply_markup,
        }).catch(() => {});
      }
      return;
    }
    // After-match challenge check: "Did the match begin?" then "Was the challenge completed?".
    const chk = String(cb.data ?? '').match(/^ch([bd]):([a-f0-9]{24}):([yn])$/);
    if (chk) {
      await handleChallengeButton(cb, chk[1] === 'b' ? 'begun' : 'done', chk[2], chk[3] === 'y');
      return;
    }
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

type Callback = { id: string; from?: { id?: number }; message?: { message_id?: number; chat: { id: number } } };

async function handleChallengeButton(cb: Callback, step: 'begun' | 'done', runId: string, yes: boolean) {
  const reply = (text: string) => telegramApi('answerCallbackQuery', { callback_query_id: cb.id, text }).catch(() => {});
  const edit = (text: string, keyboard?: unknown) => cb.message?.message_id
    ? telegramApi('editMessageText', {
        chat_id: cb.message.chat.id, message_id: cb.message.message_id, text, parse_mode: 'HTML',
        reply_markup: keyboard ?? { inline_keyboard: [] },
      }).catch(() => {})
    : Promise.resolve();
  const who = await User.findOne({ telegramChatId: String(cb.from?.id ?? cb.message?.chat?.id) }).lean();
  if (!who) return reply('This Telegram is not linked to SquadSync. Link it in Settings.');
  const run = await answerChallenge(runId, String(who._id), step, yes);
  const c = challengeByKey((run ?? (await ChallengeRun.findById(runId).lean()))?.challengeKey);
  if (!run) {
    // A teammate answered first: show where the check is now.
    const cur = await ChallengeRun.findById(runId).lean();
    if (cur?.status === 'begun' && c && cur.playerIds.some((p) => String(p) === String(who._id))) {
      await edit(doneText(c), doneKeyboard(runId));
      return reply('A teammate said the match began.');
    }
    await edit(c ? `${begunText(c).split('\n\n')[0]}\n\nAlready answered${cur ? `: ${statusLine(cur.status)}` : ''}.` : 'This check is closed.');
    return reply('This check was already answered.');
  }
  if (!c) return reply('Saved.');
  if (run.status === 'begun') {
    await edit(doneText(c), doneKeyboard(runId));
    return reply('Nice. Now: was the challenge completed?');
  }
  await edit(`${begunText(c).split('\n\n')[0]}\n\n${statusLine(run.status, c.badge)}`);
  return reply(run.status === 'completed' ? `🏅 ${c.badge.name} badge earned!` : 'Saved. Next time!');
}

function statusLine(status: string, badge?: { name: string; emoji: string }) {
  if (status === 'completed') return badge ? `🏅 Completed! Badge earned: ${badge.emoji} ${badge.name}` : '🏅 Completed!';
  if (status === 'failed') return '😤 Not completed this time.';
  if (status === 'not_played') return "❌ The match didn't happen.";
  if (status === 'expired') return 'Closed without an answer.';
  return status;
}
