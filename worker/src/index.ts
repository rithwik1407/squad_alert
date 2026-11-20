import { closeQueue, config, connectDb, getQueue, startCatchupLoop, startWorker } from '@squadsync/server';

async function main() {
  await connectDb();
  const worker = startWorker();
  // Also sends any alert that came due while this process was down.
  const stopCatchup = startCatchupLoop(getQueue(), undefined, 60_000, config.catchupGraceMin);
  const shutdown = async () => {
    stopCatchup();
    await worker.close();
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
