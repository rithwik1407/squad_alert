import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Hourglass } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Logo } from '@/components/Logo';

/**
 * Shown to a signed-in account that isn't on a team (for example a player the captain removed).
 * There is no join code any more: new people register on the sign-in page and the admin approves them.
 */
export default function Join() {
  const { user, loading, logout } = useAuth();
  const nav = useNavigate();

  if (!loading && !user) return <Navigate to="/welcome" replace />;
  if (!loading && user?.teamId) return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass gborder w-full max-w-sm p-6 shadow-glow">
        <Logo />
        <Hourglass className="mt-6 h-8 w-8 text-ember-400" aria-hidden />
        <h1 className="mt-3 text-3xl font-bold text-white">Not on a team</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Your account isn't on TEAM RARE right now. Ask the admin to add you back. New players register on the sign-in page and wait for the admin to approve them.
        </p>
        {user && (
          <p className="mt-6 text-center text-xs text-zinc-500">
            Signed in as {user.ign}. <button className="underline hover:text-zinc-300" onClick={async () => { await logout(); nav('/welcome'); }}>Sign out</button>
            {' · '}<Link to="/settings" className="underline hover:text-zinc-300">Settings</Link>
          </p>
        )}
      </motion.div>
    </div>
  );
}
