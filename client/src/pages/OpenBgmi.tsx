import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { timeIST } from '@/lib/time';
import { Card, PageHeader, Skeleton } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { OpenBgmiButton } from '@/components/OpenBgmi';
import { canOpenBgmi } from '@/lib/bgmi';
import { useAuth } from '@/context/AuthContext';

/**
 * Landing page for "Open BGMI" in notifications and Telegram: shows the room ID / password with copy buttons
 * (when it's for a match) and a button that opens the game.
 */
export default function OpenBgmi() {
  const [params] = useSearchParams();
  const matchId = params.get('match');
  /** Android couldn't start the game from the link and sent us back here. */
  const noLaunch = params.get('nolaunch') === '1';
  const toast = useToast();
  const { isCaptain } = useAuth();
  const launch = canOpenBgmi() && !isCaptain;
  const q = useQuery({ queryKey: ['match', matchId], queryFn: () => api.match(matchId!).then((r) => r.match), enabled: Boolean(matchId) });
  const m = q.data;
  const copy = (k: string, t: string) => navigator.clipboard?.writeText(t).then(() => toast.success(`${k} copied`), () => toast.error('Could not copy'));
  return (
    <div className="mx-auto max-w-md">
      <Link to={matchId ? `/matches/${matchId}` : '/'} className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" aria-hidden />Back</Link>
      <PageHeader eyebrow="Let's go" title="Open BGMI">{matchId ? (launch ? 'Copy the room details, then jump into the game.' : 'Copy the room details, then open BGMI.') : 'Your squad is waiting. Jump into the game.'}</PageHeader>
      <Card glow className="space-y-3">
        {matchId && (q.isLoading ? <Skeleton className="h-28" /> : m?.roomId ? (
          <>
            <p className="text-sm font-semibold text-white">{m.title} · {timeIST(m.startAt)}</p>
            {[['Room ID', m.roomId], ['Password', m.roomPassword || ''], ...(m.slot ? [['Slot', m.slot]] : [])].filter(([, v]) => v).map(([k, v]) => (
              <button key={k} type="button" onClick={() => copy(k, v)} aria-label={`Copy ${k}`}
                className="flex w-full items-center gap-3 rounded-xl bg-black/50 px-4 py-3 text-left ring-1 ring-ember-400/30 hover:ring-ember-400/60">
                <KeyRound className="h-4 w-4 shrink-0 text-ember-400" aria-hidden />
                <span className="w-20 shrink-0 text-xs uppercase tracking-wider text-zinc-400">{k}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-lg font-bold text-white">{v}</span>
                <Copy className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
              </button>
            ))}
          </>
        ) : <p className="text-sm text-zinc-400">Room details aren't posted yet.</p>)}
        {noLaunch && <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100 ring-1 ring-amber-300/30">Your phone didn't let the app open BGMI directly.{m?.roomId ? ' The room ID is copied:' : ''} open BGMI from your home screen{m?.roomId ? ' and paste it in Custom Room' : ''}.</p>}
        <OpenBgmiButton copy={m?.roomId} className="w-full py-3" />
        {m?.roomId && launch && !noLaunch && <p className="text-center text-[11px] text-zinc-500">The room ID is copied as the game opens. Paste it in Custom Room, then type the password.</p>}
      </Card>
    </div>
  );
}
