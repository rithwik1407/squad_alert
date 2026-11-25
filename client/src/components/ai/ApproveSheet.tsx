import { useState } from 'react';
import { motion } from 'framer-motion';
import { Bell, Check, Send } from 'lucide-react';
import { Avatar, Button, cx, Field } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { aiApi } from '@/lib/ai';
import type { Channel, PoolPlayer, ProposalBlock, ProposalForm } from '@/lib/aiTypes';
import { Sheet } from './Sheet';

const CONFIRM: Record<ProposalForm['kind'], string> = {
  scrim: 'Schedule and notify', squad: 'Confirm squad', message: 'Send message', reschedule: 'Move and notify',
  cancel: 'Cancel match', map: 'Set map', availability: 'Save my check-in', request: 'Send to captain',
};
const TITLE: Record<ProposalForm['kind'], string> = {
  scrim: 'Schedule match', squad: 'Confirm squad', message: 'Send message', reschedule: 'Move match',
  cancel: 'Cancel match', map: 'Set map', availability: 'Your check-in', request: 'Request to captain',
};

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={cx('rounded-md border px-3 py-2 text-sm font-semibold transition-colors', value === o.v ? 'border-ember-400/60 bg-ember-500/15 text-ember-100' : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PlayerPicker({ pool, selected, onToggle, showReach, max }: { pool: PoolPlayer[]; selected: string[]; onToggle: (id: string) => void; showReach?: Channel[]; max?: number }) {
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {pool.map((p) => {
        const on = selected.includes(p.id);
        const reach = showReach ? showReach.some((c) => (c === 'telegram' ? p.telegram : p.push)) : true;
        const full = !on && max != null && selected.length >= max;
        return (
          <li key={p.id}>
            <button type="button" onClick={() => onToggle(p.id)} disabled={full} aria-pressed={on}
              className={cx('flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors disabled:opacity-40', on ? 'border-ember-400/50 bg-ember-500/10' : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20')}>
              <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded border', on ? 'border-ember-400 bg-ember-400 text-ink-950' : 'border-white/25')}>{on && <Check className="h-3.5 w-3.5" aria-hidden />}</span>
              <Avatar name={p.ign} size={28} dim={!reach} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{p.ign}</span>
                <span className="block truncate text-[11px] text-zinc-500">
                  {showReach ? ([p.telegram && 'Telegram', p.push && 'Push'].filter(Boolean).join(' · ') || 'Not linked: will not get it') : [p.gameRole, p.availability].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The Approve step: the AI's draft, editable, then one confirm. Edits go to the server with the approval,
 * which checks everything again before anything changes.
 */
export function ApproveSheet({ block, open, onClose, onDone }: { block: ProposalBlock; open: boolean; onClose: () => void; onDone: (r: { status: string; resultId: string | null; result: string }) => void }) {
  const toast = useToast();
  const [f, setF] = useState<ProposalForm | null>(block.form ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const up = (patch: Partial<ProposalForm>) => setF((x) => (x ? { ...x, ...patch } as ProposalForm : x));
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function confirm() {
    setBusy(true); setErr(null);
    try {
      const r = await aiApi.approve(block.id, f ? (f as unknown as Record<string, unknown>) : {});
      onDone(r);
      toast.success(r.result || 'Done');
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  let body: React.ReactNode = <dl className="space-y-1.5">{block.lines.map((l) => <div key={l.label} className="flex gap-3 text-sm"><dt className="w-20 shrink-0 text-zinc-500">{l.label}</dt><dd className="text-white">{l.value}</dd></div>)}</dl>;
  let ready = true;
  if (f) {
    switch (f.kind) {
      case 'scrim':
        body = (
          <div className="space-y-3">
            <Field label="Event name"><input className="input" value={f.tournamentName} maxLength={60} onChange={(e) => up({ tournamentName: e.target.value })} /></Field>
            <Field label="Title"><input className="input" value={f.title} maxLength={60} onChange={(e) => up({ title: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><input className="input" type="date" value={f.date} onChange={(e) => up({ date: e.target.value })} /></Field>
              <Field label="Time"><input className="input" type="time" value={f.time} onChange={(e) => up({ time: e.target.value })} /></Field>
            </div>
            <div><span className="label">Map</span><Seg label="Map" value={f.map} options={f.maps.map((m) => ({ v: m, label: m }))} onChange={(map) => up({ map })} /></div>
            <div><span className="label">Type</span><Seg label="Type" value={f.type} options={f.types.map((t) => ({ v: t, label: t[0].toUpperCase() + t.slice(1) }))} onChange={(type) => up({ type })} /></div>
            <p className="flex items-center gap-2 text-xs text-zinc-500"><Bell className="h-3.5 w-3.5" aria-hidden />The usual alerts are scheduled, and the whole team is told now.</p>
          </div>
        );
        ready = Boolean(f.tournamentName.trim() && f.title.trim() && f.date && f.time);
        break;
      case 'squad':
        body = (
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">{f.matchLabel} · <span className={cx('font-mono font-bold', f.selectedIds.length === f.size ? 'text-emerald-300' : 'text-amber-300')}>{f.selectedIds.length}/{f.size}</span> picked</p>
            <PlayerPicker pool={f.pool} selected={f.selectedIds} max={f.size} onToggle={(id) => up({ selectedIds: toggle(f.selectedIds, id) })} />
          </div>
        );
        ready = f.selectedIds.length === f.size;
        break;
      case 'message':
        body = (
          <div className="space-y-3">
            <Field label="Message"><textarea className="input min-h-[96px] resize-y" value={f.text} maxLength={500} onChange={(e) => up({ text: e.target.value })} /></Field>
            <div>
              <span className="label">Send by</span>
              <div className="flex gap-1.5">
                {(['telegram', 'push'] as Channel[]).map((c) => (
                  <button key={c} type="button" aria-pressed={f.channels.includes(c)} onClick={() => up({ channels: toggle(f.channels, c) as Channel[] })}
                    className={cx('flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold', f.channels.includes(c) ? 'border-ember-400/60 bg-ember-500/15 text-ember-100' : 'border-white/10 text-zinc-400')}>
                    {f.channels.includes(c) && <Check className="h-3.5 w-3.5" aria-hidden />}{c === 'push' ? 'Push' : 'Telegram'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label !mb-0">To ({f.recipientIds.length})</span>
                <button type="button" className="text-xs font-semibold text-ember-300" onClick={() => up({ recipientIds: f.recipientIds.length === f.pool.length ? [] : f.pool.map((p) => p.id) })}>
                  {f.recipientIds.length === f.pool.length ? 'Clear' : 'Everyone'}
                </button>
              </div>
              <PlayerPicker pool={f.pool} selected={f.recipientIds} showReach={f.channels} onToggle={(id) => up({ recipientIds: toggle(f.recipientIds, id) })} />
            </div>
          </div>
        );
        ready = Boolean(f.text.trim() && f.channels.length && f.recipientIds.length);
        break;
      case 'reschedule':
        body = (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">{f.matchLabel}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="New date"><input className="input" type="date" value={f.date} onChange={(e) => up({ date: e.target.value })} /></Field>
              <Field label="New time"><input className="input" type="time" value={f.time} onChange={(e) => up({ time: e.target.value })} /></Field>
            </div>
            <p className="flex items-center gap-2 text-xs text-zinc-500"><Bell className="h-3.5 w-3.5" aria-hidden />The whole team is told the new time.</p>
          </div>
        );
        ready = Boolean(f.date && f.time);
        break;
      case 'cancel':
        body = <p className="text-sm text-zinc-300">Cancel <span className="font-semibold text-white">{f.matchLabel}</span>? Its alerts stop and the whole team is told.</p>;
        break;
      case 'map':
        body = (
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">{f.matchLabel}</p>
            <Seg label="Map" value={f.map} options={f.maps.map((m) => ({ v: m, label: m }))} onChange={(map) => up({ map })} />
          </div>
        );
        break;
      case 'availability':
        body = (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">{f.matchLabel}</p>
            <Seg label="Status" value={f.status} options={[{ v: 'available', label: 'Available' }, { v: 'maybe', label: 'Maybe' }, { v: 'unavailable', label: 'Unavailable' }]} onChange={(status) => up({ status, joinTime: status === 'unavailable' ? '' : f.joinTime })} />
            {f.status !== 'unavailable' && (
              <Field label="Joining at (optional)" hint="Leave empty if you'll be on time."><input className="input" type="time" value={f.joinTime} onChange={(e) => up({ joinTime: e.target.value })} /></Field>
            )}
          </div>
        );
        break;
      case 'request':
        body = <Field label="Message to the captain"><textarea className="input min-h-[96px] resize-y" value={f.text} maxLength={400} onChange={(e) => up({ text: e.target.value })} /></Field>;
        ready = Boolean(f.text.trim());
        break;
    }
  }
  const kind = f?.kind ?? (block.kind as ProposalForm['kind']);

  return (
    <Sheet open={open} onClose={onClose} title={TITLE[kind] ?? 'Approve'} subtitle="Check the details, edit anything, then confirm."
      footer={(
        <div>
          {err && <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="mb-2 rounded border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</motion.p>}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={onClose} disabled={busy}>Back</Button>
            <Button variant={kind === 'cancel' ? 'danger' : 'primary'} className="flex-[2]" loading={busy} disabled={!ready} onClick={confirm}
              icon={kind === 'message' || kind === 'request' ? <Send className="h-4 w-4" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}>
              {CONFIRM[kind] ?? 'Approve'}
            </Button>
          </div>
        </div>
      )}>
      {body}
      {block.warnings.length > 0 && <ul className="mt-3 space-y-1 text-xs text-amber-300">{block.warnings.map((w) => <li key={w}>• {w}</li>)}</ul>}
    </Sheet>
  );
}
