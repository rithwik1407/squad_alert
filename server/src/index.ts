import { config } from './config.js';
import { connectDb } from './lib/db.js';
import { createApp } from './app.js';
import { closeQueue, getQueue } from './scheduler/bull.js';
import { startWorker } from './scheduler/worker.js';
import { startCatchupLoop } from './scheduler/catchup.js';

async function main() {
  await connectDb();
  const app = createApp(getQueue);
  // Single-service mode (Render free plan): run the worker inside the API process, and
  // sweep for alerts that came due while the instance was asleep.
  const inline = config.runWorkerInApi;
  const worker = inline ? startWorker() : null;
  const stopCatchup = inline ? startCatchupLoop(getQueue(), undefined, 60_000, config.catchupGraceMin) : null;
  if (inline) console.log('[api] running the alert worker in this process');
  const server = app.listen(config.port, () => console.log(`[api] listening on :${config.port}`));
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
