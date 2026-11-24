import type { ReactNode } from 'react';
import { Copy, ExternalLink, Hash, MessageCircle, StickyNote, User } from 'lucide-react';
import type { ScrimSeries } from '@/lib/types';
import { seriesKey, useScrims } from '@/lib/useScrims';
import { useToast } from './Toast';
import { cx } from './ui';

/** Discord links, organizer and contact for one scrim series. Used on the Scrims page and on match pages. */
export function OrganizerDetails({ s, compact }: { s: ScrimSeries; compact?: boolean }) {
  const toast = useToast();
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success('Copied'));
  const empty = !s.discordInvite && !s.discordChannel && !s.organizer && !s.contact && !s.notes;
  if (empty) return <p className="text-sm text-zinc-500">No details saved yet.</p>;
  return (
    <div className="space-y-3">
      {(s.discordInvite || s.discordChannel) && (
        <div className="flex flex-wrap gap-2">
          {s.discordInvite && <LinkButton href={s.discordInvite} label="Discord server" />}
          {s.discordChannel && <LinkButton href={s.discordChannel} label="Room / slot channel" icon={<Hash className="h-4 w-4" aria-hidden />} />}
        </div>
      )}
      <dl className={cx('grid gap-2 text-sm', !compact && 'sm:grid-cols-2')}>
        {s.organizer && (
          <div className="flex items-start gap-2">
            <User className="mt-0.5 h-4 w-4 shrink-0 text-ember-400" aria-hidden />
            <div className="min-w-0"><dt className="text-[11px] uppercase tracking-wider text-zinc-500">Organizer</dt><dd className="break-words text-zinc-100">{s.organizer}</dd></div>
          </div>
        )}
        {s.contact && (
          <div className="flex items-start gap-2">
            <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-ember-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <dt className="text-[11px] uppercase tracking-wider text-zinc-500">Contact</dt>
              <dd className="flex items-start gap-1.5 text-zinc-100">
                <span className="min-w-0 break-words">{s.contact}</span>
                <button type="button" onClick={() => copy(s.contact)} className="shrink-0 rounded p-0.5 text-zinc-500 hover:text-zinc-200" aria-label="Copy contact">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </dd>
            </div>
          </div>
        )}
      </dl>
      {s.notes && (
        <p className="flex items-start gap-2 whitespace-pre-line rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-sm text-zinc-300">
          <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          <span className="min-w-0 break-words">{s.notes}</span>
        </p>
      )}
    </div>
  );
}

function LinkButton({ href, label, icon }: { href: string; label: string; icon?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-xl bg-[#5865F2]/15 px-3 py-2 text-sm font-semibold text-indigo-200 ring-1 ring-[#5865F2]/40 transition-colors hover:bg-[#5865F2]/25">
      {icon ?? <DiscordMark />}
      {label}
      <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden />
    </a>
  );
}

function DiscordMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.7.1 18.2a19.8 19.8 0 0 0 6 3l1.3-2a12.8 12.8 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.7 19.7 0 0 0 6-3c.5-5.2-.9-9.8-3.6-13.8ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
    </svg>
  );
}

/** <datalist> of saved scrim series names, so match forms can reuse the exact name and link to its organizer card. */
export function SeriesNameOptions({ id }: { id: string }) {
  const q = useScrims();
  return (
    <datalist id={id}>
      {q.data?.series.map((s) => <option key={s.id} value={s.name} />)}
    </datalist>
  );
}

/**
 * Saved scrim / tournament names shown as tappable suggestions under the name field, so the same scrim
 * always gets the same name (and its matches group together). Typing filters them; a new name is fine too.
 */
export function SeriesSuggestions({ value, onPick }: { value: string; onPick: (name: string) => void }) {
  const q = useScrims();
  const typed = seriesKey(value);
  const names = [
    ...(q.data?.series.map((s) => s.name) ?? []),
    ...(q.data?.unsaved.map((u) => u.name) ?? []),
  ].filter((n, i, all) => all.findIndex((x) => seriesKey(x) === seriesKey(n)) === i);
  if (!names.length) return null;
  const exact = names.some((n) => seriesKey(n) === typed);
  const shown = names.filter((n) => !typed || (seriesKey(n).includes(typed) && seriesKey(n) !== typed)).slice(0, 8);
  if (exact && !shown.length) return <p className="mt-1.5 text-[11px] text-emerald-300">Saved scrim name. Its matches will be grouped together.</p>;
  if (!shown.length) return <p className="mt-1.5 text-[11px] text-zinc-500">New name. It will be saved for next time.</p>;
  return (
    <div className="mt-2">
      <p className="mb-1 text-[11px] text-zinc-500">{typed ? 'Did you mean' : 'Your scrims'}:</p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((n) => (
          <button key={n} type="button" onClick={() => onPick(n)}
            className="rounded-full border border-ember-400/30 bg-ember-500/10 px-3 py-1 text-xs font-semibold text-ember-200 hover:bg-ember-500/20">{n}</button>
        ))}
      </div>
    </div>
  );
}
