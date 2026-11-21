import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
interface T { id: number; kind: Kind; text: string }
const TTL = 3800;
const Ctx = createContext<(kind: Kind, text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-2), { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), TTL);
  }, []);
  const dismiss = useCallback((id: number) => setItems((s) => s.filter((x) => x.id !== id)), []);
  const Icon = { success: CheckCircle2, error: AlertTriangle, info: Info };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,calc(env(safe-area-inset-top)_+_0.5rem))] z-[95] flex flex-col items-center gap-2 px-4 sm:top-auto sm:bottom-6 sm:right-6 sm:left-auto sm:items-end" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const I = Icon[t.kind];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: -16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 30 } }}
                exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.16 } }}
                // Swipe sideways to dismiss.
                drag="x"
                dragSnapToOrigin
                dragElastic={0.6}
                onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 80 || Math.abs(info.velocity.x) > 500) dismiss(t.id); }}
                className="glass pointer-events-auto relative flex w-full max-w-sm touch-pan-y cursor-grab items-start gap-3 overflow-hidden bg-ink-850/90 px-4 py-3 text-sm shadow-2xl active:cursor-grabbing"
              >
                <I className={t.kind === 'error' ? 'mt-0.5 h-4 w-4 shrink-0 text-red-400' : t.kind === 'success' ? 'mt-0.5 h-4 w-4 shrink-0 text-emerald-400' : 'mt-0.5 h-4 w-4 shrink-0 text-ember-400'} aria-hidden />
                <span className="flex-1 text-zinc-100">{t.text}</span>
                {/* Time left before it closes on its own. */}
                <motion.span aria-hidden className={'absolute inset-x-0 bottom-0 h-0.5 origin-left ' + (t.kind === 'error' ? 'bg-red-400/60' : t.kind === 'success' ? 'bg-emerald-400/60' : 'bg-ember-400/60')}
                  initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: TTL / 1000, ease: 'linear' }} />
                <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-zinc-500 hover:text-zinc-200">
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  return {
    success: (t: string) => push('success', t),
    error: (t: string | unknown) => push('error', typeof t === 'string' ? t : (t as Error)?.message ?? 'Something went wrong'),
    info: (t: string) => push('info', t),
  };
}
