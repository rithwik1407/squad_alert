import type { Availability, ChatMessage, ChatMode, ChatMute, ChatState, CheckinMatch, JoinRequest, Match, MatchReport, MyStats, NotificationLog, TeamStats, ScorecardRow, Team, User } from './types';

/** Empty in production: Vercel rewrites /api/* to the Render backend so the auth cookie stays first-party. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: { path: string; message: string }[]) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (e) {
    const timedOut = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError';
    throw new ApiError(0, timedOut ? 'The server took too long to answer. Check your connection and try again.' : 'Could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? (res.status === 504 ? 'The server took too long to answer. Try again.' : `Request failed (${res.status})`), data.details);
  return data as T;
}

type Session = { user: User; team: Team | null };

export const api = {
  config: () => request<{ telegramBot: string | null; pushServerReady: boolean; whatsappReady?: boolean; timeZone: string }>('GET', '/config'),

  me: () => request<Session>('GET', '/auth/me'),
  login: (b: { email: string; password: string }) => request<Session>('POST', '/auth/login', b),
  /** Sends a join request. The account can't sign in until the admin approves it. */
  register: (b: Record<string, unknown>) => request<{ pending: true; message: string }>('POST', '/auth/register', b),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),

  team: () => request<{ team: Team | null }>('GET', '/team'),
  joinRequests: () => request<{ requests: JoinRequest[] }>('GET', '/team/requests'),
  approveRequest: (id: string) => request<{ ok: true; team: Team }>('POST', `/team/requests/${id}/approve`),
  rejectRequest: (id: string) => request<{ ok: true }>('POST', `/team/requests/${id}/reject`),
  updateTeam: (b: Partial<Pick<Team, 'name' | 'tag' | 'logo' | 'drops'>>) => request<{ team: Team }>('PATCH', '/team', b),
  updateMember: (id: string, b: { name?: string; ign?: string; bgmiId?: string; email?: string; password?: string; whatsappNumber?: string }) =>
    request<{ team: Team }>('PATCH', `/team/members/${id}`, b),
  removeMember: (id: string) => request<{ team: Team }>('DELETE', `/team/members/${id}`),

  matches: (scope: 'upcoming' | 'past' | 'all' = 'upcoming') => request<{ matches: Match[] }>('GET', `/matches?scope=${scope}`),
  match: (id: string) => request<{ match: Match }>('GET', `/matches/${id}`),
  createMatch: (b: Record<string, unknown>) => request<{ match: Match }>('POST', '/matches', b),
  createMatches: (matches: Record<string, unknown>[]) => request<{ matches: Match[]; batchId: string }>('POST', '/matches/bulk', { matches }),
  checkin: () => request<{ matches: CheckinMatch[] }>('GET', '/matches/checkin'),
  setAvailability: (id: string, status: Availability, note = '') => request('PUT', `/matches/${id}/availability`, { status, note }),
  joining: (id: string) => request('POST', `/matches/${id}/joining`),
  updateMatch: (id: string, b: Record<string, unknown>) => request<{ match: Match }>('PATCH', `/matches/${id}`, b),
  cancelMatch: (id: string) => request<{ match: Match }>('POST', `/matches/${id}/cancel`),
  setStatus: (id: string, status: 'live' | 'done', placement?: number) =>
    request<{ match: Match }>('POST', `/matches/${id}/status`, { status, placement }),
  saveSquad: (id: string, selectedIds: string[], confirm: boolean) =>
    request<{ match: Match }>('PUT', `/matches/${id}/squad`, { selectedIds, confirm }),
  substitute: (id: string, outId: string, inId: string) => request<{ match: Match }>('POST', `/matches/${id}/substitute`, { outId, inId }),
  sendNow: (id: string) => request<{ jobId: string }>('POST', `/matches/${id}/send-now`),
  resendFailed: (id: string) => request<{ jobId: string }>('POST', `/matches/${id}/resend-failed`),
  matchLogs: (id: string) => request<{ logs: NotificationLog[] }>('GET', `/matches/${id}/notifications`),
  deleteMatch: (id: string) => request<{ ok: true }>('DELETE', `/matches/${id}`),
  report: (id: string) => request<MatchReport>('GET', `/matches/${id}/report`),
  /** image: a data: URL. Returns the numbers read from the screenshot; nothing is saved yet. */
  readScorecard: (id: string, image: string) => readScorecard(id, image),
  saveAttendance: (id: string, entries: { userId: string; joined: boolean }[]) => request('PUT', `/matches/${id}/attendance`, { entries }),
  saveStats: (id: string, entries: { userId: string; kills: number; damage: number; survivalMin: number; assists: number }[]) =>
    request<{ ok: true; mvpUserId: string | null }>('PUT', `/matches/${id}/stats`, { entries }),

  notifications: () => request<{ logs: NotificationLog[] }>('GET', '/notifications'),

  updateAccount: (b: { currentPassword: string; email?: string; newPassword?: string }) => request<{ user: User }>('PATCH', '/me/account', b),
  updateMe: (b: Record<string, unknown>) => request<{ user: User }>('PATCH', '/me', b),
  addFcmToken: (token: string) => request('POST', '/me/fcm-token', { token }),
  removeFcmToken: (token: string) => request('DELETE', '/me/fcm-token', { token }),
  testNotification: () => request<TestNotificationResult>('POST', '/me/test-notification'),
  telegramLink: () => request<{ url: string }>('POST', '/me/telegram/link'),
  telegramUnlink: () => request('DELETE', '/me/telegram'),
  myStats: () => request<MyStats>('GET', '/me/stats'),
  teamStats: () => request<TeamStats>('GET', '/me/stats/team'),

  chat: () => request<{ state: ChatState; messages: ChatMessage[]; mutes?: ChatMute[] }>('GET', '/chat'),
  chatUnread: (since: string) => request<{ count: number }>('GET', `/chat/unread?since=${encodeURIComponent(since)}`),
  sendChat: (text: string) => request<{ message: ChatMessage }>('POST', '/chat', { text }),
  deleteChat: (id: string) => request<{ ok: true }>('DELETE', `/chat/messages/${id}`),
  chatSettings: (b: { mode: ChatMode; openFrom?: string; openTo?: string }) => request<{ state: ChatState }>('PUT', '/chat/settings', b),
  muteChat: (userId: string, minutes: number) => request<{ mutes: ChatMute[] }>('POST', '/chat/mutes', { userId, minutes }),
  unmuteChat: (userId: string) => request<{ mutes: ChatMute[] }>('DELETE', `/chat/mutes/${userId}`),
};

export interface TestNotificationResult {
  server: { push: boolean; telegram: boolean };
  pushDevices: number;
  telegramLinked: boolean;
  results: { channel: string; ok: boolean; error?: string }[];
}

/**
 * Upload the screenshot, then poll until the server has read it. Reading runs in the background on the
 * server because Google's free tier can be slow, longer than one web request may stay open.
 */
async function readScorecard(id: string, image: string, onWait?: (seconds: number) => void): Promise<{ rows: ScorecardRow[] }> {
  const { jobId } = await request<{ jobId: string }>('POST', `/matches/${id}/scorecard`, { image }, 60_000);
  const started = Date.now();
  while (Date.now() - started < 230_000) {
    await new Promise((r) => setTimeout(r, 2500));
    const job = await request<{ status: 'reading' | 'done' | 'failed'; rows?: ScorecardRow[]; error?: string; notResults?: boolean; seconds?: number }>(
      'GET', `/matches/${id}/scorecard/${jobId}`, undefined, 20_000,
    ).catch((e: ApiError) => {
      if (e.status === 0 || e.status >= 500) return null; // a blip while polling: keep waiting
      throw e;
    });
    if (!job) continue;
    if (job.status === 'done') return { rows: job.rows ?? [] };
    if (job.status === 'failed') {
      throw new ApiError(422, job.error ?? 'Could not read the screenshot', job.notResults ? [{ path: 'image', message: 'not_results' }] : undefined);
    }
    onWait?.(job.seconds ?? Math.round((Date.now() - started) / 1000));
  }
  throw new ApiError(0, 'Reading the screenshot took too long. Try again, or type the numbers in.');
}
export { readScorecard as readScorecardWithProgress };
