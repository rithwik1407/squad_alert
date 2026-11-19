import { Worker, type Job } from 'bullmq';
import { config } from '../config.js';
import { createRedis } from '../lib/redis.js';
import { defaultProviders } from '../notifications/providers.js';
import { dispatchMatch } from './dispatch.js';
import { mongoDispatchRepo } from './repo.js';
import type { NotifyJobData } from './queue.js';

/** Start the BullMQ worker that sends match notifications. Used by /worker, or in-process via RUN_WORKER_IN_API=true. */
export function startWorker() {
  const providers = defaultProviders();
  console.log(`[worker] providers: ${providers.map((p) => p.channel).join(' → ') || 'NONE (set Firebase/Telegram env vars)'}`);

  const worker = new Worker<NotifyJobData>(
    config.queueName,
    async (job: Job<NotifyJobData>) => {
      const { matchId, trigger, onlyUserIds } = job.data;
      const result = await dispatchMatch(matchId, { trigger, onlyUserIds }, {
        repo: mongoDispatchRepo,
        providers,
        timeZone: config.displayTimeZone,
      });
      console.log(
        `[worker] ${job.id} ${trigger} match=${matchId} outcome=${result.outcome}` +
          ` sent=${result.sent.length} failed=${result.failed.length} already=${result.alreadySent.length}` +
          (result.reason ? ` reason="${result.reason}"` : ''),
      );
      return result;
    },
    {
      connection: createRedis(),
      concurrency: 10,
      // Fewer idle Redis commands (matters on Upstash's per-command pricing).
      drainDelay: 30,
      stalledInterval: 60_000,
    },
  );
  worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed:`, err.message));
  worker.on('ready', () => console.log(`[worker] listening on queue "${config.queueName}"`));
  return worker;
}
