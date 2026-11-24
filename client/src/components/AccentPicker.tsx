import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Palette } from 'lucide-react';
import { ACCENTS, getAccent, setAccent, type AccentId } from '@/lib/accent';
import { Card, cx } from './ui';

/** Pick the app's accent colour. Saved on this device. */
export function AccentPicker() {
  const [cur, setCur] = useState<AccentId>(getAccent());
  return (
    <Card className="lg:col-span-2">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ember-500/15 text-ember-300"><Palette className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-white">Accent colour</h2>
          <p className="text-sm text-zinc-400">Pick your app colour. It's saved on this phone or laptop.</p>
          <div className="mt-4 flex flex-wrap gap-3" role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map((a) => {
              const on = cur === a.id;
              return (
                <button key={a.id} type="button" role="radio" aria-checked={on} onClick={() => { setAccent(a.id); setCur(a.id); }}
                  className={cx('flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-sm font-semibold', on ? 'border-white/30 bg-white/10 text-white' : 'border-white/10 text-zinc-400 hover:text-white')}>
                  <motion.span className="relative grid h-7 w-7 place-items-center rounded-full"
                    style={{ background: `rgb(${a.rgb})`, boxShadow: on ? `0 0 18px rgb(${a.rgb} / .7)` : 'none' }}
                    animate={{ scale: on ? 1.08 : 1 }} transition={{ type: 'spring', stiffness: 500, damping: 28 }}>
                    {on && <Check className="h-4 w-4 text-ink-950" strokeWidth={3} aria-hidden />}
                  </motion.span>
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
