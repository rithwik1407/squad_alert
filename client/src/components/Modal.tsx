import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from './ui';
import { setScrollLocked } from '@/lib/smoothScroll';

/**
 * One pop-up shell for the whole app. It is portalled to <body> so a transformed parent (page transitions,
 * motion cards) can never shift it, it scrolls inside itself when taller than the screen, and it keeps clear
 * of the notch / home bar. On phones it sits at the bottom like a sheet; on wider screens it is centred.
 */
export function Modal({ open, onClose, labelledBy, children }: {
  open: boolean; onClose: () => void; labelledBy?: string; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setScrollLocked(true);
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; setScrollLocked(false); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal"
          role="dialog" aria-modal="true" aria-labelledby={labelledBy}
          data-lenis-prevent
          className="fixed inset-0 z-[90] overflow-y-auto overscroll-contain bg-black/70"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}
          onClick={onClose}
        >
          <div className="flex min-h-full items-end justify-center sm:items-center"
            style={{ padding: 'max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom))' }}>
            <motion.div
              className="glass w-full max-w-sm rounded-2xl bg-ink-900 p-5"
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

type Ask = {
  title: string; text?: string; confirmLabel?: string; danger?: boolean;
  /** When set, the dialog shows a text box and resolves with its value (or null on cancel). */
  input?: { placeholder?: string; inputMode?: 'numeric' | 'text' };
  resolve: (v: string | boolean | null) => void;
};

const DialogCtx = createContext<(a: Omit<Ask, 'resolve'>) => Promise<string | boolean | null>>(() => Promise.resolve(null));

/** In-app replacements for window.confirm / window.prompt, which look broken or jump around on phones. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [val, setVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const open = useCallback((a: Omit<Ask, 'resolve'>) => new Promise<string | boolean | null>((resolve) => {
    setVal('');
    setAsk({ ...a, resolve });
  }), []);
  const close = useCallback((v: string | boolean | null) => { setAsk((a) => { a?.resolve(v); return null; }); }, []);
  const cancel = useCallback(() => close(ask?.input ? null : false), [ask, close]);

  useEffect(() => { if (ask?.input) setTimeout(() => inputRef.current?.focus(), 50); }, [ask]);

  return (
    <DialogCtx.Provider value={open}>
      {children}
      <Modal open={!!ask} onClose={cancel} labelledBy="app-dialog-title">
        {ask && (
          <form onSubmit={(e) => { e.preventDefault(); close(ask.input ? val : true); }}>
            <h3 id="app-dialog-title" className="text-lg font-bold text-white">{ask.title}</h3>
            {ask.text && <p className="mt-2 text-sm text-zinc-300">{ask.text}</p>}
            {ask.input && (
              <input ref={inputRef} className="input mt-3" value={val} onChange={(e) => setVal(e.target.value)}
                placeholder={ask.input.placeholder} inputMode={ask.input.inputMode} />
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={cancel}>Cancel</Button>
              <Button type="submit" variant={ask.danger ? 'danger' : 'primary'}>{ask.confirmLabel ?? 'OK'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </DialogCtx.Provider>
  );
}

export function useDialog() {
  const open = useContext(DialogCtx);
  return {
    confirm: (title: string, opts: { text?: string; confirmLabel?: string; danger?: boolean } = {}) =>
      open({ title, ...opts }).then((v) => v === true),
    prompt: (title: string, opts: { text?: string; placeholder?: string; inputMode?: 'numeric' | 'text'; confirmLabel?: string } = {}) =>
      open({ title, text: opts.text, confirmLabel: opts.confirmLabel, input: { placeholder: opts.placeholder, inputMode: opts.inputMode } })
        .then((v) => (typeof v === 'string' ? v : null)),
  };
}
