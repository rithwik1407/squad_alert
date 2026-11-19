import type { NotificationProvider, NotificationPayload, Recipient, SendResult } from './types.js';
import { config } from '../config.js';

/**
 * WhatsApp Cloud API (Meta). Sends a DM to the player's number.
 *
 * Business-initiated messages need an approved *template*:
 * - WHATSAPP_TEMPLATE_NAME set (recommended): a Utility template with 4 body variables
 *   {{1}} match title, {{2}} map, {{3}} time (IST), {{4}} room/pass. We fill them in.
 * - Not set: Meta's built-in `hello_world` template is sent (fixed text), followed by a plain text message
 *   with the real match details. That text only arrives if the player messaged your WhatsApp number in the
 *   last 24 hours, so set up the custom template for reliable alerts.
 *
 * Test numbers from Meta can only message up to 5 recipients you've verified in the dashboard.
 */

interface GraphError { error?: { message?: string; code?: number; error_data?: { details?: string } } }

async function graph(body: unknown) {
  const { apiVersion, phoneNumberId, token } = config.whatsapp;
  const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...(body as object) }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as GraphError & { messages?: { id: string }[] };
  if (!res.ok || json.error) {
    const e = json.error;
    const hint = e?.code === 131030 ? ' (number not in the test allowed list: verify it in Meta > WhatsApp > API Setup)'
      : e?.code === 190 ? ' (access token expired or invalid)'
      : e?.code === 132001 ? ' (template name/language not found or not approved yet)'
      : '';
    throw new Error(`WhatsApp ${e?.code ?? res.status}: ${e?.error_data?.details ?? e?.message ?? 'request failed'}${hint}`);
  }
  return json;
}

/** Split "Scrim 1 · Erangel · 9:00 PM. Join the lobby now. Room: 123 / Pass: x" into template params. */
export function templateParams(p: NotificationPayload, meta?: { title: string; map: string; time: string; room: string }) {
  if (meta) return [meta.title, meta.map, meta.time, meta.room];
  const [title = 'Match', map = '', rest = ''] = p.body.split(' · ');
  const time = rest.split('.')[0] ?? '';
  const room = (p.body.match(/Room: .*$/)?.[0] ?? 'Room: TBA');
  return [title, map, time, room];
}

export class WhatsAppProvider implements NotificationProvider {
  readonly channel = 'whatsapp' as const;

  isConfigured() {
    return Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId);
  }

  canReach(r: Recipient) {
    return r.notifyPrefs.whatsapp !== false && Boolean(r.whatsappNumber);
  }

  async send(r: Recipient, p: NotificationPayload): Promise<SendResult> {
    const to = r.whatsappNumber!;
    const { templateName, templateLang } = config.whatsapp;
    const custom = templateName !== 'hello_world';
    try {
      if (custom) {
        await graph({
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: templateLang },
            components: [{
              type: 'body',
              // WhatsApp rejects params with newlines/tabs or 4+ spaces.
              parameters: templateParams(p).map((text) => ({ type: 'text', text: text.replace(/\s+/g, ' ').slice(0, 200) || '-' })),
            }],
          },
        });
      } else {
        await graph({ to, type: 'template', template: { name: 'hello_world', language: { code: templateLang } } });
        // Best effort: only delivered inside the 24h customer-service window.
        await graph({ to, type: 'text', text: { preview_url: false, body: `🎮 *${p.title}*\n${p.body}` } }).catch(() => {});
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
