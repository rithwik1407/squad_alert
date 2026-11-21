import { closeQueue, config, connectDb, getQueue, startCatchupLoop, startDailySummaryLoop, startWorker } from '@squadsync/server';

async function main() {
  await connectDb();
  const worker = startWorker();
  // Also sends any alert that came due while this process was down.
  const stopCatchup = startCatchupLoop(getQueue(), undefined, 60_000, config.catchupGraceMin);
  // Nightly Telegram team summary.
  const stopSummary = startDailySummaryLoop();
  const shutdown = async () => {
    stopCatchup();
    stopSummary();
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
