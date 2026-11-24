import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronLeft, ChevronRight, Crosshair, Info, Layers, Medal, Trophy } from 'lucide-react';
import { api } from '@/lib/api';
import { timeIST } from '@/lib/time';
import { mapLabel, type CalendarDay, type CalendarMatch, type CalendarMonth, type CalendarTotals } from '@/lib/types';
import { Avatar, Card, PageHeader, Skeleton, cx } from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';

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

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const monthParam = params.get('month');
  const q = useQuery({
    queryKey: ['calendar', monthParam ?? 'current'],
    queryFn: () => api.calendar(monthParam ?? undefined),
    placeholderData: keepPreviousData,
  });
  const data = q.data;
  const month = monthParam ?? data?.month ?? null;

  const byDay = useMemo(() => new Map((data?.days ?? []).map((d) => [d.day, d])), [data]);
  const dayParam = params.get('day');
  // Default to today when we played today, otherwise the latest day played this month.
  const selectedKey = dayParam && dayParam.startsWith(data?.month ?? '~') ? dayParam
    : data ? (byDay.has(data.today) ? data.today : data.days.at(-1)?.day ?? null) : null;
  const selected = selectedKey ? byDay.get(selectedKey) ?? null : null;

  const go = (next: { month?: string; day?: string | null }) => {
    const p = new URLSearchParams(params);
    if (next.month) { p.set('month', next.month); p.delete('day'); }
    if (next.day !== undefined) { if (next.day) p.set('day', next.day); else p.delete('day'); }
    setParams(p, { replace: true });
  };

  const monthTotals = useMemo(() => {
    const all = (data?.days ?? []).flatMap((d) => d.matches);
    return { days: data?.days.length ?? 0, matches: all.length, points: all.reduce((a, m) => a + m.total, 0), wins: all.filter((m) => m.placement === 1).length };
  }, [data]);

  return (
    <div>
      <PageHeader eyebrow="History" title="Calendar">Tap a day to see what we played and that day's points table.</PageHeader>

      {q.isLoading || !data || !month ? (
        <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
      ) : (
        <div className={cx('space-y-6 transition-opacity duration-200', q.isPlaceholderData && 'opacity-50')}>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:items-start">
            <Card className="md:sticky md:top-20 lg:top-6">
              <div className="mb-4 flex items-center justify-between gap-2">
                <button className="btn-ghost !p-2" aria-label="Previous month" onClick={() => go({ month: shiftMonth(month, -1) })}><ChevronLeft className="h-4 w-4" /></button>
                <div className="text-center">
                  <h2 className="font-display text-xl font-bold text-white">{monthLabel(month)}</h2>
                  {month !== data.today.slice(0, 7) && (
                    <button className="text-xs font-semibold text-ember-400 hover:underline" onClick={() => go({ month: data.today.slice(0, 7), day: null })}>Back to this month</button>
                  )}
                </div>
                <button className="btn-ghost !p-2" aria-label="Next month" onClick={() => go({ month: shiftMonth(month, 1) })}><ChevronRight className="h-4 w-4" /></button>
              </div>
              <MonthGrid month={month} today={data.today} byDay={byDay} selected={selectedKey} onPick={(d) => go({ day: d })} />
              <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-white/[0.06] pt-4 text-center">
                <MiniStat label="Days" value={monthTotals.days} />
                <MiniStat label="Matches" value={monthTotals.matches} />
                <MiniStat label="Points" value={monthTotals.points} />
                <MiniStat label="Wins" value={monthTotals.wins} />
              </dl>
            </Card>

            <AnimatePresence mode="wait">
              <motion.div key={selectedKey ?? 'none'} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                {selected ? <DayPanel day={selected} data={data} />
                  : <Card><EmptyState title="No matches this month" text="Days with matches show a dot on the calendar. Pick another month to look back." /></Card>}
              </motion.div>
            </AnimatePresence>
          </div>

          <SeriesClusters data={data} onPickDay={(d) => { go({ day: d }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
          <PointsNote system={data.pointsSystem} />
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="font-display text-xl font-bold text-white">{value}</dd>
    </div>
  );
}

function MonthGrid({ month, today, byDay, selected, onPick }: {
  month: string; today: string; byDay: Map<string, CalendarDay>; selected: string | null; onPick: (day: string) => void;
}) {
  const first = utc(month);
  const lead = (first.getUTCDay() + 6) % 7;
  const next = utc(shiftMonth(month, 1));
  const count = Math.round((next.getTime() - first.getTime()) / 864e5);
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wider text-zinc-500" aria-hidden>
        {WEEKDAYS.map((w) => <span key={w} className="py-1"><span className="min-[400px]:hidden">{w[0]}</span><span className="hidden min-[400px]:inline">{w}</span></span>)}
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={monthLabel(month)}>
        {cells.map((key, i) => {
          if (!key) return <span key={`e${i}`} />;
          const d = byDay.get(key);
          const isSel = key === selected;
          const isToday = key === today;
          return (
            <button key={key} disabled={!d} onClick={() => d && onPick(key)} aria-pressed={isSel}
              aria-label={`${dayLabel(key)}${d ? `, ${d.totals.matches} ${d.totals.matches === 1 ? 'match' : 'matches'}, ${pts(d.totals.total)}` : ', no matches'}`}
              className={cx(
                'relative flex aspect-square flex-col items-center justify-start rounded-xl p-1 text-sm transition-colors sm:p-1.5',
                d ? 'bg-white/[0.04] text-white hover:bg-ember-500/15' : 'text-zinc-600',
                isSel && '!bg-gradient-to-b from-ember-400 to-ember-500 !text-ink-950 shadow-glow',
                isToday && !isSel && 'ring-1 ring-ember-400/60',
              )}>
              <span className={cx('font-semibold leading-none', isToday && !isSel && 'text-ember-300')}>{Number(key.slice(8))}</span>
              {d && (
                <span className="mt-auto flex flex-col items-center leading-none">
                  <span className={cx('font-mono text-[10px] font-bold sm:text-xs', isSel ? 'text-ink-950' : 'text-ember-300')}>{d.totals.total}</span>
                  <span className={cx('mt-0.5 hidden text-[9px] sm:block', isSel ? 'text-ink-950/70' : 'text-zinc-500')}>{d.totals.matches}M</span>
                  <span className={cx('mt-0.5 flex gap-0.5 sm:hidden')} aria-hidden>
                    {d.matches.slice(0, 4).map((m) => <span key={m.id} className={cx('h-1 w-1 rounded-full', isSel ? 'bg-ink-950' : 'bg-ember-400')} />)}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">The number under each date is that day's total points.</p>
    </div>
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
  const players = new Map(data.players.map((p) => [p.id, p]));
  const missing = day.totals.matches - day.totals.withResult;
  return (
    <div className="space-y-6">
      <Card>
        <p className="eyebrow">{day.totals.matches} {day.totals.matches === 1 ? 'match' : 'matches'}{groups.length > 1 ? ` · ${groups.length} scrims` : ''}</p>
        <h2 className="mb-3 text-2xl font-bold text-white">{dayLabel(day.day)}</h2>
        <TotalsChips t={day.totals} />

        <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-wider text-zinc-500">Points table</h3>
        <div>
          <table className="w-full table-fixed text-sm">
            <colgroup><col /><col className="w-12 sm:w-16" /><col className="w-14 sm:w-20" /><col className="w-11 sm:w-14" /><col className="w-12 sm:w-16" /></colgroup>
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="py-2 pr-2 font-semibold">Match</th>
                <th className="px-1 py-2 text-center font-semibold sm:px-2">Place</th>
                <th className="px-1 py-2 text-right font-semibold sm:px-2"><span className="whitespace-nowrap sm:hidden">Pl pts</span><span className="hidden sm:inline">Place pts</span></th>
                <th className="px-1 py-2 text-right font-semibold sm:px-2">Kills</th>
                <th className="py-2 pl-1 text-right font-semibold sm:pl-2">Total</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key}>
                {groups.length > 1 && (
                  <tr className="bg-white/[0.03]">
                    <td colSpan={4} className="truncate py-1.5 pl-2 pr-2 text-xs font-semibold text-ember-300"><Layers className="mr-1 inline h-3 w-3" aria-hidden />{g.name} · {g.matches.length}</td>
                    <td className="py-1.5 pl-1 pr-2 text-right font-mono text-xs text-ember-300">{g.total}</td>
                  </tr>
                )}
                {g.matches.map((m) => (
                  <tr key={m.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03]">
                    <td className="py-2 pr-2">
                      <Link to={`/matches/${m.id}`} className="block min-w-0 hover:text-ember-300">
                        <span className="block truncate font-semibold text-zinc-100">{m.title}</span>
                        <span className="block truncate text-[11px] text-zinc-500">{timeIST(m.startAt)} · {mapLabel(m.map)}{!m.hasResult && ' · no result yet'}</span>
                      </Link>
                    </td>
                    <td className={cx('px-1 py-2 text-center font-mono sm:px-2', m.placement === 1 ? 'text-emerald-300' : 'text-zinc-200')}>{placeLabel(m.placement)}</td>
                    <td className="px-1 py-2 text-right font-mono text-zinc-300 sm:px-2">{m.placementPts}</td>
                    <td className="px-1 py-2 text-right font-mono text-zinc-300 sm:px-2">{m.kills ?? '–'}</td>
                    <td className="py-2 pl-1 text-right font-mono font-bold text-white sm:pl-2">{m.total}</td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr className="border-t border-white/[0.1] text-white">
                <td className="py-2.5 pr-2 font-bold">Day total</td>
                <td className="px-1 py-2.5 sm:px-2 text-center font-mono text-zinc-400">{placeLabel(day.totals.bestPlacement)}</td>
                <td className="px-1 py-2.5 sm:px-2 text-right font-mono">{day.totals.placementPts}</td>
                <td className="px-1 py-2.5 sm:px-2 text-right font-mono">{day.totals.kills}</td>
                <td className="py-2.5 pl-1 text-right font-display text-lg font-bold text-ember-300 sm:pl-2">{day.totals.total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {missing > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-zinc-500"><Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
            {missing} {missing === 1 ? 'match has' : 'matches have'} no placement or scorecard yet, so {missing === 1 ? 'it counts' : 'they count'} 0 for now.</p>
        )}
      </Card>

      {day.players.length > 0 && (
        <Card>
          <h3 className="mb-3 text-lg font-bold text-white">Players this day</h3>
          <ul className="space-y-1.5">
            {day.players.map((p, i) => {
              const u = players.get(p.userId);
              const name = u?.ign || u?.name || 'Player';
              return (
                <li key={p.userId} className="flex items-center gap-3 rounded-xl p-2 hover:bg-white/[0.03]">
                  <span className={cx('w-4 text-center font-display font-bold', i === 0 ? 'text-ember-400' : 'text-zinc-500')}>{i + 1}</span>
                  <Avatar name={name} src={u?.avatar} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-zinc-100">{name}
                      {p.mvps > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-ember-300"><Trophy className="h-3 w-3" aria-hidden />{p.mvps}</span>}</p>
                    <p className="text-[11px] text-zinc-500">{p.matches} {p.matches === 1 ? 'match' : 'matches'} · {Math.round(p.damage)} dmg · {p.assists} ast</p>
                  </div>
                  <span className="font-mono text-white">{p.kills}<span className="ml-1 text-[11px] text-zinc-500">kills</span></span>
                </li>
              );
            })}
          </ul>
        </Card>
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
      <h2 className="mb-1 text-lg font-bold text-white">Scrims this month</h2>
      <p className="mb-3 text-xs text-zinc-500">Matches with the same scrim name are grouped together. Open one to see its matches.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((g) => {
          const isOpen = open === g.key;
          const days = groupByDay(g.matches, dayOf);
          return (
            <Card key={g.key} className="!p-0">
              <button className="flex w-full items-center gap-3 p-4 text-left sm:p-5" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.key)}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ember-500/15 text-ember-300"><Layers className="h-5 w-5" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-white">{g.name}</span>
                  <span className="text-xs text-zinc-500">{g.matches.length} {g.matches.length === 1 ? 'match' : 'matches'} · {days.length} {days.length === 1 ? 'day' : 'days'} · {g.kills} kills{g.type === 'tournament' ? ' · tournament' : ''}</span>
                </span>
                <span className="text-right"><span className="block font-display text-xl font-bold text-ember-300">{g.total}</span><span className="text-[10px] uppercase tracking-wider text-zinc-500">pts</span></span>
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
                                  <span className="font-mono text-xs text-zinc-400">{placeLabel(m.placement)}</span>
                                  <span className="w-12 text-right font-mono text-xs font-bold text-white">{m.total}</span>
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
      Kills come from the saved scorecard and placement from "Finish match".
    </p>
  );
}
