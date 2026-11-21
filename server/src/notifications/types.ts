import type { Channel } from '../models/constants.js';

export interface NotificationPayload {
  title: string;
  body: string;
  /** Path inside the app that opens when the notification is tapped. */
  url: string;
  matchId: string;
  tag: string;
}

export interface Recipient {
  id: string;
  name: string;
  ign: string;
  fcmTokens: string[];
  telegramChatId: string | null;
  whatsappNumber: string | null;
  notifyPrefs: { push: boolean; telegram: boolean; whatsapp: boolean };
}

export interface SendResult {
  ok: boolean;
  error?: string;
  /** FCM tokens the provider found to be dead; the caller prunes them. */
  invalidTokens?: string[];
  /** The user's Telegram chat is gone (bot blocked, chat deleted); the caller unlinks it. */
  telegramGone?: boolean;
}

/**
 * A delivery channel. Providers are tried in order until one succeeds.
 * Add a new channel by implementing this interface and adding it to the chain in providers.ts.
 */
export interface NotificationProvider {
  readonly channel: Exclude<Channel, 'none'>;
  /** Credentials are present for this provider. */
  isConfigured(): boolean;
  /** This user can be reached on this channel (has a token / chat id and has not opted out). */
  canReach(r: Recipient): boolean;
  send(r: Recipient, p: NotificationPayload): Promise<SendResult>;
}
