import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

/** Empty state with a small animated illustration (crosshair over a drop zone). */
export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center px-6 py-10 text-center">
      <svg viewBox="0 0 160 120" className="mb-4 h-28 w-36" aria-hidden>
        <defs>
          <radialGradient id="es-g" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#ff8a1f" stopOpacity=".35" /><stop offset="1" stopColor="#ff8a1f" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse cx="80" cy="100" rx="56" ry="10" fill="url(#es-g)" />
        <motion.g animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
          <path d="M80 18 C 58 18 44 34 44 50 L 80 62 L 116 50 C 116 34 102 18 80 18 Z" fill="#1f1f2b" stroke="#ffa94d" strokeOpacity=".5" />
          <path d="M44 50 L 72 82 M116 50 L 88 82 M80 62 L 80 82" stroke="#ffa94d" strokeOpacity=".45" />
          <rect x="70" y="80" width="20" height="16" rx="3" fill="#2a2a3a" stroke="#ffa94d" strokeOpacity=".6" />
        </motion.g>
        <g stroke="#ff8a1f" strokeWidth="2" opacity=".8">
          <circle cx="128" cy="92" r="9" fill="none" />
          <path d="M128 78v6M128 100v6M114 92h6M136 92h6" />
        </g>
      </svg>
      <h3 className="text-xl font-bold text-white">{title}</h3>
      {text && <p className="mt-1 max-w-xs text-sm text-zinc-400">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}
