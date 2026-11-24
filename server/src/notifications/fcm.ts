import type { NotificationProvider, NotificationPayload, Recipient, SendResult } from './types.js';
import { config } from '../config.js';

type Messaging = import('firebase-admin/messaging').Messaging;
let messagingPromise: Promise<Messaging> | null = null;

async function getMessaging(): Promise<Messaging> {
  if (!messagingPromise) {
    messagingPromise = (async () => {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app');
      const { getMessaging } = await import('firebase-admin/messaging');
      const app =
        getApps()[0] ??
        initializeApp({
          credential: cert({
            projectId: config.firebase.projectId,
            clientEmail: config.firebase.clientEmail,
            privateKey: config.firebase.privateKey,
          }),
        });
      return getMessaging(app);
    })();
  }
  return messagingPromise;
}

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export class FcmProvider implements NotificationProvider {
  readonly channel = 'fcm' as const;

  isConfigured() {
    return Boolean(config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey);
  }

  canReach(r: Recipient) {
    return r.notifyPrefs.push !== false && r.fcmTokens.length > 0;
  }

  async send(r: Recipient, p: NotificationPayload): Promise<SendResult> {
    const messaging = await getMessaging();
    const link = new URL(p.url, config.clientUrl).toString();
    const res = await messaging.sendEachForMulticast({
      tokens: r.fcmTokens,
      // Data-only payload: the service worker builds the notification so the tap URL is always ours.
      data: { ...(p.extra ?? {}), title: p.title, body: p.body, url: p.url, matchId: p.matchId, tag: p.tag },
      webpush: {
        headers: { Urgency: 'high', TTL: '300' },
        fcmOptions: { link },
      },
    });
    const invalidTokens: string[] = [];
    const errors: string[] = [];
    res.responses.forEach((resp, i) => {
      if (!resp.success) {
        const code = resp.error?.code ?? 'unknown';
        errors.push(code);
        if (DEAD_TOKEN_CODES.has(code)) invalidTokens.push(r.fcmTokens[i]);
      }
    });
    if (res.successCount > 0) return { ok: true, invalidTokens };
    return { ok: false, error: `FCM: ${[...new Set(errors)].join(', ') || 'no successful sends'}`, invalidTokens };
  }
}
