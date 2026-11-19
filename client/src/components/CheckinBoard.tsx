import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CalendarCheck, Check, HelpCircle, X } from 'lucide-react';
import { api } from '@/lib/api';
import { relativeDay, timeIST } from '@/lib/time';
import { list, item } from '@/lib/motion';
import { mapLabel, type Availability } from '@/lib/types';
import { Card, Skeleton, cx } from './ui';
import { useToast } from './Toast';

const OPTS: { v: Availability; label: string; icon: typeof Check; on: string }[] = [
  { v: 'available', label: "I'm in", icon: Check, on: 'bg-emerald-400/20 text-emerald-200 ring-emerald-400/50' },
  { v: 'maybe', label: 'Maybe', icon: HelpCircle, on: 'bg-amber-400/20 text-amber-200 ring-amber-400/50' },
  { v: 'unavailable', label: 'Out', icon: X, on: 'bg-red-500/20 text-red-200 ring-red-400/50' },
];

/** Players tell the captain whether they can play each upcoming match, before the squad is picked. */
export function CheckinBoard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['checkin'], queryFn: () => api.checkin().then((r) => r.matches) });

  async function set(id: string, v: Availability) {
    qc.setQueryData(['checkin'], (old: Awaited<ReturnType<typeof api.checkin>>['matches'] | undefined) =>
      old?.map((m) => (m.id === id ? { ...m, myAvailability: v } : m)));
    try {
      await api.setAvailability(id, v);
    } catch (e) {
      toast.error(e);
      qc.invalidateQueries({ queryKey: ['checkin'] });
    }
  }

  return (
    <section aria-labelledby="checkin-h">
      <h2 id="checkin-h" className="mb-1 flex items-center gap-2 text-xl font-bold text-white"><CalendarCheck className="h-5 w-5 text-ember-400" aria-hidden />Check in</h2>
      <p className="mb-3 text-sm text-zinc-400">Let your captain know if you can play. It shows on the squad picker.</p>
      {q.isLoading ? <Skeleton className="h-28" /> : !q.data?.length ? (
        <Card className="text-sm text-zinc-400">No upcoming team matches to check in for.</Card>
      ) : (
        <motion.ul variants={list} initial="initial" animate="animate" className="space-y-2">
          {q.data.map((m) => (
            <motion.li key={m.id} variants={item} className="glass flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-[11rem] flex-1">
                <p className="truncate font-semibold text-white">{m.title} <span className="font-normal text-zinc-400">· {mapLabel(m.map)}</span></p>
                <p className="text-xs text-zinc-400">{relativeDay(m.startAt)} · {timeIST(m.startAt)}
                  {m.squadPicked && <span className={m.selected ? ' text-emerald-300' : ' text-zinc-500'}>{m.selected ? ' · You’re in the squad' : ' · Squad picked'}</span>}
                </p>
              </div>
              <div role="radiogroup" aria-label={`Availability for ${m.title}`} className="flex gap-1">
                {OPTS.map((o) => {
                  const on = m.myAvailability === o.v;
                  return (
                    <motion.button key={o.v} type="button" role="radio" aria-checked={on} whileTap={{ scale: 0.92 }} onClick={() => set(m.id, o.v)}
                      className={cx('flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition-colors',
                        on ? o.on : 'bg-white/[0.03] text-zinc-400 ring-white/10 hover:text-white')}>
                      <o.icon className="h-3.5 w-3.5" aria-hidden />{o.label}
                    </motion.button>
                  );
                })}
              </div>
            </motion.li>
          ))}
        </motion.ul>
      )}
    </section>
  );
}

export const AVAIL_STYLE: Record<Availability, { label: string; cls: string }> = {
  available: { label: 'Available', cls: 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30' },
  maybe: { label: 'Maybe', cls: 'bg-amber-400/15 text-amber-300 ring-amber-400/30' },
  unavailable: { label: 'Out', cls: 'bg-red-500/15 text-red-300 ring-red-400/30' },
};
