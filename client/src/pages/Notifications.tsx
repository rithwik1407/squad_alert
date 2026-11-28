import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import { AlertTriangle, BarChart3, Bell, Gamepad2, KeyRound, Medal, ListChecks, MessageCircle, Smartphone, Sparkles, Trophy, UserCheck, X, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { fullIST, ago, timeIST } from '@/lib/time';
import { list, item } from '@/lib/motion';
import { useInbox } from '@/lib/useInbox';
import type { InboxItem, InboxKind, NotificationLog } from '@/lib/types';
import { Card, PageHeader, Skeleton, StatusChip, cx } from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';
import { useDialog } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { SegmentedSwitch } from './CalendarHub';

const CH = {
  fcm: { label: 'Push', icon: Smartphone },
  telegram: { label: 'Telegram', icon: MessageCircle },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  none: { label: 'No channel', icon: XCircle },
};

export function LogTable({ logs, compact }: { logs: NotificationLog[]; compact?: boolean }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500">
            <th className="p-2 font-medium">Player</th>
            {!compact && <th className="p-2 font-medium">Match</th>}
            <th className="p-2 font-medium">Channel</th>
            <th className="p-2 font-medium">Status</th>
            <th className="p-2 font-medium">When (IST)</th>
          </tr>
        </thead>
        <motion.tbody variants={list} initial="initial" animate="animate">
          {logs.map((l) => {
            const C = CH[l.channel];
            return (
              <motion.tr key={l.id} variants={item} className="border-t border-white/5 align-top">
                <td className="p-2">
                  <p className="font-semibold text-white">{l.user?.ign ?? 'Player'}</p>
                  {l.kind === 'captain_alert' && <p className="text-[10px] uppercase tracking-wider text-amber-300">Captain alert</p>}
                  {l.kind === 'selected' && <p className="text-[10px] uppercase tracking-wider text-sky-300">Squad pick</p>}
                  {l.kind === 'results' && <p className="text-[10px] uppercase tracking-wider text-emerald-300">Match stats</p>}
                  {l.kind === 'room' && <p className="text-[10px] uppercase tracking-wider text-ember-300">Room update</p>}
                </td>
                {!compact && (
                  <td className="p-2">
                    <Link to={`/matches/${l.matchId}`} className="text-zinc-200 hover:text-ember-300">{l.match?.title ?? 'Match'}</Link>
                    {l.match && <p className="text-xs text-zinc-500">{l.match.map} · {timeIST(l.match.startAt)}</p>}
                  </td>
                )}
                <td className="p-2"><span className="inline-flex items-center gap-1.5 text-zinc-300"><C.icon className="h-3.5 w-3.5" aria-hidden />{C.label}{l.alsoVia?.length ? ` + ${l.alsoVia.map((c) => CH[c].label).join(' + ')}` : ''}</span></td>
                <td className="p-2">
                  {l.status === 'sent' ? <StatusChip status="sent">Sent</StatusChip> : <StatusChip status="failed">Failed</StatusChip>}
                </td>
                <td className="whitespace-nowrap p-2 text-zinc-400" title={fullIST(l.sentAt)}>{fullIST(l.sentAt)}</td>
              </motion.tr>
            );
          })}
        </motion.tbody>
      </table>
    </div>
  );
}

export default function Notifications() {
  const { isCaptain } = useAuth();
  const [view, setView] = useState<'inbox' | 'log'>('inbox');
  return (
    <div>
      {isCaptain && (
        <SegmentedSwitch label="Inbox or delivery log" value={view} onChange={setView} layoutId="inbox-view" className="mb-5"
          options={[{ id: 'inbox', label: 'My inbox', icon: Bell }, { id: 'log', label: 'Delivery log', icon: ListChecks }]} />
      )}
      {isCaptain && view === 'log' ? <DeliveryLog /> : <Inbox />}
    </div>
  );
}

/** Captain: today's delivery attempts for the whole team (who, which channel, landed or not). Unchanged. */
function DeliveryLog() {
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.notifications().then((r) => r.logs), refetchInterval: 20_000 });
  const [filter, setFilter] = useState<'all' | 'sent' | 'failed'>('all');
  const logs = useMemo(() => (q.data ?? []).filter((l) => filter === 'all' || l.status === filter), [q.data, filter]);
  const counts = useMemo(() => ({
    sent: (q.data ?? []).filter((l) => l.status === 'sent').length,
    failed: (q.data ?? []).filter((l) => l.status === 'failed').length,
  }), [q.data]);

  return (
    <div>
      <PageHeader eyebrow="Delivery history" title="Delivery log">Today's alerts: who, which channel, when, and whether it landed.</PageHeader>
      <div className="mb-4 flex gap-2" role="tablist" aria-label="Filter">
        {(['all', 'sent', 'failed'] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={cx('relative rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize', filter === f ? 'text-ink-950' : 'text-zinc-400 hover:text-white')}>
            {filter === f && <motion.span layoutId="nf" className="absolute inset-0 -z-0 rounded-full bg-ember-400" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="relative">{f}{f !== 'all' ? ` · ${counts[f]}` : ''}</span>
          </button>
        ))}
      </div>
      {q.isLoading ? <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> :
        !logs.length ? <Card><EmptyState title="Nothing today" text="Today's match alerts show up here." /></Card> :
        <Card key={filter}><LogTable logs={logs} /></Card>}
    </div>
  );
}

const UNDO_MS = 5000;
type Pane = 'alerts' | 'stats';

/**
 * Your inbox: a copy of every alert sent to your phone, kept 30 days.
 * X (or swipe left on a phone) hides it at once and offers Undo; the delete is only sent when Undo runs out.
 */
function Inbox() {
  const { isCaptain } = useAuth();
  const q = useInbox();
  const qc = useQueryClient();
  const dialog = useDialog();
  const toast = useToast();
  const [pane, setPane] = useState<Pane>('alerts');
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Items that were unread when you opened the Inbox keep their dot for this visit; the server marks them read.
  const [fresh, setFresh] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!q.data || fresh) return;
    setFresh(new Set(q.data.items.filter((i) => !i.read).map((i) => i.id)));
    if (q.data.unread > 0) {
      api.readInbox().then(() => qc.setQueryData<typeof q.data>(['inbox'], (d) => d && { ...d, unread: 0, items: d.items.map((i) => ({ ...i, read: true })) })).catch(() => undefined);
    }
  }, [q.data, fresh, qc]);

  const commit = useCallback(async (id: string) => {
    timers.current.delete(id);
    try {
      await api.deleteInboxItem(id);
      qc.setQueryData<{ items: InboxItem[]; unread: number }>(['inbox'], (d) => d && { ...d, items: d.items.filter((i) => i.id !== id) });
    } catch (e) {
      // Already gone is fine; anything else brings it back.
      if ((e as { status?: number }).status !== 404) {
        setHidden((h) => { const n = new Set(h); n.delete(id); return n; });
        toast.error(e);
      }
    }
    setUndo((u) => (u?.id === id ? null : u));
  }, [qc, toast]);

  // Leaving the page sends any deletes still waiting on Undo.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      const sends = [...pending].map(([id, t]) => { clearTimeout(t); return api.deleteInboxItem(id).catch(() => undefined); });
      pending.clear();
      void Promise.all(sends).then(() => qc.invalidateQueries({ queryKey: ['inbox'] }));
    };
  }, [qc]);

  const remove = (i: InboxItem) => {
    setHidden((h) => new Set(h).add(i.id));
    setUndo({ id: i.id, title: i.title });
    timers.current.set(i.id, setTimeout(() => void commit(i.id), UNDO_MS));
  };
  const restore = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setHidden((h) => { const n = new Set(h); n.delete(id); return n; });
    setUndo(null);
  };
  const clearAll = async () => {
    if (!(await dialog.confirm('Clear your inbox?', { text: 'This removes every notification from your inbox. Teammates keep theirs.', confirmLabel: 'Clear all', danger: true }))) return;
    try {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
      await api.clearInbox();
      qc.setQueryData(['inbox'], { items: [], unread: 0 });
      setUndo(null);
      toast.success('Inbox cleared');
    } catch (e) {
      toast.error(e);
    }
  };

  const items = useMemo(() => (q.data?.items ?? []).filter((i) => !hidden.has(i.id)), [q.data, hidden]);
  const alerts = useMemo(() => items.filter((i) => i.kind !== 'results'), [items]);
  const stats = useMemo(() => items.filter((i) => i.kind === 'results'), [items]);

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Inbox" title={isCaptain ? 'My inbox' : 'Your alerts'}
        action={items.length ? <button onClick={clearAll} className="ml-auto rounded-lg px-3 py-2 text-sm font-semibold text-zinc-400 hover:bg-white/5 hover:text-white">Clear all</button> : undefined}>
        Every alert sent to your phone, kept for 30 days. Tap X or swipe left to delete one.
      </PageHeader>

      {!isCaptain && (
        <SegmentedSwitch label="Inbox section" value={pane} onChange={setPane} layoutId="inbox-pane" className="mb-4"
          options={[{ id: 'alerts', label: 'Notifications', icon: Bell, count: alerts.length }, { id: 'stats', label: 'Your stats', icon: BarChart3, count: stats.length }]} />
      )}

      {q.isLoading ? <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : (
        <InboxList items={isCaptain ? items : pane === 'alerts' ? alerts : stats} fresh={fresh} onRemove={remove}
          empty={!isCaptain && pane === 'stats' ? 'Your kills, damage and assists show up here after each match.' : 'Room IDs, match reminders, squad picks, invites and Squad AI messages land here.'} />
      )}

      <AnimatePresence>
        {undo && (
          <motion.div key={undo.id} role="status" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="fixed inset-x-3 bottom-[calc(148px+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-ink-800/95 px-4 py-3 shadow-2xl backdrop-blur lg:bottom-6">
            <p className="min-w-0 flex-1 truncate text-sm text-zinc-200"><span className="font-semibold text-white">Deleted</span> · {undo.title}</p>
            <button onClick={() => restore(undo.id)} className="shrink-0 rounded-lg px-3 py-1.5 font-display text-sm font-bold uppercase tracking-wider text-ember-400 hover:bg-ember-500/10">Undo</button>
            <motion.span aria-hidden className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-ember-400"
              initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: UNDO_MS / 1000, ease: 'linear' }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InboxList({ items, fresh, onRemove, empty }: { items: InboxItem[]; fresh: Set<string> | null; onRemove: (i: InboxItem) => void; empty: string }) {
  if (!items.length) return <Card><EmptyState title="You're all caught up" text={empty} /></Card>;
  return (
    <ul className="space-y-3">
      <AnimatePresence initial={false}>
        {items.map((i) => <InboxRow key={i.id} item={i} unread={Boolean(fresh?.has(i.id))} onRemove={() => onRemove(i)} />)}
      </AnimatePresence>
    </ul>
  );
}

const KIND: Record<InboxKind, { icon: typeof Bell; tone: string; label: string }> = {
  squad: { icon: Bell, tone: 'bg-ember-500/15 text-ember-300', label: 'Match alert' },
  selected: { icon: UserCheck, tone: 'bg-sky-500/15 text-sky-300', label: 'Squad pick' },
  room: { icon: KeyRound, tone: 'bg-ember-500/15 text-ember-300', label: 'Room update' },
  results: { icon: BarChart3, tone: 'bg-emerald-500/15 text-emerald-300', label: 'Match stats' },
  captain_alert: { icon: AlertTriangle, tone: 'bg-amber-500/15 text-amber-300', label: 'Captain alert' },
  invite: { icon: Gamepad2, tone: 'bg-violet-500/15 text-violet-300', label: 'Classic invite' },
  ai_message: { icon: Sparkles, tone: 'bg-fuchsia-500/15 text-fuchsia-300', label: 'Squad AI' },
  challenge: { icon: Medal, tone: 'bg-amber-500/15 text-amber-300', label: 'Challenge' },
};

const SWIPE_DELETE_PX = 96;

function InboxRow({ item: i, unread, onRemove }: { item: InboxItem; unread: boolean; onRemove: () => void }) {
  const nav = useNavigate();
  const dragged = useRef(false);
  const x = useMotionValue(0);
  // The red delete strip only shows while the card is being pulled left.
  const stripOpacity = useTransform(x, [-SWIPE_DELETE_PX, -12, 0], [1, 0.4, 0]);
  const k = KIND[i.kind] ?? KIND.squad;
  const Icon = i.kind === 'results' && i.title.startsWith('🏆') ? Trophy : k.icon;
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_DELETE_PX || info.velocity.x < -600) onRemove();
    setTimeout(() => { dragged.current = false; }, 0);
  };

  return (
    <motion.li layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -80, height: 0, marginTop: 0, transition: { duration: 0.22 } }}
      className="relative overflow-hidden rounded-xl">
      {/* Revealed behind the card while swiping. */}
      <motion.div aria-hidden style={{ opacity: stripOpacity }} className="absolute inset-0 flex items-center justify-end rounded-xl bg-red-500/20 pr-6 text-red-300">
        <X className="h-5 w-5" />
      </motion.div>
      <motion.div drag="x" dragDirectionLock dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: 0.9, right: 0 }}
        onDragStart={() => { dragged.current = true; }} onDragEnd={onDragEnd} style={{ x, touchAction: 'pan-y' }}
        className="glass relative flex items-start gap-3 bg-ink-900 p-4 pr-2 hover:border-ember-400/25">
        <button type="button" onClick={() => { if (!dragged.current) nav(i.url || '/'); }}
          className="group flex min-w-0 flex-1 items-start gap-3 text-left">
          <span className={cx('relative grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105', k.tone)}>
            <Icon className="h-5 w-5" aria-hidden />
            {unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-ember-400 shadow-[0_0_8px_2px_rgb(var(--ember-500)/.6)]" aria-label="New" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-white">{i.title}</span>
            <span className="block whitespace-pre-line break-words text-sm text-zinc-400">{i.body}</span>
            <span className="mt-1 block text-xs text-zinc-500">{k.label} · {ago(i.createdAt)}</span>
          </span>
        </button>
        <button type="button" onClick={onRemove} aria-label="Delete notification"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </motion.div>
    </motion.li>
  );
}
