import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { config } from './config.js';
import { errorHandler } from './middleware/handlers.js';
import { authRouter } from './routes/auth.js';
import { teamRouter } from './routes/team.js';
import { matchesRouter } from './routes/matches.js';
import { meRouter } from './routes/me.js';
import { notificationsRouter } from './routes/notifications.js';
import { telegramRouter } from './routes/telegram.js';
import { chatRouter } from './routes/chat.js';
import { scrimsRouter } from './routes/scrims.js';
import { cronRouter } from './routes/cron.js';
import { invitesRouter } from './routes/invites.js';
import type { QueueLike } from './scheduler/queue.js';

export function createApp(getQueue: () => QueueLike) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  const origins = new Set([config.clientUrl, ...config.corsOrigins]);
  app.use(cors({ origin: (o, cb) => cb(null, !o || origins.has(o)), credentials: true }));
  // Results screenshots are sent as base64 JSON, so that one route gets a bigger body limit.
  app.use('/api/matches/:id/scorecard', express.json({ limit: '8mb' }));
  app.use('/api/matches/schedule-image', express.json({ limit: '8mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  // API responses are per-user (auth cookie), so never let a browser or proxy cache them.
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'up' : 'down', time: new Date().toISOString() });
  });

  // Tiny keep-awake endpoint for an uptime pinger (no DB work, no body).
  app.get('/api/ping', (_req, res) => res.type('text/plain').send('pong'));

  app.get('/api/config', (_req, res) => {
    res.json({
      telegramBot: config.telegram.botUsername || null,
      pushServerReady: Boolean(config.firebase.projectId && config.firebase.privateKey),
      whatsappEnabled: config.whatsapp.enabled,
      whatsappReady: Boolean(config.whatsapp.enabled && config.whatsapp.token && config.whatsapp.phoneNumberId),
      timeZone: config.displayTimeZone,
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/team', teamRouter);
  app.use('/api/matches', matchesRouter(getQueue));
  app.use('/api/me', meRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/telegram', telegramRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/scrims', scrimsRouter);
  app.use('/api/cron', cronRouter);
  app.use('/api/invites', invitesRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}
