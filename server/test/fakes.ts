import type { DispatchMatch, DispatchRepo, DispatchSquad, LogEntry } from '../src/scheduler/dispatch.js';
import type { NotificationProvider, Recipient, SendResult } from '../src/notifications/types.js';
import type { QueueLike, NotifyJobData } from '../src/scheduler/queue.js';

export class FakeQueue implements QueueLike {
  jobs = new Map<string, { name: string; data: NotifyJobData; delay: number; state: string }>();
  async add(name: string, data: NotifyJobData, opts: { jobId: string; delay: number }) {
    // BullMQ semantics: adding an existing jobId is a no-op.
    if (!this.jobs.has(opts.jobId)) this.jobs.set(opts.jobId, { name, data, delay: opts.delay, state: 'delayed' });
    return {};
  }
  async remove(jobId: string) {
    this.jobs.delete(jobId);
  }
  async getJob(jobId: string) {
    const j = this.jobs.get(jobId);
    if (!j) return undefined;
    return { getState: async () => j.state, remove: async () => void this.jobs.delete(jobId) };
  }
}

export function user(id: string, over: Partial<Recipient> = {}): Recipient {
  return {
    id, name: id, ign: `RARE丨${id.toUpperCase()}`, fcmTokens: [`tok-${id}`], telegramChatId: `chat-${id}`,
    whatsappNumber: null, notifyPrefs: { push: true, telegram: true, whatsapp: false }, ...over,
  };
}

export class MemoryRepo implements DispatchRepo {
  matches = new Map<string, DispatchMatch>();
  squads = new Map<string, DispatchSquad>();
  users = new Map<string, Recipient>();
  captains = new Map<string, string>();
  logs: LogEntry[] = [];
  captainAlerted = new Set<string>();
  claims = new Set<string>();
  /** Inbox copies, one per (user, match, kind): a newer one replaces the older, like the Mongo upsert. */
  inbox = new Map<string, { userId: string; matchId: string; kind: string; title: string; body: string }>();

  async saveInbox(userId: string, matchId: string, kind: string, p: { title: string; body: string }) {
    this.inbox.set(`${userId}|${matchId}|${kind}`, { userId, matchId, kind, title: p.title, body: p.body });
  }

  async claim(m: string, u: string, k: string) {
    const key = `${m}|${u}|${k}`;
    if (this.claims.has(key)) return false;
    this.claims.add(key);
    return true;
  }
  async release(m: string, u: string, k: string) { this.claims.delete(`${m}|${u}|${k}`); }

  async getMatch(id: string) { return this.matches.get(id) ?? null; }
  async getSquad(id: string) { return this.squads.get(id) ?? null; }
  async getCaptainId(teamId: string) { return this.captains.get(teamId) ?? null; }
  async getRecipients(ids: string[]) { return ids.map((i) => this.users.get(i)).filter(Boolean) as Recipient[]; }
  async hasSent(m: string, u: string, k: string) {
    return this.logs.some((l) => l.matchId === m && l.userId === u && l.kind === k && l.status === 'sent');
  }
  async writeLog(e: LogEntry) {
    if (e.repeatable && e.status === 'sent') {
      this.logs = this.logs.filter((l) => !(l.matchId === e.matchId && l.userId === e.userId && l.kind === e.kind && l.status === 'sent'));
      this.logs.push(e);
      return true;
    }
    if (e.status === 'sent' && (await this.hasSent(e.matchId, e.userId, e.kind))) return false; // unique index
    this.logs.push(e);
    return true;
  }
  async markNotified(id: string, at: Date) {
    const m = this.matches.get(id)!;
    if (!m.notifiedAt) Object.assign(m, { notifiedAt: at, status: 'notified' });
  }
  async markCaptainAlerted(id: string) { this.captainAlerted.add(id); }
  results: { userId: string; kills: number; damage: number; assists: number; survivalMin: number; mvp: boolean }[] = [];
  async getResults() { return this.results; }
  async clearTelegramChat(uid: string) { this.users.get(uid)!.telegramChatId = null; }
  async removeFcmTokens(uid: string, tokens: string[]) {
    const u = this.users.get(uid)!;
    u.fcmTokens = u.fcmTokens.filter((t) => !tokens.includes(t));
  }
}

export class FakeProvider implements NotificationProvider {
  calls: { userId: string; title: string; body: string }[] = [];
  failFor = new Set<string>();
  constructor(public readonly channel: 'fcm' | 'telegram' | 'whatsapp', private reach: (r: Recipient) => boolean) {}
  isConfigured() { return true; }
  canReach(r: Recipient) { return this.reach(r); }
  async send(r: Recipient, p: { title: string; body: string }): Promise<SendResult> {
    this.calls.push({ userId: r.id, title: p.title, body: p.body });
    if (this.failFor.has(r.id)) return { ok: false, error: `${this.channel} down` };
    return { ok: true };
  }
}
