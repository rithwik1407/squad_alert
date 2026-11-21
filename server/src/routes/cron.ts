import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { ah } from '../middleware/handlers.js';
import { dayKey, dueReportDay, previousDay } from '../lib/dailySummary.js';
import { defaultSummaryDeps, previewDailySummaries, runDailySummaries } from '../scheduler/dailySummary.js';

/**
 * URLs for an external scheduler such as cron-job.org. Protected by CRON_SECRET (?key=... or an
 * "x-cron-key" header). The server also checks on its own every minute, so this is a backup that
 * makes sure the nightly summary goes out even if the instance was asleep at midnight.
 *
 *   GET /api/cron/daily-summary?key=SECRET                 send last night's report if due and not sent yet
 *   GET /api/cron/daily-summary?key=SECRET&preview=1       show the message without sending (default: yesterday)
 *   GET /api/cron/daily-summary?key=SECRET&day=2026-11-20  send that day's report (still only once per player)
 */
export const cronRouter = Router();

function keyOk(given: unknown) {
  const want = config.dailySummary.cronSecret;
  if (!want || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

cronRouter.get('/daily-summary', ah(async (req, res) => {
  if (!config.dailySummary.cronSecret) return res.status(503).json({ error: 'Set CRON_SECRET on the server to use this URL' });
  if (!keyOk(req.query.key ?? req.get('x-cron-key'))) return res.status(401).json({ error: 'Wrong key' });

  const tz = config.displayTimeZone;
  const dayParam = typeof req.query.day === 'string' ? req.query.day : undefined;
  if (dayParam && !/^\d{4}-\d{2}-\d{2}$/.test(dayParam)) return res.status(400).json({ error: 'day must look like 2026-11-20' });

  const deps = defaultSummaryDeps();
  if (req.query.preview) {
    const day = dayParam ?? previousDay(dayKey(new Date(), tz));
    return res.json({ day, teams: await previewDailySummaries(day, deps) });
  }
  if (!config.telegram.botToken) return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN is not set' });
  if (!dayParam && !dueReportDay(new Date(), tz)) {
    return res.json({ ok: true, day: null, note: 'Nothing due: the report goes out between 12:00 AM and noon for the day before.' });
  }
  const result = await runDailySummaries(new Date(), deps, { day: dayParam });
  res.json({ ok: true, ...result });
}));
