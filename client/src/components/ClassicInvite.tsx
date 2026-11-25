import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, Gamepad2, Send, Timer, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ago } from '@/lib/time';
import type { ClassicInvite, Member } from '@/lib/types';
import { Avatar, Button, Card, cx } from './ui';
import { Modal, useDialog } from './Modal';
import { useToast } from './Toast';

const DEFAULT_MSG = 'Can we play a classic match?';

/** My teammates: players only (never the captain / admin), without me. */
function useTeammates(): Member[] {
  const { team, user } = useAuth();
  return (team?.members ?? []).filter((m) => m.id !== user?._id && m.id !== team?.captain?.id && m.role !== 'captain');
}

/** Delete my invite (it disappears for everyone). */
export function useDeleteInvite(onDone?: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const dialog = useDialog();
  const m = useMutation({
    mutationFn: (id: string) => api.deleteInvite(id),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: ['invite', id] });
      qc.invalidateQueries({ queryKey: ['invites'] });
      toast.success('Invite deleted');
      onDone?.();
    },
    onError: (e) => toast.error(e),
  });
  return {
    pending: m.isPending,
    run: async (id: string) => {
      if (await dialog.confirm('Delete this invite?', { text: 'It disappears for everyone you sent it to.', confirmLabel: 'Delete', danger: true })) m.mutate(id);
    },
  };
}

/** Re-render every second (for the 7-minute countdown). */
export function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** "Disappears in 6:42" until the invite runs out (7 minutes after it was sent). */
export function clearsIn(at: string | null, now = Date.now()) {
  if (!at) return null;
  const left = Math.max(0, Math.ceil((new Date(at).getTime() - now) / 1000));
  return left ? `Disappears in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired';
}

const isLive = (i: ClassicInvite, now: number) => !i.expiresAt || new Date(i.expiresAt).getTime() > now;

/** True while any invite is live; flips back exactly when the last one runs out (no per-second re-render). */
export function useHasLiveInvite() {
  const q = useQuery({ queryKey: ['invites'], queryFn: () => api.invites().then((r) => r.invites), refetchInterval: 15_000 });
  const [, bump] = useState(0);
  const now = Date.now();
  const live = (q.data ?? []).filter((i) => isLive(i, now));
  const nextEnd = Math.min(...live.map((i) => (i.expiresAt ? new Date(i.expiresAt).getTime() : Infinity)));
  useEffect(() => {
    if (!Number.isFinite(nextEnd)) return;
    const t = setTimeout(() => bump((n) => n + 1), Math.max(0, nextEnd - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [nextEnd]);
  return live.length > 0;
}

/** Invites that are still live. They drop out on their own the moment they run out. */
export function useInvites() {
  const now = useNow();
  const q = useQuery({ queryKey: ['invites'], queryFn: () => api.invites().then((r) => r.invites), refetchInterval: 15_000 });
  return { ...q, data: q.data?.filter((i) => isLive(i, now)), now };
}

/** Home card: "Play classic" button, plus live invites and their answers. Glows while an invite is live. */
export function PlayClassicCard() {
  const [open, setOpen] = useState(false);
  const q = useInvites();
  const invites = q.data ?? [];
  const waitingOnMe = invites.filter((i) => i.myResponse === null).length;
  return (
    <Card glow={invites.length > 0} className={cx(invites.length > 0 && 'border-ember-400/40')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-ember-400 to-ember-600 text-ink-950 shadow-glow">
            <Gamepad2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              Play classic
              {waitingOnMe > 0 && (
                <span className="relative flex h-2.5 w-2.5" aria-label={`${waitingOnMe} waiting for your answer`}>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ember-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ember-500" />
                </span>
              )}
            </h2>
            <p className="text-xs text-zinc-400">Ask teammates for a classic match. They get it in the app and on Telegram. Invites disappear after 7 minutes.</p>
          </div>
        </div>
        <Button icon={<Send className="h-4 w-4" aria-hidden />} onClick={() => setOpen(true)}>Invite</Button>
      </div>
      <AnimatePresence initial={false}>
        {invites.length > 0 && (
          <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mt-4 space-y-2 overflow-hidden">
            <AnimatePresence initial={false}>
              {invites.slice(0, 3).map((i) => <InviteRow key={i.id} invite={i} now={q.now} />)}
            </AnimatePresence>
          </motion.ul>
        )}
      </AnimatePresence>
      <InviteComposer open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

function InviteRow({ invite: i, now }: { invite: ClassicInvite; now: number }) {
  const ins = i.recipients.filter((r) => r.response === 'in').length;
  const del = useDeleteInvite();
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
      className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-2">
      <Link to={`/classic/${i.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={i.from.ign} src={i.from.avatar} size={30} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{i.sentByMe ? 'You asked' : i.from.ign}{i.message ? `: ${i.message}` : ''}</p>
          <p className="text-[11px] text-zinc-500">{ins} in · {i.recipients.filter((r) => r.response === 'out').length} out · {i.recipients.filter((r) => !r.response).length} waiting{i.createdAt ? ` · ${ago(i.createdAt)}` : ''}</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
      </Link>
      {i.sentByMe && (
        <button type="button" aria-label="Delete invite" disabled={del.pending} onClick={() => del.run(i.id)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-red-500/10 hover:text-red-300">
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      )}
      </div>
      {i.expiresAt && <p className="mt-1.5 flex items-center gap-1 pl-[42px] text-[11px] text-ember-300/80"><Timer className="h-3 w-3" aria-hidden />{clearsIn(i.expiresAt, now)}</p>}
      {i.myResponse !== undefined && <AnswerButtons invite={i} className="mt-2.5" />}
    </motion.li>
  );
}

export function AnswerButtons({ invite, className }: { invite: ClassicInvite; className?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (r: 'in' | 'out') => api.respondInvite(invite.id, r),
    onSuccess: ({ invite: fresh }, r) => {
      qc.setQueryData(['invite', invite.id], fresh);
      qc.invalidateQueries({ queryKey: ['invites'] });
      toast.success(r === 'in' ? "You're in. Everyone's been told." : "You're out. Everyone's been told.");
    },
    onError: (e) => toast.error(e),
  });
  const cur = m.isPending ? m.variables : invite.myResponse;
  return (
    <div className={cx('flex gap-2', className)}>
      {(['in', 'out'] as const).map((r) => (
        <button key={r} type="button" disabled={m.isPending} onClick={() => m.mutate(r)} aria-pressed={cur === r}
          className={cx('btn flex-1 border', cur === r
            ? r === 'in' ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : 'border-red-400/40 bg-red-500/15 text-red-200'
            : 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10')}>
          {r === 'in' ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
          {r === 'in' ? "I'm in" : "I'm out"}
        </button>
      ))}
    </div>
  );
}

function InviteComposer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mates = useTeammates();
  const qc = useQueryClient();
  const toast = useToast();
  const [msg, setMsg] = useState(DEFAULT_MSG);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const all = picked.size === mates.length && mates.length > 0;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const send = useMutation({
    mutationFn: () => api.sendInvite({ message: msg.trim(), userIds: [...picked] }),
    onSuccess: ({ invite }) => {
      const reached = invite.recipients.filter((r) => r.delivered.length).length;
      toast.success(`Sent to ${invite.recipients.length}${reached < invite.recipients.length ? ` (${invite.recipients.length - reached} have no alerts turned on)` : ''}`);
      qc.invalidateQueries({ queryKey: ['invites'] });
      setPicked(new Set());
      setMsg(DEFAULT_MSG);
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={open} onClose={onClose} labelledBy="ci-title">
      <form onSubmit={(e) => { e.preventDefault(); if (picked.size) send.mutate(); }}>
        <h3 id="ci-title" className="flex items-center gap-2 text-lg font-bold text-white"><Gamepad2 className="h-5 w-5 text-ember-400" aria-hidden />Play classic</h3>
        <label className="mt-3 block">
          <span className="label">Message</span>
          <textarea className="input min-h-[72px] resize-none" maxLength={300} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={DEFAULT_MSG} />
        </label>
        <div className="mt-3 flex items-center justify-between">
          <span className="label mb-0">Send to</span>
          <button type="button" className="text-xs font-semibold text-ember-400 hover:text-ember-300"
            onClick={() => setPicked(all ? new Set() : new Set(mates.map((m) => m.id)))}>{all ? 'Clear' : 'Select all'}</button>
        </div>
        <ul className="mt-2 grid max-h-[40vh] grid-cols-2 gap-2 overflow-y-auto overscroll-contain pr-1">
          {mates.map((m) => {
            const on = picked.has(m.id);
            return (
              <li key={m.id}>
                <button type="button" onClick={() => toggle(m.id)} aria-pressed={on}
                  className={cx('relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg border p-2 text-left transition-[border-color,background-color,box-shadow] active:scale-[.97]', on ? 'border-ember-400/80 bg-ember-500/10 shadow-glow' : 'border-dashed border-white/15 hover:border-white/30')}>
                  <span className="overflow-hidden rounded-md ring-1 ring-white/10"><Avatar name={m.ign} src={m.avatar} size={38} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-sm font-bold uppercase text-white">{m.ign}</span>
                    <span className="block truncate text-[10px] text-zinc-500">{[m.pushEnabled && 'App', m.telegramLinked && 'Telegram'].filter(Boolean).join(' + ') || 'No alerts on'}</span>
                  </span>
                  <span className={cx('grid h-5 w-5 place-items-center rounded-md border transition-colors', on ? 'border-ember-400 bg-ember-500 text-ink-950' : 'border-white/20')}>
                    {on && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
                  </span>
                </button>
              </li>
            );
          })}
          {!mates.length && <li className="text-sm text-zinc-400">No teammates yet.</li>}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button type="submit" className="flex-1" loading={send.isPending} disabled={!picked.size} icon={<Send className="h-4 w-4" aria-hidden />}>
            Send{picked.size ? ` to ${picked.size}` : ''}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
