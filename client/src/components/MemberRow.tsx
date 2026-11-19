import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { KeyRound, Pencil, UserMinus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { item } from '@/lib/motion';
import type { Member } from '@/lib/types';
import { Avatar, Button, Field } from './ui';
import { useToast } from './Toast';

/** A player on the Team page. The captain can edit their profile, login email and reset their password. */
export function MemberRow({ p, onChanged }: { p: Member; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const body: Record<string, string> = {};
    if (f.name && f.name !== p.name) body.name = f.name;
    if (f.ign && f.ign !== p.ign) body.ign = f.ign;
    if (f.bgmiId !== p.bgmiId) body.bgmiId = f.bgmiId;
    if (f.email && f.email !== p.email) body.email = f.email;
    if (f.password) body.password = f.password;
    if (!Object.keys(body).length) { setOpen(false); return; }
    setBusy(true);
    try {
      await api.updateMember(p.id, body);
      await onChanged();
      toast.success(body.password ? `Saved. Share the new password with ${p.ign}.` : `${p.ign} updated`);
      setOpen(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.li variants={item} className="rounded-xl border border-white/[0.06]">
      <div className="flex items-center gap-3 p-3">
        <Avatar name={p.ign} src={p.avatar} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">{p.ign}</p>
          <p className="truncate text-xs text-zinc-400">{p.email ?? ''}</p>
          <p className="font-mono text-[11px] text-zinc-500">UID {p.bgmiId || '-'} · {p.pushEnabled ? 'Push on' : 'No push'} · {p.telegramLinked ? 'Telegram' : 'No Telegram'}</p>
        </div>
        <button aria-label={open ? `Close editing ${p.ign}` : `Edit ${p.ign}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}
          className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white">
          {open ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </button>
        <button aria-label={`Remove ${p.ign}`} className="rounded-lg p-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
          onClick={async () => {
            if (!window.confirm(`Remove ${p.ign} from the team?`)) return;
            try { await api.removeMember(p.id); await onChanged(); toast.info(`${p.ign} removed`); } catch (e) { toast.error(e); }
          }}><UserMinus className="h-4 w-4" /></button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.form key="edit" onSubmit={save} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="grid gap-3 border-t border-white/[0.06] p-3 sm:grid-cols-2">
              <Field label="Name"><input name="name" className="input" defaultValue={p.name} /></Field>
              <Field label="IGN"><input name="ign" className="input" defaultValue={p.ign} /></Field>
              <Field label="BGMI UID"><input name="bgmiId" className="input font-mono" inputMode="numeric" defaultValue={p.bgmiId} /></Field>
              <Field label="Login email"><input name="email" type="email" className="input" defaultValue={p.email ?? ''} autoComplete="off" /></Field>
              <Field label="New password" hint="Leave empty to keep their current password. At least 8 characters.">
                <input name="password" type="text" className="input font-mono" autoComplete="new-password" minLength={8} placeholder="••••••••" />
              </Field>
              <div className="flex items-end gap-2">
                <Button type="submit" loading={busy} icon={<KeyRound className="h-4 w-4" aria-hidden />}>Save</Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.li>
  );
}
