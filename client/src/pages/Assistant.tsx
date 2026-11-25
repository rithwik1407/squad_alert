import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUp, BarChart3, BrainCircuit, CalendarClock, Check, CircleAlert, Clock, FileText, LayoutDashboard, Loader2, MessageSquare,
  History, LayoutGrid, RotateCcw, Sparkles, Square, Swords, Trophy, UserCheck, Users, X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Avatar, cx, Skeleton } from '@/components/ui';
import { BlockGrid, Panel } from '@/components/ai/Blocks';
import { Markdown } from '@/components/ai/Markdown';
import { aiApi } from '@/lib/ai';
import { aiStore, useAi, type AiGroup, type ToolStep } from '@/lib/aiStore';
import { spring } from '@/lib/motion';

const PROMPTS: { cat: string; icon: typeof Users; q: string; captain?: boolean }[] = [
  { cat: 'Squad', icon: Users, q: "Suggest today's best four players" },
  { cat: 'Players', icon: Trophy, q: 'Who is our MVP this month?' },
  { cat: 'Performance', icon: BarChart3, q: 'Analyze our last 10 matches' },
  { cat: 'Attendance', icon: UserCheck, q: 'Who misses scrims frequently?' },
  { cat: 'Strategy', icon: Swords, q: 'What are our biggest weaknesses and how do we fix them?' },
  { cat: 'Scheduling', icon: Clock, q: 'Which time is best for our daily scrims?' },
  { cat: 'Report', icon: FileText, q: 'Generate a report for our last match' },
  { cat: 'Agent', icon: CalendarClock, q: 'Schedule a scrim tomorrow at 9 PM', captain: true },
];

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

function ToolSteps({ steps }: { steps: ToolStep[] }) {
  return (
    <ul className="mb-2 space-y-1" aria-label="What the AI checked">
      <AnimatePresence initial={false}>
        {steps.map((s) => (
          <motion.li key={s.id} initial={{ opacity: 0, x: -8, height: 0 }} animate={{ opacity: 1, x: 0, height: 'auto' }} transition={spring}
            className="flex items-center gap-2 text-xs">
            <span className={cx('grid h-4 w-4 place-items-center rounded-full', s.status === 'done' ? 'bg-emerald-400/15 text-emerald-300' : s.status === 'error' ? 'bg-red-500/15 text-red-300' : 'text-ember-300')}>
              {s.status === 'start' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : s.status === 'done' ? <Check className="h-2.5 w-2.5" aria-hidden /> : <CircleAlert className="h-2.5 w-2.5" aria-hidden />}
            </span>
            <span className={s.status === 'start' ? 'text-zinc-200' : 'text-zinc-500'}>{s.label}{s.status === 'start' ? '…' : ''}</span>
            {s.ms != null && <span className="font-mono text-[10px] text-zinc-600">{s.ms}ms</span>}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function EngineChip({ engine }: { engine?: string }) {
  const label = engine === 'gemini' ? 'Gemini · live' : engine === 'groq' ? 'Groq · live' : engine === 'offline' ? 'Built-in analyst' : '…';
  return (
    <span className={cx('chip ring-1', engine === 'offline' ? 'bg-zinc-500/10 text-zinc-300 ring-zinc-400/20' : 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25')}>
      <span className={cx('h-1.5 w-1.5 rounded-full', engine === 'offline' ? 'bg-zinc-400' : 'animate-pulse bg-emerald-400')} />{label}
    </span>
  );
}

export default function Assistant() {
  const { user, team, isCaptain } = useAuth();
  const ai = useAi();
  const { msgs, groups, busy, view } = ai;
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<'chat' | 'board'>('chat');
  const [historyOpen, setHistoryOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const status = useQuery({ queryKey: ['ai-status'], queryFn: aiApi.status, staleTime: 5 * 60_000 });
  const overview = useQuery({ queryKey: ['ai-overview'], queryFn: aiApi.overview, staleTime: 60_000 });
  const engine = ai.engine ?? status.data?.engine;

  // Being on this page clears the "answer ready" dot; answers keep streaming after we leave.
  useEffect(() => { aiStore.setOnPage(true); return () => aiStore.setOnPage(false); }, []);
  // On phones the dashboard is a tab: count visuals that land while it's hidden. Desktop always shows it.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => aiStore.setBoardVisible(mq.matches || tab === 'board');
    sync();
    mq.addEventListener('change', sync);
    return () => { mq.removeEventListener('change', sync); aiStore.setBoardVisible(true); };
  }, [tab]);

  // Keep the newest message in view while it streams.
  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 260) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, []);

  // Auto-grow the composer.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  function send(text: string) { if (!text.trim() || busy) return; setInput(''); void aiStore.send(text); }
  function onSubmit(e: FormEvent) { e.preventDefault(); send(input); }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); }
  }
  function open(v: string) {
    aiStore.show(v);
    setHistoryOpen(false);
    setTab('board');
    boardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const prompts = PROMPTS.filter((p) => !p.captain || isCaptain);
  const current: AiGroup | undefined = view === 'overview' ? undefined : groups.find((g) => g.id === view);

  /* ─────────── Dashboard: the overview, or only the answer being viewed ─────────── */
  const board = (
    <div ref={boardRef} className="min-w-0 scroll-mt-24">
      <div className="relative mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={current?.id ?? 'overview'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
              {current ? (
                <>
                  <p className="hud-label">AI answer</p>
                  <p className="mt-1 line-clamp-2 font-display text-xl font-bold uppercase leading-tight tracking-wide text-white">{current.question}</p>
                  <p className="text-xs text-zinc-500">{new Date(current.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {current.pending ? 'Building visuals from live data…' : `${current.blocks.length} visual${current.blocks.length === 1 ? '' : 's'}`}</p>
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
          {current && (
            <button onClick={() => aiStore.show('overview')} className="btn-ghost !px-3 !py-1.5 text-xs"><LayoutGrid className="h-3.5 w-3.5" aria-hidden />Overview</button>
          )}
          <button onClick={() => setHistoryOpen((o) => !o)} disabled={!groups.length} aria-expanded={historyOpen}
            className="btn-ghost !px-3 !py-1.5 text-xs"><History className="h-3.5 w-3.5" aria-hidden />History{groups.length ? <span className="font-mono text-ember-300">{groups.length}</span> : null}</button>
        </div>
        <AnimatePresence>
          {historyOpen && (
            <>
              <motion.button aria-label="Close history" className="fixed inset-0 z-30 cursor-default" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setHistoryOpen(false)} />
              <motion.div initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={spring}
                className="glass no-ticks absolute right-0 top-full z-40 mt-2 w-full max-w-sm origin-top-right bg-ink-900 p-2 shadow-2xl">
                <div className="flex items-center justify-between px-2 py-1">
                  <p className="hud-label">History</p>
                  <button onClick={() => setHistoryOpen(false)} aria-label="Close" className="rounded p-1 text-zinc-500 hover:text-white"><X className="h-4 w-4" /></button>
                </div>
                <ul className="max-h-80 overflow-y-auto">
                  {groups.map((g) => (
                    <li key={g.id}>
                      <button onClick={() => open(g.id)} className={cx('flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-white/5', g.id === view && 'bg-ember-500/10')}>
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ember-400" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-white">{g.question}</span>
                          <span className="block text-[11px] text-zinc-500">{new Date(g.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {g.blocks.length} visual{g.blocks.length === 1 ? '' : 's'}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </motion.div>
            </>
          )}
        </AnimatePresence>
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
  const chat = (
    <div className="glass gborder flex h-[calc(100dvh-27rem)] min-h-[340px] flex-col overflow-hidden p-0 lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <BrainCircuit className="h-4 w-4 shrink-0 text-ember-400" aria-hidden />
          <p className="truncate font-display text-base font-bold uppercase tracking-wider text-white">Squad Intelligence</p>
        </div>
        <div className="flex items-center gap-1.5">
          <EngineChip engine={engine} />
          {msgs.length > 0 && (
            <button onClick={() => aiStore.reset()} aria-label="New chat" title="New chat" className="rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white"><RotateCcw className="h-4 w-4" /></button>
          )}
        </div>
      </div>

      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
        {msgs.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
            <p className="font-display text-2xl font-bold uppercase leading-tight text-white">Your AI team manager</p>
            <p className="mt-1 text-sm text-zinc-400">Chat normally, or ask about {team?.name ?? 'your team'}: data questions get charted on the dashboard.{isCaptain ? ' Actions wait for your approval.' : ''}</p>
            <div className="mt-4 grid gap-2">
              {prompts.map((p, i) => (
                <motion.button key={p.q} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: 0.04 * i }}
                  whileHover={{ x: 3 }} whileTap={{ scale: 0.98 }} onClick={() => send(p.q)}
                  className="group flex items-center gap-3 rounded-md border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-left hover:border-ember-400/40 hover:bg-ember-500/[0.06]">
                  <p.icon className="h-4 w-4 shrink-0 text-ember-400" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">{p.cat}</span>
                    <span className="block text-sm text-zinc-200 group-hover:text-white">{p.q}</span>
                  </span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : msgs.map((m) => m.role === 'user' ? (
          <motion.div key={m.id} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring} className="flex justify-end gap-2">
            <p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-sm border border-ember-400/25 bg-ember-500/[0.12] px-3 py-2 text-sm text-white">{m.text}</p>
            {user && <Avatar name={user.ign} src={user.avatar} size={28} />}
          </motion.div>
        ) : (
          <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex gap-2.5">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center bg-gradient-to-b from-ember-400 to-ember-600 text-ink-950 cut-sm"><Sparkles className="h-3.5 w-3.5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              {m.tools && m.tools.length > 0 && <ToolSteps steps={m.tools} />}
              {m.notice && <p className="mb-2 rounded border border-amber-400/20 bg-amber-400/[0.06] px-2 py-1 text-xs text-amber-200">{m.notice}</p>}
              {m.error ? <p className="text-sm text-red-300">{m.text}</p>
                : m.text ? <SmoothText text={m.text} live={!m.done} />
                  : !m.done && !m.tools?.length ? <span className="inline-flex gap-1" aria-label="Thinking">{[0, 1, 2].map((i) => <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-ember-400" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />)}</span> : null}
              {m.done && m.groupId && groups.some((g) => g.id === m.groupId) && (
                <motion.button initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} onClick={() => open(m.groupId!)}
                  className={cx('mt-2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold', view === m.groupId ? 'border-ember-400/50 bg-ember-500/10 text-ember-200' : 'border-white/10 bg-white/[0.03] text-ember-300 hover:border-ember-400/40')}>
                  <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />{view === m.groupId ? 'On the dashboard' : 'Show on dashboard'}
                </motion.button>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      <form onSubmit={onSubmit} className="border-t border-white/[0.06] p-3">
        {msgs.length > 0 && !busy && (
          <div className="no-scrollbar -mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3">
            {prompts.slice(0, 6).map((p) => (
              <button key={p.q} type="button" onClick={() => send(p.q)} className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-ember-400/40 hover:text-white">{p.cat}</button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-md border border-white/10 bg-ink-900/80 p-1.5 focus-within:border-ember-400/60 focus-within:ring-2 focus-within:ring-ember-400/20">
          <label htmlFor="ai-q" className="sr-only">Ask Squad Intelligence</label>
          <textarea id="ai-q" ref={inputRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} maxLength={1000}
            placeholder={isCaptain ? 'Ask, or tell me what to prepare…' : 'Ask about your team…'}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none" />
          {busy ? (
            <button type="button" onClick={() => aiStore.stop()} aria-label="Stop" className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white/10 text-white hover:bg-white/15"><Square className="h-4 w-4" /></button>
          ) : (
            <motion.button type="submit" disabled={!input.trim()} aria-label="Send" whileTap={{ scale: 0.9 }}
              className="grid h-10 w-10 shrink-0 place-items-center bg-gradient-to-b from-ember-400 to-ember-600 text-ink-950 cut-sm disabled:opacity-40"><ArrowUp className="h-5 w-5" /></motion.button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[10px] text-zinc-600">Keeps working if you switch pages. {isCaptain ? 'Nothing changes until you approve.' : 'Only the captain can approve actions.'}</p>
      </form>
    </div>
  );

  const header = (
    <header className="relative mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] pb-4 lg:mb-6">
      <div className="min-w-0">
        <p className="eyebrow mb-1.5">Squad Intelligence</p>
        <h1 className="text-2xl font-bold leading-none text-white sm:text-4xl">AI command center</h1>
        <p className="mt-2 hidden text-sm text-zinc-400 sm:block">Analyze. Recommend. Act with captain approval.</p>
      </div>
      <motion.span aria-hidden className="absolute -bottom-px left-0 h-0.5 w-24 origin-left bg-gradient-to-r from-ember-400 to-transparent" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 }} />
    </header>
  );

  /* Phone / tablet: Chat and Dashboard as tabs. */
  const tabs = (
    <div role="tablist" aria-label="View" className="mb-4 grid grid-cols-2 rounded-md border border-white/10 bg-white/[0.03] p-1 lg:hidden">
      {([['chat', 'Chat', MessageSquare], ['board', 'Dashboard', LayoutDashboard]] as const).map(([k, label, I]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={cx('relative flex items-center justify-center gap-2 rounded py-2 font-display text-sm font-bold uppercase tracking-wider', tab === k ? 'text-ink-950' : 'text-zinc-400')}>
          {tab === k && <motion.span layoutId="ai-tab" className="absolute inset-0 rounded bg-ember-400" transition={spring} />}
          <I className="relative h-4 w-4" aria-hidden /><span className="relative">{label}</span>
          {k === 'board' && ai.unseen > 0 && (
            <motion.span key={ai.unseen} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={spring}
              className="relative min-w-[18px] rounded-full bg-white px-1 text-[10px] leading-[18px] text-ink-950">{ai.unseen}</motion.span>
          )}
        </button>
      ))}
    </div>
  );

  // Desktop: dashboard left, chat docked right at full height.
  return (
    <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
      <div className="min-w-0">
        {header}
        {tabs}
        <div className={cx(tab === 'board' ? 'block' : 'hidden', 'lg:block')}>{board}</div>
      </div>
      <div className={cx('min-w-0', tab === 'chat' ? 'block' : 'hidden', 'lg:block')}>{chat}</div>
    </div>
  );
}
