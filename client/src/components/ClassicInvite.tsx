import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, Gamepad2, Send, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ago } from '@/lib/time';
import type { ClassicInvite, Member } from '@/lib/types';
import { Avatar, Button, Card, cx } from './ui';
import { Modal } from './Modal';
import { useToast } from './Toast';

const DEFAULT_MSG = 'Can we play a classic match?';

/** Everyone on the team except me. */
function useTeammates(): Member[] {
  const { team, user } = useAuth();
  const all = [...(team?.members ?? [])];
  if (team?.captain && !all.some((m) => m.id === team.captain!.id)) all.unshift(team.captain);
  return all.filter((m) => m.id !== user?._id);
}

export function useInvites() {
  return useQuery({ queryKey: ['invites'], queryFn: () => api.invites().then((r) => r.invites), refetchInterval: 20_000 });
}

/** Home card: "Play classic" button, plus today's invites and their answers. */
export function PlayClassicCard() {
  const [open, setOpen] = useState(false);
  const q = useInvites();
  const invites = q.data ?? [];
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-ember-400 to-ember-600 text-ink-950 shadow-glow">
            <Gamepad2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white">Play classic</h2>
            <p className="text-xs text-zinc-400">Ask teammates for a classic match. They get it in the app and on Telegram.</p>
          </div>
        </div>
        <Button icon={<Send className="h-4 w-4" aria-hidden />} onClick={() => setOpen(true)}>Invite</Button>
      </div>
      <AnimatePresence initial={false}>
        {invites.length > 0 && (
          <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mt-4 space-y-2 overflow-hidden">
            {invites.slice(0, 3).map((i) => <InviteRow key={i.id} invite={i} />)}
          </motion.ul>
        )}
      </AnimatePresence>
      <InviteComposer open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

function InviteRow({ invite: i }: { invite: ClassicInvite }) {
  const ins = i.recipients.filter((r) => r.response === 'in').length;
  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <Link to={`/classic/${i.id}`} className="flex items-center gap-3">
        <Avatar name={i.from.ign} src={i.from.avatar} size={30} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{i.sentByMe ? 'You asked' : i.from.ign}{i.message ? `: ${i.message}` : ''}</p>
          <p className="text-[11px] text-zinc-500">{ins} in · {i.recipients.filter((r) => r.response === 'out').length} out · {i.recipients.filter((r) => !r.response).length} waiting{i.createdAt ? ` · ${ago(i.createdAt)}` : ''}</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
      </Link>
      {i.myResponse !== undefined && <AnswerButtons invite={i} className="mt-2.5" />}
    </li>
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
      toast.success(r === 'in' ? "You're in. They've been told." : "You're out. They've been told.");
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
        <ul className="mt-2 max-h-[40vh] space-y-1.5 overflow-y-auto overscroll-contain pr-1">
          {mates.map((m) => {
            const on = picked.has(m.id);
            return (
              <li key={m.id}>
                <button type="button" onClick={() => toggle(m.id)} aria-pressed={on}
                  className={cx('flex w-full items-center gap-3 rounded-xl border p-2 text-left', on ? 'border-ember-400/50 bg-ember-500/10' : 'border-white/[0.06] hover:bg-white/[0.04]')}>
                  <Avatar name={m.ign} src={m.avatar} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">{m.ign}</span>
                    <span className="text-[11px] text-zinc-500">{[m.pushEnabled && 'App', m.telegramLinked && 'Telegram'].filter(Boolean).join(' + ') || 'No alerts on'}</span>
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
