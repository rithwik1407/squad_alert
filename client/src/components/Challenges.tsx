import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, Medal, Shuffle, Target, X } from 'lucide-react';
import { api } from '@/lib/api';
import { celebrate } from '@/lib/confetti';
import type { BadgeCount, BadgeTier, Challenge, ChallengeRun } from '@/lib/types';
import { Card, Skeleton, cx } from './ui';
import { useToast } from './Toast';

export const TIER: Record<BadgeTier, { label: string; ring: string; text: string; bg: string }> = {
  gold: { label: 'Gold', ring: 'ring-amber-300/50', text: 'text-amber-200', bg: 'from-amber-400/25 to-amber-600/10' },
  silver: { label: 'Silver', ring: 'ring-zinc-300/40', text: 'text-zinc-200', bg: 'from-zinc-300/20 to-zinc-500/10' },
  bronze: { label: 'Bronze', ring: 'ring-orange-400/40', text: 'text-orange-200', bg: 'from-orange-500/20 to-orange-700/10' },
};

/** Round badge medallion: emoji on a tier-coloured disc. */
export function BadgeIcon({ emoji, tier, size = 40, dim }: { emoji: string; tier: BadgeTier; size?: number; dim?: boolean }) {
  const t = TIER[tier];
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-full bg-gradient-to-b ring-2', t.bg, t.ring, dim && 'opacity-40 grayscale')}
      style={{ width: size, height: size, fontSize: size * 0.48 }} aria-hidden>{emoji}</span>
  );
}

export function ModeTag({ mode, className }: { mode: string; className?: string }) {
  return <span className={cx('rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-300', className)}>{mode}</span>;
}

/** One-line challenge label for invite rows. */
export function ChallengeChip({ c, className }: { c: Challenge & { daily?: boolean }; className?: string }) {
  return (
    <span className={cx('inline-flex max-w-full items-center gap-1.5 rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-300/25', className)}>
      <Target className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{c.title}</span>
    </span>
  );
}

/**
 * Pick a challenge while sending a classic invite. Shuffle for other ones.
 * `value` null means no challenge.
 */
export function ChallengePicker({ value, onChange }: { value: string | null; onChange: (key: string | null) => void }) {
  const q = useQuery({ queryKey: ['challenge-options'], queryFn: api.challengeOptions, staleTime: Infinity });
  const opts = q.data?.options ?? [];
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="label mb-0 flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-amber-300" aria-hidden />Challenge for this match</span>
        <button type="button" onClick={() => { onChange(null); void q.refetch(); }} disabled={q.isFetching}
          className="inline-flex items-center gap-1 text-xs font-semibold text-ember-400 hover:text-ember-300 disabled:opacity-50">
          <Shuffle className="h-3.5 w-3.5" aria-hidden />Shuffle
        </button>
      </div>
      <div role="radiogroup" aria-label="Challenge" className="mt-2 space-y-1.5">
        {q.isLoading ? <><Skeleton className="h-14" /><Skeleton className="h-14" /></> : opts.map((c) => {
          const on = value === c.key;
          return (
            <button key={c.key} type="button" role="radio" aria-checked={on} onClick={() => onChange(on ? null : c.key)}
              className={cx('flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-[border-color,background-color] active:scale-[.99]',
                on ? 'border-amber-300/70 bg-amber-400/10' : 'border-white/10 hover:border-white/25')}>
              <BadgeIcon emoji={c.badge.emoji} tier={c.tier} size={34} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-white">{c.title}</span>
                </span>
                <span className="block truncate text-[11px] text-zinc-400">{c.text}</span>
              </span>
              <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border', on ? 'border-amber-300 bg-amber-400 text-ink-950' : 'border-white/20')}>
                {on && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
              </span>
            </button>
          );
        })}
        <button type="button" role="radio" aria-checked={value === null} onClick={() => onChange(null)}
          className={cx('w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors',
            value === null ? 'border-white/30 bg-white/[0.06] text-white' : 'border-dashed border-white/10 text-zinc-400 hover:text-zinc-200')}>
          No challenge, just play
        </button>
      </div>
    </div>
  );
}

/** Challenge checks waiting on me, and recent challenges. */
export function useChallenges() {
  return useQuery({ queryKey: ['challenges'], queryFn: api.challenges, refetchInterval: 30_000 });
}

/**
 * The after-match check: first "Did the match begin?", then "Was the challenge completed?".
 * The first answer from anyone on the squad counts for everyone.
 */
export function ChallengeCheck({ run, highlight }: { run: ChallengeRun; highlight?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const c = run.challenge;
  const m = useMutation({
    mutationFn: (yes: boolean) => api.answerChallenge(run.id, run.ask!, yes),
    onSuccess: ({ run: fresh }) => {
      qc.invalidateQueries({ queryKey: ['challenges'] });
      qc.invalidateQueries({ queryKey: ['badges'] });
      if (fresh.status === 'completed') {
        void celebrate();
        toast.success(`Badge earned: ${c.badge.emoji} ${c.badge.name}`);
      } else if (fresh.status === 'begun') toast.success('Got it. Now, did you finish the challenge?');
      else toast.success('Saved. Everyone on the squad has been told.');
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['challenges'] });
      toast.error(e);
    },
  });
  if (!run.ask) return null;
  const q = run.ask === 'begun'
    ? { title: 'Did the match begin?', yes: 'Yes', no: 'No' }
    : { title: 'Was the challenge completed?', yes: 'Completed', no: 'Not done' };
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
      className={cx('rounded-xl border bg-white/[0.02] p-3', highlight ? 'border-amber-300/60 shadow-[0_0_0_3px_rgba(251,191,36,.12)]' : 'border-white/[0.08]')}>
      <div className="flex items-center gap-3">
        <BadgeIcon emoji={c.badge.emoji} tier={c.tier} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{c.title}</p>
          <p className="truncate text-[11px] text-zinc-400">{run.players.map((p) => p.ign).join(', ')}</p>
        </div>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Step {run.ask === 'begun' ? 1 : 2} of 2</span>
      </div>
      <p className="mt-2 text-xs text-zinc-400">{c.text} <span className="text-zinc-500">Badge: {c.badge.emoji} {c.badge.name}</span></p>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={run.ask} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }}>
          <p className="mt-3 text-sm font-bold text-amber-100">{q.title}{run.ask === 'begun' && run.status === 'waiting' && <span className="block text-[11px] font-normal text-zinc-500">Answer once your match is over.</span>}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={m.isPending} onClick={() => m.mutate(true)}
              className="btn flex-1 border border-emerald-400/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25">
              <Check className="h-4 w-4" aria-hidden />{q.yes}
            </button>
            <button type="button" disabled={m.isPending} onClick={() => m.mutate(false)}
              className="btn flex-1 border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10">
              <X className="h-4 w-4" aria-hidden />{q.no}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Home card for players: the challenges they picked (or joined) on classic invites, until the result is in.
 * After the match: "Did the match begin?" then "Was the challenge completed?". Hidden when there is none.
 */
export function ChallengeHomeCard() {
  const runs = useChallenges();
  const active = runs.data?.pending ?? [];
  if (!active.length) return null;
  return (
    <Card glow className="border-amber-300/40">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">
          <Target className="h-3.5 w-3.5" aria-hidden />{active.length === 1 ? 'Your challenge' : `Your challenges · ${active.length}`}
        </p>
        <Link to="/challenges" className="flex items-center gap-1 text-xs font-semibold text-ember-400 hover:text-ember-300">
          <Medal className="h-3.5 w-3.5" aria-hidden />Badges<ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <div className="mt-3 space-y-2">
        <AnimatePresence initial={false}>
          {active.slice(0, 3).map((r) => <ChallengeCheck key={r.id} run={r} />)}
        </AnimatePresence>
      </div>
    </Card>
  );
}

/** A row of earned badges with counts. */
export function BadgeRow({ badges, size = 36, max }: { badges: BadgeCount[]; size?: number; max?: number }) {
  const shown = max ? badges.slice(0, max) : badges;
  return (
    <ul className="flex flex-wrap gap-2">
      {shown.map((b) => (
        <li key={b.key} title={`${b.name} (${TIER[b.tier].label}) × ${b.count}`} className="relative">
          <BadgeIcon emoji={b.emoji} tier={b.tier} size={size} />
          {b.count > 1 && (
            <span className="absolute -bottom-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-ink-950 px-1 text-[9px] font-bold text-white ring-1 ring-white/20">{b.count}</span>
          )}
        </li>
      ))}
      {max && badges.length > max && <li className="grid place-items-center text-xs text-zinc-500" style={{ height: size }}>+{badges.length - max}</li>}
    </ul>
  );
}
