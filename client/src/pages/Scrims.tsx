import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { list } from '@/lib/motion';
import { useScrims } from '@/lib/useScrims';
import type { ScrimSeries } from '@/lib/types';
import { Button, Card, PageHeader, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';
import { OrganizerDetails } from '@/components/OrganizerCard';
import { ScrimEditor } from '@/components/ScrimEditor';
import { useToast } from '@/components/Toast';
import { useDialog } from '@/components/Modal';

/** Organizer contacts for every scrim / tournament series the team plays. */
export default function Scrims() {
  const q = useScrims();
  const qc = useQueryClient();
  const toast = useToast();
  const dialog = useDialog();
  const [edit, setEdit] = useState<{ series?: ScrimSeries | null; name?: string } | null>(null);
  const [find, setFind] = useState('');
  const canEdit = Boolean(q.data?.canEdit);

  const shown = useMemo(() => {
    const t = find.trim().toLowerCase();
    const all = q.data?.series ?? [];
    return t ? all.filter((s) => [s.name, s.organizer, s.contact, s.notes].some((v) => v.toLowerCase().includes(t))) : all;
  }, [q.data, find]);

  async function remove(s: ScrimSeries) {
    if (!(await dialog.confirm(`Delete ${s.name}?`, { text: 'The Discord links and contact details on this card will be removed.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.deleteScrim(s.id);
      await qc.invalidateQueries({ queryKey: ['scrims'] });
      toast.success(`${s.name} deleted`);
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Scrims" title="Organizers"
        action={canEdit ? <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEdit({})}>Add organizer</Button> : undefined}>
        Discord links and organizer contacts for each scrim series. Match pages show the card that matches their scrim name.
      </PageHeader>

      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : (
        <motion.div variants={list} initial="initial" animate="animate" className="space-y-6">
          {(q.data?.series.length ?? 0) > 3 && (
            <label className="relative block max-w-sm">
              <span className="sr-only">Search organizers</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
              <input className="input pl-9" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search scrims or organizers" />
            </label>
          )}

          {q.data?.series.length === 0 ? (
            <Card>
              <EmptyState title="No organizers saved yet"
                text={canEdit ? 'Save the Discord server and organizer contact for each scrim series so the squad can find them fast.' : 'The captain has not added any scrim organizers yet.'}
                action={canEdit ? <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEdit({})}>Add organizer</Button> : undefined} />
            </Card>
          ) : shown.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing matches "{find}".</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {shown.map((s) => (
                <Card key={s.id} className="self-start">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="break-words text-xl font-bold text-white">{s.name}</h2>
                      <p className="text-xs text-zinc-500">{s.matchCount ? `${s.matchCount} match${s.matchCount === 1 ? '' : 'es'} scheduled with this name` : 'No matches with this name yet'}</p>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-1">
                        <button className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white" aria-label={`Edit ${s.name}`} onClick={() => setEdit({ series: s })}><Pencil className="h-4 w-4" /></button>
                        <button className="rounded-lg p-2 text-zinc-400 hover:bg-red-500/10 hover:text-red-300" aria-label={`Delete ${s.name}`} onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    )}
                  </div>
                  <OrganizerDetails s={s} />
                </Card>
              ))}
            </div>
          )}

          {canEdit && (q.data?.unsaved.length ?? 0) > 0 && (
            <Card>
              <h2 className="text-lg font-bold text-white">Scrims without contacts</h2>
              <p className="mt-1 text-sm text-zinc-400">These names are on your matches but have no organizer card yet. Tap one to add it.</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {q.data!.unsaved.map((u) => (
                  <li key={u.name}>
                    <button onClick={() => setEdit({ name: u.name })}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-white/15 px-3 py-1.5 text-sm text-zinc-200 hover:border-ember-400/50 hover:text-white">
                      <Plus className="h-3.5 w-3.5 text-ember-400" aria-hidden />{u.name}
                      <span className="text-xs text-zinc-500">· {u.matchCount}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </motion.div>
      )}

      <ScrimEditor open={edit !== null} onClose={() => setEdit(null)} series={edit?.series} name={edit?.name} />
    </div>
  );
}
