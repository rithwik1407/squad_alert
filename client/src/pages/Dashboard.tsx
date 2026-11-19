import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { BellRing, CalendarPlus, Check, Inbox, KeyRound, MapPin, Send, Swords, Target, Trophy } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { isTodayIST, relativeDay, timeIST, ago } from '@/lib/time';
import { list, item, spring } from '@/lib/motion';
import { PickChip } from '@/components/PickChip';
import { useSquadSelection, SQUAD_SIZE } from '@/lib/useSquad';
import { celebrate } from '@/lib/confetti';
import type { Match, Member } from '@/lib/types';
import { Avatar, Button, Card, LockBadge, PageHeader, Skeleton, Stat, StatusChip, cx } from '@/components/ui';
import { FlipCountdown } from '@/components/FlipCountdown';
import { MatchCard, NotifyChips } from '@/components/MatchCard';
import { MapArt } from '@/components/MapArt';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/Toast';

export default function Dashboard() {
  const { isCaptain } = useAuth();
  return isCaptain ? <CaptainDashboard /> : <PlayerDashboard />;
}

function useUpcoming() {
  return useQuery({ queryKey: ['matches', 'upcoming'], queryFn: () => api.matches('upcoming').then((r) => r.matches), refetchInterval: 20_000 });
}

function NextMatchHero({ m, captain }: { m: Match; captain?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const started = new Date(m.startAt).getTime() <= Date.now();
  return (
    <Card glow className="overflow-hidden p-0 sm:p-0">
      <div className="absolute inset-0 opacity-50"><MapArt map={m.map} /></div>
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/85 to-ink-950/30" />
      <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="eyebrow">{started ? 'In progress' : 'Next match'} · {relativeDay(m.startAt)}</p>
          <h2 className="mt-1 text-3xl font-bold text-white sm:text-4xl">{m.title}</h2>
          <p className="mt-1 text-sm text-zinc-300">
            {m.map} · <span className="font-semibold text-white">{timeIST(m.startAt)} IST</span> · <span className="capitalize">{m.type}</span>
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {m.locked && <LockBadge />}
            <NotifyChips m={m} />
            {m.drop && <span className="chip bg-white/5 text-zinc-200 ring-1 ring-white/10"><MapPin className="h-3 w-3" aria-hidden />Drop: {m.drop}</span>}
          </div>
          {!captain && m.roomId && (
            <div className="mt-4 inline-flex items-center gap-3 rounded-xl bg-black/40 px-3 py-2 ring-1 ring-ember-400/30">
              <KeyRound className="h-4 w-4 text-ember-400" aria-hidden />
              <span className="font-mono text-sm text-white">Room {m.roomId} / Pass {m.roomPassword || '-'}</span>
            </div>
          )}
          {captain && (
            <div className="mt-5 flex flex-wrap gap-2">
              {!m.locked && <Link to={`/matches/${m.id}/squad`} className="btn-primary"><Swords className="h-4 w-4" aria-hidden />Pick squad</Link>}
              {m.squad?.confirmed && !m.locked && (
                <Button variant="ghost" icon={<Send className="h-4 w-4" />} onClick={async () => {
                  try { await api.sendNow(m.id); toast.success('Sending to the 4 now'); setTimeout(() => qc.invalidateQueries({ queryKey: ['matches'] }), 2500); }
                  catch (e) { toast.error(e); }
                }}>Send now</Button>
              )}
              <Link to={`/matches/${m.id}`} className="btn-ghost">Details</Link>
            </div>
          )}
        </div>
        {!started && <FlipCountdown target={m.startAt} onZero={() => qc.invalidateQueries({ queryKey: ['matches'] })} />}
        {started && <StatusChip status="live">Live</StatusChip>}
      </div>
    </Card>
  );
}

function CaptainDashboard() {
  const { team } = useAuth();
  const q = useUpcoming();
  const matches = q.data ?? [];
  const next = matches.find((m) => m.status !== 'cancelled');
  const today = matches.filter((m) => isTodayIST(m.startAt));

  return (
    <div>
      <PageHeader eyebrow="Captain HQ" title={team?.name ?? 'Dashboard'} action={
        <Link to="/matches/new" className="btn-primary"><CalendarPlus className="h-4 w-4" aria-hidden />Schedule</Link>
      } />
      <motion.div variants={list} initial="initial" animate="animate" className="space-y-6">
        {q.isLoading ? <Skeleton className="h-56" /> : next ? <NextMatchHero m={next} captain /> : (
          <Card><EmptyState title="No matches lined up" text="Schedule a scrim and SquadSync will ping your four right before it starts."
            action={<Link to="/matches/new" className="btn-primary">Schedule a match</Link>} /></Card>
        )}

        {next && !next.locked && team && <QuickPicker m={next} members={team.members} />}

        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <section aria-labelledby="today-h">
            <h2 id="today-h" className="mb-3 text-xl font-bold text-white">Today's scrims</h2>
            {q.isLoading ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : today.length ? (
              <motion.div variants={list} initial="initial" animate="animate" className="space-y-3">
                {today.map((m) => <MatchCard key={m.id} m={m} />)}
              </motion.div>
            ) : <Card className="text-sm text-zinc-400">Nothing else today. Rest those thumbs.</Card>}
          </section>
          <section aria-labelledby="roster-h">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="roster-h" className="text-xl font-bold text-white">Roster</h2>
              <Link to="/team" className="text-xs font-semibold text-ember-400 hover:text-ember-300">Manage</Link>
            </div>
            <motion.ul variants={list} initial="initial" animate="animate" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              {(team?.members ?? []).map((p) => <RosterCard key={p.id} p={p} />)}
              {team && team.members.length < 5 && (
                <motion.li variants={item} className="glass border-dashed p-3 text-sm text-zinc-400">
                  {5 - team.members.length} slot(s) open. Share code <span className="font-mono font-bold text-ember-300">{team.joinCode}</span>
                </motion.li>
              )}
            </motion.ul>
          </section>
        </div>
      </motion.div>
    </div>
  );
}

export function RosterCard({ p }: { p: Member }) {
  return (
    <motion.li variants={item} whileHover={{ x: 3 }} transition={spring} className="glass flex items-center gap-3 p-3">
      <Avatar name={p.ign} src={p.avatar} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{p.ign}</p>
        <p className="font-mono text-xs text-zinc-500">UID {p.bgmiId || '-'}</p>
      </div>
      <div className="flex gap-1" aria-label="Notification channels">
        <span title={p.pushEnabled ? 'Push on' : 'Push off'} className={cx('grid h-7 w-7 place-items-center rounded-lg', p.pushEnabled ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-zinc-600')}>
          <BellRing className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">{p.pushEnabled ? 'Push enabled' : 'Push not enabled'}</span>
        </span>
        <span title={p.telegramLinked ? 'Telegram linked' : 'Telegram not linked'} className={cx('grid h-7 w-7 place-items-center rounded-lg text-[11px] font-bold', p.telegramLinked ? 'bg-sky-400/10 text-sky-300' : 'bg-white/5 text-zinc-600')}>
          TG<span className="sr-only">{p.telegramLinked ? ' linked' : ' not linked'}</span>
        </span>
      </div>
    </motion.li>
  );
}

function QuickPicker({ m, members }: { m: Match; members: Member[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const sel = useSquadSelection(m.squad?.selectedIds, `${m.id}:${m.squad?.updatedAt}`);
  const dirty = useMemo(() => JSON.stringify([...sel.selected].sort()) !== JSON.stringify([...(m.squad?.selectedIds ?? [])].sort()), [sel.selected, m.squad]);

  async function confirm() {
    try {
      await api.saveSquad(m.id, sel.selected, true);
      celebrate();
      toast.success(`Squad locked in. Ping goes out at ${timeIST(m.notifyAt)}.`);
      qc.invalidateQueries({ queryKey: ['matches'] });
    } catch (e) { toast.error(e); }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-white">Quick squad · {m.title}</h2>
        <span className="text-xs text-zinc-400">{sel.selected.length}/{SQUAD_SIZE} picked {m.squad?.confirmed && !dirty && <Check className="inline h-3.5 w-3.5 text-emerald-400" aria-label="confirmed" />}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {members.map((p) => {
          const on = sel.selected.includes(p.id);
          const benched = sel.full && !on;
          return (
            <PickChip key={p.id} p={p} on={on} benched={benched}
              onToggle={() => { const ok = sel.toggle(p.id); if (!ok) toast.error('Only 4 can play. Unpick someone first.'); return ok; }} />
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={confirm} disabled={!sel.full || (!dirty && m.squad?.confirmed)}>Confirm squad</Button>
        <p className="text-xs text-zinc-400">Notification at <span className="font-semibold text-ember-300">{timeIST(m.notifyAt)}</span> to these 4 only.</p>
      </div>
    </Card>
  );
}

function PlayerDashboard() {
  const { user } = useAuth();
  const q = useUpcoming();
  const inbox = useQuery({ queryKey: ['notifications'], queryFn: () => api.notifications().then((r) => r.logs) });
  const stats = useQuery({ queryKey: ['mystats'], queryFn: api.myStats });
  const matches = q.data ?? [];
  const next = matches[0];

  return (
    <div>
      <PageHeader eyebrow="Player" title={`GG, ${user?.ign.replace(/^RARE丨/, '') ?? ''}`}>Matches where you're in the squad.</PageHeader>
      <motion.div variants={list} initial="initial" animate="animate" className="space-y-6">
        {!user?.pushEnabled && !user?.telegramLinked && (
          <Card className="flex flex-wrap items-center justify-between gap-3 border-ember-400/30">
            <p className="text-sm text-zinc-200"><BellRing className="mr-2 inline h-4 w-4 text-ember-400" aria-hidden />Turn on alerts so you don't miss the lobby.</p>
            <Link to="/settings" className="btn-primary">Enable alerts</Link>
          </Card>
        )}
        {q.isLoading ? <Skeleton className="h-56" /> : next ? <NextMatchHero m={next} /> : (
          <Card><EmptyState title="You're not in a squad yet" text="When your captain picks you, the match shows up here and you'll get pinged before it starts." /></Card>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Matches" value={stats.data?.totals.matches ?? '–'} icon={<Swords className="h-3.5 w-3.5" aria-hidden />} />
          <Stat label="Kills" value={stats.data?.totals.kills ?? '–'} icon={<Target className="h-3.5 w-3.5" aria-hidden />} />
          <Stat label="MVPs" value={stats.data?.totals.mvps ?? '–'} icon={<Trophy className="h-3.5 w-3.5" aria-hidden />} />
          <Stat label="Attendance" value={stats.data?.totals.attendanceRate != null ? `${stats.data.totals.attendanceRate}%` : '–'} icon={<Check className="h-3.5 w-3.5" aria-hidden />} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="up-h">
            <h2 id="up-h" className="mb-3 text-xl font-bold text-white">Upcoming</h2>
            {matches.length > 1 ? (
              <motion.div variants={list} initial="initial" animate="animate" className="space-y-3">{matches.slice(1).map((m) => <MatchCard key={m.id} m={m} />)}</motion.div>
            ) : <Card className="text-sm text-zinc-400">No other matches yet.</Card>}
          </section>
          <section aria-labelledby="inbox-h">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="inbox-h" className="text-xl font-bold text-white">Inbox</h2>
              <Link to="/notifications" className="text-xs font-semibold text-ember-400 hover:text-ember-300">See all</Link>
            </div>
            <Card className="p-0 sm:p-0">
              {inbox.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> :
                inbox.data?.length ? (
                  <ul className="divide-y divide-white/5">
                    <AnimatePresence initial={false}>
                      {inbox.data.slice(0, 5).map((n) => (
                        <motion.li key={n.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                          <Link to={`/matches/${n.matchId}`} className="flex gap-3 p-4 hover:bg-white/[0.03]">
                            <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-ember-400" aria-hidden />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-white">{n.title}</p>
                              <p className="truncate text-xs text-zinc-400">{n.body}</p>
                            </div>
                            <span className="shrink-0 text-[11px] text-zinc-500">{ago(n.sentAt)}</span>
                          </Link>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                ) : <p className="p-4 text-sm text-zinc-400">No alerts yet.</p>}
            </Card>
          </section>
        </div>
      </motion.div>
    </div>
  );
}

