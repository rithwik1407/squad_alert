import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Clock, Gamepad2, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { ago } from '@/lib/time';
import { list, item } from '@/lib/motion';
import { Avatar, Button, Card, Skeleton, cx } from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';
import { AnswerButtons, clearsIn, useDeleteInvite, useNow } from '@/components/ClassicInvite';
import { BadgeIcon, ModeTag } from '@/components/Challenges';
import { OpenBgmiButton } from '@/components/OpenBgmi';

/** One classic-match invite: the message, my answer, and who is in / out / still to answer. */
export default function Classic() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['invite', id], queryFn: () => api.invite(id).then((r) => r.invite), refetchInterval: 10_000 });
  const i = q.data;
  const nav = useNavigate();
  const del = useDeleteInvite(() => nav('/'));
  const now = useNow();
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-60" /></div>;
  if (!i || (i.expiresAt && new Date(i.expiresAt).getTime() <= now)) return <EmptyState title="Invite gone" text="It was deleted, or its 7 minutes ran out." action={<Link to="/" className="btn-ghost">Home</Link>} />;
  const groups = [
    { k: 'in' as const, label: "I'm in", icon: Check, cls: 'text-emerald-300' },
    { k: 'out' as const, label: "I'm out", icon: X, cls: 'text-red-300' },
    { k: null, label: 'Waiting', icon: Clock, cls: 'text-zinc-400' },
  ];
  return (
    <div>
      <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" aria-hidden />Home</Link>
      <motion.div variants={list} initial="initial" animate="animate" className="mx-auto max-w-2xl space-y-6">
        <Card glow>
          <p className="eyebrow flex items-center gap-1.5"><Gamepad2 className="h-3.5 w-3.5" aria-hidden />Classic match</p>
          <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Can we play a classic match?</h1>
          <div className="mt-3 flex items-start gap-3">
            <Avatar name={i.from.ign} src={i.from.avatar} size={36} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">{i.sentByMe ? 'You' : i.from.ign}{i.createdAt ? <span className="ml-2 text-xs font-normal text-zinc-500">{ago(i.createdAt)}</span> : null}</p>
              {i.message && <p className="mt-0.5 whitespace-pre-wrap break-words text-zinc-200">{i.message}</p>}
            </div>
          </div>
          {i.challenge && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-300/30 bg-amber-400/[0.06] p-3">
              <BadgeIcon emoji={i.challenge.badge.emoji} tier={i.challenge.tier} size={40} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">Challenge{i.challenge.daily && ' · Today'}<ModeTag mode={i.challenge.mode} /></p>
                <p className="text-sm font-bold text-white">{i.challenge.title}</p>
                <p className="text-[11px] text-zinc-400">{i.challenge.text} Earns the {i.challenge.badge.name} badge.</p>
              </div>
            </div>
          )}
          {i.myResponse !== undefined && <AnswerButtons invite={i} className="mt-5" />}
          {(i.sentByMe || i.myResponse === 'in') && <OpenBgmiButton className="mt-3 w-full" />}
          {(i.sentByMe || i.expiresAt) && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-4">
              <p className="text-xs text-zinc-500">{clearsIn(i.expiresAt, now) ?? 'Only you can delete this invite.'}</p>
              {i.sentByMe && <Button variant="danger" loading={del.pending} icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => del.run(i.id)}>Delete invite</Button>}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-bold text-white">Answers</h2>
          <div className="space-y-4">
            {groups.map((g) => {
              const people = i.recipients.filter((r) => r.response === g.k);
              if (!people.length) return null;
              return (
                <motion.section key={String(g.k)} variants={item}>
                  <h3 className={cx('mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider', g.cls)}>
                    <g.icon className="h-3.5 w-3.5" aria-hidden />{g.label} · {people.length}
                  </h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {people.map((r) => (
                      <li key={r.user.id} className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                        <Avatar name={r.user.ign} src={r.user.avatar} size={28} dim={g.k === 'out'} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{r.user.ign}</span>
                        {r.respondedAt ? <span className="text-[11px] text-zinc-500">{ago(r.respondedAt)}</span>
                          : !r.delivered.length ? <span className="text-[11px] text-amber-300">No alerts on</span> : null}
                      </li>
                    ))}
                  </ul>
                </motion.section>
              );
            })}
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
