import { config } from './config.js';
import { connectDb } from './lib/db.js';
import { createApp } from './app.js';
import { closeQueue, getQueue } from './scheduler/bull.js';
import { startWorker } from './scheduler/worker.js';

async function main() {
  await connectDb();
  const app = createApp(getQueue);
  // Single-service mode for small deployments: run the worker inside the API process.
  const worker = process.env.RUN_WORKER_IN_API === 'true' ? startWorker() : null;
  const server = app.listen(config.port, () => console.log(`[api] listening on :${config.port}`));
  const shutdown = async () => {
    server.close();
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
