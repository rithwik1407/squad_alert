import { useSlow } from '@/lib/useSlow';

/** Shown when a request is slow: the free server sleeps when nobody uses it and takes a moment to start. */
export function WakingNote({ active, className = '' }: { active: boolean; className?: string }) {
  const slow = useSlow(active);
  if (!slow) return null;
  return (
    <p role="status" className={`text-center text-sm text-zinc-400 ${className}`}>
      <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-ember-400 align-middle" aria-hidden />
      Waking up the server. After a break this can take up to 30 seconds, it's quick after that.
    </p>
  );
}
