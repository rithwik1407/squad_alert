import { Gamepad2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { bgmiLink, canOpenBgmi, copyAndOpenBgmi } from '@/lib/bgmi';
import { cx } from './ui';

/**
 * "Open BGMI" for squad players on Android phones (never the admin, and not on iPhone or computers, where a web
 * app can't start the game). With `copy`, it copies that text (the room ID) first so it's ready to paste.
 */
export function OpenBgmiButton({ copy, label, className }: { copy?: string | null; label?: string; className?: string }) {
  const { isCaptain } = useAuth();
  if (isCaptain || !canOpenBgmi()) return null;
  return (
    <a href={bgmiLink()} onClick={(e) => { e.preventDefault(); void copyAndOpenBgmi(copy); }}
      className={cx('btn-primary justify-center', className)}>
      <Gamepad2 className="h-4 w-4" aria-hidden />{label ?? (copy ? 'Copy ID & open BGMI' : 'Open BGMI')}
    </a>
  );
}
