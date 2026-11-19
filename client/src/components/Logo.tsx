import { Link } from 'react-router-dom';

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="inline-flex items-center gap-2.5" aria-label="SquadSync home">
      <img src="/icons/icon.svg" alt="" width={compact ? 30 : 36} height={compact ? 30 : 36} />
      <span className="font-display text-xl font-bold tracking-wider text-white">
        SQUAD<span className="text-ember-400">SYNC</span>
      </span>
    </Link>
  );
}
