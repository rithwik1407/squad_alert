/**
 * Squad AI conversation state. Chats are saved on the server per teammate, so they survive reloads, closing
 * the app and switching devices. A question keeps running on the server after the app closes; when the app
 * comes back it re-attaches and the rest of the answer streams in (or the finished answer is just there).
 * The state lives outside React pages so leaving the Squad AI page never interrupts anything; the nav item
 * shows a dot when an answer finishes off-page.
 */
import { useSyncExternalStore } from 'react';
import { aiApi, askAi, attachAi } from './ai';
import type { AiEvent, AiHistoryItem, AiTurn, BlockWithId } from './aiTypes';

export interface ToolStep { id: string; label: string; status: 'start' | 'done' | 'error'; ms?: number }
export interface AiMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** The saved answer this message belongs to. */
  turnId?: string;
  tools?: ToolStep[];
  /** Dashboard answer this reply drew (only when the question needed visuals). */
  groupId?: string;
  notice?: string;
  engine?: string;
  label?: string;
  model?: string;
  done?: boolean;
  error?: boolean;
}
export interface AiGroup { id: string; question: string; at: number; blocks: BlockWithId[]; pending: boolean }

export interface AiState {
  /** The chat on screen; null = a new chat that has no saved question yet. */
  conversationId: string | null;
  msgs: AiMsg[];
  /** Answers in this chat that drew visuals, newest first. */
  groups: AiGroup[];
  /** What the dashboard shows: the default overview, or one answer's visuals. */
  view: 'overview' | string;
  busy: boolean;
  /** The answer being written right now (on the server). */
  runningId: string | null;
  engine?: string;
  label?: string;
  model?: string;
  /** An answer finished while the user was on another page. */
  ready: boolean;
  /** Visuals that arrived while the phone was on the Chat tab. */
  unseen: number;
  loaded: boolean;
  loadError?: string;
  /** Every question asked, newest first (the History list). null until opened. */
  history: AiHistoryItem[] | null;
}

const CONV_KEY = 'ss_ai_conv';
const uid = () => Math.random().toString(36).slice(2, 10);
const store = {
  get: () => { try { return localStorage.getItem(CONV_KEY); } catch { return null; } },
  set: (v: string) => { try { localStorage.setItem(CONV_KEY, v); } catch { /* private mode */ } },
};

let state: AiState = { conversationId: null, msgs: [], groups: [], view: 'overview', busy: false, runningId: null, ready: false, unseen: 0, loaded: false, history: null };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let onPage = false;
let boardVisible = true;
let loading: Promise<void> | null = null;

function set(patch: Partial<AiState> | ((s: AiState) => Partial<AiState>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}

const patchMsg = (id: string, f: (m: AiMsg) => AiMsg) => set((s) => ({ msgs: s.msgs.map((m) => (m.id === id ? f(m) : m)) }));

export function useAi(): AiState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

/** Chat messages and dashboard answers for a list of saved turns. */
function fromTurns(turns: AiTurn[]) {
  const msgs: AiMsg[] = [];
  const groups: AiGroup[] = [];
  for (const t of turns) {
    const running = t.status === 'running';
    msgs.push({ id: `${t.id}-q`, role: 'user', text: t.question, done: true, turnId: t.id });
    msgs.push({
      id: t.id, role: 'assistant', turnId: t.id, text: t.text, tools: t.tools, notice: t.notice ?? undefined,
      engine: t.engine ?? undefined, label: t.label ?? undefined, model: t.model ?? undefined,
      done: !running, error: t.status === 'error' && !t.text, groupId: t.blocks.length ? t.id : undefined,
    });
    if (t.blocks.length || running) groups.unshift({ id: t.id, question: t.question, at: new Date(t.at).getTime(), blocks: t.blocks, pending: running });
  }
  return { msgs, groups: groups.filter((g) => g.blocks.length || g.pending) };
}

/** Apply one streamed event to the assistant message `aId` (and its dashboard answer). */
function applyEvent(aId: string, q: string, e: AiEvent) {
  const group = (turnId: string) => {
    if (!state.groups.some((g) => g.id === turnId)) {
      set((s) => ({ groups: [{ id: turnId, question: q, at: Date.now(), blocks: [], pending: true }, ...s.groups], view: turnId }));
    }
    patchMsg(aId, (m) => ({ ...m, groupId: turnId }));
    return turnId;
  };
  const turnId = () => state.msgs.find((m) => m.id === aId)?.turnId ?? aId;
  switch (e.type) {
    case 'turn':
      patchMsg(aId, (m) => ({ ...m, turnId: e.id }));
      set({ runningId: e.id, conversationId: e.conversationId });
      store.set(e.conversationId);
      if (state.history) set((s) => ({ history: [{ id: e.id, conversationId: e.conversationId, question: q, status: 'running', visuals: 0, at: new Date().toISOString(), live: true }, ...(s.history ?? [])] }));
      break;
    case 'meta':
      set({ engine: e.engine, label: e.label, model: e.model });
      patchMsg(aId, (m) => ({ ...m, engine: e.engine, label: e.label, model: e.model }));
      break;
    case 'text': patchMsg(aId, (m) => ({ ...m, text: m.text + e.delta })); break;
    case 'tool':
      group(turnId());
      patchMsg(aId, (m) => {
        const tools = m.tools ?? [];
        const i = tools.findIndex((t) => t.id === e.id);
        const step = { id: e.id, label: e.label, status: e.status, ms: e.ms };
        return { ...m, tools: i < 0 ? [...tools, step] : tools.map((t, j) => (j === i ? step : t)) };
      });
      break;
    case 'block': {
      const id = group(turnId());
      set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, blocks: [...g.blocks, e.block] } : g)) }));
      if (!boardVisible) set((s) => ({ unseen: s.unseen + 1 }));
      break;
    }
    case 'notice': patchMsg(aId, (m) => ({ ...m, notice: e.message })); break;
    case 'done': break;
  }
}

/** Close out an answer: drop an empty dashboard answer, flag the nav dot, refresh History. */
function finish(aId: string, stopped: boolean) {
  const turnId = state.msgs.find((m) => m.id === aId)?.turnId ?? aId;
  patchMsg(aId, (m) => ({ ...m, done: true, text: m.text || (stopped ? '_Stopped._' : 'No answer came back. Try again.') }));
  set((s) => {
    const g = s.groups.find((x) => x.id === turnId);
    // Tools ran but drew nothing (e.g. no data yet): drop the empty answer and go back to the overview.
    if (g && !g.blocks.length) return { groups: s.groups.filter((x) => x.id !== turnId), view: s.view === turnId ? 'overview' : s.view };
    return { groups: s.groups.map((x) => (x.id === turnId ? { ...x, pending: false } : x)) };
  });
  set((s) => ({
    busy: false, runningId: null, ready: !onPage && !stopped ? true : s.ready,
    history: s.history?.map((h) => (h.id === turnId ? { ...h, status: stopped ? 'stopped' : 'done', live: false, visuals: s.groups.find((g) => g.id === turnId)?.blocks.length ?? 0 } : h)) ?? null,
  }));
}

/** Watch a running answer from the start (after a reload, or when the app comes back to the foreground). */
async function watch(turnId: string) {
  if (controller) return;
  const ctrl = new AbortController();
  controller = ctrl;
  const msg = state.msgs.find((m) => m.turnId === turnId && m.role === 'assistant');
  if (!msg) { controller = null; return; }
  const q = state.msgs.find((m) => m.role === 'user' && m.turnId === turnId)?.text ?? '';
  // The stream replays everything from the start, so begin from a clean answer.
  patchMsg(msg.id, (m) => ({ ...m, text: '', tools: [], notice: undefined, done: false }));
  set((s) => ({ busy: true, runningId: turnId, groups: s.groups.map((g) => (g.id === turnId ? { ...g, blocks: [], pending: true } : g)) }));
  let ended = false;
  try {
    await attachAi(turnId, (e) => { if (e.type === 'done') ended = true; applyEvent(msg.id, q, e); }, ctrl.signal);
  } catch { /* network: retried when the app is visible again */ }
  if (controller === ctrl) controller = null;
  if (ended || ctrl.signal.aborted) finish(msg.id, false);
  else set({ busy: false });
}

export const aiStore = {
  /** Load the chat on screen from the server (once per app start), and re-attach to an answer still running. */
  init(force = false): Promise<void> {
    if (loading) return loading;
    if (state.loaded && !force) return Promise.resolve();
    loading = (async () => {
      try {
        const saved = store.get();
        if (saved === 'new' && !force) { set({ loaded: true, loadError: undefined }); return; }
        const { conversationId, turns } = await aiApi.turns(saved && saved !== 'new' ? saved : 'latest');
        if (state.busy && state.loaded) return; // a question started meanwhile; keep what's on screen
        const { msgs, groups } = fromTurns(turns);
        set((s) => ({ conversationId, msgs, groups, view: groups.some((g) => g.id === s.view) ? s.view : 'overview', loaded: true, loadError: undefined }));
        const running = turns.find((t) => t.status === 'running');
        if (running) void watch(running.id);
      } catch (e) {
        set({ loaded: true, loadError: (e as Error).message });
      } finally { loading = null; }
    })();
    return loading;
  },
  /** The app came back to the foreground: re-attach if an answer was running when it went away. */
  resume() {
    if (!state.loaded) return void aiStore.init();
    const open = state.msgs.find((m) => m.role === 'assistant' && !m.done && m.turnId);
    if (open?.turnId && !controller) void watch(open.turnId);
  },
  /** The Squad AI page tells the store when it is open (clears the nav dot). */
  setOnPage(v: boolean) { onPage = v; if (v && state.ready) set({ ready: false }); },
  /** Phone layout: whether the Dashboard tab is showing (for the unseen counter). */
  setBoardVisible(v: boolean) { boardVisible = v; if (v && state.unseen) set({ unseen: 0 }); },
  show(view: AiState['view']) { set({ view }); },

  async stop() {
    const id = state.runningId;
    controller?.abort();
    if (id) await aiApi.stop(id).catch(() => undefined);
  },

  /** Start a new chat. Earlier ones stay in History. */
  reset() {
    if (state.busy) return;
    store.set('new');
    set({ conversationId: null, msgs: [], groups: [], view: 'overview', unseen: 0 });
  },

  async send(text: string) {
    const q = text.trim();
    if (!q || state.busy) return;
    const aId = uid();
    set((s) => ({ msgs: [...s.msgs, { id: `${aId}-q`, role: 'user', text: q, done: true }, { id: aId, role: 'assistant', text: '', tools: [] }], busy: true, loaded: true }));
    const ctrl = new AbortController();
    controller = ctrl;
    let ended = false;
    let failed = false;
    try {
      await askAi(q, state.conversationId, (e) => {
        if (e.type === 'turn') patchMsg(`${aId}-q`, (m) => ({ ...m, turnId: e.id }));
        if (e.type === 'done') ended = true;
        applyEvent(aId, q, e);
      }, ctrl.signal);
    } catch (err) {
      failed = true;
      patchMsg(aId, (m) => ({ ...m, error: true, done: true, text: m.text || (err as Error).message }));
    }
    if (controller === ctrl) controller = null;
    const turnId = state.msgs.find((m) => m.id === aId)?.turnId;
    if (failed || ended || ctrl.signal.aborted || !turnId) {
      if (failed) set({ busy: false, runningId: null });
      else finish(aId, ctrl.signal.aborted && !ended);
    } else {
      // The connection dropped (app went to the background) but the answer is still running on the server.
      set({ busy: false });
      if (document.visibilityState === 'visible') setTimeout(() => aiStore.resume(), 1500);
    }
  },

  /* ─────────── History ─────────── */

  async loadHistory() {
    try {
      const { items } = await aiApi.history();
      set({ history: items });
    } catch (e) {
      set({ history: state.history ?? [] });
      throw e;
    }
  },

  /** Open a saved chat (from History) and show that answer's visuals. */
  async open(item: Pick<AiHistoryItem, 'id' | 'conversationId'>) {
    if (state.busy && item.conversationId !== state.conversationId) throw new Error('Wait for the current answer to finish first.');
    if (item.conversationId !== state.conversationId) {
      const { conversationId, turns } = await aiApi.turns(item.conversationId);
      const { msgs, groups } = fromTurns(turns);
      store.set(item.conversationId);
      set({ conversationId, msgs, groups });
    }
    set((s) => ({ view: s.groups.some((g) => g.id === item.id) ? item.id : 'overview' }));
  },

  async remove(id: string) {
    await aiApi.deleteTurn(id);
    set((s) => {
      const msgs = s.msgs.filter((m) => m.turnId !== id && m.id !== id && m.id !== `${id}-q`);
      return {
        msgs, groups: s.groups.filter((g) => g.id !== id), view: s.view === id ? 'overview' : s.view,
        history: s.history?.filter((h) => h.id !== id) ?? null,
      };
    });
  },

  async clearAll() {
    controller?.abort();
    await aiApi.clearHistory();
    store.set('new');
    set({ conversationId: null, msgs: [], groups: [], view: 'overview', history: [], busy: false, runningId: null, unseen: 0 });
  },

  /** An approval card changed (approved / dismissed): keep the saved copy in step. */
  patchBlock(blockId: string, patch: Record<string, unknown>) {
    set((s) => ({ groups: s.groups.map((g) => ({ ...g, blocks: g.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } as BlockWithId : b)) })) }));
  },
};

// Re-attach when the phone brings the app back.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.loaded) aiStore.resume(); });
}
