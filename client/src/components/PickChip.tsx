import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { Check } from 'lucide-react';
import type { Member } from '@/lib/types';
import { shake, spring } from '@/lib/motion';
import { Avatar, cx } from './ui';

/** Mini roster tile used on the dashboard quick picker: portrait, IGN, and the slot number once picked. */
export function PickChip({ p, on, benched, onToggle, slot }: { p: Member; on: boolean; benched: boolean; onToggle: () => boolean; slot?: number }) {
  const controls = useAnimationControls();
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      aria-label={`${p.ign}${on ? ', picked' : benched ? ', bench' : ''}`}
      animate={controls}
      style={{ opacity: benched ? 0.5 : 1 }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.94 }}
      transition={spring}
      onClick={() => { if (!onToggle()) controls.start(shake); }}
      className={cx('relative flex w-[92px] flex-col items-center gap-1.5 overflow-hidden rounded-lg border p-2 pb-2.5 text-center transition-[border-color,background-color,box-shadow,filter] duration-200',
        on ? 'border-ember-400/80 bg-ember-500/10 shadow-glow' : 'border-dashed border-white/15 bg-white/[0.02] hover:border-white/30',
        benched && 'grayscale')}
    >
      {on && <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ember-500/25 to-transparent" />}
      <span className="relative overflow-hidden rounded-md ring-1 ring-white/10"><Avatar name={p.ign} src={p.avatar} size={52} dim={benched} /></span>
      <span className={cx('relative w-full truncate font-display text-sm font-bold uppercase', on ? 'text-white' : 'text-zinc-300')}>{p.ign.replace(/^RARE丨/, '')}</span>
      <AnimatePresence>
        {on && (
          <motion.span key="tick" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={spring}
            className="cut-sm absolute right-1 top-1 grid h-5 min-w-5 place-items-center bg-ember-400 px-0.5 font-display text-[10px] font-bold text-ink-950">
            {slot ? `P${slot}` : <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
          </motion.span>
        )}
      </AnimatePresence>
      {benched && <span className="chip absolute right-1 top-1 bg-zinc-700/80 !px-1 !py-0 text-[9px] text-zinc-300">Bench</span>}
    </motion.button>
  );
}
