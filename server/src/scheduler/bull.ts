import { Queue } from 'bullmq';
import { config } from '../config.js';
import { createRedis } from '../lib/redis.js';
import type { NotifyJobData, QueueLike } from './queue.js';

let queue: Queue<NotifyJobData> | null = null;

export function getQueue(): QueueLike {
  if (!queue) queue = new Queue<NotifyJobData>(config.queueName, { connection: createRedis() });
  return queue as unknown as QueueLike;
}

export async function closeQueue() {
  await queue?.close();
  queue = null;
}
