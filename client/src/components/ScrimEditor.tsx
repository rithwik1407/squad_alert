import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { ScrimSeries, ScrimSeriesInput } from '@/lib/types';
import { Modal } from './Modal';
import { Button, Field } from './ui';
import { useToast } from './Toast';

const blank: ScrimSeriesInput = { name: '', organizer: '', discordInvite: '', discordChannel: '', contact: '', notes: '' };

/** Add or edit one organizer card. Pass `series` to edit, or `name` to start a new card for that series. */
export function ScrimEditor({ open, onClose, series, name }: { open: boolean; onClose: () => void; series?: ScrimSeries | null; name?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<ScrimSeriesInput>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(series ? { name: series.name, organizer: series.organizer, discordInvite: series.discordInvite, discordChannel: series.discordChannel, contact: series.contact, notes: series.notes } : { ...blank, name: name ?? '' });
  }, [open, series, name]);

  const set = (k: keyof ScrimSeriesInput) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      if (series) await api.updateScrim(series.id, f);
      else await api.createScrim(f);
      await qc.invalidateQueries({ queryKey: ['scrims'] });
      toast.success(series ? 'Organizer details saved' : `${f.name.trim()} saved`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="scrim-editor-title">
      <form onSubmit={submit} className="space-y-3">
        <h2 id="scrim-editor-title" className="text-xl font-bold text-white">{series ? 'Edit organizer' : 'Add scrim organizer'}</h2>
        <Field label="Scrim / tournament name" error={errors.name} hint="Same name as on matches">
          <input className="input" value={f.name} onChange={set('name')} placeholder="EG Daily Scrims" required maxLength={60} autoFocus={!series && !name} />
        </Field>
        <Field label="Discord server invite" error={errors.discordInvite}>
          <input className="input" value={f.discordInvite} onChange={set('discordInvite')} placeholder="https://discord.gg/..." inputMode="url" maxLength={300} />
        </Field>
        <Field label="Room ID / slot list channel" error={errors.discordChannel} hint="Optional Discord link">
          <input className="input" value={f.discordChannel} onChange={set('discordChannel')} placeholder="https://discord.com/channels/..." inputMode="url" maxLength={300} />
        </Field>
        <Field label="Organizer" error={errors.organizer}>
          <input className="input" value={f.organizer} onChange={set('organizer')} placeholder="Name or org" maxLength={80} />
        </Field>
        <Field label="Contact" error={errors.contact} hint="Discord, WhatsApp or Insta">
          <input className="input" value={f.contact} onChange={set('contact')} placeholder="@eg_admin · +91 98xxxxxx" maxLength={200} />
        </Field>
        <Field label="Notes" error={errors.notes}>
          <textarea className="input min-h-[80px]" value={f.notes} onChange={set('notes')} placeholder="Slot fee, registration time, rules..." maxLength={1000} />
        </Field>
        <div className="flex gap-2 pt-1">
          <Button type="submit" className="flex-1" loading={busy}>Save</Button>
          <Button variant="ghost" className="flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
