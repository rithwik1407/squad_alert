import type { NotificationProvider } from './types.js';
import { FcmProvider } from './fcm.js';
import { TelegramProvider } from './telegram.js';
import { WhatsAppProvider } from './whatsapp.js';

/**
 * Delivery order: WhatsApp DM first, then web push, then Telegram. Unconfigured providers are dropped.
 * NOTIFY_ORDER (e.g. "fcm,telegram,whatsapp") overrides the order.
 */
export function defaultProviders(): NotificationProvider[] {
  const all: NotificationProvider[] = [new WhatsAppProvider(), new FcmProvider(), new TelegramProvider()];
  const order = (process.env.NOTIFY_ORDER ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (order.length) all.sort((a, b) => rank(order, a.channel) - rank(order, b.channel));
  return all.filter((p) => p.isConfigured());
}

const rank = (order: string[], c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
