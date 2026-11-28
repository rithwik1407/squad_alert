import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Ban, CheckCircle2, Copy, Crown, Eye, Loader2, ImageUp, KeyRound, MapPin, Pencil, Radio, RefreshCw, Repeat, Send, Swords, Trash2, Trophy, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isNotResultsError, pendingRead, startRead } from '@/lib/scorecardUpload';
import { matchPoints, pointsLine } from '@/lib/points';
import { useAuth } from '@/context/AuthContext';
import { fullIST } from '@/lib/time';
import { list } from '@/lib/motion';
import type { GuestStat, Match, MatchReport, Member, ScorecardRow } from '@/lib/types';
import { mapLabel } from '@/lib/types';
import { Avatar, Button, Card, LockBadge, PageHeader, Skeleton, StatusChip, cx } from '@/components/ui';
import { OpenBgmiButton } from '@/components/OpenBgmi';
import { MapArt } from '@/components/MapArt';
import { FlipCountdown } from '@/components/FlipCountdown';
import { NotifyChips } from '@/components/MatchCard';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/Toast';
import { JoinButton } from './Dashboard';
import { AVAIL_STYLE } from '@/components/CheckinBoard';
import { Modal, useDialog } from '@/components/Modal';
import { OrganizerDetails } from '@/components/OrganizerCard';
import { ScrimEditor } from '@/components/ScrimEditor';
import { useSeriesFor } from '@/lib/useScrims';

export default function MatchDetail() {
  const { id = '' } = useParams();
  const { isCaptain, team } = useAuth();
  const q = useQuery({ queryKey: ['match', id], queryFn: () => api.match(id).then((r) => r.match), refetchInterval: 10_000 });
  const m = q.data;
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-60" /><Skeleton className="h-40" /></div>;
  if (!m) return <EmptyState title="Match not found" text="It may have been removed, or you are not in this squad." action={<Link to="/" className="btn-ghost">Home</Link>} />;
  const members = [...(team?.members ?? [])];
  // The admin can play too, so look them up as well (for names and profile photos).
  const everyone = team?.captain && !members.some((p) => p.id === team.captain!.id) ? [...members, team.captain] : members;
  const byId = new Map(everyone.map((p) => [p.id, p]));
  const upcoming = new Date(m.startAt).getTime() > Date.now() && !['cancelled', 'done'].includes(m.status);
  // Attendance and stats only appear once the match start time has passed.
  const started = new Date(m.startAt).getTime() <= Date.now() && m.status !== 'cancelled';

  return (
    <div>
      <Link to={isCaptain ? '/matches' : '/'} className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" aria-hidden />Back</Link>
      <motion.div variants={list} initial="initial" animate="animate" className="space-y-6">
        <Card glow className="overflow-hidden p-0 sm:p-0">
          <div className="absolute inset-0 opacity-60"><MapArt map={m.map} /></div>
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/80 to-ink-950/20" />
          <div className="relative p-5 sm:p-7">
            <div className="flex flex-wrap gap-1.5">
              <StatusChip status={m.status} />
              {m.locked && <LockBadge />}
              <span className="chip bg-white/5 capitalize text-zinc-300 ring-1 ring-white/10">{m.type}{m.tournamentName ? ` · ${m.tournamentName}` : ''}</span>
            </div>
            <div className="h-3" />
            <PageHeader title={m.title}>{fullIST(m.startAt)} IST · {mapLabel(m.map)}</PageHeader>
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div className="space-y-2">
                {m.drop && <p className="flex items-center gap-2 text-sm text-zinc-200"><MapPin className="h-4 w-4 text-ember-400" aria-hidden />Drop: <b>{m.drop}</b></p>}
                {isCaptain || m.inSquad ? <RoomBox m={m} /> : <p className="text-sm text-zinc-400">Room ID and password go to the picked squad.</p>}
                {!isCaptain && <JoinButton m={m} />}
              </div>
              {upcoming && <FlipCountdown target={m.startAt} />}
            </div>
          </div>
        </Card>

        <SeriesCard name={m.tournamentName} />

        {isCaptain && <CaptainActions m={m} members={members} />}

        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold text-white">Squad</h2>
            {m.squad ? (m.squad.confirmed ? <StatusChip status="sent">Confirmed</StatusChip> : <StatusChip status="pending">Draft</StatusChip>) : <StatusChip status="pending">Not picked</StatusChip>}
          </div>
          {m.squad ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[...m.squad.selectedIds, ...(m.squad.benchedId ? [m.squad.benchedId] : [])].map((pid) => {
                const p = byId.get(pid);
                const bench = pid === m.squad!.benchedId;
                const joining = m.joining.includes(pid);
                const avail = m.availability[pid];
                return (
                  <li key={pid} className={cx('flex items-center gap-2 rounded-xl border p-2.5', bench ? 'border-white/5 opacity-50 grayscale' : 'border-ember-400/25 bg-ember-500/5')}>
                    <Avatar name={p?.ign ?? '??'} src={p?.avatar} size={32} dim={bench} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{p?.ign ?? 'Player'}</p>
                      {bench ? <p className="text-[10px] uppercase tracking-wider text-zinc-400">Bench</p>
                        : joining ? <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300"><CheckCircle2 className="h-3 w-3" aria-hidden />Joining</p>
                        : isCaptain && avail ? <p className={cx('text-[10px] font-semibold uppercase tracking-wider', AVAIL_STYLE[avail].cls.split(' ').find((c) => c.startsWith('text-')))}>{AVAIL_STYLE[avail].label}</p>
                        : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-zinc-400">No squad yet.</p>}
          {isCaptain && !m.locked && upcoming && (
            <Link to={`/matches/${m.id}/squad`} className="btn-primary mt-4"><Swords className="h-4 w-4" aria-hidden />{m.squad ? 'Change squad' : 'Pick squad'}</Link>
          )}
        </Card>

        {started && (isCaptain ? <ReportCard m={m} members={members} /> : <ResultsCard m={m} members={everyone} />)}
        {isCaptain && <DeleteMatch m={m} />}
      </motion.div>
    </div>
  );
}

function RoomBox({ m }: { m: Match }) {
  const toast = useToast();
  if (!m.roomId) return <p className="text-sm text-zinc-400">Room details not posted yet.</p>;
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success('Copied'));
  return (
    <div className="flex flex-wrap gap-2">
      {[['Room', m.roomId], ['Pass', m.roomPassword || '-'], ...(m.slot ? [['Slot', m.slot]] : [])].map(([k, v]) => (
        <button key={k} onClick={() => copy(v)} className="flex items-center gap-2 rounded-xl bg-black/50 px-3 py-2 ring-1 ring-ember-400/30 hover:ring-ember-400/60" aria-label={`Copy ${k}`}>
          <KeyRound className="h-4 w-4 text-ember-400" aria-hidden />
          <span className="text-xs uppercase tracking-wider text-zinc-400">{k}</span>
          <span className="font-mono font-bold text-white">{v}</span>
          <Copy className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
        </button>
      ))}
      <OpenBgmiButton copy={m.roomId} className="w-full sm:w-auto" />
    </div>
  );
}

/** Deleting is kept apart from the everyday controls so it isn't tapped by mistake. */
function DeleteMatch({ m }: { m: Match }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 border-red-500/20">
      <div>
        <h2 className="text-base font-bold text-white">Delete match</h2>
        <p className="text-xs text-zinc-400">Removes it for everyone, with its squad, attendance, stats and screenshot.</p>
      </div>
      <Button variant="danger" loading={busy} icon={<Trash2 className="h-4 w-4" aria-hidden />}
        onClick={async () => {
          if (!(await dialog.confirm('Delete this match for everyone?', { text: 'Its squad, attendance and stats are removed from every player. This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
          setBusy(true);
          api.deleteMatch(m.id).then(() => {
            toast.success('Match deleted');
            qc.removeQueries({ queryKey: ['match', m.id] });
            qc.invalidateQueries({ queryKey: ['matches'] });
            qc.invalidateQueries({ queryKey: ['mystats'] });
            qc.invalidateQueries({ queryKey: ['calendar'] });
            nav('/matches');
          }, (e) => { toast.error(e); setBusy(false); });
        }}>Delete</Button>
    </Card>
  );
}

/** Eye button for the saved results screenshot; tap to see it full size. */
function ScreenshotThumb({ matchId, at }: { matchId: string; at: string | null }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['screenshot', matchId, at], queryFn: () => api.screenshot(matchId), enabled: Boolean(at), staleTime: Infinity });
  if (!at) return null;
  return (
    <>
      <button onClick={() => q.data && setOpen(true)} disabled={!q.data} aria-label="View results screenshot" title="View results screenshot"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.06] text-zinc-200 ring-1 ring-white/10 transition-colors hover:bg-ember-500/15 hover:text-ember-300 hover:ring-ember-400/50 disabled:opacity-50">
        {q.data ? <Eye className="h-5 w-5" aria-hidden /> : <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      </button>
      {open && q.data && createPortal(
        <motion.div role="dialog" aria-modal="true" aria-label="Results screenshot" className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-3" onClick={() => setOpen(false)}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
          <button aria-label="Close" className="absolute right-3 top-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }} onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
          <motion.img src={q.data.image} alt="Results screenshot" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }} />
        </motion.div>,
        document.body,
      )}
    </>
  );
}

function CaptainActions({ m, members }: { m: Match; members: Member[] }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [subOut, setSubOut] = useState('');
  const [subIn, setSubIn] = useState('');
  const done = ['cancelled', 'done'].includes(m.status);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['match', m.id] });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['match', m.id] });
        qc.invalidateQueries({ queryKey: ['logs', m.id] });
      }, 2500);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const bench = members.filter((p) => !m.squad?.selectedIds.includes(p.id));
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-white">Controls</h2>
        <NotifyChips m={m} />
      </div>
      <div className="flex flex-wrap gap-2">
        {!done && <Link to={`/matches/${m.id}/edit`} className="btn-ghost"><Pencil className="h-4 w-4" aria-hidden />{m.map === 'TBD' ? 'Set map / edit' : 'Edit'}</Link>}
        {!done && !m.locked && (
          <Button variant="primary" loading={busy === 'send'} disabled={!m.squad?.confirmed} icon={<Send className="h-4 w-4" aria-hidden />}
            title={m.squad?.confirmed ? undefined : 'Confirm the squad first'}
            onClick={() => run('send', () => api.sendNow(m.id), 'Sending to the selected 4 now')}>Send now</Button>
        )}
        {m.locked && !done && (
          <Button variant="ghost" loading={busy === 'resend'} disabled={!m.notifications?.failed && !m.notifications?.pending} icon={<RefreshCw className="h-4 w-4" aria-hidden />}
            onClick={() => run('resend', () => api.resendFailed(m.id), 'Retrying failed deliveries')}>Resend to failed</Button>
        )}
        {/* Matches go live by themselves at the IDP time; this is only for starting early. */}
        {m.status === 'notified' || m.status === 'scheduled' ? (
          <Button variant="ghost" loading={busy === 'live'} icon={<Radio className="h-4 w-4" aria-hidden />}
            onClick={() => run('live', () => api.setStatus(m.id, 'live'), 'Marked live')}>Mark live</Button>
        ) : null}
        {m.status === 'live' && (
          <Button variant="ghost" loading={busy === 'done'} icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
            onClick={async () => {
              const p = await dialog.prompt('Finish match', { text: 'Final placement (1-25)? Leave empty to skip.', placeholder: 'e.g. 3', inputMode: 'numeric', confirmLabel: 'Finish' });
              if (p === null) return;
              const n = p ? Number(p) : undefined;
              run('done', () => api.setStatus(m.id, 'done', n && n >= 1 && n <= 25 ? n : undefined), 'Match finished');
            }}>Finish</Button>
        )}
        {!done && (
          <Button variant="danger" loading={busy === 'cancel'} icon={<Ban className="h-4 w-4" aria-hidden />}
            onClick={async () => { if (await dialog.confirm('Cancel this match?', { text: 'The scheduled alert will be removed.', confirmLabel: 'Cancel match', danger: true })) run('cancel', () => api.cancelMatch(m.id), 'Match cancelled').then(() => nav('/matches')); }}>Cancel</Button>
        )}
      </div>

      {m.squad?.confirmed && !done && (
        <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-white"><Repeat className="h-4 w-4 text-ember-400" aria-hidden />Emergency substitution</p>
          <p className="mt-1 text-xs text-zinc-400">{m.locked ? 'Works after the lock. Only the incoming player gets alerted, right away.' : 'Swap before the alert goes out. The scheduled alert will use the new squad.'}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select aria-label="Player out" className="input" value={subOut} onChange={(e) => setSubOut(e.target.value)}>
              <option value="">Player out…</option>
              {m.squad.selectedIds.map((id) => <option key={id} value={id}>{members.find((p) => p.id === id)?.ign ?? id}</option>)}
            </select>
            <select aria-label="Player in" className="input" value={subIn} onChange={(e) => setSubIn(e.target.value)}>
              <option value="">Player in…</option>
              {bench.map((p) => <option key={p.id} value={p.id}>{p.ign}</option>)}
            </select>
            <Button variant="ghost" disabled={!subOut || !subIn} loading={busy === 'sub'}
              onClick={() => run('sub', () => api.substitute(m.id, subOut, subIn), m.locked ? 'Sub in. Alerting them now.' : 'Squad updated').then(() => { setSubIn(''); setSubOut(''); })}>Swap</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------- Attendance, stats and MVP ---------- */

/** Same weighting as the server: finishes 40%, damage 30%, survival 20%, assists (in place of knockouts) 10%, each vs the squad best. */
const W = { kills: 0.4, damage: 0.3, survivalMin: 0.2, assists: 0.1 } as const;
type Row = { joined: boolean; kills: number; damage: number; survivalMin: number; assists: number };

function mvpScores(rows: Record<string, Row>) {
  const ids = Object.keys(rows);
  const keys = Object.keys(W) as (keyof typeof W)[];
  const max = Object.fromEntries(keys.map((k) => [k, Math.max(0, ...ids.map((id) => rows[id][k] || 0))])) as Record<keyof typeof W, number>;
  const score: Record<string, number> = {};
  for (const id of ids) score[id] = Math.round(keys.reduce((a, k) => a + (max[k] ? ((rows[id][k] || 0) / max[k]) * W[k] : 0), 0) * 1000) / 10;
  const best = [...ids].sort((a, b) => score[b] - score[a] || rows[b].kills - rows[a].kills || rows[b].damage - rows[a].damage)[0];
  return { score, mvp: best && score[best] > 0 ? best : null };
}

/** Shrink the screenshot before upload so it stays small on slow mobile data. */
async function toDataUrl(file: File, maxW = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, maxW / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ReportCard({ m, members }: { m: Match; members: Member[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['report', m.id], queryFn: () => api.report(m.id) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  /** Players on the results who aren't on our team: kept on this match only (never in stats or the team). */
  const [guests, setGuests] = useState<GuestStat[]>([]);
  const [busy, setBusy] = useState<'read' | 'save' | null>(null);
  const [dirty, setDirty] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);
  const [place, setPlace] = useState('');
  /** The last screenshot read had no squad position on it: ask the admin to type it in. */
  const [noPlace, setNoPlace] = useState(false);
  const byId = new Map(members.map((p) => [p.id, p]));

  useEffect(() => {
    if (!q.data) return;
    const ids = [...new Set([...(m.squad?.selectedIds ?? []), ...q.data.stats.map((s) => s.userId)])];
    const next: Record<string, Row> = {};
    for (const id of ids) {
      const a = q.data.attendance.find((x) => x.userId === id);
      const s = q.data.stats.find((x) => x.userId === id);
      next[id] = { joined: a?.joined ?? true, kills: s?.kills ?? 0, damage: s?.damage ?? 0, survivalMin: s?.survivalMin ?? 0, assists: s?.assists ?? 0 };
    }
    setRows(next);
    setPlace(q.data.placement ? String(q.data.placement) : '');
    setGuests(q.data.guests ?? []);
    setDirty(false);
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only players who played are scored: un-ticked rows aren't in the results.
  const { score, mvp } = useMemo(() => mvpScores(Object.fromEntries(Object.entries(rows).filter(([, r]) => r.joined))), [rows]);
  const setGuest = (i: number, patch: Partial<GuestStat>) => { setDirty(true); setGuests((g) => g.map((x, j) => (j === i ? { ...x, ...patch } : x))); };
  const toGuest = (c: ScorecardRow): GuestStat => ({ name: c.name, kills: c.finishes, damage: c.damage, survivalMin: c.survivedMin, assists: c.assists });
  const set = (id: string, patch: Partial<Row>) => { setDirty(true); setRows((r) => ({ ...r, [id]: { ...(r[id] ?? { joined: true, kills: 0, damage: 0, survivalMin: 0, assists: 0 }), ...patch } })); };
  const fromCard = (c: ScorecardRow): Partial<Row> => ({ joined: true, kills: c.finishes, damage: c.damage, survivalMin: c.survivedMin, assists: c.assists });

  const [notResults, setNotResults] = useState(false);

  /** Show progress and results for a read, whether it started now or before the admin left this page. */
  async function follow(read: ReturnType<typeof startRead>) {
    readRef.current = read;
    setBusy('read');
    setReadErr(null);
    setWaited(read.seconds);
    read.listeners.add(setWaited);
    try {
      const { rows: got, placement } = await read.promise;
      if (!mounted.current) return;
      const matched = got.filter((r) => r.userId);
      for (const r of matched) set(r.userId!, fromCard(r));
      // Squad players who aren't on the results screen didn't play this match: un-tick them (the admin can tick back).
      if (matched.length) {
        const onScreen = new Set(matched.map((r) => r.userId!));
        setRows((rs) => Object.fromEntries(Object.entries(rs).map(([id, r]) => [id, onScreen.has(id) ? r : { ...r, joined: false }])));
      }
      if (placement) setPlace(String(placement));
      setNoPlace(!placement);
      setDirty(false);
      const outside = got.filter((r) => !r.userId);
      setGuests(outside.map(toGuest));
      const kills = got.reduce((a, r) => a + r.finishes, 0);
      toast.success(`Read ${got.length} players and saved ${matched.length}${outside.length ? `. ${outside.length} not on the team ${outside.length === 1 ? 'is' : 'are'} kept on this match only` : ''}. `
        + (placement ? `Points ${pointsLine(placement, kills)}. ` : 'No position on the screenshot: type it in. ')
        + 'Fix anything wrong, then Save.');
    } catch (e) {
      if (!mounted.current) return;
      if (isNotResultsError(e)) setNotResults(true);
      else { setReadErr((e as Error).message || 'Could not read the screenshot'); toast.error(e); }
    } finally {
      read.listeners.delete(setWaited);
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function upload(file: File) {
    setBusy('read');
    let image: string;
    try { image = await toDataUrl(file); } catch {
      setBusy(null);
      setNotResults(true);
      return;
    }
    follow(startRead(m.id, image, qc, toast));
  }

  // Came back to this match while a read was still going: pick it up again. On leaving, stop listening
  // so the read reports its result with a toast instead (it keeps going either way).
  const mounted = useRef(true);
  const readRef = useRef<ReturnType<typeof startRead> | null>(null);
  useEffect(() => {
    mounted.current = true;
    const read = pendingRead(m.id);
    if (read) follow(read);
    return () => {
      mounted.current = false;
      readRef.current?.listeners.delete(setWaited);
    };
  }, [m.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy('save');
    try {
      const entries = Object.entries(rows);
      await api.saveAttendance(m.id, entries.map(([userId, r]) => ({ userId, joined: r.joined })));
      const p = Number(place);
      // Only players who played go into the results. Anyone un-ticked or removed didn't play that match,
      // so their matches-played count doesn't go up (the server marks the rest of the squad as not played).
      const res = await api.saveStats(m.id, entries.filter(([, r]) => r.joined).map(([userId, r]) => ({
        userId, kills: r.kills, damage: r.damage, survivalMin: r.survivalMin, assists: r.assists,
      })), p >= 1 && p <= 25 ? Math.round(p) : null, guests.map((g) => ({ ...g, name: g.name.trim().slice(0, 40) || 'Guest' })));
      toast.success(res.mvpUserId ? `Saved. MVP: ${byId.get(res.mvpUserId)?.ign ?? 'player'}` : 'Saved');
      qc.invalidateQueries({ queryKey: ['report', m.id] });
      qc.invalidateQueries({ queryKey: ['match', m.id] });
      qc.invalidateQueries({ queryKey: ['mystats'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  }

  const ids = Object.keys(rows);
  const placeNum = Number(place) >= 1 && Number(place) <= 25 ? Math.round(Number(place)) : null;
  const teamKills = ids.reduce((a, id) => a + (rows[id].joined ? rows[id].kills : 0), 0) + guests.reduce((a, g) => a + g.kills, 0);
  const addable = members.filter((p) => !rows[p.id]);
  const num = (v: string) => Math.max(0, Number(v) || 0);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold text-white"><Trophy className="h-5 w-5 text-ember-400" aria-hidden />Attendance & stats</h2>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        <Button variant="ghost" loading={busy === 'read'} icon={<ImageUp className="h-4 w-4" aria-hidden />} onClick={() => fileRef.current?.click()}>
          {busy === 'read' ? `Reading screenshot…${waited >= 5 ? ` ${waited}s` : ''}` : 'Upload results screenshot'}
        </Button>
      </div>
      {busy === 'read' && waited >= 10 && (
        <p className="mb-3 text-xs text-zinc-400">The free readers are slow right now. It keeps trying (Google, then the backups) for up to about 3 minutes. You can leave this page: the stats are saved when it finishes.</p>
      )}
      <Modal open={notResults} onClose={() => setNotResults(false)} labelledBy="nr-title">
          <div className="text-center">
            <ImageUp className="mx-auto h-10 w-10 text-ember-400" aria-hidden />
            <h3 id="nr-title" className="mt-3 text-lg font-bold text-white">Match results screenshot only</h3>
            <p className="mt-2 text-sm text-zinc-300">That image isn't a BGMI match results screen. Upload the screenshot of the results table that shows Player, Finishes, Assists, Damage and Survived.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={() => { setNotResults(false); fileRef.current?.click(); }}>Choose another</Button>
              <Button variant="ghost" onClick={() => setNotResults(false)}>Close</Button>
            </div>
          </div>
      </Modal>
      {readErr && busy !== 'read' && (
        <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm">
          <div>
            <p className="font-semibold text-red-200">Couldn't read the screenshot</p>
            <p className="mt-0.5 text-red-200/80">{readErr}</p>
            <p className="mt-1 text-zinc-300">You can type each player's kills, damage, survival and assists in the table below and tap Save. The MVP is still worked out for you.</p>
          </div>
          <button aria-label="Dismiss" className="rounded p-1 text-zinc-400 hover:text-white" onClick={() => setReadErr(null)}><X className="h-4 w-4" /></button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Position</span>
          <span className="flex items-center gap-1"><span className="font-display text-lg font-bold text-zinc-500">#</span>
            <input type="number" min={1} max={25} inputMode="numeric" aria-label="Squad position" placeholder="–" className="input w-20 py-1.5"
              value={place} onChange={(e) => { setDirty(true); setNoPlace(false); setPlace(e.target.value); }} /></span>
        </label>
        <PointsSummary placement={placeNum} kills={teamKills} />
        <ScreenshotThumb matchId={m.id} at={q.data?.screenshotAt ?? null} />
      </div>
      {noPlace && !place && (
        <p role="status" className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-2.5 text-xs text-amber-200">
          The screenshot didn't show the squad's position. Type it in above and Save so the points table gets the placement points.</p>
      )}
      <p className="mb-3 text-xs text-zinc-400">Only ticked players count as played. Un-tick or remove anyone who didn't play: their matches count won't go up. Upload the BGMI results screen and the numbers and position fill in automatically. Points: placement (#1 10, #2 6, #3 5, #4 4, #5 3, #6 2, #7-8 1) plus 1 per kill. Check them, fix anything wrong, then Save. MVP: finishes 40%, damage 30%, survival 20%, assists 10% (the screen has no knockouts, so assists count instead).</p>

      {guests.length > 0 && (
        <div className="mb-3 space-y-2 rounded-xl border border-sky-400/25 bg-sky-400/5 p-3">
          <p className="text-sm font-semibold text-sky-200">Not on the team</p>
          <p className="text-xs text-zinc-400">These players are kept on this match's results only, with their numbers. They never show in stats or on the team. If one is actually a teammate with a different name, pick who.</p>
          {guests.map((g, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="chip bg-sky-400/10 text-sky-200">Guest</span>
              <span className="min-w-0 truncate font-mono text-white">{g.name}</span>
              <label className="flex items-center gap-1 text-xs text-zinc-400">K<input type="number" min={0} max={99} aria-label={`${g.name} kills`} className="input w-14 py-1" value={g.kills} onChange={(e) => setGuest(i, { kills: num(e.target.value) })} /></label>
              <label className="flex items-center gap-1 text-xs text-zinc-400">Dmg<input type="number" min={0} max={9999} aria-label={`${g.name} damage`} className="input w-20 py-1" value={g.damage} onChange={(e) => setGuest(i, { damage: num(e.target.value) })} /></label>
              <label className="flex items-center gap-1 text-xs text-zinc-400">A<input type="number" min={0} max={99} aria-label={`${g.name} assists`} className="input w-14 py-1" value={g.assists} onChange={(e) => setGuest(i, { assists: num(e.target.value) })} /></label>
              <select aria-label={`Is ${g.name} a teammate`} className="input w-auto py-1" value="" onChange={(e) => {
                if (!e.target.value) return;
                set(e.target.value, { joined: true, kills: g.kills, damage: g.damage, survivalMin: g.survivalMin, assists: g.assists });
                setGuests((list) => list.filter((_, j) => j !== i));
              }}>
                <option value="">It's a teammate…</option>
                {members.map((p) => <option key={p.id} value={p.id}>{p.ign}</option>)}
              </select>
              <button aria-label={`Remove ${g.name}`} className="rounded p-1 text-zinc-500 hover:text-white" onClick={() => { setDirty(true); setGuests((list) => list.filter((_, j) => j !== i)); }}><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}

      {q.isLoading ? <Skeleton className="h-32" /> : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500">
              <th className="p-2">Player</th><th className="p-2">Joined</th><th className="p-2">Kills</th><th className="p-2">Damage</th>
              <th className="p-2">Survived (min)</th><th className="p-2">Assists</th><th className="p-2">Score</th><th className="p-2" />
            </tr></thead>
            <tbody>
              {ids.map((id) => {
                const r = rows[id];
                const ign = byId.get(id)?.ign ?? 'Player';
                const photo = byId.get(id)?.avatar;
                return (
                  <tr key={id} className={cx('border-t border-white/5', mvp === id && 'bg-ember-500/10', !r.joined && 'opacity-50')}>
                    <td className="p-2 font-semibold text-white"><span className="inline-flex items-center gap-2 align-middle"><Avatar name={ign} src={photo} size={24} />{ign}</span>{mvp === id && <span className="ml-2 inline-flex items-center gap-1 text-xs font-bold text-ember-300"><Crown className="h-3.5 w-3.5" aria-hidden />MVP</span>}{!r.joined && <span className="ml-2 text-xs font-medium text-zinc-400">Not played</span>}</td>
                    <td className="p-2"><input type="checkbox" aria-label={`${ign} joined`} className="h-4 w-4 accent-ember-500" checked={r.joined} onChange={(e) => set(id, { joined: e.target.checked })} /></td>
                    <td className="p-2"><input type="number" min={0} max={99} aria-label={`${ign} kills`} className="input w-16 py-1.5" value={r.kills} onChange={(e) => set(id, { kills: num(e.target.value) })} /></td>
                    <td className="p-2"><input type="number" min={0} max={9999} aria-label={`${ign} damage`} className="input w-20 py-1.5" value={r.damage} onChange={(e) => set(id, { damage: num(e.target.value) })} /></td>
                    <td className="p-2"><input type="number" min={0} max={60} step={0.1} aria-label={`${ign} minutes survived`} className="input w-20 py-1.5" value={r.survivalMin} onChange={(e) => set(id, { survivalMin: num(e.target.value) })} /></td>
                    <td className="p-2"><input type="number" min={0} max={99} aria-label={`${ign} assists`} className="input w-16 py-1.5" value={r.assists} onChange={(e) => set(id, { assists: num(e.target.value) })} /></td>
                    <td className="p-2 font-mono text-zinc-300">{score[id]?.toFixed(1) ?? '–'}</td>
                    <td className="p-2"><button aria-label={`Remove ${ign}`} className="rounded p-1 text-zinc-500 hover:text-white" onClick={() => { setDirty(true); setRows((rs) => { const n = { ...rs }; delete n[id]; return n; }); }}><X className="h-4 w-4" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!ids.length && <p className="p-2 text-sm text-zinc-400">No squad picked for this match. Upload the screenshot or add players below.</p>}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button loading={busy === 'save'} disabled={!ids.length} onClick={save}>{dirty ? 'Save stats' : 'Save'}</Button>
        {addable.length > 0 && (
          <select aria-label="Add a player" className="input w-auto py-2" value="" onChange={(e) => e.target.value && set(e.target.value, {})}>
            <option value="">Add player…</option>
            {addable.map((p) => <option key={p.id} value={p.id}>{p.ign}</option>)}
          </select>
        )}
      </div>
    </Card>
  );
}

/** Live points for the match while the admin edits: placement points + kill points. */
function PointsSummary({ placement, kills }: { placement: number | null; kills: number }) {
  const p = matchPoints(placement, kills);
  return (
    <div className="flex items-end gap-2 font-mono text-sm" aria-label={`Points: ${pointsLine(placement, kills)}`}>
      <span className="flex flex-col"><span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Place pts</span><span className="text-zinc-200">{p.placementPts}</span></span>
      <span className="pb-px text-zinc-600">+</span>
      <span className="flex flex-col"><span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Kill pts</span><span className="text-zinc-200">{p.killPts}</span></span>
      <span className="pb-px text-zinc-600">=</span>
      <span className="flex flex-col"><span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Total</span><span className="font-bold text-ember-300">{p.total}</span></span>
    </div>
  );
}

/** What players see after the match: kills, damage and the MVP. */
function ResultsCard({ m, members }: { m: Match; members: Member[] }) {
  const q = useQuery({ queryKey: ['report', m.id], queryFn: () => api.report(m.id) });
  const data: MatchReport | undefined = q.data;
  const stats = [...(data?.stats ?? [])].sort((a, b) => b.mvpScore - a.mvpScore);
  const guests = [...(data?.guests ?? [])].sort((a, b) => b.kills - a.kills || b.damage - a.damage);
  const kills = stats.reduce((a, s) => a + s.kills, 0) + guests.reduce((a, g) => a + g.kills, 0);
  // Picked teammates the admin left out of the results.
  const sat = (data?.attendance ?? []).filter((a) => !a.joined && !stats.some((s) => s.userId === a.userId)).map((a) => a.userId);
  const ign = (id: string) => members.find((p) => p.id === id)?.ign ?? 'Player';
  const photo = (id: string) => members.find((p) => p.id === id)?.avatar;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold text-white"><Trophy className="h-5 w-5 text-ember-400" aria-hidden />Match results</h2>
        <div className="flex items-center gap-3">
          {data?.placement ? <span className="chip bg-ember-500/15 text-ember-300">Position #{data.placement}</span> : null}
          {data && (data.placement || stats.length > 0 || guests.length > 0) ? (
            <span className="chip bg-white/[0.06] text-zinc-200" title={pointsLine(data.placement, kills)}>
              {matchPoints(data.placement, kills).total} pts
            </span>
          ) : null}
          <ScreenshotThumb matchId={m.id} at={data?.screenshotAt ?? null} />
        </div>
      </div>
      {q.isLoading ? <Skeleton className="h-24" /> : !stats.length && !guests.length ? <p className="text-sm text-zinc-400">Results aren't posted yet.</p> : (
        <>
        <ul className="divide-y divide-white/5">
          {stats.map((s) => (
            <li key={s.userId} className={cx('flex items-center justify-between gap-3 py-2.5', s.mvp && 'text-ember-200')}>
              <span className="flex min-w-0 items-center gap-2 font-semibold text-white">
                <Avatar name={ign(s.userId)} src={photo(s.userId)} size={28} />
                {s.mvp && <Crown className="h-4 w-4 text-ember-300" aria-label="MVP" />}<span className="truncate">{ign(s.userId)}</span>
              </span>
              <span className="text-sm text-zinc-300">{s.kills} kills · {s.damage} dmg</span>
            </li>
          ))}
          {guests.map((g, i) => (
            <li key={`g${i}`} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 font-semibold text-white">
                <Avatar name={g.name} size={28} />
                <span className="truncate">{g.name}</span>
                <span className="chip shrink-0 bg-sky-400/10 text-[10px] text-sky-200" title="Not on the team: shown on this match only">Guest</span>
              </span>
              <span className="text-right text-sm text-zinc-300">{g.kills} kills · {g.damage} dmg<span className="hidden sm:inline"> · {g.assists} ast · {g.survivalMin}m</span></span>
            </li>
          ))}
        </ul>
        {sat.length > 0 && <p className="mt-2 text-xs text-zinc-500">Not played: {sat.map(ign).join(', ')}</p>}
        </>
      )}
    </Card>
  );
}

/** Organizer contacts for this match's scrim series, so the room/slot Discord channel is one tap away. */
function SeriesCard({ name }: { name: string }) {
  const { series, canEdit, loading } = useSeriesFor(name);
  const [editing, setEditing] = useState(false);
  if (!name || loading || (!series && !canEdit)) return null;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow">Organizer</p>
          <h2 className="break-words text-xl font-bold text-white">{series?.name ?? name}</h2>
        </div>
        <div className="flex gap-2">
          {canEdit && series && <Button variant="ghost" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={() => setEditing(true)}>Edit</Button>}
          <Link to="/calendar?view=scrims" className="btn-ghost">All organizers</Link>
        </div>
      </div>
      {series ? <OrganizerDetails s={series} /> : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-white/10 p-3">
          <p className="text-sm text-zinc-400">No Discord link or contact saved for {name} yet.</p>
          <Button onClick={() => setEditing(true)}>Add organizer</Button>
        </div>
      )}
      <ScrimEditor open={editing} onClose={() => setEditing(false)} series={series} name={name} />
    </Card>
  );
}
