import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button, Field } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { useToast } from '@/components/Toast';

export default function Join() {
  const { code: urlCode } = useParams();
  const { user, loading, refresh, logout } = useAuth();
  const [code, setCode] = useState((urlCode ?? '').toUpperCase());
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const preview = useQuery({
    queryKey: ['preview', code],
    queryFn: () => api.previewTeam(code),
    enabled: code.length >= 6,
    retry: false,
  });

  if (!loading && user?.teamId) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) {
      nav('/welcome', { state: { from: `/join/${code}` } });
      return;
    }
    setBusy(true);
    try {
      const { team } = await api.joinTeam(code);
      await refresh();
      toast.success(`You're on ${team.name}!`);
      nav('/');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass gborder w-full max-w-sm p-6 shadow-glow">
        <Logo />
        <h1 className="mt-6 text-3xl font-bold text-white">Join your team</h1>
        <p className="mt-1 text-sm text-zinc-400">Enter the code your captain shared.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Join code">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().trim())} maxLength={8} autoFocus
              className="input text-center font-mono text-2xl uppercase tracking-[0.4em]" aria-describedby="team-preview" />
          </Field>
          <div id="team-preview" className="min-h-[2.5rem]" aria-live="polite">
            {preview.data && (
              <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-3 rounded-xl bg-ember-500/10 p-3 ring-1 ring-ember-400/25">
                <Users className="h-5 w-5 text-ember-400" aria-hidden />
                <div><p className="font-display text-lg font-bold text-white">{preview.data.name}</p><p className="text-xs text-zinc-400">{preview.data.slotsLeft} slot{preview.data.slotsLeft === 1 ? '' : 's'} left</p></div>
              </motion.div>
            )}
            {preview.isError && <p className="text-sm text-red-300">No team with that code.</p>}
          </div>
          <Button type="submit" loading={busy} disabled={code.length < 4} className="w-full">{user ? 'Join team' : 'Sign in to join'}</Button>
        </form>
        {user && (
          <p className="mt-5 text-center text-xs text-zinc-500">
            Signed in as {user.ign}. <button className="underline hover:text-zinc-300" onClick={async () => { await logout(); nav('/welcome'); }}>Switch account</button>
            {' · '}<Link to="/settings" className="underline hover:text-zinc-300">Settings</Link>
          </p>
        )}
      </motion.div>
    </div>
  );
}
