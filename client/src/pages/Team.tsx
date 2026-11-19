import { useState } from 'react';
import { motion } from 'framer-motion';
import { Copy, Link2, MapPin, RefreshCw, Share2 } from 'lucide-react';
import { MemberRow } from '@/components/MemberRow';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { list } from '@/lib/motion';
import { MAPS, type MapName } from '@/lib/types';
import { Button, Card, PageHeader } from '@/components/ui';
import { useToast } from '@/components/Toast';

export default function TeamPage() {
  const { team, refresh } = useAuth();
  const toast = useToast();
  const [drops, setDrops] = useState<Partial<Record<MapName, string>>>(team?.drops ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  if (!team) return null;
  const link = `${window.location.origin}/join/${team.joinCode}`;

  const copy = async (t: string, what: string) => {
    try { await navigator.clipboard.writeText(t); toast.success(`${what} copied`); } catch { toast.error('Copy failed'); }
  };

  return (
    <div>
      <PageHeader eyebrow="Team" title={team.name}>Up to 5 players. Invite with the code or link. Tap the pencil to change a player's details or login.</PageHeader>
      <motion.div variants={list} initial="initial" animate="animate" className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card glow className="self-start">
          <p className="eyebrow">Join code</p>
          <motion.p key={team.joinCode} initial={{ rotateX: 90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }}
            className="mt-2 font-mono text-5xl font-bold tracking-[0.3em] text-white">{team.joinCode}</motion.p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="ghost" icon={<Copy className="h-4 w-4" aria-hidden />} onClick={() => copy(team.joinCode, 'Code')}>Copy code</Button>
            <Button variant="ghost" icon={<Link2 className="h-4 w-4" aria-hidden />} onClick={() => copy(link, 'Invite link')}>Copy link</Button>
            {'share' in navigator && (
              <Button variant="ghost" icon={<Share2 className="h-4 w-4" aria-hidden />}
                onClick={() => navigator.share({ title: `Join ${team.name} on SquadSync`, text: `Code ${team.joinCode}`, url: link }).catch(() => {})}>Share</Button>
            )}
            <Button variant="ghost" loading={busy === 'code'} icon={<RefreshCw className="h-4 w-4" aria-hidden />}
              onClick={async () => {
                if (!window.confirm('Make a new code? The old code and link stop working.')) return;
                setBusy('code');
                try { await api.regenerateCode(); await refresh(); toast.success('New code ready'); } catch (e) { toast.error(e); } finally { setBusy(null); }
              }}>New code</Button>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-xl font-bold text-white">Players · {team.members.length}/5</h2>
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
