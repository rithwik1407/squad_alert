import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Crown, Loader2, Lock, MessageCircle, Send, Settings2, ShieldBan, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from './Toast';
import { Avatar, cx } from './ui';
import { dayIST, isTodayIST, timeIST, splitDuration } from '@/lib/time';
import type { ChatMessage, ChatMode, ChatMute, ChatState, Member } from '@/lib/types';

const OPEN_POLL_MS = 3000;
const CLOSED_POLL_MS = 20_000;

const seenKey = (uid: string) => `ss_chat_seen_${uid}`;
/** First visit: start from now, so old history doesn't show up as a pile of unread messages. */
function readSeen(uid: string) {
  let v = '';
  try { v = localStorage.getItem(seenKey(uid)) ?? ''; } catch { /* private mode */ }
  if (!v) { v = new Date().toISOString(); writeSeen(uid, v); }
  return v;
}
function writeSeen(uid: string, iso: string) {
  try { localStorage.setItem(seenKey(uid), iso); } catch { /* private mode */ }
}

/** "18:00" -> "6:00 PM" */
function hhmmLabel(v: string) {
  const [h, m] = v.split(':').map(Number);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function leftText(untilIso: string, now: number) {
  const { d, h, m, s } = splitDuration(new Date(untilIso).getTime() - now);
  if (d) return `${d}d ${h}h left`;
  if (h) return `${h}h ${m}m left`;
  if (m) return `${m}m ${s}s left`;
  return `${s}s left`;
}

function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

/** Small round button that opens the team group chat. Lives in the app layout on every page. */
export function TeamChat() {
  const { user, team } = useAuth();
  const [open, setOpen] = useState(false);
  const uid = user?._id ?? '';
  const [seen, setSeen] = useState(() => (uid ? readSeen(uid) : ''));

  const unread = useQuery({
    queryKey: ['chat-unread', seen],
    queryFn: () => api.chatUnread(seen || new Date(0).toISOString()),
    enabled: Boolean(team) && !open,
    refetchInterval: CLOSED_POLL_MS,
  });
  const count = open ? 0 : unread.data?.count ?? 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const markSeen = (iso: string) => {
    if (!uid || iso <= seen) return;
    writeSeen(uid, iso);
    setSeen(iso);
  };

  if (!team || !user) return null;

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            key="chat-fab"
            type="button"
            onClick={() => setOpen(true)}
            aria-label={count ? `Open team chat, ${count} new` : 'Open team chat'}
            initial={{ scale: 0, rotate: -90, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            exit={{ scale: 0, rotate: 90, opacity: 0 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-b from-ember-400 to-ember-600 text-ink-950 shadow-glow lg:bottom-6 lg:right-6"
          >
            {count > 0 && <span className="absolute inset-0 animate-ping rounded-full bg-ember-400/40" aria-hidden />}
            <MessageCircle className="relative h-6 w-6" strokeWidth={2.4} aria-hidden />
            <AnimatePresence>
              {count > 0 && (
                <motion.span
                  key={count}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 18 }}
                  className="absolute -right-1 -top-1 min-w-[22px] rounded-full bg-white px-1.5 text-center text-[11px] font-bold leading-[22px] text-ink-950 ring-2 ring-ink-950"
                >
                  {count > 9 ? '9+' : count}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && <ChatPanel key="chat-panel" teamName={team.name} members={[team.captain, ...team.members].filter(Boolean) as Member[]} meId={uid} onClose={() => setOpen(false)} onSeen={markSeen} />}
      </AnimatePresence>
    </>
  );
}

function ChatPanel({ teamName, members, meId, onClose, onSeen }: {
  teamName: string; members: Member[]; meId: string; onClose: () => void; onSeen: (iso: string) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [showAdmin, setShowAdmin] = useState(false);
  const q = useQuery({ queryKey: ['chat'], queryFn: () => api.chat(), refetchInterval: OPEN_POLL_MS });
  const state = q.data?.state;
  const messages = q.data?.messages ?? [];
  const last = messages[messages.length - 1];

  useEffect(() => { if (last) onSeen(last.createdAt); }, [last?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const del = useMutation({
    mutationFn: (id: string) => api.deleteChat(id),
    onMutate: (id) => {
      qc.setQueryData<Awaited<ReturnType<typeof api.chat>>>(['chat'], (d) => d && { ...d, messages: d.messages.filter((m) => m.id !== id) });
    },
    onError: (e: Error) => { toast.error(e.message); void q.refetch(); },
  });

  return (
    <>
      <motion.div
        className="fixed inset-0 z-[55] bg-black/50 lg:hidden"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} aria-hidden
      />
      <motion.section
        role="dialog"
        aria-label="Team chat"
        initial={{ opacity: 0, scale: 0.6, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.6, y: 40, transition: { duration: 0.18 } }}
        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
        style={{ transformOrigin: 'bottom right' }}
        className="glass gborder fixed inset-x-0 bottom-0 top-[8vh] z-[60] flex flex-col overflow-hidden rounded-b-none bg-ink-900 shadow-2xl lg:inset-x-auto lg:bottom-6 lg:right-6 lg:top-auto lg:h-[min(600px,calc(100vh-3rem))] lg:w-[400px] lg:rounded-b-2xl"
      >
        <header className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-b from-ember-400 to-ember-600 text-ink-950">
            <MessageCircle className="h-5 w-5" strokeWidth={2.4} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-bold leading-tight text-white">{teamName} chat</p>
            {state ? <StatusLine state={state} /> : <p className="text-xs text-zinc-500">Loading…</p>}
          </div>
          {state?.isAdmin && (
            <button type="button" onClick={() => setShowAdmin((v) => !v)} aria-pressed={showAdmin} aria-label="Chat controls"
              className={cx('rounded-lg p-2 transition-colors', showAdmin ? 'bg-ember-500/20 text-ember-300' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100')}>
              <Settings2 className="h-5 w-5" />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close chat" className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
            <X className="h-5 w-5" />
          </button>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          {showAdmin && state?.isAdmin ? (
            <motion.div key="admin" className="flex-1 overflow-y-auto"
              initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} transition={{ duration: 0.2 }}>
              <AdminControls state={state} mutes={q.data?.mutes ?? []} members={members.filter((m) => m.id !== meId)} />
            </motion.div>
          ) : (
            <motion.div key="chat" className="flex min-h-0 flex-1 flex-col"
              initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.2 }}>
              <MessageList loading={q.isLoading} messages={messages} canDelete={Boolean(state?.isAdmin)} onDelete={(id) => del.mutate(id)} />
              {state && <Composer state={state} />}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </>
  );
}

function StatusLine({ state }: { state: ChatState }) {
  const label = state.mode === 'always' ? 'Open all day'
    : state.mode === 'closed' ? 'Closed by admin'
    : `${state.open ? 'Open' : 'Closed'} · ${hhmmLabel(state.openFrom)} to ${hhmmLabel(state.openTo)}`;
  return (
    <p className="flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={cx('h-1.5 w-1.5 rounded-full', state.open ? 'animate-pulse bg-mint-400' : 'bg-zinc-500')} aria-hidden />
      {label}
    </p>
  );
}

function MessageList({ messages, loading, canDelete, onDelete }: {
  messages: ChatMessage[]; loading: boolean; canDelete: boolean; onDelete: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastId = messages[messages.length - 1]?.id;

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: lastId ? 'smooth' : 'auto' });
  }, [lastId]);

  if (loading) {
    return <div className="grid flex-1 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-ember-400" aria-label="Loading messages" /></div>;
  }

  return (
    <div
      ref={ref}
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4"
      aria-live="polite"
    >
      {messages.length === 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-16 text-center">
          <MessageCircle className="mx-auto h-10 w-10 text-zinc-600" aria-hidden />
          <p className="mt-3 text-sm text-zinc-400">No messages yet. Say hi to the squad!</p>
        </motion.div>
      )}
      <AnimatePresence initial={false}>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || dayIST(prev.createdAt) !== dayIST(m.createdAt);
          const grouped = !newDay && prev && !prev.system && !m.system && prev.userId === m.userId
            && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          return (
            <motion.div key={m.id} layout="position"
              initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 500, damping: 34 }}>
              {newDay && (
                <p className="my-3 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  {isTodayIST(m.createdAt) ? 'Today' : dayIST(m.createdAt)}
                </p>
              )}
              {m.system ? <SystemNote m={m} /> : <Bubble m={m} grouped={Boolean(grouped)} canDelete={canDelete} onDelete={onDelete} />}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function SystemNote({ m }: { m: ChatMessage }) {
  return (
    <p className="mx-auto my-2 w-fit max-w-[90%] rounded-full bg-white/[0.05] px-3 py-1 text-center text-[11px] text-zinc-400 ring-1 ring-white/[0.06]">
      {m.text} · {timeIST(m.createdAt)}
    </p>
  );
}

function Bubble({ m, grouped, canDelete, onDelete }: { m: ChatMessage; grouped: boolean; canDelete: boolean; onDelete: (id: string) => void }) {
  return (
    <div className={cx('group flex items-end gap-2', m.mine && 'flex-row-reverse', grouped ? 'mt-0.5' : 'mt-3')}>
      <div className="w-8 shrink-0">{!m.mine && !grouped && <Avatar name={m.ign} src={m.avatar} size={32} />}</div>
      <div className={cx('flex max-w-[78%] flex-col', m.mine ? 'items-end' : 'items-start')}>
        {!m.mine && !grouped && (
          <p className="mb-0.5 flex items-center gap-1 px-1 text-[11px] font-semibold text-zinc-400">
            {m.ign}
            {m.isAdmin && <span className="chip bg-ember-500/15 px-1.5 py-0 text-[9px] text-ember-300 ring-1 ring-ember-400/30">Admin</span>}
            {!m.isAdmin && m.role === 'captain' && <Crown className="h-3 w-3 text-amber-400" aria-label="Captain" />}
          </p>
        )}
        <div className={cx('flex items-center gap-1', m.mine && 'flex-row-reverse')}>
          <div className={cx(
            'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-snug',
            m.mine ? 'rounded-br-md bg-gradient-to-b from-ember-400 to-ember-500 text-ink-950' : 'rounded-bl-md bg-white/[0.07] text-zinc-100',
          )}>
            {m.text}
            <span className={cx('ml-2 inline-block translate-y-0.5 text-[10px]', m.mine ? 'text-ink-950/60' : 'text-zinc-500')}>{timeIST(m.createdAt)}</span>
          </div>
          {canDelete && (
            <button type="button" onClick={() => onDelete(m.id)} aria-label="Delete message"
              className="rounded-md p-1 text-zinc-600 opacity-0 transition-opacity hover:text-red-300 focus:opacity-100 group-hover:opacity-100">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Composer({ state }: { state: ChatState }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const now = useNow(Boolean(state.mutedUntil));

  const send = useMutation({
    mutationFn: (t: string) => api.sendChat(t),
    onSuccess: ({ message }) => {
      qc.setQueryData<Awaited<ReturnType<typeof api.chat>>>(['chat'], (d) => d && { ...d, messages: [...d.messages.filter((m) => m.id !== message.id), message] });
    },
    onError: (e: Error, t) => { setText(t); toast.error(e.message); void qc.invalidateQueries({ queryKey: ['chat'] }); },
  });

  useEffect(() => {
    if (state.mutedUntil && new Date(state.mutedUntil).getTime() <= now) void qc.invalidateQueries({ queryKey: ['chat'] });
  }, [now, state.mutedUntil, qc]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || send.isPending) return;
    setText('');
    send.mutate(t);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  if (!state.canPost) {
    const muted = Boolean(state.mutedUntil);
    return (
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="flex items-center gap-3 border-t border-white/[0.06] bg-white/[0.02] px-4 py-3.5" style={{ paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))' }}>
        {muted ? <ShieldBan className="h-5 w-5 shrink-0 text-red-300" aria-hidden /> : <Lock className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden />}
        <div className="text-sm">
          {muted ? (
            <>
              <p className="font-semibold text-red-200">The admin muted you</p>
              <p className="text-xs text-zinc-400">You can read messages. Back in {leftText(state.mutedUntil!, now).replace(' left', '')}.</p>
            </>
          ) : (
            <>
              <p className="font-semibold text-zinc-200">Chat is closed right now</p>
              <p className="text-xs text-zinc-400">
                {state.mode === 'hours' ? `It opens at ${hhmmLabel(state.openFrom)}.` : 'The admin will open it again.'}
              </p>
            </>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-white/[0.06] px-3 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={1}
        maxLength={1000}
        placeholder={state.isAdmin && !state.open ? 'Chat is closed, but you can still post…' : 'Message the squad…'}
        aria-label="Message"
        className="input max-h-32 min-h-[44px] flex-1 resize-none py-3"
      />
      <motion.button type="submit" disabled={!text.trim() || send.isPending} aria-label="Send"
        whileTap={{ scale: 0.85 }} whileHover={{ scale: 1.06 }}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-b from-ember-400 to-ember-500 text-ink-950 disabled:opacity-40">
        {send.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
      </motion.button>
    </form>
  );
}

/* ---------------- Admin controls ---------------- */

const DURATIONS = [
  { label: '5 minutes', min: 5 },
  { label: '15 minutes', min: 15 },
  { label: '30 minutes', min: 30 },
  { label: '1 hour', min: 60 },
  { label: '3 hours', min: 180 },
  { label: '12 hours', min: 720 },
  { label: '1 day', min: 1440 },
  { label: '3 days', min: 4320 },
  { label: '7 days', min: 10080 },
];

function AdminControls({ state, mutes, members }: { state: ChatState; mutes: ChatMute[]; members: Member[] }) {
  return (
    <div className="space-y-6 p-4">
      <ScheduleControls state={state} />
      <section>
        <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-white"><ShieldBan className="h-4 w-4 text-ember-400" /> Mute players</h3>
        <p className="mb-3 text-xs text-zinc-400">A muted player can still read the chat but can't send messages until the time runs out or you unmute them.</p>
        <ul className="space-y-2">
          {members.map((m) => <MuteRow key={m.id} member={m} mute={mutes.find((x) => x.userId === m.id)} />)}
          {members.length === 0 && <li className="text-sm text-zinc-500">No teammates yet.</li>}
        </ul>
      </section>
    </div>
  );
}

function ScheduleControls({ state }: { state: ChatState }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<ChatMode>(state.mode);
  const [from, setFrom] = useState(state.openFrom);
  const [to, setTo] = useState(state.openTo);
  const dirty = mode !== state.mode || (mode === 'hours' && (from !== state.openFrom || to !== state.openTo));

  const save = useMutation({
    mutationFn: () => api.chatSettings({ mode, openFrom: from, openTo: to }),
    onSuccess: () => { toast.success('Chat timings saved'); void qc.invalidateQueries({ queryKey: ['chat'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const opts: { v: ChatMode; label: string }[] = [
    { v: 'always', label: 'Always open' },
    { v: 'hours', label: 'Set hours' },
    { v: 'closed', label: 'Closed' },
  ];

  return (
    <section>
      <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-white"><Clock className="h-4 w-4 text-ember-400" /> Chat timings</h3>
      <p className="mb-3 text-xs text-zinc-400">When teammates can send messages. You can always post. Times are India time.</p>
      <div className="relative grid grid-cols-3 rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/[0.06]" role="radiogroup" aria-label="Chat timings">
        {opts.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={mode === o.v} onClick={() => setMode(o.v)}
            className={cx('relative z-10 rounded-lg py-2 text-xs font-semibold transition-colors', mode === o.v ? 'text-ink-950' : 'text-zinc-400 hover:text-zinc-200')}>
            {mode === o.v && <motion.span layoutId="chat-mode" className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-b from-ember-400 to-ember-500" transition={{ type: 'spring', stiffness: 450, damping: 32 }} />}
            {o.label}
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {mode === 'hours' && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block"><span className="label">Opens at</span>
                <input type="time" className="input" value={from} onChange={(e) => setFrom(e.target.value)} required />
              </label>
              <label className="block"><span className="label">Closes at</span>
                <input type="time" className="input" value={to} onChange={(e) => setTo(e.target.value)} required />
              </label>
            </div>
            {from > to && <p className="mt-2 text-xs text-zinc-500">Stays open past midnight until {hhmmLabel(to)} the next day.</p>}
          </motion.div>
        )}
      </AnimatePresence>
      <button type="button" className="btn-primary mt-3 w-full" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
        {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save timings
      </button>
    </section>
  );
}

function MuteRow({ member, mute }: { member: Member; mute?: ChatMute }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [choice, setChoice] = useState('60');
  const [custom, setCustom] = useState({ n: '2', unit: '60' });
  const now = useNow(Boolean(mute));
  const minutes = useMemo(
    () => (choice === 'custom' ? Math.round(Number(custom.n) * Number(custom.unit)) : Number(choice)),
    [choice, custom],
  );
  const done = (msg: string) => () => { toast.success(msg); void qc.invalidateQueries({ queryKey: ['chat'] }); };

  const muteM = useMutation({
    mutationFn: () => api.muteChat(member.id, minutes),
    onSuccess: done(`${member.ign} is muted`),
    onError: (e: Error) => toast.error(e.message),
  });
  const unmuteM = useMutation({
    mutationFn: () => api.unmuteChat(member.id),
    onSuccess: done(`${member.ign} can chat again`),
    onError: (e: Error) => toast.error(e.message),
  });

  const active = mute && new Date(mute.until).getTime() > now;

  return (
    <motion.li layout className={cx('rounded-xl border p-3 transition-colors', active ? 'border-red-400/25 bg-red-500/[0.06]' : 'border-white/[0.06] bg-white/[0.02]')}>
      <div className="flex items-center gap-3">
        <Avatar name={member.ign} src={member.avatar} size={34} dim={Boolean(active)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{member.ign}</p>
          {active
            ? <p className="text-xs text-red-300">Muted · {leftText(mute!.until, now)}</p>
            : <p className="text-xs text-zinc-500">Can chat</p>}
        </div>
        {active && (
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={unmuteM.isPending} onClick={() => unmuteM.mutate()}>
            {unmuteM.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Unmute
          </button>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <select className="input flex-1 py-2 text-xs" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={`Mute ${member.ign} for`}>
          {DURATIONS.map((d) => <option key={d.min} value={d.min}>{d.label}</option>)}
          <option value="custom">Custom…</option>
        </select>
        {choice === 'custom' && (
          <>
            <input type="number" min={1} className="input w-16 py-2 text-xs" value={custom.n} aria-label="Amount"
              onChange={(e) => setCustom((c) => ({ ...c, n: e.target.value }))} />
            <select className="input w-24 py-2 text-xs" value={custom.unit} aria-label="Unit" onChange={(e) => setCustom((c) => ({ ...c, unit: e.target.value }))}>
              <option value="1">minutes</option>
              <option value="60">hours</option>
              <option value="1440">days</option>
            </select>
          </>
        )}
        <button type="button" className="btn-danger px-3 py-2 text-xs"
          disabled={muteM.isPending || !(minutes >= 1 && minutes <= 43200)} onClick={() => muteM.mutate()}>
          {muteM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldBan className="h-3.5 w-3.5" />}
          {active ? 'Change' : 'Mute'}
        </button>
      </div>
    </motion.li>
  );
}
