import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown, ArrowUp, BarChart3, BrainCircuit, CalendarClock, Check, ChevronDown, CircleAlert, Clock, History, LayoutDashboard, LayoutGrid, Loader2,
  MessageSquare, MessageSquarePlus, Sparkles, Square, Swords, Trash2, Trophy, UserCheck, Users, X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { cx, Skeleton } from '@/components/ui';
import { useDialog } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { BlockGrid, Panel } from '@/components/ai/Blocks';
import { Markdown } from '@/components/ai/Markdown';
import { Sheet } from '@/components/ai/Sheet';
import { aiApi } from '@/lib/ai';
import { aiStore, useAi, type AiGroup, type AiMsg, type ToolStep } from '@/lib/aiStore';
import type { AiSuggestion } from '@/lib/aiTypes';
import { spring } from '@/lib/motion';

const CAT_ICON: Record<string, typeof Users> = {
  Squad: Users, Players: Trophy, Performance: BarChart3, Attendance: UserCheck, Strategy: Swords, Schedule: Clock, Actions: CalendarClock,
};

/* Suggestions: a fresh set every visit. The ids shown on the last few visits are skipped by the server. */
const SEEN_KEY = 'ss_ai_seen';
const readSeen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]; } catch { return []; } };
const rememberSeen = (ids: string[]) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids, ...readSeen().filter((x) => !ids.includes(x))].slice(0, 16))); } catch { /* private mode */ } };

const timeOf = (at: number | string) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayOf(at: string) {
  const d = new Date(at);
  const today = new Date();
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Reveals streamed text at a steady pace so bursts from the network read like smooth typing. */
function SmoothText({ text, live }: { text: string; live: boolean }) {
  const [shown, setShown] = useState(live ? 0 : text.length);
  const target = useRef(text);
  target.current = text;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setShown((n) => {
        const backlog = target.current.length - n;
        if (backlog <= 0) return n;
        return n + Math.max(1, Math.ceil(backlog / 14));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const typing = live || shown < text.length;
  return (
    <div className="relative">
      <Markdown text={text.slice(0, shown)} />
      {typing && <span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse-glow bg-ember-400" />}
    </div>
  );
}

/** Long finished answers fold to a preview with "Show more". */
function Answer({ m }: { m: AiMsg }) {
  const [open, setOpen] = useState(false);
  const long = Boolean(m.done && m.text.length > 900);
  return (
    <>
      <div className={cx('relative', long && !open && 'max-h-[20rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]')}>
        <SmoothText text={m.text} live={!m.done} />
      </div>
      {long && (
        <div>
          <button onClick={() => setOpen((o) => !o)} className="mt-1 inline-flex items-center gap-1 py-1 text-xs font-semibold text-ember-300 hover:text-ember-200">
            <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />{open ? 'Show less' : 'Show more'}
          </button>
        </div>
      )}
    </>
  );
}

function ToolSteps({ steps }: { steps: ToolStep[] }) {
  return (
    <ul className="mb-2.5 space-y-1 border-l border-white/10 pl-3" aria-label="What the AI checked">
      <AnimatePresence initial={false}>
        {steps.map((s) => (
          <motion.li key={s.id} initial={{ opacity: 0, x: -8, height: 0 }} animate={{ opacity: 1, x: 0, height: 'auto' }} transition={spring}
            className="flex items-center gap-2 text-xs">
            <span className={cx('grid h-4 w-4 shrink-0 place-items-center rounded-full', s.status === 'done' ? 'bg-emerald-400/15 text-emerald-300' : s.status === 'error' ? 'bg-red-500/15 text-red-300' : 'text-ember-300')}>
              {s.status === 'start' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : s.status === 'done' ? <Check className="h-2.5 w-2.5" aria-hidden /> : <CircleAlert className="h-2.5 w-2.5" aria-hidden />}
            </span>
            <span className={s.status === 'start' ? 'text-zinc-200' : 'text-zinc-500'}>{s.label}{s.status === 'start' ? '…' : ''}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/** One quiet status line under the name: online, or the built-in fallback. */
function EngineStatus({ engine, label, model, busy }: { engine?: string; label?: string; model?: string; busy: boolean }) {
  const offline = engine === 'offline';
  const text = busy ? 'Thinking…' : !engine ? 'Connecting…' : offline ? 'Basic mode' : 'Online';
  return (
    <span title={model ? `${label ?? engine} · ${model}` : undefined} className="flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', busy ? 'animate-pulse bg-ember-400' : offline || !engine ? 'bg-zinc-500' : 'bg-emerald-400')} />
      {text}
    </span>
  );
}

/** The assistant's face: a small glowing orb with the sparkle. */
function AiOrb({ size = 32, live }: { size?: number; live?: boolean }) {
  return (
    <span className="relative grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-ember-300 via-ember-500 to-ember-700 text-ink-950 shadow-[0_0_18px_rgb(var(--ember-500)/.35)]"
      style={{ width: size, height: size }} aria-hidden>
      {live && <span className="absolute inset-0 animate-ping rounded-full bg-ember-400/30" />}
      <Sparkles className="relative" style={{ width: size * 0.48, height: size * 0.48 }} strokeWidth={2.4} />
    </span>
  );
}

/**
 * Phones: the chat is pinned between the top bar and the bottom nav (and above the keyboard), so only the
 * message list scrolls. Returns null on desktop, where the chat docks beside the dashboard.
 */
function useMobileFrame(active: boolean) {
  const [frame, setFrame] = useState<{ top: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    if (!active) { setFrame(null); return; }
    const mq = window.matchMedia('(min-width: 1024px)');
    const measure = () => {
      if (mq.matches) return setFrame(null);
      const top = document.querySelector('[data-topbar]')?.getBoundingClientRect().bottom ?? 0;
      const nav = document.querySelector('[data-bottomnav]')?.getBoundingClientRect().height ?? 0;
      const vv = window.visualViewport;
      // With the keyboard open the visual viewport shrinks: sit on top of the keyboard instead of the nav.
      const keyboard = vv ? Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)) : 0;
      setFrame({ top: Math.max(0, top), bottom: Math.max(nav, keyboard) });
    };
    measure();
    const t = setTimeout(measure, 350);
    mq.addEventListener('change', measure);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      clearTimeout(t);
      mq.removeEventListener('change', measure);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [active]);
  return frame;
}

export default function Assistant() {
  const { user, team, isCaptain } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const ai = useAi();
  const { msgs, groups, busy, view } = ai;
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<'chat' | 'board'>('chat');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sheetGroup, setSheetGroup] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const frame = useMobileFrame(tab === 'chat');

  const status = useQuery({ queryKey: ['ai-status'], queryFn: aiApi.status, staleTime: 5 * 60_000 });
  const overview = useQuery({ queryKey: ['ai-overview'], queryFn: aiApi.overview, staleTime: 60_000 });
  // A new set of suggestions each time the page opens.
  const [visit] = useState(() => Date.now());
  const suggestions = useQuery({
    queryKey: ['ai-suggestions', visit], staleTime: Infinity, gcTime: 0,
    queryFn: async () => { const r = await aiApi.suggestions(readSeen()); rememberSeen(r.suggestions.map((s) => s.id)); return r.suggestions; },
  });
  const engine = ai.engine ?? status.data?.engine;
  const engineLabel = ai.label ?? status.data?.label;

  useEffect(() => { void aiStore.init(); }, []);
  // Being on this page clears the "answer ready" dot; answers keep running after we leave.
  useEffect(() => { aiStore.setOnPage(true); return () => aiStore.setOnPage(false); }, []);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => { setIsDesktop(mq.matches); aiStore.setBoardVisible(mq.matches || tab === 'board'); };
    sync();
    mq.addEventListener('change', sync);
    return () => { mq.removeEventListener('change', sync); aiStore.setBoardVisible(true); };
  }, [tab]);

  // Keep the newest message in view while it streams, unless the reader scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom && msgs.length) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs, atBottom]);
  useEffect(() => { requestAnimationFrame(() => { const el = scroller.current; if (el) el.scrollTo({ top: msgs.length ? el.scrollHeight : 0 }); }); }, [ai.loaded, tab, ai.conversationId]); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  }, []);
  const jump = () => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); setAtBottom(true); };

  // Auto-grow the composer.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  function send(text: string) {
    if (!text.trim() || busy) return;
    setInput('');
    setAtBottom(true);
    void aiStore.send(text);
  }
  function onSubmit(e: FormEvent) { e.preventDefault(); send(input); }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && isDesktop) { e.preventDefault(); send(input); }
  }
  /** Visuals for one answer: beside the chat on desktop, in a swipe-down sheet on phones. */
  function showVisuals(id: string) {
    aiStore.show(id);
    if (isDesktop) boardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else setSheetGroup(id);
  }
  async function openHistory() {
    setHistoryOpen(true);
    await aiStore.loadHistory().catch((e) => toast.error(e));
  }
  async function openItem(item: { id: string; conversationId: string; visuals: number }) {
    try {
      await aiStore.open(item);
      setHistoryOpen(false);
      setAtBottom(false);
      if (item.visuals) { if (isDesktop) aiStore.show(item.id); else setSheetGroup(item.id); }
      else setTab('chat');
      requestAnimationFrame(() => document.getElementById(`turn-${item.id}`)?.scrollIntoView({ block: 'start' }));
    } catch (e) { toast.error(e); }
  }
  async function removeItem(id: string) {
    try { await aiStore.remove(id); } catch (e) { toast.error(e); }
  }
  async function clearAll() {
    const ok = await dialog.confirm('Clear all history?', { text: 'Every saved question and answer is deleted for you. Teammates are not affected.', confirmLabel: 'Clear all', danger: true });
    if (!ok) return;
    try { await aiStore.clearAll(); setHistoryOpen(false); toast.success('History cleared'); } catch (e) { toast.error(e); }
  }

  const sugg: AiSuggestion[] = suggestions.data ?? [];
  const current: AiGroup | undefined = view === 'overview' ? undefined : groups.find((g) => g.id === view);
  const sheet = sheetGroup ? groups.find((g) => g.id === sheetGroup) : undefined;

  /* ─────────── History panel ─────────── */
  const historyList = (
    <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="History" subtitle="Your questions. Only you can see them."
      footer={ai.history?.length ? (
        <button onClick={clearAll} className="btn-danger w-full !py-2 text-sm"><Trash2 className="h-4 w-4" aria-hidden />Clear all</button>
      ) : undefined}>
      {ai.history == null ? (
        <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : !ai.history.length ? (
        <p className="py-8 text-center text-sm text-zinc-500">No questions yet.</p>
      ) : (
        <ul className="-mx-2">
          <AnimatePresence initial={false}>
            {ai.history.map((h, i) => {
              const head = i === 0 || dayOf(ai.history![i - 1].at) !== dayOf(h.at);
              return (
                <motion.li key={h.id} layout exit={{ opacity: 0, x: 40, height: 0 }} transition={spring}>
                  {head && <p className="px-2 pb-1 pt-3 font-display text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">{dayOf(h.at)}</p>}
                  <div className={cx('group flex items-center gap-1 rounded-md hover:bg-white/5', h.id === view && 'bg-ember-500/10')}>
                    <button onClick={() => openItem(h)} className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2.5 text-left">
                      {h.status === 'running' ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-ember-400" aria-hidden /> : h.visuals ? <LayoutDashboard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ember-400" aria-hidden /> : <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm text-white">{h.question}</span>
                        <span className="block text-[11px] text-zinc-500">{timeOf(h.at)}{h.visuals ? ` · ${h.visuals} visual${h.visuals === 1 ? '' : 's'}` : ''}{h.status === 'running' ? ' · answering…' : ''}</span>
                      </span>
                    </button>
                    <button onClick={() => removeItem(h.id)} aria-label={`Delete "${h.question}"`} title="Delete"
                      className="mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-red-500/10 hover:text-red-300"><X className="h-4 w-4" /></button>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </Sheet>
  );

  /* ─────────── Dashboard: the overview, or only the answer being viewed ─────────── */
  const board = (
    <div ref={boardRef} className="min-w-0 scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={current?.id ?? 'overview'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
              {current ? (
                <>
                  <p className="hud-label">AI answer</p>
                  <p className="mt-1 line-clamp-2 font-display text-xl font-bold uppercase leading-tight tracking-wide text-white">{current.question}</p>
                  <p className="text-xs text-zinc-500">{timeOf(current.at)} · {current.pending ? 'Building visuals from live data…' : `${current.blocks.length} visual${current.blocks.length === 1 ? '' : 's'}`}</p>
                </>
              ) : (
                <>
                  <p className="hud-label">Dashboard</p>
                  <p className="mt-1 font-display text-xl font-bold uppercase leading-tight tracking-wide text-white">Team overview</p>
                  <p className="text-xs text-zinc-500">Last 20 matches · ask a question to chart anything else</p>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {current && <button onClick={() => aiStore.show('overview')} className="btn-ghost !px-3 !py-1.5 text-xs"><LayoutGrid className="h-3.5 w-3.5" aria-hidden />Overview</button>}
          <button onClick={openHistory} className="btn-ghost !px-3 !py-1.5 text-xs"><History className="h-3.5 w-3.5" aria-hidden />History</button>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={current?.id ?? 'overview'} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
          {current ? (
            current.blocks.length ? <BlockGrid blocks={current.blocks} isCaptain={isCaptain} />
              : (
                <div className="glass flex h-48 items-center justify-center gap-3 text-sm text-zinc-400">
                  <BrainCircuit className="h-5 w-5 animate-pulse-glow text-ember-400" aria-hidden />Building visuals from your team's records…
                </div>
              )
          ) : overview.isLoading ? (
            <div className="grid gap-4"><Skeleton className="h-36" /><Skeleton className="h-48" /></div>
          ) : overview.data?.blocks.length ? (
            <BlockGrid blocks={overview.data.blocks} isCaptain={isCaptain} />
          ) : (
            <Panel title="No results yet"><p className="text-sm text-zinc-400">Log placement and kills on finished matches (or upload the results screenshot). The overview fills in from there.</p></Panel>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );

  /* ─────────── Chat ─────────── */
  const firstName = (user?.ign ?? '').replace(/^RARE丨/i, '');
  const empty = (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex min-h-full flex-col justify-center py-2">
      <div className="flex flex-col items-center text-center">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
          <AiOrb size={52} />
        </motion.div>
        <p className="mt-3 text-xl font-semibold text-white">Hi{firstName ? ` ${firstName}` : ''}, how can I help?</p>
        <p className="mt-1 max-w-xs text-sm text-zinc-400">Ask anything about {team?.name ?? 'your team'}. {isCaptain ? 'Actions wait for your OK.' : 'Stats come with charts.'}</p>
      </div>
      <p className="mb-2 mt-6 text-xs font-medium text-zinc-500">Try asking</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {suggestions.isLoading ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />) : sugg.map((p, i) => {
          const I = CAT_ICON[p.cat] ?? Sparkles;
          return (
            <motion.button key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.05 * i }}
              whileTap={{ scale: 0.98 }} onClick={() => send(p.q)}
              className="group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-3 text-left hover:border-ember-400/40 hover:bg-ember-500/[0.06]">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ember-500/10 text-ember-400"><I className="h-4 w-4" aria-hidden /></span>
              <span className="min-w-0 flex-1 text-sm text-zinc-200 group-hover:text-white">{p.q}</span>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );

  const messages = msgs.map((m) => m.role === 'user' ? (
    <motion.div key={m.id} id={m.turnId ? `turn-${m.turnId}` : undefined} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}
      className="flex scroll-mt-3 justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gradient-to-b from-ember-400 to-ember-500 px-3.5 py-2 text-[15px] leading-relaxed text-ink-950 sm:text-sm">{m.text}</p>
    </motion.div>
  ) : (
    <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex gap-2.5">
      <span className="mt-1"><AiOrb size={26} live={!m.done} /></span>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-white/[0.06] bg-white/[0.035] px-3.5 py-2.5 text-[15px] leading-relaxed sm:text-sm">
        {m.tools && m.tools.length > 0 && <ToolSteps steps={m.tools} />}
        {m.notice && <p className="mb-2 rounded border border-amber-400/20 bg-amber-400/[0.06] px-2 py-1 text-xs text-amber-200">{m.notice}</p>}
        {m.error ? <p className="text-sm text-red-300">{m.text}</p>
          : m.text ? <Answer m={m} />
            : !m.done && !m.tools?.length ? <span className="inline-flex gap-1" aria-label="Thinking">{[0, 1, 2].map((i) => <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-ember-400" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />)}</span> : null}
        {m.groupId && groups.some((g) => g.id === m.groupId) && (
          <motion.button initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} onClick={() => showVisuals(m.groupId!)}
            className={cx('mt-2.5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold', isDesktop && view === m.groupId ? 'border-ember-400/50 bg-ember-500/10 text-ember-200' : 'border-white/10 bg-white/[0.03] text-ember-300 hover:border-ember-400/40')}>
            <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
            {isDesktop ? (view === m.groupId ? 'On the dashboard' : 'Show on dashboard') : `View visuals${groups.find((g) => g.id === m.groupId)?.blocks.length ? ` (${groups.find((g) => g.id === m.groupId)!.blocks.length})` : ''}`}
          </motion.button>
        )}
      </div>
    </motion.div>
  ));

  const chat = (
    <div className={cx('flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-900/90 p-0 shadow-xl', frame ? 'h-full' : 'h-[calc(100dvh-27rem)] min-h-[340px] lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)]')}>
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <AiOrb size={34} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-tight text-white">Squad AI</p>
            <EngineStatus engine={engine} label={engineLabel} model={ai.model} busy={busy} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={openHistory} aria-label="History" title="History" className="grid h-9 w-9 place-items-center rounded-full text-zinc-400 hover:bg-white/5 hover:text-white lg:hidden"><History className="h-[18px] w-[18px]" /></button>
          {msgs.length > 0 && (
            <button onClick={() => aiStore.reset()} disabled={busy} aria-label="New chat" title="New chat" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 px-3 text-xs font-semibold text-zinc-200 hover:bg-white/5 hover:text-white disabled:opacity-40"><MessageSquarePlus className="h-4 w-4" aria-hidden />New</button>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div id="ai-scroll" ref={scroller} onScroll={onScroll} className="h-full space-y-4 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4" data-lenis-prevent aria-live="polite">
          {!ai.loaded ? <div className="space-y-3"><Skeleton className="ml-auto h-10 w-2/3" /><Skeleton className="h-24" /></div>
            : ai.loadError && !msgs.length ? <p className="text-sm text-red-300">{ai.loadError} <button className="font-semibold text-ember-300" onClick={() => aiStore.init(true)}>Retry</button></p>
              : msgs.length === 0 ? empty : messages}
        </div>
        <AnimatePresence>
          {!atBottom && msgs.length > 0 && (
            <motion.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} onClick={jump}
              className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/15 bg-ink-800 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />{busy ? 'Jump to live answer' : 'Jump to latest'}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <form onSubmit={onSubmit} className="border-t border-white/[0.06] p-2.5 sm:p-3">
        {msgs.length > 0 && !busy && sugg.length > 0 && (
          <div className="no-scrollbar -mx-2.5 mb-2 flex gap-1.5 overflow-x-auto px-2.5 sm:-mx-3 sm:px-3">
            {sugg.map((p) => (
              <button key={p.id} type="button" onClick={() => send(p.q)} className="shrink-0 whitespace-nowrap rounded-full bg-white/[0.05] px-3 py-1.5 text-xs text-zinc-300 ring-1 ring-white/10 hover:text-white hover:ring-ember-400/40">{p.q}</button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-3xl border border-white/10 bg-ink-950/70 py-1 pl-2 pr-1 transition-colors focus-within:border-ember-400/60 focus-within:ring-2 focus-within:ring-ember-400/20">
          <label htmlFor="ai-q" className="sr-only">Ask Squad Intelligence</label>
          <textarea id="ai-q" ref={inputRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} maxLength={1000} enterKeyHint="send"
            placeholder="Message Squad AI…"
            className="max-h-36 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-base text-white placeholder:text-zinc-500 focus:outline-none sm:text-sm" />
          {busy ? (
            <button type="button" onClick={() => aiStore.stop()} aria-label="Stop" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/15"><Square className="h-4 w-4 fill-current" /></button>
          ) : (
            <motion.button type="submit" disabled={!input.trim()} aria-label="Send" whileTap={{ scale: 0.9 }}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-b from-ember-400 to-ember-600 text-ink-950 transition-opacity disabled:opacity-30"><ArrowUp className="h-5 w-5" strokeWidth={2.6} /></motion.button>
          )}
        </div>
        <p className="mt-1.5 hidden text-center text-[11px] text-zinc-600 sm:block">Keeps answering if you leave. {isCaptain ? 'Nothing changes without your OK.' : 'Only the captain approves changes.'}</p>
      </form>
    </div>
  );

  const header = (
    <header className="relative mb-6 hidden flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] pb-4 lg:flex">
      <div className="min-w-0">
        <p className="eyebrow mb-1.5">Squad Intelligence</p>
        <h1 className="text-4xl font-bold leading-none text-white">AI command center</h1>
        <p className="mt-2 text-sm text-zinc-400">Analyze. Recommend. Act with captain approval.</p>
      </div>
      <motion.span aria-hidden className="absolute -bottom-px left-0 h-0.5 w-24 origin-left bg-gradient-to-r from-ember-400 to-transparent" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 }} />
    </header>
  );

  /* Phone / tablet: Chat and Dashboard as tabs. */
  const tabs = (
    <div role="tablist" aria-label="View" className="grid grid-cols-2 rounded-full border border-white/10 bg-ink-900/90 p-1 lg:hidden">
      {([['chat', 'Chat', MessageSquare], ['board', 'Charts', LayoutDashboard]] as const).map(([k, label, I]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={cx('relative flex items-center justify-center gap-2 rounded-full py-1.5 text-sm font-semibold', tab === k ? 'text-ink-950' : 'text-zinc-400')}>
          {tab === k && <motion.span layoutId="ai-tab" className="absolute inset-0 rounded-full bg-ember-400" transition={spring} />}
          <I className="relative h-4 w-4" aria-hidden /><span className="relative">{label}</span>
          {k === 'board' && ai.unseen > 0 && (
            <motion.span key={ai.unseen} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={spring}
              className="relative min-w-[18px] rounded-full bg-white px-1 text-[10px] leading-[18px] text-ink-950">{ai.unseen}</motion.span>
          )}
        </button>
      ))}
    </div>
  );

  const visualsSheet = (
    <Sheet open={Boolean(sheet)} onClose={() => setSheetGroup(null)} wide title={sheet?.question ?? 'Visuals'}
      subtitle={sheet ? `${timeOf(sheet.at)} · ${sheet.pending ? 'building…' : `${sheet.blocks.length} visual${sheet.blocks.length === 1 ? '' : 's'}`} · swipe down to close` : undefined}>
      {sheet && (sheet.blocks.length ? <BlockGrid blocks={sheet.blocks} isCaptain={isCaptain} /> : <div className="flex h-40 items-center justify-center gap-3 text-sm text-zinc-400"><BrainCircuit className="h-5 w-5 animate-pulse-glow text-ember-400" aria-hidden />Building visuals…</div>)}
    </Sheet>
  );

  // Phone chat: pinned frame between the top bar and the bottom nav, portalled so page transitions can't move it.
  const phoneChat: ReactNode = frame && tab === 'chat' ? createPortal(
    <div className="fixed inset-x-0 z-20 flex flex-col gap-2 bg-ink-950 px-3 pb-2 pt-3 sm:px-6" style={{ top: frame.top, bottom: frame.bottom }}>
      {tabs}
      <div className="min-h-0 flex-1">{chat}</div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {phoneChat}
      {historyList}
      {visualsSheet}
      {/* Desktop: dashboard left, chat docked right at full height. Phones: tabs. */}
      <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
        <div className="min-w-0">
          {header}
          {!frame && <div className="mb-4">{tabs}</div>}
          <div className={cx(tab === 'board' ? 'block' : 'hidden', 'lg:block')}>{board}</div>
        </div>
        {!frame && <div className={cx('min-w-0', tab === 'chat' ? 'block' : 'hidden', 'lg:block')}>{chat}</div>}
      </div>
    </>
  );
}
