import { config } from './config.js';
import { connectDb } from './lib/db.js';
import { createApp } from './app.js';
import { closeQueue, getQueue } from './scheduler/bull.js';
import { startWorker } from './scheduler/worker.js';
import { startCatchupLoop } from './scheduler/catchup.js';
import { seedTeamRare } from './seed-data.js';

/** Keep retrying instead of crashing, so /api/health stays up and shows db: "down" with the reason in the logs. */
async function connectWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      await connectDb();
      console.log('[db] connected');
      return;
    } catch (e) {
      console.error(`[db] connection failed (attempt ${attempt}): ${(e as Error).message}`);
      console.error('[db] check MONGODB_URI on Render and that Atlas Network Access allows 0.0.0.0/0');
      await new Promise((r) => setTimeout(r, Math.min(30_000, attempt * 5_000)));
    }
  }
}

async function main() {
  const app = createApp(getQueue);
  // Listen first so Render's health check and the Vercel proxy always get an answer.
  const server = app.listen(config.port, () => console.log(`[api] listening on :${config.port}`));

  await connectWithRetry();

  if (process.env.SEED_TEAM_RARE === 'true') {
    try {
      const created = await seedTeamRare({ wipe: false });
      console.log(created ? '[seed] created TEAM RARE accounts' : '[seed] TEAM RARE already exists, nothing to do');
    } catch (e) {
      console.error('[seed] failed:', (e as Error).message);
    }
  }

  // Single-service mode (Render free plan): run the worker inside the API process, and
  // sweep for alerts that came due while the instance was asleep.
  const inline = config.runWorkerInApi;
  const worker = inline ? startWorker() : null;
  const stopCatchup = inline ? startCatchupLoop(getQueue(), undefined, 60_000, config.catchupGraceMin) : null;
  if (inline) console.log('[api] running the alert worker in this process');

  const shutdown = async () => {
    server.close();
    stopCatchup?.();
    await worker?.close();
    await closeQueue();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
