import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronLeft, ChevronRight, Crosshair, Info, Medal, Trophy, X } from 'lucide-react';
import { api } from '@/lib/api';
import { timeIST } from '@/lib/time';
import { mapLabel, type CalendarDay, type CalendarMatch, type CalendarMonth, type CalendarTotals } from '@/lib/types';
import { Avatar, Card, PageHeader, Skeleton, cx } from '@/components/ui';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const utc = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d ?? 1));
};
const monthLabel = (month: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(utc(month));
const dayLabel = (day: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(utc(day));
const shortDay = (day: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(utc(day));
function shiftMonth(month: string, by: number) {
  const d = utc(month);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}
const pts = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;
const placeLabel = (p: number | null) => (p ? `#${p}` : '–');

interface Group { key: string; name: string; type: string; matches: CalendarMatch[]; total: number; kills: number }

/** Cluster matches that share a scrim / tournament name (case and punctuation ignored). */
function groupBySeries(matches: CalendarMatch[]): Group[] {
  const by = new Map<string, Group>();
  for (const m of matches) {
    const g = by.get(m.seriesKey) ?? { key: m.seriesKey, name: m.series, type: m.type, matches: [], total: 0, kills: 0 };
    g.matches.push(m);
    g.total += m.total;
    g.kills += m.kills ?? 0;
    by.set(m.seriesKey, g);
  }
  return [...by.values()];
}

/** Series colour: tournaments are gold, scrims rotate through a cool palette (orange stays reserved for the accent). */
const SCRIM_COLORS = ['#22d3ee', '#a78bfa', '#4ade80', '#f472b6', '#60a5fa', '#2dd4bf', '#fb7185', '#c084fc'];
const TOURNEY_COLOR = '#fbbf24';
function seriesColor(key: string, type: string) {
  if (type === 'tournament') return TOURNEY_COLOR;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SCRIM_COLORS[h % SCRIM_COLORS.length];
}
/** Short tag for tiny phone cells: "Bharat Pro Scrims" → "BPS", "Lunar" → "LUNA". */
function abbrev(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
  return (words[0] ?? name).slice(0, 4).toUpperCase();
}

type TypeFilter = { scrim: boolean; tournament: boolean };

function useIsDesktop() {
  const q = '(min-width: 1024px)';
  const [is, setIs] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setIs(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return is;
}

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const monthParam = params.get('month');
  const [filter, setFilter] = useState<TypeFilter>({ scrim: true, tournament: true });
  const q = useQuery({
    queryKey: ['calendar', monthParam ?? 'current'],
    queryFn: () => api.calendar(monthParam ?? undefined),
    placeholderData: keepPreviousData,
  });
  const data = q.data;
  const month = monthParam ?? data?.month ?? null;

  const byDay = useMemo(() => new Map((data?.days ?? []).map((d) => [d.day, d])), [data]);
  const dayParam = params.get('day');
  const selectedKey = dayParam && dayParam.startsWith(data?.month ?? '~') ? dayParam : null;
  const selected = selectedKey ? byDay.get(selectedKey) ?? null : null;

  const go = (next: { month?: string; day?: string | null }) => {
    const p = new URLSearchParams(params);
    if (next.month) { p.set('month', next.month); p.delete('day'); }
    if (next.day !== undefined) { if (next.day) p.set('day', next.day); else p.delete('day'); }
    setParams(p, { replace: true });
  };

  const monthTotals = useMemo(() => {
    const all = (data?.days ?? []).flatMap((d) => d.matches);
    // Only finished matches count; the rest of this month's matches show as upcoming.
    const played = all.filter((m) => m.completed);
    return { played: played.length, upcoming: all.length - played.length, points: played.reduce((a, m) => a + m.total, 0), wins: played.filter((m) => m.placement === 1).length };
  }, [data]);
  const legend = useMemo(() => groupBySeries((data?.days ?? []).flatMap((d) => d.matches)).sort((a, b) => b.total - a.total), [data]);

  return (
    <div>
      <PageHeader eyebrow="Matches this month" title="Calendar">Every match this month, played and coming up. Points and player numbers only count once a match is finished. Tap a day for its matches and points table.</PageHeader>

      {q.isLoading || !data || !month ? (
        <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]"><Skeleton className="h-72" /><Skeleton className="h-[520px]" /></div>
      ) : (
        <div className={cx('space-y-8 transition-opacity duration-200', q.isPlaceholderData && 'opacity-50')}>
          <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)] lg:items-start">
            {/* Left rail: month numbers, filters, series legend */}
            <aside className="glass order-2 space-y-5 p-4 lg:order-1 lg:sticky lg:top-6">
              <div>
                <p className="hud-label mb-3">This month</p>
                <dl className="grid grid-cols-4 gap-2 lg:grid-cols-2">
                  <MiniStat label="Played" value={monthTotals.played} />
                  <MiniStat label="Upcoming" value={monthTotals.upcoming} />
                  <MiniStat label="Points" value={monthTotals.points} accent />
                  <MiniStat label="Wins" value={monthTotals.wins} gold={monthTotals.wins > 0} />
                </dl>
              </div>
              <fieldset>
                <legend className="hud-label mb-2">Show</legend>
                <div className="flex gap-2 lg:flex-col">
                  <FilterToggle label="Scrims" color={SCRIM_COLORS[0]} on={filter.scrim} onChange={(v) => setFilter((f) => ({ ...f, scrim: v }))} />
                  <FilterToggle label="Tournaments" color={TOURNEY_COLOR} on={filter.tournament} onChange={(v) => setFilter((f) => ({ ...f, tournament: v }))} />
                </div>
              </fieldset>
              {legend.length > 0 && (
                <div>
                  <p className="hud-label mb-2">Series</p>
                  <ul className="space-y-1">
                    {legend.map((g) => (
                      <li key={g.key} className={cx('flex items-center gap-2 text-sm', !filter[g.type as keyof TypeFilter] && 'opacity-40')}>
                        <span className="h-3 w-1 shrink-0 rounded-sm" style={{ background: seriesColor(g.key, g.type) }} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-zinc-300">{g.name}</span>
                        <span className="font-mono text-xs text-zinc-500">{g.total}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>

            {/* Month grid */}
            <section className="glass order-1 p-2 sm:p-4 lg:order-2">
              <div className="mb-3 flex items-center justify-between gap-2 px-1">
                <div className="min-w-0">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.h2 key={month} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.18 }}
                      className="truncate font-display text-2xl font-bold uppercase tracking-wider text-ember-400 sm:text-3xl">{monthLabel(month)}</motion.h2>
                  </AnimatePresence>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {month !== data.today.slice(0, 7) && (
                    <button className="btn-ghost !px-3 !py-2 !text-xs" onClick={() => go({ month: data.today.slice(0, 7), day: null })}>Today</button>
                  )}
                  <button className="btn-ghost !p-2.5" aria-label="Previous month" onClick={() => go({ month: shiftMonth(month, -1) })}><ChevronLeft className="h-4 w-4" /></button>
                  <button className="btn-ghost !p-2.5" aria-label="Next month" onClick={() => go({ month: shiftMonth(month, 1) })}><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
              <MonthGrid month={month} today={data.today} byDay={byDay} selected={selectedKey} filter={filter} onPick={(d) => go({ day: d })} />
              {data.days.length === 0 && <p className="mt-3 px-1 text-sm text-zinc-500">No matches this month. Use the arrows to look back.</p>}
            </section>
          </div>

          <SeriesClusters data={data} onPickDay={(d) => go({ day: d })} />
          <PointsNote system={data.pointsSystem} />
        </div>
      )}

      {data && <DaySheet day={selected} data={data} onClose={() => go({ day: null })} />}
    </div>
  );
}

function MiniStat({ label, value, accent, gold }: { label: string; value: number; accent?: boolean; gold?: boolean }) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
      <dt className="font-display text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</dt>
      <dd className={cx('font-mono text-lg font-bold tabular-nums', accent ? 'text-ember-300' : gold ? 'text-amber-300' : 'text-white')}>{value}</dd>
    </div>
  );
}

function FilterToggle({ label, color, on, onChange }: { label: string; color: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={() => onChange(!on)}
      className={cx('flex min-h-[40px] flex-1 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm font-semibold',
        on ? 'border-white/15 bg-white/[0.05] text-white' : 'border-white/[0.06] text-zinc-500')}>
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border" style={{ borderColor: color, background: on ? color : 'transparent' }}>
        {on && <svg viewBox="0 0 12 12" className="h-3 w-3 text-ink-950" aria-hidden><path d="M2.5 6.5l2.2 2.2L9.5 3.8" fill="none" stroke="currentColor" strokeWidth="2" /></svg>}
      </span>
      {label}
    </button>
  );
}

function MonthGrid({ month, today, byDay, selected, filter, onPick }: {
  month: string; today: string; byDay: Map<string, CalendarDay>; selected: string | null; filter: TypeFilter; onPick: (day: string) => void;
}) {
  const first = utc(month);
  const lead = (first.getUTCDay() + 6) % 7;
  const next = utc(shiftMonth(month, 1));
  const count = Math.round((next.getTime() - first.getTime()) / 864e5);
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  return (
    <div>
      <div className="mb-1.5 grid grid-cols-7 gap-1 text-center font-display text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 sm:gap-1.5" aria-hidden>
        {WEEKDAYS.map((w) => <span key={w} className="py-1"><span className="min-[400px]:hidden">{w[0]}</span><span className="hidden min-[400px]:inline">{w}</span></span>)}
      </div>
      <motion.div key={month} className="grid grid-cols-7 gap-1 sm:gap-1.5" role="grid" aria-label={monthLabel(month)}
        initial="initial" animate="animate" variants={{ initial: {}, animate: { transition: { staggerChildren: 0.012 } } }}>
        {cells.map((key, i) => {
          if (!key) return <span key={`e${i}`} className="rounded-md bg-white/[0.01]" />;
          const d = byDay.get(key);
          const shown = d ? d.matches.filter((m) => filter[m.type]) : [];
          const groups = groupBySeries(shown);
          const active = shown.length > 0;
          const total = shown.reduce((a, m) => a + m.total, 0);
          const anyPlayed = shown.some((m) => m.completed);
          const allUpcoming = active && !anyPlayed;
          const isSel = key === selected;
          const isToday = key === today;
          return (
            <motion.button key={key} disabled={!active} onClick={() => onPick(key)} aria-pressed={isSel}
              variants={{ initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } }}
              whileHover={active ? { y: -2 } : undefined} whileTap={active ? { scale: 0.96 } : undefined}
              aria-label={`${dayLabel(key)}${active ? `, ${groups.map((g) => g.name).join(', ')}, ${shown.length} ${shown.length === 1 ? 'match' : 'matches'}${anyPlayed ? `, ${pts(total)}` : ', upcoming'}` : ', no matches'}`}
              className={cx(
                'group relative flex min-h-[64px] flex-col overflow-hidden rounded-md border text-left sm:min-h-[96px] lg:min-h-[108px]',
                active ? 'border-white/10 bg-ink-800/80 hover:border-ember-400/50' : 'cursor-default border-white/[0.04] bg-white/[0.015]',
                allUpcoming && '!border-dashed',
                isSel && '!border-ember-400 shadow-glow',
              )}>
              {/* Header strip: date number + day points */}
              <span className={cx('flex items-center justify-between px-1 py-0.5 sm:px-1.5', active ? 'bg-white/[0.06]' : '', isSel && '!bg-ember-500/25')}>
                <span className={cx('grid h-5 min-w-5 place-items-center rounded-[3px] px-0.5 font-mono text-[11px] font-bold leading-none sm:text-xs',
                  isToday ? 'bg-ember-500 text-ink-950' : active ? 'text-white' : 'text-zinc-600')}>{Number(key.slice(8))}</span>
                {anyPlayed && <span className="hidden font-mono text-[10px] font-bold text-ember-300 sm:inline">{total}<span className="text-zinc-500">p</span></span>}
                {allUpcoming && <span className="hidden text-[9px] font-bold uppercase tracking-wider text-zinc-400 sm:inline">Soon</span>}
              </span>
              {active && (
                <span className="flex flex-1 flex-col gap-0.5 p-0.5 sm:gap-1 sm:p-1">
                  {groups.slice(0, 3).map((g, gi) => {
                    const c = seriesColor(g.key, g.type);
                    const later = g.matches.every((m) => !m.completed);
                    return (
                      <span key={g.key} className={cx('flex items-center gap-1 truncate rounded-[3px] border-l-2 px-0.5 py-px text-[8px] font-bold leading-tight sm:px-1 sm:py-0.5 sm:text-[10px] sm:font-semibold', gi > 1 && 'hidden sm:flex', later && 'border-dashed opacity-70')}
                        style={{ background: later ? 'transparent' : `${c}26`, borderColor: c, color: c }}>
                        <span className="truncate sm:hidden">{abbrev(g.name)}</span>
                        <span className="hidden truncate text-zinc-100 sm:inline">{g.name}</span>
                        {g.matches.length > 1 && <span className="ml-auto hidden shrink-0 font-mono text-[9px] opacity-80 md:inline">×{g.matches.length}</span>}
                      </span>
                    );
                  })}
                  {groups.length > 3 && <span className="hidden px-1 text-[10px] text-zinc-500 sm:block">+{groups.length - 3} more</span>}
                  {groups.length > 2 && <span className="px-0.5 text-[8px] text-zinc-500 sm:hidden">+{groups.length - 2}</span>}
                  {anyPlayed && <span className="mt-auto px-0.5 font-mono text-[9px] font-bold text-ember-300 sm:hidden">{total}</span>}
                </span>
              )}
            </motion.button>
          );
        })}
      </motion.div>
    </div>
  );
}

/** Day details: a side panel on desktop, a bottom sheet on phones. Backdrop tap or Escape closes it. */
function DaySheet({ day, data, onClose }: { day: CalendarDay | null; data: CalendarMonth; onClose: () => void }) {
  const desktop = useIsDesktop();
  useEffect(() => {
    if (!day) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [day, onClose]);
  const off = desktop ? { x: '100%', y: 0 } : { x: 0, y: '100%' };
  return createPortal(
    <AnimatePresence>
      {day && (
        <motion.div key="sheet" className="fixed inset-0 z-[85]" initial={{ opacity: 1 }} exit={{ opacity: 1 }}>
          <motion.div className="absolute inset-0 bg-black/65" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.div role="dialog" aria-modal="true" aria-label={dayLabel(day.day)}
            className={cx('absolute overflow-y-auto overscroll-contain border-white/10 bg-ink-900 shadow-2xl',
              desktop ? 'inset-y-0 right-0 w-[460px] max-w-full border-l' : 'inset-x-0 bottom-0 max-h-[88vh] rounded-t-2xl border-t')}
            style={desktop ? undefined : { paddingBottom: 'env(safe-area-inset-bottom)' }}
            initial={off} animate={{ x: 0, y: 0 }} exit={off} transition={{ type: 'spring', stiffness: 380, damping: 38 }}>
            <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-ember-400 via-ember-500/40 to-transparent" />
            {!desktop && <span aria-hidden className="mx-auto mt-2 block h-1 w-10 rounded-full bg-white/20" />}
            <div className="sticky top-0 z-10 flex items-center justify-end bg-ink-900/95 px-3 pt-2">
              <button className="btn-ghost !p-2.5" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button>
            </div>
            <div className="px-4 pb-6 sm:px-5">
              <DayPanel day={day} data={data} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function TotalsChips({ t }: { t: CalendarTotals }) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="chip bg-ember-500/15 text-ember-300"><Trophy className="h-3 w-3" aria-hidden />{pts(t.total)}</span>
      <span className="chip bg-white/[0.06] text-zinc-300"><Crosshair className="h-3 w-3" aria-hidden />{t.kills} kills</span>
      {t.bestPlacement && <span className="chip bg-white/[0.06] text-zinc-300"><Medal className="h-3 w-3" aria-hidden />Best #{t.bestPlacement}</span>}
      {t.wins > 0 && <span className="chip bg-emerald-500/15 text-emerald-300">{t.wins} {t.wins === 1 ? 'chicken dinner' : 'chicken dinners'}</span>}
    </div>
  );
}

function DayPanel({ day, data }: { day: CalendarDay; data: CalendarMonth }) {
  const groups = groupBySeries(day.matches);
  // The points table only has finished matches; the others are listed above as upcoming / live.
  const playedGroups = groupBySeries(day.matches.filter((m) => m.completed));
  const players = new Map(data.players.map((p) => [p.id, p]));
  const missing = day.totals.matches - day.totals.withResult;
  const upcoming = day.totals.upcoming ?? 0;
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{day.totals.matches} played{upcoming ? ` · ${upcoming} upcoming` : ''} · {groups.length} series</p>
        <h2 className="mt-1 text-3xl font-bold uppercase text-white">{dayLabel(day.day)}</h2>
        <div className="mt-3"><TotalsChips t={day.totals} /></div>
      </div>

      {/* What we played: one block per scrim / tournament, each match a row */}
      <section>
        <p className="hud-label mb-2">{upcoming && !day.totals.matches ? 'Matches' : 'Matches played'}</p>
        <motion.div className="space-y-3" initial="initial" animate="animate" variants={{ initial: {}, animate: { transition: { staggerChildren: 0.05 } } }}>
          {groups.map((g) => {
            const c = seriesColor(g.key, g.type);
            return (
              <motion.div key={g.key} variants={{ initial: { opacity: 0, x: 16 }, animate: { opacity: 1, x: 0 } }}
                className="overflow-hidden rounded-lg border border-white/[0.08] bg-ink-850">
                <div className="flex items-center gap-2 border-l-[3px] px-3 py-2" style={{ borderColor: c, background: `${c}14` }}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-base font-bold uppercase text-white">{g.name}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: c }}>{g.type === 'tournament' ? 'Tournament' : 'Scrim'} · {g.matches.length} {g.matches.length === 1 ? 'match' : 'matches'} · {g.kills} kills</span>
                  </span>
                  <span className="text-right"><span className="block font-mono text-xl font-bold text-ember-300">{g.total}</span><span className="text-[9px] uppercase tracking-wider text-zinc-500">pts</span></span>
                </div>
                <ul>
                  {g.matches.map((m, i) => (
                    <li key={m.id} className="border-t border-white/[0.05]">
                      <Link to={`/matches/${m.id}`} className="flex min-h-[48px] items-center gap-3 px-3 py-2 hover:bg-white/[0.04]">
                        <span className="w-6 shrink-0 font-mono text-xs text-zinc-500">M{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-zinc-100">{m.title}</span>
                          <span className="block truncate text-[11px] text-zinc-500">{timeIST(m.startAt)} · {mapLabel(m.map)}{m.completed && !m.hasResult && ' · no result yet'}</span>
                        </span>
                        {m.completed ? (
                          <>
                            <span className={cx('cut-sm shrink-0 px-1.5 py-0.5 font-mono text-xs font-bold', m.placement === 1 ? 'bg-amber-400 text-ink-950' : 'bg-white/[0.06] text-zinc-200')}>{placeLabel(m.placement)}</span>
                            <span className="w-9 shrink-0 text-right font-mono text-sm font-bold text-white">{m.total}</span>
                          </>
                        ) : (
                          <span className={cx('chip shrink-0 !text-[10px]', m.status === 'live' ? 'bg-red-500/15 text-red-300' : 'bg-white/[0.06] text-zinc-400')}>
                            {m.status === 'live' || new Date(m.startAt).getTime() <= Date.now() ? 'Live' : 'Upcoming'}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </motion.div>
      </section>

      {playedGroups.length === 0 ? (
        <p className="flex items-start gap-1.5 text-xs text-zinc-500"><Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          The points table fills in as matches finish (Finish match, or upload the results screenshot).</p>
      ) : (
      <section>
        <p className="hud-label mb-2">Points table</p>
        <table className="w-full table-fixed text-sm">
          <colgroup><col /><col className="w-12" /><col className="w-14" /><col className="w-11" /><col className="w-12" /></colgroup>
          <thead>
            <tr className="border-b border-white/[0.08] text-left font-display text-[11px] uppercase tracking-wider text-zinc-500">
              <th className="py-2 pr-2 font-bold">Match</th>
              <th className="px-1 py-2 text-center font-bold">Place</th>
              <th className="px-1 py-2 text-right font-bold">Pl pts</th>
              <th className="px-1 py-2 text-right font-bold">Kills</th>
              <th className="py-2 pl-1 text-right font-bold">Total</th>
            </tr>
          </thead>
          {playedGroups.map((g) => {
            const c = seriesColor(g.key, g.type);
            return (
              <tbody key={g.key}>
                <tr style={{ background: `${c}12` }}>
                  <td colSpan={4} className="truncate border-l-2 py-1.5 pl-2 pr-2 text-xs font-bold" style={{ borderColor: c, color: c }}>{g.name} · {g.matches.length}</td>
                  <td className="py-1.5 pl-1 pr-1 text-right font-mono text-xs font-bold" style={{ color: c }}>{g.total}</td>
                </tr>
                {g.matches.map((m) => (
                  <tr key={m.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="truncate py-2 pr-2 text-zinc-200">{m.title}</td>
                    <td className={cx('px-1 py-2 text-center font-mono', m.placement === 1 ? 'text-amber-300' : 'text-zinc-200')}>{placeLabel(m.placement)}</td>
                    <td className="px-1 py-2 text-right font-mono text-zinc-300">{m.placementPts}</td>
                    <td className="px-1 py-2 text-right font-mono text-zinc-300">{m.kills ?? '–'}</td>
                    <td className="py-2 pl-1 text-right font-mono font-bold text-white">{m.total}</td>
                  </tr>
                ))}
              </tbody>
            );
          })}
          <tfoot>
            <tr className="border-t border-white/[0.12] text-white">
              <td className="py-2.5 pr-2 font-display font-bold uppercase">Day total</td>
              <td className="px-1 py-2.5 text-center font-mono text-zinc-400">{placeLabel(day.totals.bestPlacement)}</td>
              <td className="px-1 py-2.5 text-right font-mono">{day.totals.placementPts}</td>
              <td className="px-1 py-2.5 text-right font-mono">{day.totals.kills}</td>
              <td className="py-2.5 pl-1 text-right font-mono text-lg font-bold text-ember-300">{day.totals.total}</td>
            </tr>
          </tfoot>
        </table>
        {missing > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-zinc-500"><Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
            {missing} {missing === 1 ? 'match has' : 'matches have'} no placement or scorecard yet, so {missing === 1 ? 'it counts' : 'they count'} 0 for now.</p>
        )}
        {upcoming > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-zinc-500"><Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
            {upcoming} more {upcoming === 1 ? 'match' : 'matches'} this day {upcoming === 1 ? 'adds' : 'add'} to the table once finished.</p>
        )}
      </section>
      )}

      {day.players.length > 0 && (
        <section>
          <p className="hud-label mb-2">Players this day</p>
          <ul className="space-y-1.5">
            {day.players.map((p, i) => {
              const u = players.get(p.userId);
              const name = u?.ign || u?.name || 'Player';
              return (
                <li key={p.userId} className="flex items-center gap-3 rounded-md border border-white/[0.05] bg-white/[0.02] p-2">
                  <span className={cx('w-4 text-center font-mono font-bold', i === 0 ? 'text-ember-400' : 'text-zinc-500')}>{i + 1}</span>
                  <Avatar name={name} src={u?.avatar} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-display text-sm font-bold uppercase text-zinc-100">{name}
                      {p.mvps > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-300"><Trophy className="h-3 w-3" aria-hidden />{p.mvps}</span>}</p>
                    <p className="text-[11px] text-zinc-500">{p.matches} {p.matches === 1 ? 'match' : 'matches'} · {Math.round(p.damage)} dmg · {p.assists} ast</p>
                  </div>
                  <span className="font-mono text-white">{p.kills}<span className="ml-1 text-[11px] text-zinc-500">kills</span></span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Every scrim / tournament played this month, each one a card that opens to its matches, day by day. */
function SeriesClusters({ data, onPickDay }: { data: CalendarMonth; onPickDay: (day: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const dayOf = new Map(data.days.flatMap((d) => d.matches.map((m) => [m.id, d.day] as const)));
  const groups = groupBySeries(data.days.flatMap((d) => d.matches)).sort((a, b) => b.matches.length - a.matches.length || b.total - a.total);
  if (!groups.length) return null;
  return (
    <section>
      <h2 className="hud-label mb-1 !text-sm !text-white">Scrims & tournaments this month</h2>
      <p className="mb-3 text-xs text-zinc-500">Matches with the same scrim name are grouped together. Open one to see its matches.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((g) => {
          const isOpen = open === g.key;
          const days = groupByDay(g.matches, dayOf);
          return (
            <Card key={g.key} className="!p-0">
              <button className="flex w-full items-center gap-3 p-4 text-left sm:p-5" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.key)}>
                <span className="h-10 w-1.5 shrink-0 rounded-sm" style={{ background: seriesColor(g.key, g.type) }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-base font-bold uppercase text-white">{g.name}</span>
                  <span className="text-xs text-zinc-500">{g.matches.length} {g.matches.length === 1 ? 'match' : 'matches'} · {days.length} {days.length === 1 ? 'day' : 'days'} · {g.kills} kills{g.type === 'tournament' ? ' · tournament' : ''}</span>
                </span>
                <span className="text-right"><span className="block font-mono text-xl font-bold text-ember-300">{g.total}</span><span className="text-[10px] uppercase tracking-wider text-zinc-500">pts</span></span>
                <ChevronDown className={cx('h-4 w-4 shrink-0 text-zinc-500 transition-transform', isOpen && 'rotate-180')} aria-hidden />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                    <div className="space-y-3 border-t border-white/[0.06] px-4 pb-4 pt-3 sm:px-5">
                      {days.map(([day, ms]) => (
                        <div key={day}>
                          <button className="mb-1 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-ember-300" onClick={() => onPickDay(day)}>
                            <span>{shortDay(day)}</span><span>{pts(ms.reduce((a, m) => a + m.total, 0))} · day table</span>
                          </button>
                          <ul className="space-y-1">
                            {ms.map((m) => (
                              <li key={m.id}>
                                <Link to={`/matches/${m.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/[0.04]">
                                  <span className="w-16 shrink-0 text-xs text-zinc-500">{timeIST(m.startAt)}</span>
                                  <span className="min-w-0 flex-1 truncate text-zinc-100">{m.title}<span className="text-zinc-500"> · {mapLabel(m.map)}</span></span>
                                  {m.completed ? (
                                    <>
                                      <span className="font-mono text-xs text-zinc-400">{placeLabel(m.placement)}</span>
                                      <span className="w-12 text-right font-mono text-xs font-bold text-white">{m.total}</span>
                                    </>
                                  ) : <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Upcoming</span>}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function groupByDay(matches: CalendarMatch[], dayOf: Map<string, string>): [string, CalendarMatch[]][] {
  const by = new Map<string, CalendarMatch[]>();
  for (const m of matches) {
    const k = dayOf.get(m.id) ?? m.startAt.slice(0, 10);
    by.set(k, [...(by.get(k) ?? []), m]);
  }
  return [...by.entries()];
}

function PointsNote({ system }: { system: CalendarMonth['pointsSystem'] }) {
  const entries = Object.entries(system.placement).sort(([a], [b]) => Number(a) - Number(b));
  return (
    <p className="text-[11px] leading-relaxed text-zinc-500">
      Points use the standard BGMI table: {entries.map(([p, v]) => `#${p} ${v}`).join(', ')}, other places 0, plus {system.perKill} per kill.
      Uploading a results screenshot fills in both the kills and the squad's position; you can also set the position with "Finish match".
    </p>
  );
}
