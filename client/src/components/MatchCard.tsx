import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BellRing, ChevronRight, MapPin } from 'lucide-react';
import type { Match } from '@/lib/types';
import { relativeDay, timeIST } from '@/lib/time';
import { item, spring } from '@/lib/motion';
import { MapArt } from './MapArt';
import { LockBadge, StatusChip } from './ui';

export function NotifyChips({ m }: { m: Match }) {
  if (m.status === 'cancelled') return <StatusChip status="cancelled" />;
  if (m.notifications) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {m.notifications.sent > 0 && <StatusChip status="sent">{m.notifications.sent} sent</StatusChip>}
        {m.notifications.failed > 0 && <StatusChip status="failed">{m.notifications.failed} failed</StatusChip>}
        {m.notifications.pending > 0 && <StatusChip status="pending">{m.notifications.pending} pending</StatusChip>}
      </span>
    );
  }
  if (m.captainAlertedAt && !m.squad?.confirmed) return <StatusChip status="failed">Squad missing</StatusChip>;
  if (!m.squad?.confirmed) return <StatusChip status="pending">Squad not set</StatusChip>;
  return <StatusChip status="scheduled">Ping at {timeIST(m.notifyAt)}</StatusChip>;
}

export function MatchCard({ m, to }: { m: Match; to?: string }) {
  return (
    <motion.div variants={item} whileHover={{ y: -3 }} whileTap={{ scale: 0.985 }} transition={spring}>
      <Link to={to ?? `/matches/${m.id}`} className="glass gborder group flex overflow-hidden focus-visible:ring-2">
        <div className="relative w-24 shrink-0 sm:w-32">
          <MapArt map={m.map} />
          <span className="absolute bottom-2 left-2 font-display text-xs font-bold uppercase tracking-wider text-white/90">{m.map === 'TBD' ? 'Map TBD' : m.map}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-bold leading-tight text-white">{m.title}</p>
              <p className="text-xs text-zinc-400">
                {relativeDay(m.startAt)} · <span className="font-semibold text-zinc-200">{timeIST(m.startAt)}</span>
                <span className="capitalize"> · {m.type}</span>
              </p>
            </div>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-ember-400" aria-hidden />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {m.status !== 'scheduled' && m.status !== 'notified' && <StatusChip status={m.status} />}
            {m.locked && <LockBadge />}
            <NotifyChips m={m} />
            {m.drop && (
              <span className="chip bg-white/5 text-zinc-300 ring-1 ring-white/10"><MapPin className="h-3 w-3" aria-hidden />{m.drop}</span>
            )}
            {m.status === 'scheduled' && m.squad?.confirmed && (
              <span className="sr-only"><BellRing /> notification scheduled</span>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
