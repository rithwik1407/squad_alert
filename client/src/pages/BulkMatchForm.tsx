import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CalendarRange, Plus, Repeat, Trash2, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { MAPS, MAP_TBD, mapLabel, type MatchMap } from '@/lib/types';
import { dayIST, fromISTInput, timeIST, toISTInput } from '@/lib/time';
import { Button, Card, Field, PageHeader, cx } from '@/components/ui';
import { useToast } from '@/components/Toast';

interface Row { key: number; time: string; title: string; map: MatchMap }

let seq = 0;
const row = (time: string, title: string, map: MatchMap = MAP_TBD): Row => ({ key: ++seq, time, title, map });

const addHour = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const PRESETS: { label: string; times: string[] }[] = [
  { label: 'Evening block · 6–10 PM', times: ['18:00', '19:00', '20:00', '21:00', '22:00'] },
  { label: 'Prime time · 8, 9, 10 PM', times: ['20:00', '21:00', '22:00'] },
  { label: 'Late night · 10 PM–12 AM', times: ['22:00', '23:00', '00:00'] },
];

export default function BulkMatchForm() {
  const { team } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(toISTInput(new Date()).slice(0, 10));
  const [type, setType] = useState<'scrim' | 'tournament'>('scrim');
  const [offset, setOffset] = useState(2);
  const [days, setDays] = useState(1);
  const [rows, setRows] = useState<Row[]>([row('20:00', 'Scrim 1'), row('21:00', 'Scrim 2'), row('22:00', 'Scrim 3')]);
  const [busy, setBusy] = useState(false);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => {
    const last = rs[rs.length - 1];
    return [...rs, row(last ? addHour(last.time) : '20:00', `${type === 'scrim' ? 'Scrim' : 'Round'} ${rs.length + 1}`)];
  });
  const usePreset = (times: string[]) => setRows(times.map((t, i) => row(t, `${type === 'scrim' ? 'Scrim' : 'Round'} ${i + 1}`)));

  /** Expand rows × days into concrete UTC start times. Times before 6 AM count as "after midnight" of the chosen evening. */
  const planned = useMemo(() => {
    const out: { title: string; map: MatchMap; startAt: string }[] = [];
    for (let d = 0; d < days; d++) {
      for (const r of rows) {
        if (!r.time) continue;
        const base = new Date(`${date}T00:00:00+05:30`).getTime() + d * 864e5 + (Number(r.time.slice(0, 2)) < 6 ? 864e5 : 0);
        const day = toISTInput(new Date(base)).slice(0, 10);
        out.push({ title: r.title.trim() || 'Scrim', map: r.map, startAt: fromISTInput(`${day}T${r.time}`) });
      }
    }
    return out.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [rows, days, date]);

  const past = planned.filter((p) => new Date(p.startAt).getTime() < Date.now());
  const dupTimes = new Set(planned.map((p) => p.startAt)).size !== planned.length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { matches } = await api.createMatches(planned.map((p) => ({ ...p, type, notifyOffsetMin: offset })));
      qc.invalidateQueries({ queryKey: ['matches'] });
      toast.success(`${matches.length} matches scheduled. Pick each squad before its alert.`);
      nav('/matches');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Link to="/matches/new" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" aria-hidden />Single match</Link>
      <PageHeader eyebrow="Bulk add" title="Add several matches">
        Each one gets its own time and alert. Leave the map as "Not decided" and set it later.
      </PageHeader>

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Date (IST)"><input type="date" className="input [color-scheme:dark]" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
              <Field label="Type">
                <select className="input" value={type} onChange={(e) => setType(e.target.value as 'scrim' | 'tournament')}>
                  <option value="scrim">Scrim</option><option value="tournament">Tournament</option>
                </select>
              </Field>
              <Field label="Notify before (min)"><input type="number" min={0} max={120} className="input" value={offset} onChange={(e) => setOffset(Number(e.target.value))} /></Field>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <Repeat className="h-4 w-4 text-ember-400" aria-hidden />
              <span className="text-sm text-zinc-200">Repeat daily for</span>
              <div role="radiogroup" aria-label="Days" className="flex gap-1">
                {[1, 2, 3, 5, 7].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={days === n} onClick={() => setDays(n)}
                    className={cx('h-8 min-w-8 rounded-lg px-2 text-sm font-semibold', days === n ? 'bg-ember-500 text-ink-950' : 'bg-white/5 text-zinc-300 hover:bg-white/10')}>{n}</button>
                ))}
              </div>
              <span className="text-sm text-zinc-400">day{days > 1 ? 's' : ''}</span>
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-white">Matches</h2>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p.label} type="button" onClick={() => usePreset(p.times)} className="chip bg-white/5 text-zinc-300 ring-1 ring-white/10 hover:text-white">
                    <Zap className="h-3 w-3 text-ember-400" aria-hidden />{p.label}
                  </button>
                ))}
              </div>
            </div>
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {rows.map((r, i) => (
                  <motion.li key={r.key} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30 }}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-xl border border-white/[0.06] bg-ink-900/60 p-2 sm:grid-cols-[2rem_7.5rem_1fr_10rem_auto]">
                    <span className="hidden text-center font-mono text-xs text-zinc-500 sm:block">{i + 1}</span>
                    <input type="time" aria-label={`Match ${i + 1} time`} className="input [color-scheme:dark]" value={r.time} onChange={(e) => update(r.key, { time: e.target.value })} required />
                    <input aria-label={`Match ${i + 1} title`} className="input" value={r.title} onChange={(e) => update(r.key, { title: e.target.value })} maxLength={60} />
                    <select aria-label={`Match ${i + 1} map`} className={cx('input col-span-2 sm:col-span-1', r.map === MAP_TBD && 'text-zinc-400')} value={r.map}
                      onChange={(e) => update(r.key, { map: e.target.value as MatchMap })}>
                      <option value={MAP_TBD}>Not decided</option>
                      {MAPS.map((m) => <option key={m} value={m}>{m}{team?.drops[m] ? ` · ${team.drops[m]}` : ''}</option>)}
                    </select>
                    <button type="button" aria-label={`Remove match ${i + 1}`} disabled={rows.length === 1}
                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      className="grid h-10 w-10 place-items-center rounded-lg text-zinc-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            <Button type="button" variant="ghost" className="mt-3" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={addRow} disabled={rows.length >= 12}>Add another</Button>
          </Card>
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <Card glow>
            <p className="eyebrow flex items-center gap-1.5"><CalendarRange className="h-3.5 w-3.5" aria-hidden />Preview</p>
            <p className="mt-2 font-display text-3xl font-bold text-white">{planned.length} match{planned.length === 1 ? '' : 'es'}</p>
            <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1 text-sm">
              {planned.map((p) => (
                <li key={p.startAt + p.title} className={cx('flex items-center justify-between gap-2 rounded-lg px-2 py-1.5', new Date(p.startAt).getTime() < Date.now() ? 'bg-red-500/10 text-red-200' : 'bg-white/[0.03]')}>
                  <span className="truncate"><span className="text-zinc-500">{dayIST(p.startAt)}</span> · <b className="text-white">{timeIST(p.startAt)}</b> · {p.title}</span>
                  <span className={cx('shrink-0 text-xs', p.map === MAP_TBD ? 'text-zinc-500' : 'text-ember-300')}>{mapLabel(p.map)}</span>
                </li>
              ))}
            </ul>
            {past.length > 0 && <p className="mt-3 text-xs text-red-300">{past.length} time{past.length > 1 ? 's are' : ' is'} already past. Change the date or times.</p>}
            {dupTimes && <p className="mt-3 text-xs text-red-300">Two matches share a start time.</p>}
            <p className="mt-3 text-xs text-zinc-400">Each alert fires {offset} min before its match, only to the 4 you pick for it.</p>
            <Button type="submit" loading={busy} disabled={!planned.length || past.length > 0 || dupTimes || planned.length > 40} className="mt-4 w-full py-3">
              Schedule {planned.length} match{planned.length === 1 ? '' : 'es'}
            </Button>
          </Card>
        </div>
      </form>
    </div>
  );
}
