import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { X } from 'lucide-react';
import { cx } from '@/components/ui';

/**
 * Bottom sheet on phones (drag the handle or swipe the header down to close), centred panel on wider
 * screens. Scrolls inside itself and keeps clear of the notch and the home bar.
 */
export function Sheet({ open, onClose, title, subtitle, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const drag = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="sheet" className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 backdrop-blur-[2px] sm:items-center sm:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} onClick={onClose}>
          <motion.div role="dialog" aria-modal="true" aria-label={title}
            className={cx('glass flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-ink-900 shadow-2xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%', transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            drag="y" dragControls={drag} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => { if (i.offset.y > 90 || i.velocity.y > 600) onClose(); }}
            onClick={(e) => e.stopPropagation()}>
            <div className="touch-none select-none border-b border-white/[0.06] px-4 pb-3 pt-2 sm:pt-4" onPointerDown={(e) => drag.start(e)}>
              <span aria-hidden className="mx-auto mb-2 block h-1 w-10 rounded-full bg-white/20 sm:hidden" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg font-bold uppercase leading-tight tracking-wide text-white">{title}</p>
                  {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
                </div>
                <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
            {footer && <div className="border-t border-white/[0.06] px-4 pt-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
