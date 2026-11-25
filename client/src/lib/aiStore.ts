/**
 * Squad AI conversation state, kept outside React pages so a question keeps streaming when the user
 * switches to another section. The Squad AI nav item shows a dot when an answer finishes off-page.
 */
import { useSyncExternalStore } from 'react';
import { askAi } from './ai';
import type { AiEvent, BlockWithId } from './aiTypes';

export interface ToolStep { id: string; label: string; status: 'start' | 'done' | 'error'; ms?: number }
export interface AiMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools?: ToolStep[];
  /** Dashboard answer this reply drew (only when the question needed visuals). */
  groupId?: string;
  notice?: string;
  engine?: string;
  done?: boolean;
  error?: boolean;
}
export interface AiGroup { id: string; question: string; at: number; blocks: BlockWithId[]; pending: boolean }

export interface AiState {
  msgs: AiMsg[];
  /** Answers that drew visuals, newest first. Feeds the History panel. */
  groups: AiGroup[];
  /** What the dashboard shows: the default overview, or one answer's visuals. */
  view: 'overview' | string;
  busy: boolean;
  engine?: string;
  /** An answer finished while the user was on another page. */
  ready: boolean;
  /** Visuals that arrived while the phone was on the Chat tab. */
  unseen: number;
}

const KEY = 'ss_ai_session_v2';
const uid = () => Math.random().toString(36).slice(2, 10);

function restore(): AiState {
  const base: AiState = { msgs: [], groups: [], view: 'overview', busy: false, ready: false, unseen: 0 };
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw) as Partial<AiState>;
    // A reload mid-answer leaves nothing streaming; close those out.
    return {
      ...base,
      msgs: (s.msgs ?? []).map((m) => ({ ...m, done: true, tools: m.tools?.map((t) => (t.status === 'start' ? { ...t, status: 'error' as const } : t)) })),
      groups: (s.groups ?? []).filter((g) => g.blocks.length).map((g) => ({ ...g, pending: false })),
      view: s.view && (s.view === 'overview' || s.groups?.some((g) => g.id === s.view)) ? s.view : 'overview',
    };
  } catch { return base; }
}

let state: AiState = restore();
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let onPage = false;
let boardVisible = true;

function set(patch: Partial<AiState> | ((s: AiState) => Partial<AiState>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  try { sessionStorage.setItem(KEY, JSON.stringify({ msgs: state.msgs.slice(-40), groups: state.groups.slice(0, 20), view: state.view })); } catch { /* full or blocked */ }
  listeners.forEach((l) => l());
}

const patchMsg = (id: string, f: (m: AiMsg) => AiMsg) => set((s) => ({ msgs: s.msgs.map((m) => (m.id === id ? f(m) : m)) }));
const patchGroup = (id: string, f: (g: AiGroup) => AiGroup) => set((s) => ({ groups: s.groups.map((g) => (g.id === id ? f(g) : g)) }));

export function useAi(): AiState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

export const aiStore = {
  /** The Squad AI page tells the store when it is open (clears the nav dot). */
  setOnPage(v: boolean) { onPage = v; if (v && state.ready) set({ ready: false }); },
  /** Phone layout: whether the Dashboard tab is showing (for the unseen counter). */
  setBoardVisible(v: boolean) { boardVisible = v; if (v && state.unseen) set({ unseen: 0 }); },
  show(view: AiState['view']) { set({ view }); },
  stop() { controller?.abort(); },
  reset() { controller?.abort(); set({ msgs: [], groups: [], view: 'overview', unseen: 0 }); },

  async send(text: string) {
    const q = text.trim();
    if (!q || state.busy) return;
    const userMsg: AiMsg = { id: uid(), role: 'user', text: q, done: true };
    const aId = uid();
    const history = [...state.msgs, userMsg].filter((m) => m.done && !m.error && m.text.trim()).slice(-12).map((m) => ({ role: m.role, text: m.text }));
    set((s) => ({ msgs: [...s.msgs, userMsg, { id: aId, role: 'assistant', text: '', tools: [] }], busy: true }));
    // The dashboard answer is only created once a tool starts, so small talk never touches the dashboard.
    let gId: string | null = null;
    const group = () => {
      if (gId) return gId;
      gId = uid();
      const id = gId;
      set((s) => ({ groups: [{ id, question: q, at: Date.now(), blocks: [], pending: true }, ...s.groups], view: id }));
      patchMsg(aId, (m) => ({ ...m, groupId: id }));
      return id;
    };
    const ctrl = new AbortController();
    controller = ctrl;
    const onEvent = (e: AiEvent) => {
      switch (e.type) {
        case 'meta': set({ engine: e.engine }); patchMsg(aId, (m) => ({ ...m, engine: e.engine })); break;
        case 'text': patchMsg(aId, (m) => ({ ...m, text: m.text + e.delta })); break;
        case 'tool':
          group();
          patchMsg(aId, (m) => {
            const tools = m.tools ?? [];
            const i = tools.findIndex((t) => t.id === e.id);
            const step = { id: e.id, label: e.label, status: e.status, ms: e.ms };
            return { ...m, tools: i < 0 ? [...tools, step] : tools.map((t, j) => (j === i ? step : t)) };
          });
          break;
        case 'block': {
          const id = group();
          patchGroup(id, (g) => ({ ...g, blocks: [...g.blocks, e.block] }));
          if (!boardVisible) set((s) => ({ unseen: s.unseen + 1 }));
          break;
        }
        case 'notice': patchMsg(aId, (m) => ({ ...m, notice: e.message })); break;
        case 'done': break;
      }
    };
    try {
      await askAi(history, onEvent, ctrl.signal);
    } catch (err) {
      patchMsg(aId, (m) => ({ ...m, error: true, text: m.text || (err as Error).message }));
    } finally {
      patchMsg(aId, (m) => ({ ...m, done: true, text: m.text || (ctrl.signal.aborted ? '_Stopped._' : 'No answer came back. Try again.') }));
      if (gId) {
        const id = gId;
        set((s) => {
          const g = s.groups.find((x) => x.id === id);
          // Tools ran but drew nothing (e.g. no data yet): drop the empty answer and go back to the overview.
          if (g && !g.blocks.length) return { groups: s.groups.filter((x) => x.id !== id), view: s.view === id ? 'overview' : s.view };
          return { groups: s.groups.map((x) => (x.id === id ? { ...x, pending: false } : x)) };
        });
      }
      set({ busy: false, ready: !onPage && !ctrl.signal.aborted ? true : state.ready });
      if (controller === ctrl) controller = null;
    }
  },
};
