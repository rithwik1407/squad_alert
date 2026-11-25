import { ApiError } from './api';
import type { AiEvent, AiHistoryItem, AiSuggestion, AiTurn, BlockWithId } from './aiTypes';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/ai${path}`, {
      method, credentials: 'include',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const aiApi = {
  status: () => json<{ engine: string; label: string; providers: string[] }>('GET', '/status'),
  overview: () => json<{ blocks: BlockWithId[] }>('GET', '/overview'),
  suggestions: (seen: string[]) => json<{ suggestions: AiSuggestion[] }>('GET', `/suggestions?seen=${encodeURIComponent(seen.join(','))}`),
  turns: (conversation: string) => json<{ conversationId: string | null; turns: AiTurn[] }>('GET', `/turns?conversation=${encodeURIComponent(conversation)}`),
  history: () => json<{ items: AiHistoryItem[] }>('GET', '/history'),
  deleteTurn: (id: string) => json<{ ok: true }>('DELETE', `/turns/${id}`),
  clearHistory: () => json<{ ok: true; deleted: number }>('DELETE', '/turns'),
  stop: (id: string) => json<{ stopped: boolean }>('POST', `/turns/${id}/stop`),
  /** Approve an AI-prepared action, with the approver's edits to the draft. */
  approve: (id: string, edits?: Record<string, unknown>) => json<{ id: string; status: string; resultId: string | null; result: string; kind: string }>('POST', `/proposals/${id}/approve`, { edits: edits ?? {} }),
  /** Captain approves an AI squad recommendation: saves it confirmed and alerts the picked players. */
  applySquad: (matchId: string, selectedIds: string[]) => json<{ ok: true; matchId: string }>('POST', '/squad', { matchId, selectedIds }),
  reject: (id: string) => json<{ id: string; status: string }>('POST', `/proposals/${id}/reject`, {}),
};

/** Read a Server-Sent Events response and hand each event to `onEvent`. */
async function readStream(res: Response, onEvent: (e: AiEvent) => void) {
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

async function open(path: string, init: RequestInit) {
  try {
    return await fetch(`${BASE}/api/ai${path}`, { credentials: 'include', ...init });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }
}

/**
 * Ask the Squad AI. The server answers with Server-Sent Events over a POST (EventSource can't POST), starting
 * with a `turn` event that names the saved answer. Closing the app only stops watching: the answer keeps going.
 */
export async function askAi(question: string, conversationId: string | null, onEvent: (e: AiEvent) => void, signal?: AbortSignal) {
  const res = await open('/chat', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ question, conversationId }),
  });
  if (res) await readStream(res, onEvent);
}

/** Watch an answer that is already running (or replay a finished one) from the start. */
export async function attachAi(turnId: string, onEvent: (e: AiEvent) => void, signal?: AbortSignal) {
  const res = await open(`/turns/${turnId}/stream`, { method: 'GET', signal, headers: { accept: 'text/event-stream' } });
  if (res) await readStream(res, onEvent);
}
