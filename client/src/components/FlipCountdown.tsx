import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { splitDuration } from '@/lib/time';
import { cx } from './ui';

function Digit({ value }: { value: string }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative inline-flex h-[1.2em] w-[0.78em] overflow-hidden rounded-lg bg-gradient-to-b from-ink-700 to-ink-850 ring-1 ring-white/10 [perspective:400px]">
      <span className="absolute inset-x-0 top-1/2 z-10 h-px bg-black/60" aria-hidden />
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={reduce ? { opacity: 0 } : { rotateX: -90, y: '-30%', opacity: 0 }}
          animate={{ rotateX: 0, y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { rotateX: 90, y: '30%', opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0 grid place-items-center [backface-visibility:hidden]"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function Group({ n, label }: { n: number; label: string }) {
  const s = String(n).padStart(2, '0');
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex gap-1">{s.split('').map((c, i) => <Digit key={i} value={c} />)}</div>
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">{label}</span>
    </div>
  );
}

/** Live flip-digit countdown. Glows and pulses under 5 minutes. */
export function FlipCountdown({ target, className, onZero }: { target: string; className?: string; onZero?: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(target).getTime() - now;
  useEffect(() => {
    if (ms <= 0) onZero?.();
  }, [ms <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const { d, h, m, s } = splitDuration(ms);
  const urgent = ms > 0 && ms < 5 * 60_000;
  return (
    <div
      className={cx(
        'relative inline-flex items-start gap-2 rounded-2xl p-2 font-mono text-4xl font-bold text-white sm:gap-3 sm:text-6xl',
        urgent && 'text-ember-300',
        className,
      )}
      role="timer"
      aria-label={ms > 0 ? `${d} days ${h} hours ${m} minutes ${s} seconds` : 'Started'}
    >
      {urgent && (
        <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-2xl animate-pulse-glow"
          style={{ boxShadow: '0 0 0 2px rgba(255,138,31,.35), 0 0 60px -6px rgba(255,138,31,.85)' }} />
      )}
      {d > 0 && <><Group n={d} label="days" /><Sep /></>}
      <Group n={h} label="hrs" /><Sep />
      <Group n={m} label="min" /><Sep />
      <Group n={s} label="sec" />
    </div>
  );
}

const Sep = () => <span className="mt-[0.1em] text-zinc-600" aria-hidden>:</span>;
