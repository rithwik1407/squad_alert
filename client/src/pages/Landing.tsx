import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion, useMotionValue, useScroll, useSpring, useTransform, AnimatePresence } from 'framer-motion';
import { BellRing, Crosshair, Lock, ShieldCheck, Timer, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button, Field, cx } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { useToast } from '@/components/Toast';
import { MapArt } from '@/components/MapArt';
import { list, item } from '@/lib/motion';

export default function Landing() {
  const { user, setSession } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 60, damping: 20 });
  const sy = useSpring(my, { stiffness: 60, damping: 20 });
  const bgY = useTransform(scrollY, [0, 600], [0, 180]);
  const midY = useTransform(scrollY, [0, 600], [0, 90]);
  const layer1x = useTransform(sx, (v) => v * -30);
  const layer1y = useTransform(sy, (v) => v * -20);
  const layer2x = useTransform(sx, (v) => v * 18);
  const layer2y = useTransform(sy, (v) => v * 12);

  if (user) return <Navigate to={(loc.state as { from?: string })?.from ?? '/'} replace />;

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      onPointerMove={(e) => {
        mx.set(e.clientX / window.innerWidth - 0.5);
        my.set(e.clientY / window.innerHeight - 0.5);
      }}
    >
      {/* Parallax background */}
      <motion.div aria-hidden style={{ y: bgY }} className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      </motion.div>
      <motion.div aria-hidden style={{ x: layer1x, y: layer1y }} className="pointer-events-none absolute -right-60 -top-60 h-[760px] w-[760px] rounded-full bg-[radial-gradient(closest-side,rgba(255,138,31,.28),transparent)]" />
      <motion.div aria-hidden style={{ x: layer2x, y: layer2y }} className="pointer-events-none absolute -bottom-72 -left-60 h-[720px] w-[720px] rounded-full bg-[radial-gradient(closest-side,rgba(251,191,36,.12),transparent)]" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <a href="#auth" className="btn-ghost hidden sm:inline-flex">Sign in</a>
      </header>

      <section ref={heroRef} className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-6 lg:grid-cols-[1.1fr_1fr] lg:pt-14">
        <motion.div variants={list} initial="initial" animate="animate">
          <motion.p variants={item} className="eyebrow">BGMI team ops</motion.p>
          <motion.h1 variants={item} className="mt-3 text-5xl font-bold leading-[0.95] text-white sm:text-7xl">
            Pick your four.<br />
            <span className="bg-gradient-to-r from-ember-300 via-ember-400 to-ember-600 bg-clip-text text-transparent">Ping only them.</span>
          </motion.h1>
          <motion.p variants={item} className="mt-5 max-w-lg text-base text-zinc-400 sm:text-lg">
            Schedule scrims, lock in the squad at the last second, and SquadSync alerts exactly those four players two minutes
            before the lobby opens, with the room ID and password. The bench stays quiet.
          </motion.p>
          <motion.ul variants={list} className="mt-8 grid max-w-lg grid-cols-2 gap-3 text-sm">
            {[
              { icon: Timer, t: 'T-minus alerts', d: 'Exact, server-side timing' },
              { icon: Users, t: '4 of 5 picker', d: 'Bench gets nothing' },
              { icon: BellRing, t: 'Push + Telegram', d: 'Automatic fallback' },
              { icon: Lock, t: 'Squad lock', d: 'No edits after the ping' },
            ].map(({ icon: I, t, d }) => (
              <motion.li key={t} variants={item} className="glass flex items-start gap-3 p-3">
                <I className="mt-0.5 h-4 w-4 shrink-0 text-ember-400" aria-hidden />
                <span><span className="block font-semibold text-white">{t}</span><span className="text-xs text-zinc-500">{d}</span></span>
              </motion.li>
            ))}
          </motion.ul>
          <motion.div style={{ y: midY }} className="pointer-events-none mt-10 hidden gap-3 lg:flex" aria-hidden>
            {(['Erangel', 'Miramar', 'Sanhok'] as const).map((m, i) => (
              <motion.div key={m} initial={{ opacity: 0, y: 30, rotate: -4 + i * 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 + i * 0.1 }}
                className="relative h-24 w-40 overflow-hidden rounded-xl ring-1 ring-white/10">
                <MapArt map={m} />
                <span className="absolute bottom-2 left-2 font-display text-sm font-bold text-white">{m}</span>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>

        <AuthCard onDone={(s) => { setSession(s); nav(s.user.teamId ? '/' : '/join'); }} />
      </section>

      <footer className="relative z-10 mx-auto max-w-6xl px-5 pb-8 text-xs text-zinc-600">
        <p className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Times shown in IST. No Discord required.</p>
      </footer>
    </div>
  );
}

type Session = Awaited<ReturnType<typeof api.login>>;

function AuthCard({ onDone }: { onDone: (s: Session) => void }) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [mode, setMode] = useState<'player' | 'captain'>('player');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Set after a successful registration: the request is waiting for the admin. */
  const [sent, setSent] = useState<{ email: string; mode: 'player' | 'captain' } | null>(null);
  const toast = useToast();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setBusy(true);
    setErrors({});
    try {
      if (tab === 'login') {
        const s = await api.login({ email: f.email, password: f.password });
        toast.success(`Welcome back, ${s.user.ign}`);
        onDone(s);
      } else {
        await api.register({ ...f, mode });
        form.reset();
        setSent({ email: f.email, mode });
        setTab('login');
        toast.success('Request sent to the admin');
      }
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div id="auth" initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.2, type: 'spring', stiffness: 200, damping: 24 }}
      className="glass gborder w-full max-w-md justify-self-center p-6 shadow-glow sm:p-7 lg:justify-self-end">
      <div role="tablist" aria-label="Sign in or register" className="relative mb-6 grid grid-cols-2 rounded-xl bg-white/[0.04] p-1">
        {(['login', 'register'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setErrors({}); }}
            className={cx('relative z-10 rounded-lg py-2 text-sm font-semibold transition-colors', tab === t ? 'text-ink-950' : 'text-zinc-400 hover:text-zinc-200')}>
            {tab === t && <motion.span layoutId="auth-tab" className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-b from-ember-400 to-ember-500" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
            {t === 'login' ? 'Sign in' : 'Register'}
          </button>
        ))}
      </div>

      {sent && (
        <div role="status" className="mb-5 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200 ring-1 ring-emerald-400/25">
          <p className="font-semibold text-emerald-100">Request sent</p>
          <p className="mt-0.5">The admin will review your {sent.mode} request for {sent.email}. You can sign in here once it's approved.</p>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <AnimatePresence mode="popLayout" initial={false}>
          {tab === 'register' && (
            <motion.div key="reg" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-4 overflow-hidden">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="I am a">
                {(['player', 'captain'] as const).map((m) => (
                  <button type="button" key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                    className={cx('flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold capitalize transition-colors',
                      mode === m ? 'border-ember-400/60 bg-ember-500/10 text-ember-300' : 'border-white/10 text-zinc-400 hover:border-white/20')}>
                    {m === 'captain' ? <Crosshair className="h-4 w-4" aria-hidden /> : <Users className="h-4 w-4" aria-hidden />} {m}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name" error={errors.name}><input name="name" className="input" autoComplete="name" required /></Field>
                <Field label="IGN" error={errors.ign}><input name="ign" className="input" placeholder="RARE丨…" required /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="BGMI UID" error={errors.bgmiId}><input name="bgmiId" className="input" inputMode="numeric" placeholder="5577363210" required /></Field>
                <Field label="Phone" error={errors.phone}><input name="phone" type="tel" className="input" autoComplete="tel" placeholder="+91 98765 43210" required /></Field>
              </div>
              <p className="text-xs text-zinc-500">Your request goes to the TEAM RARE admin. You can sign in after they approve it.</p>
            </motion.div>
          )}
        </AnimatePresence>
        <Field label="Email" error={errors.email}><input name="email" type="email" className="input" autoComplete="email" required /></Field>
        <Field label="Password" error={errors.password}>
          <input name="password" type="password" className="input" autoComplete={tab === 'login' ? 'current-password' : 'new-password'} required minLength={tab === 'register' ? 8 : 1} />
        </Field>
        <Button type="submit" loading={busy} className="w-full py-3">{tab === 'login' ? 'Sign in' : `Request to join as ${mode}`}</Button>
      </form>
    </motion.div>
  );
}
