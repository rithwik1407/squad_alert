import type { Match, MyStats, NotificationLog, Team, User } from './types';

/** Empty in production: Vercel rewrites /api/* to the Render backend so the auth cookie stays first-party. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: { path: string; message: string }[]) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.details);
  return data as T;
}

type Session = { user: User; team: Team | null };

export const api = {
  config: () => request<{ telegramBot: string | null; pushServerReady: boolean; timeZone: string }>('GET', '/config'),

  me: () => request<Session>('GET', '/auth/me'),
  login: (b: { email: string; password: string }) => request<Session>('POST', '/auth/login', b),
  register: (b: Record<string, unknown>) => request<Session>('POST', '/auth/register', b),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),

  team: () => request<{ team: Team | null }>('GET', '/team'),
  previewTeam: (code: string) => request<{ name: string; tag: string; slotsLeft: number }>('GET', `/team/preview/${encodeURIComponent(code)}`),
  joinTeam: (code: string) => request<{ team: Team }>('POST', '/team/join', { code }),
  regenerateCode: () => request<{ joinCode: string }>('POST', '/team/code/regenerate'),
  updateTeam: (b: Partial<Pick<Team, 'name' | 'tag' | 'logo' | 'drops'>>) => request<{ team: Team }>('PATCH', '/team', b),
  removeMember: (id: string) => request<{ team: Team }>('DELETE', `/team/members/${id}`),

  matches: (scope: 'upcoming' | 'past' | 'all' = 'upcoming') => request<{ matches: Match[] }>('GET', `/matches?scope=${scope}`),
  match: (id: string) => request<{ match: Match }>('GET', `/matches/${id}`),
  createMatch: (b: Record<string, unknown>) => request<{ match: Match }>('POST', '/matches', b),
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
  report: (id: string) =>
    request<{ attendance: { userId: string; joined: boolean }[]; stats: { userId: string; kills: number; damage: number; mvp: boolean }[] }>(
      'GET', `/matches/${id}/report`),
  saveAttendance: (id: string, entries: { userId: string; joined: boolean }[]) => request('PUT', `/matches/${id}/attendance`, { entries }),
  saveStats: (id: string, entries: { userId: string; kills: number; damage: number; mvp: boolean }[]) =>
    request('PUT', `/matches/${id}/stats`, { entries }),

  notifications: () => request<{ logs: NotificationLog[] }>('GET', '/notifications'),

  updateMe: (b: Record<string, unknown>) => request<{ user: User }>('PATCH', '/me', b),
  addFcmToken: (token: string) => request('POST', '/me/fcm-token', { token }),
  removeFcmToken: (token: string) => request('DELETE', '/me/fcm-token', { token }),
  telegramLink: () => request<{ url: string }>('POST', '/me/telegram/link'),
  telegramUnlink: () => request('DELETE', '/me/telegram'),
  myStats: () => request<MyStats>('GET', '/me/stats'),
};
