import { Link } from 'react-router-dom';

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="inline-flex items-center gap-2.5" aria-label="SquadSync home">
      <img src="/icons/logo.png" alt="" width={compact ? 32 : 40} height={compact ? 32 : 40} className="rounded-lg" />
      <span className="font-display text-xl font-bold tracking-wider text-white">
        SQUAD<span className="text-ember-400">SYNC</span>
      </span>
    </Link>
  );
}
