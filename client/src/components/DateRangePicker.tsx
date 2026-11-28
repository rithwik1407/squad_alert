import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { cx } from '@/components/ui';
import { daysAgoKeyIST, shortDayFromKey } from '@/lib/time';

/**
 * One date filter for the stats page: a button that shows the chosen dates, and a sheet with a month
 * calendar to pick them. Tap a first day, then a last day. Days with matches carry a dot, and the sheet
 * shows how many matches the dates hold before you apply them. Works on day keys ("YYYY-MM-DD", IST).
 */
export function DateRangePicker({ from, to, onChange, matchDays, countIn }: {
  from: string; to: string;
  onChange: (from: string, to: string) => void;
  /** Day keys that have at least one match. */
  matchDays: Set<string>;
  /** How many matches fall in a range (empty ends are open). */
  countIn: (from: string, to: string) => number;
}) {
  const [open, setOpen] = useState(false);
  const label = rangeLabel(from, to);

  return (
    <>
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen(true)}
        className={cx(
          'group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
          from || to ? 'border-ember-400/40 bg-ember-500/[0.08]' : 'border-white/10 bg-white/[0.03] hover:border-white/20',
        )}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ember-500/15 text-ember-300">
          <CalendarDays className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Dates</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={label} className="block truncate text-sm font-semibold text-zinc-100"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              {label}
            </motion.span>
          </AnimatePresence>
        </span>
        {from || to ? (
          <span role="button" tabIndex={0} aria-label="Show all dates"
            onClick={(e) => { e.stopPropagation(); onChange('', ''); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange('', ''); } }}
            className="grid h-7 w-7 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" aria-hidden />
          </span>
        ) : <ChevronDown className="h-4 w-4 text-zinc-500 transition-transform group-hover:translate-y-0.5" aria-hidden />}
      </motion.button>

      <Modal open={open} onClose={() => setOpen(false)} labelledBy="date-range-title">
        {open && (
          <RangeSheet from={from} to={to} matchDays={matchDays} countIn={countIn}
            onCancel={() => setOpen(false)}
            onApply={(a, b) => { onChange(a, b); setOpen(false); }} />
        )}
      </Modal>
    </>
  );
}

function rangeLabel(from: string, to: string) {
  if (!from && !to) return 'All time';
  if (from && to) return from === to ? shortDayFromKey(from) : `${shortDayFromKey(from)} – ${shortDayFromKey(to)}`;
  return from ? `From ${shortDayFromKey(from)}` : `Until ${shortDayFromKey(to)}`;
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const monthF = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const ymOf = (key: string) => ({ y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) - 1 });

function RangeSheet({ from, to, matchDays, countIn, onApply, onCancel }: {
  from: string; to: string; matchDays: Set<string>; countIn: (from: string, to: string) => number;
  onApply: (from: string, to: string) => void; onCancel: () => void;
}) {
  const today = daysAgoKeyIST(0);
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const [hover, setHover] = useState('');
  // Which end the next tap sets: the start until one is picked, then the end.
  const picking: 'from' | 'to' = a && !b ? 'to' : 'from';
  const [{ y, m }, setYm] = useState(() => ymOf(to || from || today));
  const [dir, setDir] = useState(0);

  const shift = (n: number) => {
    setDir(n);
    setYm(({ y: yy, m: mm }) => { const t = mm + n; return { y: yy + Math.floor(t / 12), m: ((t % 12) + 12) % 12 }; });
  };
  const atLatest = keyOf(y, m, 1) >= today.slice(0, 8) + '01';

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay(); // 0 = Sunday
    const lead = (first + 6) % 7; // Monday first
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => keyOf(y, m, i + 1))] as (string | null)[];
  }, [y, m]);

  const tap = (k: string) => {
    if (picking === 'from' || k < a) { setA(k); setB(''); return; }
    setB(k);
  };
  // While choosing the end, preview the band up to the day under the pointer.
  const end = b || (a && hover && hover >= a ? hover : '');
  const inBand = (k: string) => Boolean(a && end && k > a && k < end);
  const count = countIn(a, b || (a ? a : ''));
  const label = !a ? 'Pick a first day' : !b ? 'Now pick the last day' : rangeLabel(a, b);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 id="date-range-title" className="text-lg font-bold text-white">Pick dates</h3>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={label} className="text-xs text-zinc-400"
              initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.16 }}>
              {label}
            </motion.p>
          </AnimatePresence>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close" className="btn-ghost !p-2"><X className="h-4 w-4" /></button>
      </div>

      {/* From / To pills: the glowing one is the end the next tap sets. */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(['from', 'to'] as const).map((end) => {
          const v = end === 'from' ? a : b;
          const on = picking === end;
          return (
            <div key={end} className="relative rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              {on && <motion.span initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="absolute inset-0 rounded-xl ring-2 ring-ember-400/70 shadow-[0_0_24px_-6px_rgba(255,138,31,.6)]"
                transition={{ type: 'spring', stiffness: 420, damping: 32 }} />}
              <span className="relative block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{end === 'from' ? 'From' : 'To'}</span>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={v || 'none'} className={cx('relative block text-sm font-semibold', v ? 'text-white' : 'text-zinc-600')}
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.15 }}>
                  {v ? shortDayFromKey(v) : '—'}
                </motion.span>
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="btn-ghost !p-2" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></button>
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.span key={`${y}-${m}`} className="font-display text-base font-bold text-white"
            initial={{ opacity: 0, y: dir >= 0 ? 10 : -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: dir >= 0 ? -10 : 10 }} transition={{ duration: 0.18 }}>
            {monthF.format(new Date(Date.UTC(y, m, 1)))}
          </motion.span>
        </AnimatePresence>
        <button type="button" className="btn-ghost !p-2" aria-label="Next month" disabled={atLatest} onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></button>
      </div>

      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-zinc-500">
        {WEEKDAYS.map((d, i) => <span key={i} className="py-1">{d}</span>)}
      </div>

      <div className="relative overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={`${y}-${m}`}
            custom={dir}
            className="grid grid-cols-7 gap-y-1"
            initial={{ opacity: 0, x: dir * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -60 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.2} dragDirectionLock
            onDragEnd={(_, info) => {
              if ((info.offset.x < -50 || info.velocity.x < -400) && !atLatest) shift(1);
              else if (info.offset.x > 50 || info.velocity.x > 400) shift(-1);
            }}
            style={{ touchAction: 'pan-y' }}
            onMouseLeave={() => setHover('')}
          >
            {cells.map((k, i) => {
              if (!k) return <span key={`e${i}`} />;
              const future = k > today;
              const isA = k === a; const isB = k === (b || '') ; const isEnd = isA || isB;
              const band = inBand(k) || (isA && !!end && end !== a) || (k === end && !!a && end !== a);
              return (
                <div key={k} className="relative h-10">
                  {band && (
                    <motion.span
                      layout={false}
                      className={cx('absolute inset-y-1 bg-ember-500/15', isA ? 'left-1/2 right-0' : k === end ? 'left-0 right-1/2' : 'inset-x-0')}
                      initial={{ opacity: 0, scaleX: 0.4 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ duration: 0.2, delay: Math.min(i, 30) * 0.006 }}
                    />
                  )}
                  <motion.button
                    type="button"
                    disabled={future}
                    onClick={() => tap(k)}
                    onMouseEnter={() => setHover(k)}
                    whileTap={{ scale: 0.85 }}
                    initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30, delay: Math.min(i, 42) * 0.008 }}
                    aria-pressed={isEnd}
                    aria-label={`${shortDayFromKey(k)}${matchDays.has(k) ? ', has matches' : ''}`}
                    className={cx(
                      'relative mx-auto grid h-10 w-10 place-items-center rounded-full text-sm font-semibold transition-colors',
                      future ? 'text-zinc-700' : isEnd ? 'text-ink-950' : 'text-zinc-200 hover:bg-white/10',
                      k === today && !isEnd && 'ring-1 ring-white/25',
                    )}
                  >
                    {isEnd && (
                      <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="absolute inset-0 rounded-full bg-gradient-to-b from-ember-400 to-ember-500 shadow-[0_6px_18px_-6px_rgba(255,138,31,.8)]"
                        transition={{ type: 'spring', stiffness: 460, damping: 30 }} />
                    )}
                    <span className="relative">{Number(k.slice(8))}</span>
                    {matchDays.has(k) && (
                      <span className={cx('absolute bottom-1 h-1 w-1 rounded-full', isEnd ? 'bg-ink-950' : 'bg-ember-400')} aria-hidden />
                    )}
                  </motion.button>
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="h-1 w-1 rounded-full bg-ember-400" aria-hidden />Days with matches</p>

      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={() => onApply('', '')}>All time</button>
        <motion.button type="button" className="btn-primary flex-[2]" disabled={!a} whileTap={{ scale: 0.97 }}
          onClick={() => onApply(a, b || a)}>
          Show{' '}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={count} className="inline-block font-mono" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }}>
              {a ? count : ''}
            </motion.span>
          </AnimatePresence>
          {' '}{a ? (count === 1 ? 'match' : 'matches') : 'matches'}
        </motion.button>
      </div>
    </div>
  );
}
