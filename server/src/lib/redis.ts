import { Redis } from 'ioredis';
import { config } from '../config.js';

/** BullMQ requires maxRetriesPerRequest = null. Upstash needs TLS (rediss://), which ioredis handles from the URL. */
export function createRedis(url = config.redisUrl) {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}
