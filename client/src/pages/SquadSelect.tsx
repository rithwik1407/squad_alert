import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGroup, motion, useAnimationControls, AnimatePresence } from 'framer-motion';
import { ArrowLeft, BellRing, Check, Lock, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useSquadSelection, SQUAD_SIZE } from '@/lib/useSquad';
import { celebrate } from '@/lib/confetti';
import { shake, spring, list } from '@/lib/motion';
import { relativeDay, timeIST } from '@/lib/time';
import type { Member } from '@/lib/types';
import { Avatar, Button, Card, LockBadge, PageHeader, Skeleton, cx } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { EmptyState } from '@/components/EmptyState';

function PlayerCard({ p, on, benched, locked, order, onToggle }: {
  p: Member; on: boolean; benched: boolean; locked: boolean; order: number; onToggle: () => boolean;
}) {
  const controls = useAnimationControls();
  useEffect(() => {
    controls.start({ opacity: 1, y: 0, transition: { ...spring, delay: order * 0.06 } });
  }, [controls, order]);
  return (
    <motion.button
      layout
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-disabled={locked}
      aria-label={`${p.ign}${on ? ', selected' : benched ? ', on the bench' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={controls}
      whileHover={locked ? undefined : { y: -4 }}
      whileTap={locked ? undefined : { scale: 0.96 }}
      transition={spring}
      onClick={() => {
        if (locked) return;
        if (!onToggle()) controls.start({ ...shake, opacity: 1, y: 0 });
      }}
      className={cx(
        'glass relative flex flex-col items-center gap-3 overflow-hidden p-4 text-center transition-[filter,opacity,border-color] duration-300 sm:p-5',
        on ? 'border-ember-400/70 shadow-glow' : 'border-white/[0.07]',
        benched && 'opacity-55 grayscale',
        locked ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      {on && <motion.span layoutId={`glow-${p.id}`} className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ember-500/20 to-transparent" />}
      <AnimatePresence>
        {on && (
          <motion.span key="check" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={spring}
            className="absolute right-2.5 top-2.5 grid h-6 w-6 place-items-center rounded-full bg-ember-400 text-ink-950">
            <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
          </motion.span>
        )}
        {benched && (
          <motion.span key="bench" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="chip absolute left-2.5 top-2.5 bg-zinc-700 text-zinc-200">Bench</motion.span>
        )}
      </AnimatePresence>
      <Avatar name={p.ign} src={p.avatar} size={64} dim={benched} />
      <div className="relative min-w-0">
        <p className="truncate font-display text-lg font-bold text-white">{p.ign}</p>
        <p className="font-mono text-[11px] text-zinc-500">UID {p.bgmiId || '-'}</p>
      </div>
      <div className="relative flex gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
        <span className={p.pushEnabled ? 'text-emerald-300' : 'text-zinc-600'}>Push</span>
        <span className="text-zinc-700">·</span>
        <span className={p.telegramLinked ? 'text-sky-300' : 'text-zinc-600'}>Telegram</span>
      </div>
    </motion.button>
  );
}

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
  const locked = Boolean(m?.locked);
  const dirty = JSON.stringify([...sel.selected].sort()) !== JSON.stringify([...(m?.squad?.selectedIds ?? [])].sort());

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-60" /><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-52" />)}</div></div>;
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
      <PageHeader eyebrow={`${m.map} · ${relativeDay(m.startAt)} · ${timeIST(m.startAt)}`} title={`Squad · ${m.title}`}
        action={locked ? <LockBadge className="text-sm" /> : undefined}>
        Tap to pick exactly {SQUAD_SIZE}. The fifth sits on the bench and gets no alert.
      </PageHeader>

      {members.length < SQUAD_SIZE ? (
        <Card><EmptyState title="Not enough players" text={`You need at least ${SQUAD_SIZE} players on the team. Share your join code ${team?.joinCode}.`} /></Card>
      ) : (
        <LayoutGroup>
          <motion.div variants={list} initial="initial" animate="animate" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {members.map((p, i) => {
              const on = sel.selected.includes(p.id);
              return (
                <PlayerCard key={p.id} p={p} order={i} on={on} benched={sel.full && !on} locked={locked}
                  onToggle={() => {
                    const ok = sel.toggle(p.id);
                    if (!ok) toast.error(`Squad is full (${SQUAD_SIZE}/${SQUAD_SIZE}). Tap a selected player to swap.`);
                    return ok;
                  }} />
              );
            })}
          </motion.div>
        </LayoutGroup>
      )}

      <motion.div layout className="sticky bottom-20 z-20 mt-6 lg:bottom-6">
        <Card className="flex flex-col gap-4 bg-ink-850/90 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="relative grid h-12 w-12 place-items-center rounded-xl bg-ember-500/10 ring-1 ring-ember-400/30">
              {locked ? <Lock className="h-5 w-5 text-ember-300" aria-hidden /> : <BellRing className="h-5 w-5 text-ember-300" aria-hidden />}
            </div>
            <div>
              <p className="text-sm text-zinc-400">
                <motion.span key={sel.selected.length} initial={{ scale: 1.4, color: '#ffa94d' }} animate={{ scale: 1, color: '#fff' }} className="inline-block font-display text-lg font-bold">
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
      </motion.div>
    </div>
  );
}
