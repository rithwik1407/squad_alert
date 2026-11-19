/** Shared entry point used by the worker package. */
export { config } from './config.js';
export { connectDb, disconnectDb } from './lib/db.js';
export { createRedis } from './lib/redis.js';
export * from './models/index.js';
export { dispatchMatch, type DispatchResult, type DispatchDeps, type DispatchRepo, type Trigger } from './scheduler/dispatch.js';
export { mongoDispatchRepo } from './scheduler/repo.js';
export { upsertMatchJob, removeMatchJob, enqueueImmediate, JOB_NAME, type NotifyJobData } from './scheduler/queue.js';
export { defaultProviders } from './notifications/providers.js';
export type { NotificationProvider, Recipient, NotificationPayload, SendResult } from './notifications/types.js';
export { startWorker } from './scheduler/worker.js';
