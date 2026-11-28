import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Clock, Medal, Target, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { ago } from '@/lib/time';
import { list, item } from '@/lib/motion';
import type { ChallengeRun } from '@/lib/types';
import { Avatar, Card, PageHeader, Skeleton, cx } from '@/components/ui';
import { BadgeIcon, BadgeRow, ChallengeCheck, TIER, useChallenges } from '@/components/Challenges';

const STATUS: Record<ChallengeRun['status'], { label: string; cls: string; icon: typeof Clock }> = {
  waiting: { label: 'Match on', cls: 'text-sky-300', icon: Clock },
  asking: { label: 'Waiting for an answer', cls: 'text-amber-300', icon: Clock },
  begun: { label: 'Played, waiting for result', cls: 'text-amber-300', icon: Clock },
  completed: { label: 'Completed', cls: 'text-emerald-300', icon: CheckCircle2 },
  failed: { label: 'Not completed', cls: 'text-red-300', icon: XCircle },
  not_played: { label: "Match didn't happen", cls: 'text-zinc-400', icon: XCircle },
  cancelled: { label: 'Cancelled', cls: 'text-zinc-500', icon: XCircle },
  expired: { label: 'No answer', cls: 'text-zinc-500', icon: XCircle },
};

/** Squad challenges: today's challenge, after-match checks, the badge shelf and recent challenges. */
export default function Challenges() {
  const [params] = useSearchParams();
  const focus = params.get('check');
  const runs = useChallenges();
  const badges = useQuery({ queryKey: ['badges'], queryFn: api.badges, staleTime: 30_000 });
  const pending = runs.data?.pending ?? [];

  return (
    <div>
      <PageHeader eyebrow="Squad" title="Challenges">
        Pick a challenge when you send a classic invite. After the match, the squad marks it completed or not, and earns the badge.
      </PageHeader>
      <motion.div variants={list} initial="initial" animate="animate" className="space-y-6">
        {pending.length > 0 && (
          <motion.section variants={item} aria-labelledby="chk-h">
            <h2 id="chk-h" className="mb-3 flex items-center gap-2 text-xl font-bold text-white"><Target className="h-5 w-5 text-amber-300" aria-hidden />How did it go?</h2>
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {pending.map((r) => <ChallengeCheck key={r.id} run={r} highlight={r.id === focus} />)}
              </AnimatePresence>
            </div>
          </motion.section>
        )}

        <section aria-labelledby="shelf-h">
          <h2 id="shelf-h" className="mb-3 flex items-center gap-2 text-xl font-bold text-white"><Medal className="h-5 w-5 text-amber-300" aria-hidden />Squad badges</h2>
          <Card>
            {badges.isLoading ? <Skeleton className="h-20" /> : badges.data?.team.badges.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {badges.data.team.badges.map((b) => (
                  <li key={b.key} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <BadgeIcon emoji={b.emoji} tier={b.tier} size={40} />
                    <div className="min-w-0">
                      <p className={cx('truncate text-sm font-bold', TIER[b.tier].text)}>{b.name}</p>
                      <p className="text-[11px] text-zinc-500">×{b.count}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-zinc-400">No badges yet. Send a classic invite with a challenge and finish it to earn the first one.</p>}
          </Card>
        </section>

        {!!badges.data?.players.length && (
          <section aria-labelledby="pl-h">
            <h2 id="pl-h" className="mb-3 text-xl font-bold text-white">Player badges</h2>
            <Card className="p-0 sm:p-0">
              <ul className="divide-y divide-white/5">
                {badges.data.players.map((p, i) => (
                  <li key={p.user.id} className="flex items-center gap-3 p-3 sm:p-4">
                    <span className="w-5 text-center text-xs font-bold text-zinc-500">{i + 1}</span>
                    <Avatar name={p.user.ign} src={p.user.avatar} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{p.user.ign}</p>
                      {p.badges.length ? <div className="mt-1.5"><BadgeRow badges={p.badges} size={26} max={8} /></div> : <p className="text-[11px] text-zinc-500">No badges yet</p>}
                    </div>
                    <span className="shrink-0 text-lg font-bold text-amber-200">{p.total}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        <section aria-labelledby="hist-h">
          <h2 id="hist-h" className="mb-3 text-xl font-bold text-white">Recent challenges</h2>
          {runs.isLoading ? <Skeleton className="h-32" /> : runs.data?.runs.length ? (
            <Card className="p-0 sm:p-0">
              <ul className="divide-y divide-white/5">
                {runs.data.runs.map((r) => {
                  const s = STATUS[r.status];
                  return (
                    <li key={r.id} className="flex items-center gap-3 p-3 sm:p-4">
                      <BadgeIcon emoji={r.challenge.badge.emoji} tier={r.challenge.tier} size={34} dim={r.status !== 'completed'} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{r.challenge.title}</p>
                        <p className="truncate text-[11px] text-zinc-500">{r.players.map((p) => p.ign).join(', ')}{r.createdAt ? ` · ${ago(r.createdAt)}` : ''}</p>
                      </div>
                      <span className={cx('flex shrink-0 items-center gap-1 text-[11px] font-semibold', s.cls)}><s.icon className="h-3.5 w-3.5" aria-hidden /><span className="sr-only sm:not-sr-only">{s.label}</span></span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : <Card className="text-sm text-zinc-400">No challenges yet. Players pick one when they send a classic invite from Home.</Card>}
        </section>
      </motion.div>
    </div>
  );
}
