import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Bell, MessageCircle, Smartphone, XCircle } from 'lucide-react';
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
                </td>
                {!compact && (
                  <td className="p-2">
                    <Link to={`/matches/${l.matchId}`} className="text-zinc-200 hover:text-ember-300">{l.match?.title ?? 'Match'}</Link>
                    {l.match && <p className="text-xs text-zinc-500">{l.match.map} · {timeIST(l.match.startAt)}</p>}
                  </td>
                )}
                <td className="p-2"><span className="inline-flex items-center gap-1.5 text-zinc-300"><C.icon className="h-3.5 w-3.5" aria-hidden />{C.label}</span></td>
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
              {filter === f && <motion.span layoutId="nf" className="absolute inset-0 -z-0 rounded-full bg-ember-400" />}
              <span className="relative">{f}{f !== 'all' ? ` · ${counts[f]}` : ''}</span>
            </button>
          ))}
        </div>
      )}

      {q.isLoading ? <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div> :
        !logs.length ? <Card><EmptyState title="All quiet" text="Alerts show up here once a match notification goes out." /></Card> :
        isCaptain ? <Card><LogTable logs={logs} /></Card> : (
          <motion.ul variants={list} initial="initial" animate="animate" className="space-y-3">
            {logs.map((l) => (
              <motion.li key={l.id} variants={item}>
                <Link to={`/matches/${l.matchId}`} className="glass flex gap-3 p-4 hover:bg-white/[0.05]">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ember-500/15 text-ember-300"><Bell className="h-5 w-5" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white">{l.title}</p>
                    <p className="text-sm text-zinc-400">{l.body}</p>
                    <p className="mt-1 text-xs text-zinc-500">{CH[l.channel].label} · {ago(l.sentAt)}</p>
                  </div>
                </Link>
              </motion.li>
            ))}
          </motion.ul>
        )}
    </div>
  );
}
