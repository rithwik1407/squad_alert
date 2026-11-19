import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, BellRing, Check, MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { MAPS, type MapName } from '@/lib/types';
import { fromISTInput, timeIST, toISTInput, fullIST } from '@/lib/time';
import { list, item, spring } from '@/lib/motion';
import { Button, Card, Field, PageHeader, Skeleton, cx } from '@/components/ui';
import { MapArt, mapTag } from '@/components/MapArt';
import { useToast } from '@/components/Toast';

function defaultStart() {
  // Next round half hour, at least 30 min out.
  const d = new Date(Date.now() + 30 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return toISTInput(d);
}

export default function MatchForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { team } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const existing = useQuery({ queryKey: ['match', id], queryFn: () => api.match(id!).then((r) => r.match), enabled: editing });

  const [title, setTitle] = useState('Scrim 1');
  const [type, setType] = useState<'scrim' | 'tournament'>('scrim');
  const [map, setMap] = useState<MapName>('Erangel');
  const [drop, setDrop] = useState<string>(team?.drops.Erangel ?? '');
  const [start, setStart] = useState(defaultStart());
  const [offset, setOffset] = useState(2);
  const [roomId, setRoomId] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [tournamentName, setTournamentName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const m = existing.data;
    if (!m) return;
    setTitle(m.title); setType(m.type); setMap(m.map); setDrop(m.drop); setStart(toISTInput(m.startAt));
    setOffset(m.notifyOffsetMin); setRoomId(m.roomId); setRoomPassword(m.roomPassword); setTournamentName(m.tournamentName);
  }, [existing.data]);

  const pickMap = (mp: MapName) => {
    setMap(mp);
    setDrop(team?.drops[mp] ?? '');
  };

  const startIso = start ? fromISTInput(start) : null;
  const notifyIso = startIso ? new Date(new Date(startIso).getTime() - offset * 60_000).toISOString() : null;
  const timeLocked = Boolean(existing.data?.locked);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!startIso) return;
    setBusy(true);
    const body = { title, type, map, drop, startAt: startIso, notifyOffsetMin: offset, roomId, roomPassword, tournamentName: type === 'tournament' ? tournamentName : '' };
    try {
      if (timeLocked) {
        delete (body as Partial<typeof body>).startAt;
        delete (body as Partial<typeof body>).notifyOffsetMin;
      }
      const { match } = editing ? await api.updateMatch(id!, body) : await api.createMatch(body);
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['match', match.id] });
      toast.success(editing ? 'Match updated, alert rescheduled' : `Scheduled. Alert at ${timeIST(match.notifyAt)}`);
      nav(editing ? `/matches/${match.id}` : `/matches/${match.id}/squad`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (editing && existing.isLoading) return <Skeleton className="h-96" />;

  return (
    <div>
      <Link to={editing ? `/matches/${id}` : '/matches'} className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" aria-hidden />Back</Link>
      <PageHeader eyebrow={editing ? 'Edit match' : 'New match'} title={editing ? title : 'Schedule a match'}>All times are IST (Asia/Kolkata).</PageHeader>

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <motion.div variants={list} initial="initial" animate="animate" className="space-y-6">
          <Card>
            <h2 className="mb-3 text-lg font-bold text-white">Map</h2>
            <div role="radiogroup" aria-label="Map" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {MAPS.map((mp) => (
                <motion.button key={mp} type="button" role="radio" aria-checked={map === mp} onClick={() => pickMap(mp)}
                  variants={item} whileHover={{ y: -3 }} whileTap={{ scale: 0.96 }} transition={spring}
                  className={cx('relative h-28 overflow-hidden rounded-xl text-left ring-1 transition-shadow', map === mp ? 'ring-2 ring-ember-400 shadow-glow' : 'ring-white/10')}>
                  <MapArt map={mp} />
                  <span className="absolute bottom-2 left-2.5">
                    <span className="block font-display text-lg font-bold leading-none text-white">{mp}</span>
                    <span className="text-[10px] text-zinc-300">{mapTag(mp)}{team?.drops[mp] ? ` · ${team.drops[mp]}` : ''}</span>
                  </span>
                  {map === mp && (
                    <motion.span layoutId="map-check" className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-ember-400 text-ink-950">
                      <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
                    </motion.span>
                  )}
                </motion.button>
              ))}
            </div>
            <div className="mt-4">
              <Field label="Drop location" hint={team?.drops[map] ? `Team default for ${map}: ${team.drops[map]}` : 'No team default for this map'}>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ember-400" aria-hidden />
                  <input className="input pl-9" value={drop} onChange={(e) => setDrop(e.target.value)} placeholder="e.g. Quarry" maxLength={30} />
                </div>
              </Field>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-bold text-white">Details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={60} /></Field>
              <Field label="Type">
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Type">
                  {(['scrim', 'tournament'] as const).map((t) => (
                    <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)}
                      className={cx('rounded-xl border px-3 py-2.5 text-sm font-semibold capitalize', type === t ? 'border-ember-400/60 bg-ember-500/10 text-ember-300' : 'border-white/10 text-zinc-400')}>{t}</button>
                  ))}
                </div>
              </Field>
              {type === 'tournament' && (
                <Field label="Tournament"><input className="input" value={tournamentName} onChange={(e) => setTournamentName(e.target.value)} placeholder="BGIS 2026" /></Field>
              )}
              <Field label="Start (IST)" hint={timeLocked ? 'Locked: the alert already went out' : undefined}>
                <input type="datetime-local" className="input [color-scheme:dark]" value={start} onChange={(e) => setStart(e.target.value)} required disabled={timeLocked} />
              </Field>
              <Field label="Notify before (minutes)">
                <input type="number" min={0} max={120} className="input" value={offset} onChange={(e) => setOffset(Number(e.target.value))} disabled={timeLocked} />
              </Field>
              <Field label="Room ID" hint="Can be added later, right before the match"><input className="input font-mono" value={roomId} onChange={(e) => setRoomId(e.target.value)} inputMode="numeric" /></Field>
              <Field label="Room password"><input className="input font-mono" value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} /></Field>
            </div>
          </Card>
        </motion.div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <Card glow>
            <p className="eyebrow">Alert preview</p>
            <div className="mt-3 rounded-2xl bg-ink-800/90 p-4 ring-1 ring-white/10">
              <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                <img src="/icons/icon.svg" alt="" className="h-4 w-4" />SquadSync · {notifyIso ? timeIST(notifyIso) : '--'}
              </div>
              <p className="mt-1.5 font-semibold text-white">Match in {offset} minute{offset === 1 ? '' : 's'}!</p>
              <p className="text-sm text-zinc-300">
                {title} · {map} · {startIso ? timeIST(startIso) : '--'}. Join the lobby now. Room: {roomId || 'TBA'}{roomId ? ` / Pass: ${roomPassword || '-'}` : ''}
              </p>
            </div>
            <p className="mt-4 flex items-start gap-2 text-sm text-zinc-300">
              <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-ember-400" aria-hidden />
              {notifyIso ? <>Fires {fullIST(notifyIso)} to the 4 selected players only.</> : 'Pick a start time.'}
            </p>
            <Button type="submit" loading={busy} className="mt-5 w-full py-3">{editing ? 'Save changes' : 'Schedule & pick squad'}</Button>
          </Card>
        </div>
      </form>
    </div>
  );
}
