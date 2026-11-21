import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Ban, CheckCircle2, Copy, CopyPlus, Crown, ImageUp, KeyRound, MapPin, Pencil, Radio, RefreshCw, Repeat, Send, Swords, Trash2, Trophy, X,
} from 'lucide-react';
import { api, readScorecardWithProgress } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { fullIST, timeIST, ago } from '@/lib/time';
import { list } from '@/lib/motion';
import type { Match, MatchReport, Member, NotificationLog, ScorecardRow } from '@/lib/types';
import { mapLabel } from '@/lib/types';
import { Avatar, Button, Card, LockBadge, PageHeader, Skeleton, StatusChip, cx } from '@/components/ui';
import { MapArt } from '@/components/MapArt';
import { FlipCountdown } from '@/components/FlipCountdown';
import { NotifyChips } from '@/components/MatchCard';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/Toast';
import { JoinButton } from './Dashboard';
import { AVAIL_STYLE } from '@/components/CheckinBoard';

export default function MatchDetail() {
  const { id = '' } = useParams();
  const { isCaptain, team } = useAuth();
  const q = useQuery({ queryKey: ['match', id], queryFn: () => api.match(id).then((r) => r.match), refetchInterval: 10_000 });
  const m = q.data;
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-60" /><Skeleton className="h-40" /></div>;
  if (!m) return <EmptyState title="Match not found" text="It may have been removed, or you are not in this squad." action={<Link to="/" className="btn-ghost">Home</Link>} />;
  const members = [...(team?.members ?? [])];
  const byId = new Map(members.map((p) => [p.id, p]));
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
                    <Avatar name={p?.ign ?? '??'} size={32} dim={bench} />
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

        {isCaptain && <MatchLogs m={m} />}
        {started && (isCaptain ? <ReportCard m={m} members={members} /> : <ResultsCard m={m} members={members} />)}
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
      {[['Room', m.roomId], ['Pass', m.roomPassword || '-']].map(([k, v]) => (
        <button key={k} onClick={() => copy(v)} className="flex items-center gap-2 rounded-xl bg-black/50 px-3 py-2 ring-1 ring-ember-400/30 hover:ring-ember-400/60" aria-label={`Copy ${k}`}>
          <KeyRound className="h-4 w-4 text-ember-400" aria-hidden />
          <span className="text-xs uppercase tracking-wider text-zinc-400">{k}</span>
          <span className="font-mono font-bold text-white">{v}</span>
          <Copy className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
        </button>
      ))}
    </div>
  );
}

function CaptainActions({ m, members }: { m: Match; members: Member[] }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
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
        <Link to={`/matches/new?from=${m.id}`} className="btn-ghost"><CopyPlus className="h-4 w-4" aria-hidden />Duplicate</Link>
        {!done && !m.locked && (
          <Button variant="primary" loading={busy === 'send'} disabled={!m.squad?.confirmed} icon={<Send className="h-4 w-4" aria-hidden />}
            title={m.squad?.confirmed ? undefined : 'Confirm the squad first'}
            onClick={() => run('send', () => api.sendNow(m.id), 'Sending to the selected 4 now')}>Send now</Button>
        )}
        {m.locked && !done && (
          <Button variant="ghost" loading={busy === 'resend'} disabled={!m.notifications?.failed && !m.notifications?.pending} icon={<RefreshCw className="h-4 w-4" aria-hidden />}
            onClick={() => run('resend', () => api.resendFailed(m.id), 'Retrying failed deliveries')}>Resend to failed</Button>
        )}
        {m.status === 'notified' || m.status === 'scheduled' ? (
          <Button variant="ghost" loading={busy === 'live'} icon={<Radio className="h-4 w-4" aria-hidden />}
            onClick={() => run('live', () => api.setStatus(m.id, 'live'), 'Marked live')}>Mark live</Button>
        ) : null}
        {m.status === 'live' && (
          <Button variant="ghost" loading={busy === 'done'} icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
            onClick={() => {
              const p = window.prompt('Final placement (1-25)? Leave empty to skip.');
              const n = p ? Number(p) : undefined;
              run('done', () => api.setStatus(m.id, 'done', n && n >= 1 && n <= 25 ? n : undefined), 'Match finished');
            }}>Finish</Button>
        )}
        <Button variant="danger" loading={busy === 'delete'} icon={<Trash2 className="h-4 w-4" aria-hidden />}
          onClick={() => {
            if (!window.confirm('Delete this match for everyone? Its squad, attendance and stats are removed from every player. This cannot be undone.')) return;
            setBusy('delete');
            api.deleteMatch(m.id).then(() => {
              toast.success('Match deleted');
              qc.removeQueries({ queryKey: ['match', m.id] });
              qc.invalidateQueries({ queryKey: ['matches'] });
              qc.invalidateQueries({ queryKey: ['mystats'] });
              nav('/matches');
            }, (e) => { toast.error(e); setBusy(null); });
          }}>Delete</Button>
        {!done && (
          <Button variant="danger" loading={busy === 'cancel'} icon={<Ban className="h-4 w-4" aria-hidden />}
            onClick={() => { if (window.confirm('Cancel this match? The scheduled alert will be removed.')) run('cancel', () => api.cancelMatch(m.id), 'Match cancelled').then(() => nav('/matches')); }}>Cancel</Button>
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

function MatchLogs({ m }: { m: Match }) {
  const q = useQuery({ queryKey: ['logs', m.id], queryFn: () => api.matchLogs(m.id).then((r) => r.logs), refetchInterval: m.locked ? 15_000 : false });
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Delivery log</h2>
        {q.data?.[0] && <span className="text-xs text-zinc-500">Last {ago(q.data[0].sentAt)}</span>}
      </div>
      {q.isLoading ? <Skeleton className="h-24" /> : q.data?.length ? <DeliveryList logs={q.data} /> :
        <p className="text-sm text-zinc-400">{m.squad?.confirmed ? `Nothing sent yet. Alert fires at ${timeIST(m.notifyAt)}.` : 'Nothing sent yet.'}</p>}
    </Card>
  );
}

/** One line per player: Sent if any channel reached them, otherwise Failed. */
function DeliveryList({ logs }: { logs: NotificationLog[] }) {
  const rows = useMemo(() => {
    const by = new Map<string, { name: string; captain: boolean; sent: boolean }>();
    for (const l of logs) {
      const k = `${l.userId}:${l.kind}`;
      const cur = by.get(k) ?? { name: l.user?.ign ?? 'Player', captain: l.kind === 'captain_alert', sent: false };
      cur.sent ||= l.status === 'sent';
      by.set(k, cur);
    }
    return [...by.entries()];
  }, [logs]);
  return (
    <ul className="divide-y divide-white/5">
      {rows.map(([k, r]) => (
        <li key={k} className="flex items-center justify-between gap-3 py-2.5">
          <span className="min-w-0 truncate font-semibold text-white">{r.name}{r.captain && <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-300">Captain alert</span>}</span>
          {r.sent ? <StatusChip status="sent">Sent</StatusChip> : <StatusChip status="failed">Failed</StatusChip>}
        </li>
      ))}
    </ul>
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
  const [unmatched, setUnmatched] = useState<ScorecardRow[]>([]);
  const [busy, setBusy] = useState<'read' | 'save' | null>(null);
  const [dirty, setDirty] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);
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
    setDirty(false);
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const { score, mvp } = useMemo(() => mvpScores(rows), [rows]);
  const set = (id: string, patch: Partial<Row>) => { setDirty(true); setRows((r) => ({ ...r, [id]: { ...(r[id] ?? { joined: true, kills: 0, damage: 0, survivalMin: 0, assists: 0 }), ...patch } })); };
  const fromCard = (c: ScorecardRow): Partial<Row> => ({ joined: true, kills: c.finishes, damage: c.damage, survivalMin: c.survivedMin, assists: c.assists });

  async function upload(file: File) {
    setBusy('read');
    setReadErr(null);
    setWaited(0);
    try {
      const { rows: read } = await readScorecardWithProgress(m.id, await toDataUrl(file), setWaited);
      const matched = read.filter((r) => r.userId);
      for (const r of matched) set(r.userId!, fromCard(r));
      setUnmatched(read.filter((r) => !r.userId));
      toast.success(`Read ${read.length} players${matched.length < read.length ? `, ${read.length - matched.length} need a name picked` : ''}. Check the numbers, then Save.`);
    } catch (e) {
      setReadErr((e as Error).message || 'Could not read the screenshot');
      toast.error(e);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save() {
    setBusy('save');
    try {
      const entries = Object.entries(rows);
      await api.saveAttendance(m.id, entries.map(([userId, r]) => ({ userId, joined: r.joined })));
      const res = await api.saveStats(m.id, entries.map(([userId, r]) => ({
        userId, kills: r.kills, damage: r.damage, survivalMin: r.survivalMin, assists: r.assists,
      })));
      toast.success(res.mvpUserId ? `Saved. MVP: ${byId.get(res.mvpUserId)?.ign ?? 'player'}` : 'Saved');
      qc.invalidateQueries({ queryKey: ['report', m.id] });
      qc.invalidateQueries({ queryKey: ['mystats'] });
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  }

  const ids = Object.keys(rows);
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
        <p className="mb-3 text-xs text-zinc-400">Google's free reader is slow right now. It keeps trying for up to about 2 minutes. You can keep this page open.</p>
      )}
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
      <p className="mb-3 text-xs text-zinc-400">Upload the BGMI results screen and the numbers fill in automatically. Check them, fix anything wrong, then Save. MVP: finishes 40%, damage 30%, survival 20%, assists 10% (the screen has no knockouts, so assists count instead).</p>

      {unmatched.length > 0 && (
        <div className="mb-3 space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
          <p className="text-sm font-semibold text-amber-200">Couldn't match these names to a player. Pick who they are:</p>
          {unmatched.map((u, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-white">{u.name}</span>
              <span className="text-zinc-400">{u.finishes} kills · {u.damage} dmg</span>
              <select aria-label={`Who is ${u.name}`} className="input w-auto py-1.5" value="" onChange={(e) => {
                if (!e.target.value) return;
                set(e.target.value, fromCard(u));
                setUnmatched((list) => list.filter((_, j) => j !== i));
              }}>
                <option value="">Pick player…</option>
                {members.map((p) => <option key={p.id} value={p.id}>{p.ign}</option>)}
              </select>
              <button className="text-xs text-zinc-500 hover:text-white" onClick={() => setUnmatched((list) => list.filter((_, j) => j !== i))}>Ignore</button>
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
                return (
                  <tr key={id} className={cx('border-t border-white/5', mvp === id && 'bg-ember-500/10')}>
                    <td className="p-2 font-semibold text-white">{ign}{mvp === id && <span className="ml-2 inline-flex items-center gap-1 text-xs font-bold text-ember-300"><Crown className="h-3.5 w-3.5" aria-hidden />MVP</span>}</td>
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

/** What players see after the match: kills, damage and the MVP. */
function ResultsCard({ m, members }: { m: Match; members: Member[] }) {
  const q = useQuery({ queryKey: ['report', m.id], queryFn: () => api.report(m.id) });
  const data: MatchReport | undefined = q.data;
  const stats = [...(data?.stats ?? [])].sort((a, b) => b.mvpScore - a.mvpScore);
  const ign = (id: string) => members.find((p) => p.id === id)?.ign ?? 'Player';
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-xl font-bold text-white"><Trophy className="h-5 w-5 text-ember-400" aria-hidden />Match results</h2>
      {q.isLoading ? <Skeleton className="h-24" /> : !stats.length ? <p className="text-sm text-zinc-400">Results aren't posted yet.</p> : (
        <ul className="divide-y divide-white/5">
          {stats.map((s) => (
            <li key={s.userId} className={cx('flex items-center justify-between gap-3 py-2.5', s.mvp && 'text-ember-200')}>
              <span className="flex min-w-0 items-center gap-2 font-semibold text-white">
                {s.mvp && <Crown className="h-4 w-4 text-ember-300" aria-label="MVP" />}{ign(s.userId)}
              </span>
              <span className="text-sm text-zinc-300">{s.kills} kills · {s.damage} dmg</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
