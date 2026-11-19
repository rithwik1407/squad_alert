import { motion, useAnimationControls } from 'framer-motion';
import type { Member } from '@/lib/types';
import { shake } from '@/lib/motion';
import { Avatar, cx } from './ui';

/** Compact pick toggle used on the dashboard quick picker. */
export function PickChip({ p, on, benched, onToggle }: { p: Member; on: boolean; benched: boolean; onToggle: () => boolean }) {
  const controls = useAnimationControls();
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      animate={controls}
      style={{ opacity: benched ? 0.5 : 1 }}
      whileTap={{ scale: 0.94 }}
      onClick={() => { if (!onToggle()) controls.start(shake); }}
      className={cx('flex items-center gap-2 rounded-xl border px-2.5 py-2 text-sm font-semibold transition-colors',
        on ? 'border-ember-400/70 bg-ember-500/15 text-white' : 'border-white/10 bg-white/[0.03] text-zinc-400')}
    >
      <Avatar name={p.ign} size={26} dim={benched} />
      {p.ign.replace(/^RARE丨/, '')}
      {benched && <span className="chip bg-zinc-700/60 px-1.5 py-0 text-[9px] text-zinc-300">Bench</span>}
    </motion.button>
  );
}
