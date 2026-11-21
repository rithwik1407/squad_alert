import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { ParsedSchedule } from '@/lib/types';
import { Button } from '@/components/ui';

/** Shrink the image before upload so it stays small on slow mobile data. */
async function toDataUrl(file: File, maxW = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, maxW / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const isNotSchedule = (e: unknown) => e instanceof ApiError && Boolean(e.details?.some((d) => d.message === 'not_schedule'));

/**
 * "Upload schedule image": reads a scrim / tournament schedule screenshot (Discord bot schedule, banner…) and hands
 * back name, date and one match per entry at its IDP time. The form fills in; the admin checks it and presses Schedule.
 */
export function ScheduleImageUpload({ onParsed }: { onParsed: (s: ParsedSchedule) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [waited, setWaited] = useState(0);
  const [err, setErr] = useState<{ notSchedule: boolean; message: string } | null>(null);

  async function upload(file: File) {
    setErr(null);
    setReading(true);
    setWaited(0);
    try {
      const image = await toDataUrl(file);
      onParsed(await api.readSchedule(image, setWaited));
    } catch (e) {
      setErr({ notSchedule: isNotSchedule(e), message: (e as Error).message || 'Could not read the image' });
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-ember-400/30 bg-ember-500/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Got a schedule image?</p>
          <p className="text-xs text-zinc-400">Upload the scrim or tournament schedule and the name, date, IDP times and maps fill in. Check them, then Schedule.</p>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        <Button variant="ghost" loading={reading} icon={<ImagePlus className="h-4 w-4" aria-hidden />} onClick={() => fileRef.current?.click()}>
          {reading ? `Reading image…${waited >= 5 ? ` ${waited}s` : ''}` : 'Upload schedule image'}
        </Button>
      </div>
      {reading && waited >= 10 && (
        <p className="mt-2 text-xs text-zinc-400">The free readers are slow right now. It keeps trying for up to about 3 minutes.</p>
      )}
      {err && !reading && (
        <div role="alert" className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-red-400/30 bg-red-500/10 p-2.5 text-sm">
          <div>
            <p className="font-semibold text-red-200">{err.notSchedule ? 'That isn\'t a schedule image' : 'Couldn\'t read the image'}</p>
            <p className="mt-0.5 text-red-200/80">
              {err.notSchedule ? 'Upload the screenshot that lists each match with its IDP time (and start time or map).' : err.message}
            </p>
            <p className="mt-1 text-zinc-300">You can still fill the matches in by hand below.</p>
          </div>
          <button type="button" aria-label="Dismiss" className="rounded p-1 text-zinc-400 hover:text-white" onClick={() => setErr(null)}><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}
