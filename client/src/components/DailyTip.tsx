import { motion } from 'framer-motion';
import { Lightbulb, Flame } from 'lucide-react';
import { tipOfTheDay } from '@/lib/tips';

/** One short IGL tip or motivation line, new every day. */
export function DailyTip() {
  const t = tipOfTheDay();
  const Icon = t.kind === 'IGL tip' ? Lightbulb : Flame;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-start gap-3 rounded-2xl border border-ember-400/20 bg-gradient-to-r from-ember-500/10 via-ember-500/[0.04] to-transparent p-3.5 sm:p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ember-500/15 text-ember-300"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ember-400">{t.kind} of the day</p>
        <p className="mt-0.5 text-sm text-zinc-100">{t.text}</p>
      </div>
    </motion.div>
  );
}
