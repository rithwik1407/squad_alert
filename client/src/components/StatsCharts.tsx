import { useEffect, useRef, type ReactNode } from 'react';
import { animate, motion, useInView, useMotionValue, useTransform } from 'framer-motion';
import { Trophy } from 'lucide-react';
import { cx } from '@/components/ui';
import { spring } from '@/lib/motion';

/**
 * Series colours for players, stepped for the dark surface. A player keeps the same
 * colour wherever they appear, whatever filter is on (assigned by roster order, never by rank).
 */
export const PLAYER_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
export const ORANGE = '#ff8a1f';
export const MUTED = '#71717a';
export const GRID = 'rgba(255,255,255,.06)';

export type MetricKey = 'kills' | 'damage' | 'assists' | 'survivalMin' | 'mvpScore';
export const METRICS: { key: MetricKey; label: string; short: string; unit?: string }[] = [
  { key: 'kills', label: 'Kills', short: 'Kills' },
  { key: 'damage', label: 'Damage', short: 'Dmg' },
  { key: 'assists', label: 'Assists', short: 'Ast' },
  { key: 'survivalMin', label: 'Survival', short: 'Surv', unit: 'min' },
  { key: 'mvpScore', label: 'MVP score', short: 'MVP' },
];
export const metricOf = (k: MetricKey) => METRICS.find((m) => m.key === k)!;
export const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toLocaleString('en-IN', { maximumFractionDigits: 1 }));

/** A number that counts up when it scrolls into view and glides between values after that. */
export function CountUp({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => `${v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`);
  useEffect(() => {
    if (!inView) return;
    const c = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return c.stop;
  }, [inView, value, mv]);
  return <motion.span ref={ref}>{text}</motion.span>;
}

/** Stat tile with a count-up value and a small delta line. */
export function StatTile({ label, icon, value, decimals, suffix, hint, accent }: {
  label: string; icon?: ReactNode; value: number | null; decimals?: number; suffix?: string; hint?: ReactNode; accent?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={spring}
      className={cx(
        'relative overflow-hidden rounded-xl border p-3',
        accent ? 'border-ember-400/30 bg-ember-500/[0.07]' : 'border-white/[0.06] bg-white/[0.03]',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-400">{icon}{label}</div>
      <div className="mt-1 font-display text-2xl font-bold text-white">
        {value == null ? '–' : <CountUp value={value} decimals={decimals} suffix={suffix} />}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>}
    </motion.div>
  );
}

/** Pill tabs with a sliding highlight. */
export function Segmented<T extends string>({ value, options, onChange, id, size = 'md' }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; id: string; size?: 'sm' | 'md';
}) {
  return (
    <div role="tablist" className="inline-flex flex-wrap rounded-xl border border-white/10 bg-white/[0.03] p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'relative rounded-lg font-semibold transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
              on ? 'text-ink-950' : 'text-zinc-300 hover:text-white',
            )}
          >
            {on && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-lg bg-gradient-to-b from-ember-400 to-ember-500"
                transition={spring}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A player legend entry that doubles as a show/hide filter. */
export function PlayerChip({ name, color, on, onClick, onHover }: {
  name: string; color: string; on: boolean; onClick: () => void; onHover?: (h: boolean) => void;
}) {
  return (
    <motion.button
      layout
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      aria-pressed={on}
      className={cx(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
        on ? 'border-white/15 bg-white/[0.07] text-zinc-100' : 'border-white/[0.06] bg-transparent text-zinc-500 line-through',
      )}
    >
      <span className="h-2.5 w-2.5 rounded-full transition-opacity" style={{ background: color, opacity: on ? 1 : 0.3 }} aria-hidden />
      {name}
    </motion.button>
  );
}

type TipRow = { name: string; color: string; value: number; mvp?: boolean; dashed?: boolean };

/** Shared tooltip card for every chart on the page. */
export function TooltipCard({ title, subtitle, rows, unit }: { title: string; subtitle?: string; rows: TipRow[]; unit?: string }) {
  return (
    <div className="min-w-[160px] rounded-xl border border-white/10 bg-ink-800/95 px-3 py-2.5 text-xs shadow-xl">
      <div className="font-semibold text-white">{title}</div>
      {subtitle && <div className="text-[11px] text-zinc-500">{subtitle}</div>}
      <ul className="mt-2 space-y-1">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={r.dashed ? { border: `1.5px dashed ${r.color}` } : { background: r.color }}
              aria-hidden
            />
            <span className="flex-1 text-zinc-300">{r.name}</span>
            {r.mvp && <Trophy className="h-3 w-3 text-ember-400" aria-label="MVP" />}
            <span className="font-mono text-white">{fmtNum(r.value)}{unit ? ` ${unit}` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
