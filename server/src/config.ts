import dotenv from 'dotenv';

// Local dev: a package-level .env wins, then the repo-root .env.
dotenv.config({ path: ['.env', '../.env'] });

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required env var ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  mongoUri: req('MONGODB_URI', isProd ? undefined : 'mongodb://127.0.0.1:27017/squadsync'),
  redisUrl: req('REDIS_URL', isProd ? undefined : 'redis://127.0.0.1:6379'),
  jwtSecret: req('JWT_SECRET', isProd ? undefined : 'dev-only-insecure-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  /** Extra CORS origins, comma separated (e.g. Vercel preview URLs). */
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /** 'lax' when the client proxies /api through Vercel rewrites (recommended), 'none' for cross-site. */
  cookieSameSite: (process.env.COOKIE_SAMESITE ?? 'lax') as 'lax' | 'none' | 'strict',
  displayTimeZone: process.env.DISPLAY_TZ ?? 'Asia/Kolkata',
  queueName: process.env.QUEUE_NAME ?? 'match-notify',
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID ?? '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME ?? '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  },
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN ?? '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  },
};
