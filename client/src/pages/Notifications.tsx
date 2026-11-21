import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { BarChart3, Bell, MessageCircle, Smartphone, Trophy, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { fullIST, ago, timeIST } from '@/lib/time';
import { list, item } from '@/lib/motion';
import type { NotificationLog } from '@/lib/types';
import { Card, PageHeader, Skeleton, StatusChip, cx } from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';

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
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.notifications().then((r) => r.logs), refetchInterval: 20_000 });
  const [filter, setFilter] = useState<'all' | 'sent' | 'failed'>('all');
  const logs = useMemo(() => (q.data ?? []).filter((l) => filter === 'all' || l.status === filter), [q.data, filter]);
  const counts = useMemo(() => ({
    sent: (q.data ?? []).filter((l) => l.status === 'sent').length,
    failed: (q.data ?? []).filter((l) => l.status === 'failed').length,
  }), [q.data]);

  return (
    <div>
      <PageHeader eyebrow={isCaptain ? 'Delivery history' : 'Inbox'} title={isCaptain ? 'Notifications' : 'Your alerts'}>
        {isCaptain ? 'Every attempt: who, which channel, when, and whether it landed.' : 'Alerts SquadSync sent you.'}
      </PageHeader>

      {isCaptain && (
        <div className="mb-4 flex gap-2" role="tablist" aria-label="Filter">
          {(['all', 'sent', 'failed'] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={cx('relative rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize', filter === f ? 'text-ink-950' : 'text-zinc-400 hover:text-white')}>
              {filter === f && <motion.span layoutId="nf" className="absolute inset-0 -z-0 rounded-full bg-ember-400" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span className="relative">{f}{f !== 'all' ? ` · ${counts[f]}` : ''}</span>
            </button>
          ))}
        </div>
      )}

      {q.isLoading ? <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div> :
        !logs.length ? <Card><EmptyState title="All quiet" text="Alerts show up here once a match notification goes out." /></Card> :
        isCaptain ? <Card key={filter}><LogTable logs={logs} /></Card> : <PlayerInbox logs={logs} />}
    </div>
  );
}

type Pane = 'alerts' | 'stats';

/** Player inbox: two tabs, alerts (room/IDP, reminders, squad picks) and per-match stats. Only the selected one shows. */
function PlayerInbox({ logs }: { logs: NotificationLog[] }) {
  const alerts = useMemo(() => logs.filter((l) => l.kind !== 'results'), [logs]);
  const stats = useMemo(() => logs.filter((l) => l.kind === 'results'), [logs]);
  const [pane, setPane] = useState<Pane>('alerts');
  const tabs: { id: Pane; label: string; count: number; icon: typeof Bell }[] = [
    { id: 'alerts', label: 'Notifications', count: alerts.length, icon: Bell },
    { id: 'stats', label: 'Your stats', count: stats.length, icon: BarChart3 },
  ];

  return (
    <div>
      <div className="mb-4 flex gap-2" role="tablist" aria-label="Inbox section">
        {tabs.map((t) => (
          <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={pane === t.id} aria-controls={`inbox-${t.id}`} onClick={() => setPane(t.id)}
            className={cx('relative inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold', pane === t.id ? 'text-ink-950' : 'text-zinc-400 hover:text-white')}>
            {pane === t.id && <motion.span layoutId="inbox-pane" className="absolute inset-0 -z-0 rounded-full bg-ember-400" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <t.icon className="relative h-4 w-4" aria-hidden />
            <span className="relative">{t.label} · {t.count}</span>
          </button>
        ))}
      </div>

      {pane === 'alerts' ? (
        <InboxList key="alerts" id="alerts" count={alerts.length} empty="Room/IDP updates, match reminders and squad picks land here.">
          {alerts.map((l) => <InboxItem key={l.id} log={l} />)}
        </InboxList>
      ) : (
        <InboxList key="stats" id="stats" count={stats.length} empty="Your kills, damage and assists show up here after each match.">
          {stats.map((l) => <InboxItem key={l.id} log={l} stat />)}
        </InboxList>
      )}
    </div>
  );
}

function InboxList({ id, count, empty, children }: { id: Pane; count: number; empty: string; children: ReactNode }) {
  return (
    <section id={`inbox-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} className="max-w-3xl">
      {count ? (
        <motion.ul variants={list} initial="initial" animate="animate" className="space-y-3">{children}</motion.ul>
      ) : (
        <Card><EmptyState title="Nothing yet" text={empty} /></Card>
      )}
    </section>
  );
}

function InboxItem({ log: l, stat }: { log: NotificationLog; stat?: boolean }) {
  const mvp = stat && l.title.startsWith('🏆');
  const Icon = stat ? (mvp ? Trophy : BarChart3) : Bell;
  return (
    <motion.li variants={item}>
      <Link to={`/matches/${l.matchId}`} className="glass group flex gap-3 p-4 hover:border-ember-400/25 hover:bg-white/[0.05]">
        <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105',
          stat ? 'bg-emerald-500/15 text-emerald-300' : 'bg-ember-500/15 text-ember-300')}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{l.title}</p>
          <p className="break-words text-sm text-zinc-400">{l.body}</p>
          <p className="mt-1 text-xs text-zinc-500">{CH[l.channel].label} · {ago(l.sentAt)}</p>
        </div>
      </Link>
    </motion.li>
  );
}
