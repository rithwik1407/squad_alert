import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { Check, Crown, Info, RotateCcw, X } from 'lucide-react';
import type { Availability, Member } from '@/lib/types';
import type { PlayerLine } from '@/lib/usePlayerStats';
import { shake, spring } from '@/lib/motion';
import { AVAIL_STYLE } from './CheckinBoard';
import { Avatar, cx } from './ui';

const fmt = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '0');

/**
 * Esports roster card: avatar, IGN, check-in and career numbers on the front; a full stat sheet on the back.
 * Tapping the card picks / drops the player. The info button flips it (instant when reduced motion is on).
 */
export function RosterCard({ p, line, on, slot, benched, locked, avail, note, order, onToggle }: {
  p: Member; line: PlayerLine; on: boolean; slot: number | null; benched: boolean; locked: boolean;
  avail?: Availability; note?: string; order: number; onToggle: () => boolean;
}) {
  const [flipped, setFlipped] = useState(false);
  const controls = useAnimationControls();

  const pick = () => {
    if (locked) return;
    if (!onToggle()) controls.start(shake);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: benched ? 0.6 : 1, y: 0 }}
      transition={{ ...spring, delay: Math.min(order, 8) * 0.05 }}
      className="relative [perspective:1200px]"
    >
      <motion.div animate={controls} className="relative">
        <motion.div
          className="relative grid [transform-style:preserve-3d]"
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        >
          {/* FRONT */}
          <div className={cx('col-start-1 row-start-1 [backface-visibility:hidden]', flipped && 'pointer-events-none')}>
            <motion.button
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-disabled={locked}
              aria-label={`${p.ign}${on ? `, in squad slot ${slot}` : benched ? ', on the bench' : ''}`}
              onClick={pick}
              whileHover={locked ? undefined : { y: -3 }}
              whileTap={locked ? undefined : { scale: 0.97 }}
              transition={spring}
              className={cx(
                'glass no-ticks group relative flex w-full items-stretch gap-3 overflow-hidden p-2.5 pr-12 text-left transition-[border-color,box-shadow,filter] duration-300',
                on ? 'border-ember-400/80 shadow-glow' : 'hover:border-white/20',
                benched && 'grayscale',
                locked ? 'cursor-not-allowed' : 'cursor-pointer',
              )}
            >
              {/* Dashed inner outline, like a roster slot */}
              <span aria-hidden className={cx('pointer-events-none absolute inset-1 rounded-md border border-dashed transition-colors', on ? 'border-ember-400/50' : 'border-white/10')} />
              <AnimatePresence>
                {on && (
                  <motion.span key="sweep" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ember-500/25 via-ember-500/5 to-transparent" />
                )}
              </AnimatePresence>

              <div className="relative shrink-0">
                <div className="overflow-hidden rounded-md bg-gradient-to-b from-ink-600 to-ink-800 ring-1 ring-white/10">
                  <Avatar name={p.ign} src={p.avatar} size={76} dim={benched} />
                </div>
                {p.role === 'captain' && (
                  <span className="cut-sm absolute -bottom-1 left-1/2 inline-flex -translate-x-1/2 items-center gap-0.5 bg-amber-400 px-1.5 py-0.5 font-display text-[10px] font-bold uppercase text-ink-950">
                    <Crown className="h-2.5 w-2.5" aria-hidden />IGL
                  </span>
                )}
              </div>

              <div className="relative flex min-w-0 flex-1 flex-col justify-between py-0.5">
                <div className="min-w-0">
                  <p className="truncate font-display text-xl font-bold uppercase leading-tight text-white">{p.ign}</p>
                  <p className="truncate font-mono text-[10px] text-zinc-500">UID {p.bgmiId || '-'}</p>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className={cx('chip !px-1.5 !py-0.5 ring-1', avail ? AVAIL_STYLE[avail].cls : 'bg-white/5 text-zinc-500 ring-white/10')} title={note || undefined}>
                    {avail ? AVAIL_STYLE[avail].label : 'No check-in'}
                  </span>
                  {line.mvps > 0 && <span className="chip !px-1.5 !py-0.5 bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30">{line.mvps} MVP</span>}
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-1 border-t border-white/[0.06] pt-1.5">
                  <Mini label="M" value={line.matches} />
                  <Mini label="Kills" value={line.kills} />
                  <Mini label="K/M" value={fmt(line.kpm, 1)} />
                </dl>
              </div>

              {/* Slot marker / selected tick */}
              <AnimatePresence>
                {on && (
                  <motion.span key="tick" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={spring}
                    className="cut-sm absolute bottom-2 right-2 grid h-7 min-w-7 place-items-center bg-ember-400 px-1 font-display text-xs font-bold text-ink-950">
                    {slot ? `P${slot}` : <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}
                  </motion.span>
                )}
                {benched && (
                  <motion.span key="bench" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="chip absolute bottom-2 right-2 bg-zinc-700 text-zinc-200">Bench</motion.span>
                )}
              </AnimatePresence>
            </motion.button>
            <FlipButton label={`Show ${p.ign}'s stats`} onClick={() => setFlipped(true)}><Info className="h-4 w-4" aria-hidden /></FlipButton>
          </div>

          {/* BACK: stat sheet */}
          <div className={cx('absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]', !flipped && 'pointer-events-none')} aria-hidden={!flipped}>
            <div className="glass relative flex h-full flex-col overflow-hidden border-ember-400/40 p-3 pr-12">
              <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-ember-500/15 blur-2xl" />
              <p className="relative truncate font-display text-lg font-bold uppercase leading-tight text-white"><span className="mr-2 font-display text-[10px] tracking-[0.2em] text-ember-400">STATS</span>{p.ign}</p>
              <dl className="relative mt-1 grid flex-1 grid-cols-3 content-center gap-x-2 gap-y-1">
                <Big label="Matches" value={line.matches} />
                <Big label="Kills" value={line.kills} />
                <Big label="K / M" value={fmt(line.kpm, 2)} />
                <Big label="Avg dmg" value={fmt(line.adr)} />
                <Big label="Best" value={`${line.bestKills}K`} />
                <Big label="MVPs" value={line.mvps} gold={line.mvps > 0} />
              </dl>
            </div>
            <FlipButton label="Back to card" onClick={() => setFlipped(false)}><RotateCcw className="h-4 w-4" aria-hidden /></FlipButton>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

function FlipButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className="absolute right-1.5 top-1.5 z-10 grid h-11 w-11 place-items-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white">
      <span className="grid h-7 w-7 place-items-center rounded-md border border-white/10 bg-ink-800/80">{children}</span>
    </button>
  );
}

function Mini({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-display text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</dt>
      <dd className="font-mono text-sm font-bold tabular-nums text-zinc-100">{value}</dd>
    </div>
  );
}

function Big({ label, value, gold }: { label: string; value: ReactNode; gold?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-display text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</dt>
      <dd className={cx('font-mono text-base font-bold tabular-nums', gold ? 'text-amber-300' : 'text-white')}>{value}</dd>
    </div>
  );
}

/** One of the 4 squad slots. Empty: dashed outline. Filled: the player slides in; tap to drop them. */
export function SquadSlot({ n, p, locked, onRemove }: { n: number; p: Member | null; locked: boolean; onRemove: () => void }) {
  return (
    <div className="relative h-[92px] rounded-lg border border-dashed border-white/15 bg-white/[0.015]">
      <AnimatePresence mode="popLayout" initial={false}>
        {p ? (
          <motion.button key={p.id} type="button" disabled={locked} onClick={onRemove} aria-label={`Slot ${n}: ${p.ign}. Tap to drop`}
            initial={{ opacity: 0, x: -24, scale: 0.94 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={spring}
            className="glass group absolute inset-0 flex items-center gap-2.5 overflow-hidden border-ember-400/60 p-2 text-left disabled:cursor-default">
            <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-ember-500/20 to-transparent" />
            <div className="relative overflow-hidden rounded-md ring-1 ring-ember-400/40"><Avatar name={p.ign} src={p.avatar} size={60} /></div>
            <div className="relative min-w-0 flex-1">
              <p className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-ember-400">Player {n}</p>
              <p className="truncate font-display text-lg font-bold uppercase leading-tight text-white">{p.ign}</p>
            </div>
            {!locked && <X className="relative mr-1 h-4 w-4 shrink-0 text-zinc-500 group-hover:text-white" aria-hidden />}
          </motion.button>
        ) : (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center gap-3 p-2 text-zinc-600">
            <span className="grid h-[60px] w-[60px] place-items-center rounded-md border border-dashed border-white/10 font-display text-2xl font-bold">+</span>
            <span>
              <span className="block font-display text-[10px] font-bold uppercase tracking-[0.2em]">Player {n}</span>
              <span className="block font-display text-sm font-bold uppercase text-zinc-500">Open slot</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
