import { describe, expect, it } from 'vitest';
import { catchUpDueMatches, type CatchupRepo, type DueMatch } from '../src/scheduler/catchup.js';
import { FakeQueue } from './fakes.js';

const NOW = new Date('2026-11-19T15:00:00.000Z');
const min = (n: number) => n * 60_000;
const at = (offsetMin: number) => new Date(NOW.getTime() + min(offsetMin));

function repo(matches: DueMatch[]): CatchupRepo {
  return {
    async findPending(after, before) {
      return matches.filter((m) => m.startAt > after && m.startAt <= before);
    },
  };
}

describe('catch-up after the server slept', () => {
  it('queues matches whose alert time passed while asleep, now', async () => {
    const q = new FakeQueue();
    const ids = await catchUpDueMatches(q, repo([
      { id: 'due', startAt: at(1), notifyOffsetMin: 2 }, // alert was due 1 min ago
      { id: 'started', startAt: at(-5), notifyOffsetMin: 2 }, // started 5 min ago, within grace
      { id: 'future', startAt: at(30), notifyOffsetMin: 2 }, // not due yet
      { id: 'old', startAt: at(-60), notifyOffsetMin: 2 }, // long over
    ]), NOW, 10);
    expect(ids.sort()).toEqual(['due', 'started']);
    const job = [...q.jobs.values()].find((j) => j.data.matchId === 'due')!;
    expect(job.delay).toBe(0);
    expect(job.data.trigger).toBe('scheduled');
  });

  it('running the sweep again does not queue a second job', async () => {
    const q = new FakeQueue();
    const r = repo([{ id: 'due', startAt: at(1), notifyOffsetMin: 2 }]);
    await catchUpDueMatches(q, r, NOW);
    await catchUpDueMatches(q, r, new Date(NOW.getTime() + min(1)));
    expect(q.jobs.size).toBe(1);
  });
});
