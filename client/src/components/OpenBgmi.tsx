import { Gamepad2 } from 'lucide-react';
import { bgmiLink, copyAndOpenBgmi } from '@/lib/bgmi';
import { cx } from './ui';

/** Big "Open BGMI" button. With `copy`, it copies that text (the room ID) first so it's ready to paste in the game. */
export function OpenBgmiButton({ copy, label, className }: { copy?: string | null; label?: string; className?: string }) {
  return (
    <a href={bgmiLink()} onClick={(e) => { if (copy) { e.preventDefault(); void copyAndOpenBgmi(copy); } }}
      className={cx('btn-primary justify-center', className)}>
      <Gamepad2 className="h-4 w-4" aria-hidden />{label ?? (copy ? 'Copy ID & open BGMI' : 'Open BGMI')}
    </a>
  );
}
