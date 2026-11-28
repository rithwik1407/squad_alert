import { Link } from 'react-router-dom';
import { Crest } from './Crest';

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="group inline-flex items-center gap-2.5" aria-label="SquadSync home">
      <Crest size={compact ? 34 : 42} />
      <span className="font-display text-xl font-bold uppercase tracking-[0.12em] text-white">
        SQUAD<span className="text-ember-400">SYNC</span>
      </span>
    </Link>
  );
}
