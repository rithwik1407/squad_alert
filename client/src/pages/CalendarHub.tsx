import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookUser, CalendarDays } from 'lucide-react';
import { cx } from '@/components/ui';

import CalendarPage from './Calendar';
import Scrims from './Scrims';

type View = 'calendar' | 'scrims';

/** One tab for match history and scrim organizers, switched with a segmented control. The choice lives in the URL (?view=scrims). */
export default function CalendarHub() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'scrims' ? 'scrims' : 'calendar';
  // Push (not replace), so the back button returns to the other side.
  const pick = (v: View) => { if (v !== view) setParams(v === 'scrims' ? { view: 'scrims' } : {}); };

  return (
    <div>
      <SegmentedSwitch
        label="Calendar or scrims"
        value={view}
        onChange={pick}
        options={[
          { id: 'calendar', label: 'Calendar', icon: CalendarDays },
          { id: 'scrims', label: 'Scrims', icon: BookUser },
        ]}
        className="mb-5"
      />
      {view === 'scrims' ? <Scrims /> : <CalendarPage />}
    </div>
  );
}

/** Game-menu style two/three way switch with a sliding ember pill. */
export function SegmentedSwitch<T extends string>({ label, value, onChange, options, className, layoutId = 'seg-pill' }: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; icon?: typeof CalendarDays; count?: number }[];
  className?: string;
  layoutId?: string;
}) {
  return (
    <div role="tablist" aria-label={label}
      className={cx('inline-flex w-full max-w-sm rounded-xl border border-white/[0.07] bg-ink-900/80 p-1 sm:w-auto', className)}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} role="tab" aria-selected={on} onClick={() => onChange(o.id)}
            className={cx('relative flex min-h-[40px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 font-display text-[13px] font-bold uppercase tracking-wider transition-colors sm:flex-none',
              on ? 'text-ink-950' : 'text-zinc-400 hover:text-white')}>
            {on && <motion.span layoutId={layoutId} className="absolute inset-0 rounded-lg bg-ember-400 shadow-glow" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            {o.icon && <o.icon className="relative h-4 w-4" aria-hidden />}
            <span className="relative">{o.label}{o.count !== undefined ? ` · ${o.count}` : ''}</span>
          </button>
        );
      })}
    </div>
  );
}
