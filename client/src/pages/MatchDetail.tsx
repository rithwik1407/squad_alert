import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Ban, CheckCircle2, Copy, KeyRound, MapPin, Pencil, Radio, RefreshCw, Repeat, Send, Swords, Trophy,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { fullIST, timeIST, ago } from '@/lib/time';
import { list } from '@/lib/motion';
import type { Match, Member } from '@/lib/types';
import { Avatar, Button, Card, LockBadge, PageHeader, Skeleton, StatusChip, cx } from '@/components/ui';
import { MapArt } from '@/components/MapArt';
import { FlipCountdown } from '@/components/FlipCountdown';
import { NotifyChips } from '@/components/MatchCard';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/Toast';
import { LogTable } from './Notifications';

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
            <PageHeader title={m.title}>{fullIST(m.startAt)} IST · {m.map}</PageHeader>
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div className="space-y-2">
                {m.drop && <p className="flex items-center gap-2 text-sm text-zinc-200"><MapPin className="h-4 w-4 text-ember-400" aria-hidden />Drop: <b>{m.drop}</b></p>}
                <RoomBox m={m} />
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
                return (
                  <li key={pid} className={cx('flex items-center gap-2 rounded-xl border p-2.5', bench ? 'border-white/5 opacity-50 grayscale' : 'border-ember-400/25 bg-ember-500/5')}>
                    <Avatar name={p?.ign ?? '??'} size={32} dim={bench} />
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{p?.ign ?? 'Player'}</p>{bench && <p className="text-[10px] uppercase tracking-wider text-zinc-400">Bench</p>}</div>
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
        {isCaptain && new Date(m.startAt).getTime() < Date.now() + 3600_000 && m.squad?.confirmed && m.status !== 'cancelled' && <ReportCard m={m} members={members} />}
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
        {!done && <Link to={`/matches/${m.id}/edit`} className="btn-ghost"><Pencil className="h-4 w-4" aria-hidden />Edit</Link>}
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
      {q.isLoading ? <Skeleton className="h-24" /> : q.data?.length ? <LogTable logs={q.data} compact /> :
        <p className="text-sm text-zinc-400">{m.squad?.confirmed ? `Nothing sent yet. Alert fires at ${timeIST(m.notifyAt)}.` : 'Nothing sent yet.'}</p>}
    </Card>
  );
}

function ReportCard({ m, members }: { m: Match; members: Member[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['report', m.id], queryFn: () => api.report(m.id) });
  const squad = (m.squad?.selectedIds ?? []).map((id) => members.find((p) => p.id === id)).filter(Boolean) as Member[];
  const [rows, setRows] = useState<Record<string, { joined: boolean; kills: number; damage: number; mvp: boolean }>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    const next: typeof rows = {};
    for (const p of squad) {
      const a = q.data.attendance.find((x) => x.userId === p.id);
      const s = q.data.stats.find((x) => x.userId === p.id);
      next[p.id] = { joined: a?.joined ?? true, kills: s?.kills ?? 0, damage: s?.damage ?? 0, mvp: s?.mvp ?? false };
    }
    setRows(next);
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (id: string, patch: Partial<(typeof rows)[string]>) =>
    setRows((r) => {
      const n = { ...r, [id]: { ...r[id], ...patch } };
      if (patch.mvp) for (const k of Object.keys(n)) if (k !== id) n[k] = { ...n[k], mvp: false };
      return n;
    });

  async function save() {
    setBusy(true);
    try {
      const entries = Object.entries(rows);
      await api.saveAttendance(m.id, entries.map(([userId, r]) => ({ userId, joined: r.joined })));
      await api.saveStats(m.id, entries.map(([userId, r]) => ({ userId, kills: r.kills, damage: r.damage, mvp: r.mvp })));
      toast.success('Attendance and stats saved');
      qc.invalidateQueries({ queryKey: ['report', m.id] });
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-xl font-bold text-white"><Trophy className="h-5 w-5 text-ember-400" aria-hidden />Attendance & stats</h2>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500"><th className="p-2">Player</th><th className="p-2">Joined</th><th className="p-2">Kills</th><th className="p-2">Damage</th><th className="p-2">MVP</th></tr></thead>
          <tbody>
            {squad.map((p) => {
              const r = rows[p.id];
              if (!r) return null;
              return (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="p-2 font-semibold text-white">{p.ign}</td>
                  <td className="p-2"><input type="checkbox" aria-label={`${p.ign} joined`} className="h-4 w-4 accent-ember-500" checked={r.joined} onChange={(e) => set(p.id, { joined: e.target.checked })} /></td>
                  <td className="p-2"><input type="number" min={0} max={99} aria-label={`${p.ign} kills`} className="input w-20 py-1.5" value={r.kills} onChange={(e) => set(p.id, { kills: Number(e.target.value) })} /></td>
                  <td className="p-2"><input type="number" min={0} max={9999} aria-label={`${p.ign} damage`} className="input w-24 py-1.5" value={r.damage} onChange={(e) => set(p.id, { damage: Number(e.target.value) })} /></td>
                  <td className="p-2"><input type="radio" name="mvp" aria-label={`${p.ign} MVP`} className="h-4 w-4 accent-ember-500" checked={r.mvp} onChange={() => set(p.id, { mvp: true })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button className="mt-4" loading={busy} onClick={save}>Save</Button>
    </Card>
  );
}
