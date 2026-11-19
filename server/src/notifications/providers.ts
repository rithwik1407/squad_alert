import type { NotificationProvider } from './types.js';
import { FcmProvider } from './fcm.js';
import { TelegramProvider } from './telegram.js';

/** Delivery order: FCM web push first, Telegram as the fallback. Unconfigured providers are dropped. */
export function defaultProviders(): NotificationProvider[] {
  return [new FcmProvider(), new TelegramProvider()].filter((p) => p.isConfigured());
}
