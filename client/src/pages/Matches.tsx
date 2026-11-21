import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CalendarPlus, Layers, Trophy } from 'lucide-react';
import { api } from '@/lib/api';
import { list } from '@/lib/motion';
import { dayIST } from '@/lib/time';
import type { Match } from '@/lib/types';
import { Card, PageHeader, Skeleton, cx } from '@/components/ui';
import { MatchCard } from '@/components/MatchCard';
import { EmptyState } from '@/components/EmptyState';

const TABS = [
  { k: 'upcoming', label: 'Upcoming' },
  { k: 'past', label: 'History' },
  { k: 'tournaments', label: 'Tournaments' },
] as const;

export default function Matches() {
  const [tab, setTab] = useState<(typeof TABS)[number]['k']>('upcoming');
  const q = useQuery({
    queryKey: ['matches', tab === 'tournaments' ? 'all' : tab],
    queryFn: () => api.matches(tab === 'tournaments' ? 'all' : tab).then((r) => r.matches),
    // Keep the old list on screen while the next tab loads instead of flashing skeletons.
    placeholderData: keepPreviousData,
  });
  const switching = q.isPlaceholderData;
  const data = (q.data ?? []).filter((m) => tab !== 'tournaments' || m.type === 'tournament');
  const groups = data.reduce<Record<string, Match[]>>((acc, m) => {
    (acc[dayIST(m.startAt)] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader eyebrow="Schedule" title="Matches" action={
        <div className="flex gap-2">
          <Link to="/matches/bulk" className="btn-ghost"><Layers className="h-4 w-4" aria-hidden />Add several</Link>
          <Link to="/matches/new" className="btn-primary"><CalendarPlus className="h-4 w-4" aria-hidden />New match</Link>
        </div>} />
      <div role="tablist" aria-label="Matches" className="mb-5 inline-flex rounded-xl bg-white/[0.04] p-1">
        {TABS.map((t) => (
          <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
            className={cx('relative rounded-lg px-4 py-2 text-sm font-semibold', tab === t.k ? 'text-ink-950' : 'text-zinc-400 hover:text-white')}>
            {tab === t.k && <motion.span layoutId="mt" className="absolute inset-0 rounded-lg bg-gradient-to-b from-ember-400 to-ember-500" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'tournaments' && data.length > 0 && <TournamentSummary matches={data} />}

      {q.isLoading ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div> :
        !data.length ? <Card><EmptyState title={tab === 'upcoming' ? 'Nothing scheduled' : 'Nothing here yet'} text="Scheduled matches and their alert status show up here." action={tab === 'upcoming' ? <Link to="/matches/new" className="btn-primary">Schedule a match</Link> : undefined} /></Card> : (
          <div key={switching ? 'stale' : tab} className={cx('space-y-6 transition-opacity duration-200', switching ? 'opacity-50' : 'fade-up')}>
            {Object.entries(groups).map(([day, ms]) => (
              <section key={day}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">{day}</h2>
                <motion.div variants={list} initial="initial" animate="animate" className="grid gap-3 md:grid-cols-2">
                  {ms.map((m) => <MatchCard key={m.id} m={m} />)}
                </motion.div>
              </section>
            ))}
          </div>
        )}
    </div>
  );
}

function TournamentSummary({ matches }: { matches: Match[] }) {
  const played = matches.filter((m) => m.placement);
  const best = played.length ? Math.min(...played.map((m) => m.placement!)) : null;
  const avg = played.length ? (played.reduce((a, m) => a + m.placement!, 0) / played.length).toFixed(1) : null;
  return (
    <Card className="mb-5 flex flex-wrap items-center gap-6">
      <Trophy className="h-8 w-8 text-ember-400" aria-hidden />
      <div><p className="text-xs uppercase tracking-wider text-zinc-500">Rounds</p><p className="font-display text-2xl font-bold text-white">{matches.length}</p></div>
      <div><p className="text-xs uppercase tracking-wider text-zinc-500">Best place</p><p className="font-display text-2xl font-bold text-white">{best ? `#${best}` : '–'}</p></div>
      <div><p className="text-xs uppercase tracking-wider text-zinc-500">Avg place</p><p className="font-display text-2xl font-bold text-white">{avg ?? '–'}</p></div>
    </Card>
  );
}
