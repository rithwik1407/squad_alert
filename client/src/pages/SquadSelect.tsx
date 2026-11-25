import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, BellRing, Lock, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useSquadSelection, SQUAD_SIZE } from '@/lib/useSquad';
import { celebrate } from '@/lib/confetti';
import { relativeDay, timeIST } from '@/lib/time';
import { mapLabel } from '@/lib/types';
import { Button, Card, LockBadge, PageHeader, Skeleton } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { EmptyState } from '@/components/EmptyState';
import { RosterCard, SquadSlot } from '@/components/RosterCard';
import { EMPTY_LINE, usePlayerStats } from '@/lib/usePlayerStats';

export default function SquadSelect() {
  const { id = '' } = useParams();
  const { team } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['match', id], queryFn: () => api.match(id).then((r) => r.match) });
  const m = q.data;
  const sel = useSquadSelection(m?.squad?.selectedIds, `${m?.id}:${m?.squad?.updatedAt}`);
  const [saving, setSaving] = useState(false);
  const members = useMemo(() => team?.members ?? [], [team]);
  const { lines } = usePlayerStats();
  const byId = useMemo(() => new Map(members.map((p) => [p.id, p])), [members]);
  const locked = Boolean(m?.locked);
  const dirty = JSON.stringify([...sel.selected].sort()) !== JSON.stringify([...(m?.squad?.selectedIds ?? [])].sort());

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-60" /><Skeleton className="h-28" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div></div>;
  if (!m) return <EmptyState title="Match not found" />;

  async function save(confirm: boolean) {
    setSaving(true);
    try {
      await api.saveSquad(m!.id, sel.selected, confirm);
      await qc.invalidateQueries({ queryKey: ['match', id] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      if (confirm) {
        celebrate();
        toast.success(`Squad confirmed. ${SQUAD_SIZE} players get pinged at ${timeIST(m!.notifyAt)}.`);
      } else toast.info('Draft saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Link to={`/matches/${m.id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" aria-hidden />Match</Link>
      <PageHeader eyebrow={`${mapLabel(m.map)} · ${relativeDay(m.startAt)} · ${timeIST(m.startAt)}`} title={`Squad · ${m.title}`}
        action={locked ? <LockBadge className="text-sm" /> : undefined}>
        Tap to pick exactly {SQUAD_SIZE}. Everyone else sits on the bench and gets no alert.
      </PageHeader>

      {members.length < SQUAD_SIZE ? (
        <Card><EmptyState title="Not enough players" text={`You need at least ${SQUAD_SIZE} players on the team. New players register on the sign-in page and the admin approves them.`} /></Card>
      ) : (
        <>
          {/* Lineup: the 4 squad slots fill left to right as players are picked. */}
          <section className="glass mb-6 p-3 sm:p-4" aria-label="Squad lineup">
            <div className="mb-3 flex items-center justify-between">
              <p className="hud-label">Lineup</p>
              <p className="font-mono text-xs text-zinc-500">{sel.selected.length}/{SQUAD_SIZE}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: SQUAD_SIZE }, (_, i) => {
                const pid = sel.selected[i];
                return <SquadSlot key={i} n={i + 1} p={(pid && byId.get(pid)) || null} locked={locked} onRemove={() => pid && sel.toggle(pid)} />;
              })}
            </div>
          </section>

          <div className="mb-3 flex items-center justify-between">
            <p className="hud-label">Roster · {members.length}</p>
            <p className="text-xs text-zinc-500">Tap to pick · <span className="text-zinc-400">i</span> for stats</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((p, i) => {
              const idx = sel.selected.indexOf(p.id);
              const on = idx >= 0;
              return (
                <RosterCard key={p.id} p={p} order={i} on={on} slot={on ? idx + 1 : null} benched={sel.full && !on} locked={locked}
                  line={lines.get(p.id) ?? EMPTY_LINE} avail={m.availability[p.id]} note={m.availabilityNotes[p.id]}
                  onToggle={() => {
                    const ok = sel.toggle(p.id);
                    if (!ok) toast.error(`Squad is full (${SQUAD_SIZE}/${SQUAD_SIZE}). Tap a picked player to swap.`);
                    return ok;
                  }} />
              );
            })}
          </div>
        </>
      )}

      <div className="sticky bottom-20 z-20 mt-6 lg:bottom-6">
        <Card className="flex flex-col gap-4 bg-ink-850/90 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="cut relative grid h-12 w-12 place-items-center bg-ember-500/15">
              {locked ? <Lock className="h-5 w-5 text-ember-300" aria-hidden /> : <BellRing className="h-5 w-5 text-ember-300" aria-hidden />}
            </div>
            <div>
              <p className="text-sm text-zinc-400">
                <motion.span key={sel.selected.length} initial={{ scale: 1.4, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }} className="inline-block font-mono text-lg font-bold text-white">
                  {sel.selected.length}/{SQUAD_SIZE}
                </motion.span>{' '}selected
              </p>
              <p className="text-sm text-zinc-300">
                {locked ? <>Notification sent. Squad is locked. Use <Link className="text-ember-300 underline" to={`/matches/${m.id}`}>emergency sub</Link>.</>
                  : <>Notification at <span className="font-semibold text-ember-300">{timeIST(m.notifyAt)}</span> ({m.notifyOffsetMin} min before)</>}
              </p>
            </div>
          </div>
          {!locked && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => save(false)} disabled={!sel.full || saving}>Save draft</Button>
              <Button onClick={() => save(true)} loading={saving} disabled={!sel.full || (!dirty && m.squad?.confirmed)}
                icon={<ShieldCheck className="h-4 w-4" aria-hidden />}>
                {m.squad?.confirmed && !dirty ? 'Confirmed' : 'Confirm squad'}
              </Button>
            </div>
          )}
          {locked && <Button variant="ghost" onClick={() => nav(`/matches/${m.id}`)}>Back to match</Button>}
        </Card>
      </div>
    </div>
  );
}
