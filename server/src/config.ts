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
  /** The one account that approves new signups. */
  adminEmail: (process.env.ADMIN_EMAIL ?? 'admin@rare.com').trim().toLowerCase(),
  displayTimeZone: process.env.DISPLAY_TZ ?? 'Asia/Kolkata',
  queueName: process.env.QUEUE_NAME ?? 'match-notify',
  /** Run the BullMQ worker inside the API (one free Render service). RUN_WORKER_INLINE is an alias. */
  runWorkerInApi: process.env.RUN_WORKER_IN_API === 'true' || process.env.RUN_WORKER_INLINE === 'true',
  /** How many minutes after a match starts a late (missed while asleep) alert is still sent. */
  catchupGraceMin: Number(process.env.CATCHUP_GRACE_MIN ?? 10),
  /** Optional: lets the admin upload a BGMI results screenshot and have it read automatically. */
  /** Free option: Google Gemini key from aistudio.google.com. Used before ANTHROPIC_API_KEY when both are set. */
  geminiApiKey: (process.env.GEMINI_API_KEY ?? '').trim(),
  /** Optional: force one Gemini model (e.g. gemini-3.8-flash). Empty = pick automatically. */
  geminiModel: (process.env.GEMINI_MODEL ?? '').trim(),
  /** More free readers, tried after Gemini: Groq (console.groq.com) and OpenRouter (openrouter.ai, ":free" models). */
  groqApiKey: (process.env.GROQ_API_KEY ?? '').trim(),
  groqModel: (process.env.GROQ_MODEL ?? '').trim(),
  openRouterApiKey: (process.env.OPENROUTER_API_KEY ?? '').trim(),
  openRouterModel: (process.env.OPENROUTER_MODEL ?? '').trim(),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  scorecardModel: process.env.SCORECARD_MODEL || 'claude-opus-5-5',
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
    /** WhatsApp alerts are parked: nothing is sent and the Settings option is hidden unless WHATSAPP_ENABLED=true. */
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    token: process.env.WHATSAPP_TOKEN ?? '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0',
    /** Approved template with 4 body params: {{1}} match, {{2}} map, {{3}} time, {{4}} room/pass. Default: Meta's hello_world. */
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || 'hello_world',
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG || (process.env.WHATSAPP_TEMPLATE_NAME ? 'en' : 'en_US'),
  },
};
