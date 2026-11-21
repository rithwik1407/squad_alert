import { randomUUID } from 'node:crypto';

/**
 * Screenshot reading can take a while (Google's free tier is often busy and gets retried), longer than
 * the Vercel → Render proxy keeps a request open. So the upload starts a job and the app polls for it.
 * Jobs live in memory on the single API instance and are forgotten after 15 minutes.
 */
export type ScorecardJob<T> =
  | { status: 'reading'; matchId: string; startedAt: number }
  | { status: 'done'; matchId: string; startedAt: number; rows: T[] }
  | { status: 'failed'; matchId: string; startedAt: number; error: string };

const jobs = new Map<string, ScorecardJob<unknown>>();
const TTL = 15 * 60_000;

function sweep() {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.startedAt > TTL) jobs.delete(id);
}

export function startScorecardJob<T>(matchId: string, work: () => Promise<T[]>): string {
  sweep();
  const id = randomUUID();
  const startedAt = Date.now();
  jobs.set(id, { status: 'reading', matchId, startedAt });
  work().then(
    (rows) => jobs.set(id, { status: 'done', matchId, startedAt, rows }),
    (e: Error) => {
      console.warn('[scorecard] job failed:', e.message);
      jobs.set(id, { status: 'failed', matchId, startedAt, error: e.message || 'Could not read the screenshot' });
    },
  );
  return id;
}

export function getScorecardJob(id: string, matchId: string) {
  const j = jobs.get(id);
  return j && j.matchId === matchId ? j : null;
}
