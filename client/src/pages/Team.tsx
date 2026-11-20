import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, MapPin, UserPlus, X } from 'lucide-react';
import { MemberRow } from '@/components/MemberRow';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { list } from '@/lib/motion';
import { MAPS, type MapName } from '@/lib/types';
import { Avatar, Button, Card, PageHeader } from '@/components/ui';
import { useJoinRequests } from '@/lib/useJoinRequests';
import { ago } from '@/lib/time';
import { useToast } from '@/components/Toast';

export default function TeamPage() {
  const { team, refresh } = useAuth();
  const { isAdmin } = useJoinRequests();
  const toast = useToast();
  const [drops, setDrops] = useState<Partial<Record<MapName, string>>>(team?.drops ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  if (!team) return null;

  return (
    <div>
      <PageHeader eyebrow="Team" title={team.name}>New players ask to join from the sign-in page and the admin approves them. Tap the pencil to change a player's details or login.</PageHeader>
      <motion.div variants={list} initial="initial" animate="animate" className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {isAdmin ? <RequestsCard onChanged={refresh} /> : (
          <Card glow className="self-start">
            <p className="eyebrow">New players</p>
            <p className="mt-2 text-sm text-zinc-400">New players register on the sign-in page. The admin approves each request before they join the team.</p>
          </Card>
        )}

        <Card>
          <h2 className="mb-3 text-xl font-bold text-white">Players · {team.members.length}</h2>
          <motion.ul variants={list} initial="initial" animate="animate" className="space-y-2">
            {team.members.map((p) => (
              <MemberRow key={p.id} p={p} onChanged={refresh} />
            ))}
          </motion.ul>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-1 flex items-center gap-2 text-xl font-bold text-white"><MapPin className="h-5 w-5 text-ember-400" aria-hidden />Default drops</h2>
          <p className="mb-4 text-sm text-zinc-400">Pre-filled when you schedule a match on that map.</p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {MAPS.map((m) => (
              <label key={m} className="block">
                <span className="label">{m}</span>
                <input className="input" value={drops[m] ?? ''} placeholder="-" maxLength={30} onChange={(e) => setDrops((d) => ({ ...d, [m]: e.target.value }))} />
              </label>
            ))}
          </div>
          <Button className="mt-4" loading={busy === 'drops'} onClick={async () => {
            setBusy('drops');
            try { await api.updateTeam({ drops }); await refresh(); toast.success('Drops saved'); } catch (e) { toast.error(e); } finally { setBusy(null); }
          }}>Save drops</Button>
        </Card>
      </motion.div>
    </div>
  );
}

/** Admin only: people who registered and are waiting. Approve adds them to TEAM RARE with the role they asked for. */
function RequestsCard({ onChanged }: { onChanged: () => Promise<unknown> }) {
  const { requests, loading, refetch } = useJoinRequests();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, ign: string, approve: boolean) {
    if (!approve && !window.confirm(`Reject ${ign}? Their request will be deleted and they can register again.`)) return;
    setBusy(id);
    try {
      if (approve) {
        await api.approveRequest(id);
        await onChanged();
        toast.success(`${ign} joined the team`);
      } else {
        await api.rejectRequest(id);
        toast.success(`Rejected ${ign}`);
      }
      await refetch();
    } catch (e) {
      toast.error(e);
      await refetch();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card glow className="self-start">
      <h2 className="flex items-center gap-2 text-xl font-bold text-white">
        <UserPlus className="h-5 w-5 text-ember-400" aria-hidden />Join requests
        {requests.length > 0 && <span className="chip bg-ember-500/20 text-ember-300">{requests.length}</span>}
      </h2>
      <p className="mt-1 text-sm text-zinc-400">People who registered on the sign-in page. Approve to add them to the team.</p>
      {loading ? <p className="mt-4 text-sm text-zinc-500">Loading...</p> : requests.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-white/10 p-3 text-sm text-zinc-500">No requests right now.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {requests.map((r) => (
            <li key={r.id} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
              <div className="flex items-start gap-3">
                <Avatar name={r.ign} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
                    {r.ign}
                    <span className="chip bg-white/10 text-[10px] capitalize text-zinc-300">{r.role}</span>
                  </p>
                  <p className="text-xs text-zinc-400">{r.name} · {ago(r.createdAt)}</p>
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    <div className="min-w-0"><dt className="inline text-zinc-500">Email </dt><dd className="inline break-all text-zinc-200">{r.email}</dd></div>
                    <div><dt className="inline text-zinc-500">Phone </dt><dd className="inline text-zinc-200">{r.phone ? `+${r.phone}` : '-'}</dd></div>
                    <div><dt className="inline text-zinc-500">BGMI UID </dt><dd className="inline font-mono text-zinc-200">{r.bgmiId || '-'}</dd></div>
                  </dl>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button className="flex-1" loading={busy === r.id} disabled={busy !== null && busy !== r.id}
                  icon={<Check className="h-4 w-4" aria-hidden />} onClick={() => act(r.id, r.ign, true)}>Approve</Button>
                <Button variant="ghost" className="flex-1" disabled={busy !== null}
                  icon={<X className="h-4 w-4" aria-hidden />} onClick={() => act(r.id, r.ign, false)}>Reject</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
