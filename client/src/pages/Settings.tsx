import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { BellRing, CheckCircle2, ImagePlus, KeyRound, ExternalLink, LogOut, MessageCircle, Smartphone, Unlink } from 'lucide-react';
import { api, type TestNotificationResult } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { disablePush, enablePush, permission, pushConfigured, pushSupport } from '@/lib/push';
import { list } from '@/lib/motion';
import { normalizeAvatarUrl, photoToAvatar } from '@/lib/avatar';
import { Avatar, Button, Card, Field, PageHeader, cx } from '@/components/ui';
import { useToast } from '@/components/Toast';

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', on ? 'bg-ember-500' : 'bg-white/10')}>
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 32 }}
        className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow', on ? 'right-1' : 'left-1')} />
    </button>
  );
}

export default function Settings() {
  const { user, refresh, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const cfg = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });
  const [busy, setBusy] = useState<string | null>(null);
  const [perm, setPerm] = useState(permission());
  const [test, setTest] = useState<TestNotificationResult | null>(null);
  const support = pushSupport();

  useEffect(() => {
    // Refresh Telegram status when the user returns from the Telegram app.
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const [avatar, setAvatar] = useState(user?.avatar ?? '');
  const [avatarBroken, setAvatarBroken] = useState(false);
  useEffect(() => { setAvatar(user?.avatar ?? ''); }, [user?.avatar]);

  if (!user) return null;

  const prefs = user.notifyPrefs;
  const setPref = async (k: keyof typeof prefs, v: boolean) => {
    try { await api.updateMe({ notifyPrefs: { [k]: v } }); await refresh(); } catch (e) { toast.error(e); }
  };

  async function turnOnPush() {
    setBusy('push');
    try {
      await enablePush();
      setPerm(permission());
      await refresh();
      toast.success('Push alerts are on for this device');
    } catch (e) {
      setPerm(permission());
      toast.error(e);
    } finally { setBusy(null); }
  }

  async function sendTest() {
    setBusy('test');
    try {
      const r = await api.testNotification();
      setTest(r);
      if (r.results.some((x) => x.ok)) toast.success('Test sent. Check your phone.');
      else toast.error(new Error(testProblem(r)));
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  }

  async function linkTelegram() {
    setBusy('tg');
    try {
      const { url } = await api.telegramLink();
      window.open(url, '_blank', 'noopener');
      toast.info('Tap Start in Telegram, then come back here.');
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  }

  async function pickPhoto(file?: File) {
    if (!file) return;
    try { setAvatar(await photoToAvatar(file)); setAvatarBroken(false); } catch (err) { toast.error(err); }
  }

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy('profile');
    try {
      await api.updateMe({ name: f.name, ign: f.ign, bgmiId: f.bgmiId || undefined, avatar });
      await refresh();
      toast.success('Profile saved');
    } catch (err) { toast.error(err); } finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader eyebrow="Settings" title="Alerts & profile" />
      <motion.div variants={list} initial="initial" animate="animate" className="grid gap-6 lg:grid-cols-2">
        <WhatsAppCard number={user.whatsappNumber ?? ''} on={prefs.whatsapp !== false} ready={cfg.data?.whatsappReady}
          onToggle={(v) => setPref('whatsapp', v)} onSaved={refresh} />

        <Card>
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ember-500/15 text-ember-300"><Smartphone className="h-5 w-5" aria-hidden /></span>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-white">Push notifications</h2>
              <p className="text-sm text-zinc-400">Backup to WhatsApp. Works even when the app is closed.</p>
            </div>
            <Toggle label="Use push" on={prefs.push} onChange={(v) => setPref('push', v)} />
          </div>
          <ol className="mt-4 space-y-2 text-sm">
            {[
              { done: support === 'ok', text: support === 'ios-needs-install' ? 'iPhone: tap Share → Add to Home Screen, then open SquadSync from there' : support === 'ok' ? 'Browser supports push' : 'This browser does not support push. Link Telegram instead.' },
              { done: perm === 'granted', text: perm === 'denied' ? 'Blocked. Allow notifications in site settings, then retry' : 'Allow notifications' },
              { done: user.pushEnabled, text: 'Device registered with SquadSync' },
            ].map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <CheckCircle2 className={cx('h-4 w-4 shrink-0', s.done ? 'text-emerald-400' : 'text-zinc-600')} aria-hidden />
                <span className={s.done ? 'text-zinc-200' : 'text-zinc-400'}>{s.text}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button loading={busy === 'push'} onClick={turnOnPush} disabled={support !== 'ok' || !pushConfigured()} icon={<BellRing className="h-4 w-4" aria-hidden />}>
              {user.pushEnabled ? 'Re-register this device' : 'Enable push'}
            </Button>
            {user.pushEnabled && <Button variant="ghost" onClick={async () => { await disablePush(); await refresh(); toast.info('This device will no longer get push'); }}>Turn off here</Button>}
          </div>
          {!pushConfigured() && <p className="mt-3 text-xs text-amber-300/80">Push isn't configured on this deployment yet: the website is missing its Firebase keys (VITE_FIREBASE_* on Vercel, then redeploy).</p>}
          {pushConfigured() && cfg.data && !cfg.data.pushServerReady && <p className="mt-3 text-xs text-amber-300/80">The server is missing its Firebase keys (FIREBASE_* on Render), so push can't be sent yet even after you enable it.</p>}

          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-sm text-zinc-300">Not sure alerts work? Send yourself a test on every channel you have set up.</p>
            <Button className="mt-3" variant="ghost" loading={busy === 'test'} onClick={sendTest} icon={<BellRing className="h-4 w-4" aria-hidden />}>Send me a test alert</Button>
            {test && (
              <ul className="mt-3 space-y-1.5 text-sm">
                {test.results.map((r) => (
                  <li key={r.channel} className="flex items-start gap-2">
                    <CheckCircle2 className={cx('mt-0.5 h-4 w-4 shrink-0', r.ok ? 'text-emerald-400' : 'text-rose-400')} aria-hidden />
                    <span className={r.ok ? 'text-zinc-200' : 'text-rose-200'}>{channelName(r.channel)}: {r.ok ? 'sent' : r.error}</span>
                  </li>
                ))}
                {!test.results.length && <li className="text-amber-300/90">{testProblem(test)}</li>}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky-400/15 text-sky-300"><MessageCircle className="h-5 w-5" aria-hidden /></span>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-white">Telegram</h2>
              <p className="text-sm text-zinc-400">Fallback if push fails or isn't set up.</p>
            </div>
            <Toggle label="Use Telegram" on={prefs.telegram} onChange={(v) => setPref('telegram', v)} />
          </div>
          <div className="mt-4">
            {user.telegramLinked ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="chip bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/25"><CheckCircle2 className="h-3 w-3" aria-hidden />Linked</span>
                <Button variant="ghost" icon={<Unlink className="h-4 w-4" aria-hidden />} onClick={async () => { await api.telegramUnlink(); await refresh(); toast.info('Telegram unlinked'); }}>Unlink</Button>
              </div>
            ) : (
              <>
                <Button variant="ghost" loading={busy === 'tg'} onClick={linkTelegram} disabled={!cfg.data?.telegramBot} icon={<ExternalLink className="h-4 w-4" aria-hidden />}>
                  Link Telegram{cfg.data?.telegramBot ? ` (@${cfg.data.telegramBot})` : ''}
                </Button>
                <p className="mt-2 text-xs text-zinc-500">Opens the bot with a one-time code. Tap <b>Start</b> and you're linked.</p>
                {cfg.data && !cfg.data.telegramBot && <p className="mt-2 text-xs text-amber-300/80">Telegram bot isn't configured on the server yet.</p>}
              </>
            )}
          </div>
        </Card>

        {user.isAdmin ? <LoginCard email={user.email} onSaved={refresh} /> : (
          <Card className="lg:col-span-2">
            <h2 className="mb-1 flex items-center gap-2 text-xl font-bold text-white"><KeyRound className="h-5 w-5 text-ember-400" aria-hidden />Login</h2>
            <p className="text-sm text-zinc-400">Signed in as <span className="text-zinc-200">{user.email}</span>. To change your password, ask the admin.</p>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-xl font-bold text-white">Profile</h2>
          <form onSubmit={saveProfile} className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div className="flex flex-col items-center gap-2">
              <Avatar key={avatar} name={user.ign} src={avatar} size={72} />
              {/* Hidden probe so we can say when a pasted link doesn't load. */}
              {avatar && !avatar.startsWith('data:') && (
                <img src={normalizeAvatarUrl(avatar)} alt="" hidden referrerPolicy="no-referrer"
                  onLoad={() => setAvatarBroken(false)} onError={() => setAvatarBroken(true)} />
              )}
              <label className="btn-ghost cursor-pointer !px-3 !py-1.5 text-xs">
                <ImagePlus className="h-3.5 w-3.5" aria-hidden />Upload photo
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {avatar && <button type="button" className="text-xs text-zinc-500 hover:text-white" onClick={() => { setAvatar(''); setAvatarBroken(false); }}>Remove</button>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><input name="name" className="input" defaultValue={user.name} required /></Field>
              <Field label="IGN"><input name="ign" className="input" defaultValue={user.ign} required /></Field>
              <Field label="BGMI UID"><input name="bgmiId" className="input font-mono" defaultValue={user.bgmiId} inputMode="numeric" /></Field>
              <Field label="Avatar link"
                error={avatarBroken ? "That link doesn't open as an image. For Google Drive, set sharing to “Anyone with the link”, or use Upload photo." : undefined}
                hint="Upload a photo, or paste an image link. Google Drive share links work if sharing is set to “Anyone with the link”.">
                <input className="input" value={avatar.startsWith('data:') ? '' : avatar} placeholder={avatar.startsWith('data:') ? 'Uploaded photo' : 'https://…'}
                  onChange={(e) => { setAvatar(e.target.value.trim()); setAvatarBroken(false); }} />
              </Field>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button type="submit" loading={busy === 'profile'}>Save profile</Button>
                <Button type="button" variant="ghost" icon={<LogOut className="h-4 w-4" aria-hidden />} onClick={async () => { await logout(); nav('/welcome'); }}>Sign out</Button>
              </div>
            </div>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}

function LoginCard({ email, onSaved }: { email: string; onSaved: () => Promise<unknown> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (f.newPassword && f.newPassword !== f.confirm) { toast.error('New passwords do not match'); return; }
    setBusy(true);
    try {
      await api.updateAccount({
        currentPassword: f.currentPassword,
        email: f.email && f.email !== email ? f.email : undefined,
        newPassword: f.newPassword || undefined,
      });
      await onSaved();
      form.reset();
      toast.success('Login details updated');
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  }
  return (
    <Card className="lg:col-span-2">
      <h2 className="mb-1 flex items-center gap-2 text-xl font-bold text-white"><KeyRound className="h-5 w-5 text-ember-400" aria-hidden />Login</h2>
      <p className="mb-4 text-sm text-zinc-400">Change your email or password. Your current password is needed to save.</p>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Email"><input name="email" type="email" className="input" defaultValue={email} key={email} autoComplete="email" /></Field>
        <Field label="New password" hint="Optional, 8+ characters"><input name="newPassword" type="password" className="input" minLength={8} autoComplete="new-password" /></Field>
        <Field label="Confirm new password"><input name="confirm" type="password" className="input" autoComplete="new-password" /></Field>
        <Field label="Current password"><input name="currentPassword" type="password" className="input" required autoComplete="current-password" /></Field>
        <div className="sm:col-span-2 lg:col-span-4"><Button type="submit" loading={busy}>Save login</Button></div>
      </form>
    </Card>
  );
}

function WhatsAppCard({ number, on, ready, onToggle, onSaved }: {
  number: string; on: boolean; ready?: boolean; onToggle: (v: boolean) => void; onSaved: () => Promise<unknown>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get('phone') ?? '');
    setBusy(true);
    try { await api.updateMe({ whatsappNumber: v }); await onSaved(); toast.success(v ? 'WhatsApp number saved' : 'WhatsApp number removed'); }
    catch (err) { toast.error(err); } finally { setBusy(false); }
  }
  return (
    <Card className="lg:col-span-2">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300"><MessageCircle className="h-5 w-5" aria-hidden /></span>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-white">WhatsApp</h2>
          <p className="text-sm text-zinc-400">Main channel. Match alerts arrive as a WhatsApp message to this number.</p>
        </div>
        <Toggle label="Use WhatsApp" on={on} onChange={onToggle} />
      </div>
      <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <Field label="WhatsApp number" hint="With country code. 10-digit Indian numbers get +91 added.">
            <input name="phone" type="tel" className="input font-mono" defaultValue={number ? `+${number}` : ''} key={number} placeholder="+91 98765 43210" autoComplete="tel" />
          </Field>
        </div>
        <Button type="submit" loading={busy}>Save number</Button>
      </form>
      {ready === false && <p className="mt-3 text-xs text-amber-300/80">WhatsApp isn't configured on the server yet (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID).</p>}
    </Card>
  );
}

const channelName = (c: string) => (c === 'fcm' ? 'Push' : c === 'telegram' ? 'Telegram' : c === 'whatsapp' ? 'WhatsApp' : c);

/** Plain reason when nothing could be sent, so the player knows which step is missing. */
function testProblem(t: TestNotificationResult): string {
  const failed = t.results.find((r) => !r.ok);
  if (failed) return `${channelName(failed.channel)} failed: ${failed.error}`;
  if (!t.server.push && !t.server.telegram) return 'The server has no alert channel set up yet (Firebase and Telegram keys are missing on Render).';
  if (t.server.push && t.pushDevices === 0 && !t.telegramLinked) return 'No device is registered. Tap Enable push above (on iPhone, from the Home Screen app), or link Telegram.';
  if (!t.server.push && !t.telegramLinked) return 'Push is not set up on the server yet. Link Telegram below to get alerts now.';
  return 'Nothing to send to. Check that the toggles above are on.';
}
