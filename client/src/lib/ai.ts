import { ApiError } from './api';
import type { AiEvent, AiUpcoming, BlockWithId } from './aiTypes';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/ai${path}`, {
    method, credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const aiApi = {
  status: () => json<{ engine: 'gemini' | 'groq' | 'offline' }>('GET', '/status'),
  overview: () => json<{ blocks: BlockWithId[]; upcoming: AiUpcoming[] }>('GET', '/overview'),
  approve: (id: string) => json<{ id: string; status: string; resultId: string | null; kind: 'scrim' | 'squad' }>('POST', `/proposals/${id}/approve`),
  /** Captain approves an AI squad recommendation: saves it confirmed and alerts the picked players. */
  applySquad: (matchId: string, selectedIds: string[]) => json<{ ok: true; matchId: string }>('POST', '/squad', { matchId, selectedIds }),
  reject: (id: string) => json<{ id: string; status: string }>('POST', `/proposals/${id}/reject`),
};

/**
 * Ask the Squad AI. The server answers with Server-Sent Events over a POST, so this reads the stream
 * by hand (EventSource can't POST) and hands each event to `onEvent` as it arrives.
 */
export async function askAi(messages: { role: 'user' | 'assistant'; text: string }[], onEvent: (e: AiEvent) => void, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST', credentials: 'include', signal,
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ messages }),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try { onEvent(JSON.parse(line.slice(5).trim()) as AiEvent); } catch { /* ignore a bad line */ }
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
  }
}
