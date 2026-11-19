import type { NotificationProvider, NotificationPayload, Recipient, SendResult } from './types.js';
import { config } from '../config.js';

/**
 * WhatsApp Cloud API provider: stub for later.
 *
 * To finish it: create an approved message template (e.g. "match_starting" with 4 body params),
 * then POST to https://graph.facebook.com/v21.0/{WHATSAPP_PHONE_NUMBER_ID}/messages with
 * { messaging_product: 'whatsapp', to, type: 'template', template: {...} } and a Bearer WHATSAPP_TOKEN.
 * Then add `new WhatsAppProvider()` to the chain in providers.ts.
 */
export class WhatsAppProvider implements NotificationProvider {
  readonly channel = 'whatsapp' as const;

  isConfigured() {
    return Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId);
  }

  canReach(r: Recipient) {
    return r.notifyPrefs.whatsapp === true && Boolean(r.whatsappNumber);
  }

  async send(_r: Recipient, _p: NotificationPayload): Promise<SendResult> {
    return { ok: false, error: 'WhatsApp provider not implemented yet' };
  }
}
