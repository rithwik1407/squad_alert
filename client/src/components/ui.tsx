import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { Loader2, Lock } from 'lucide-react';
import { item, spring } from '@/lib/motion';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export const Card = forwardRef<HTMLDivElement, HTMLMotionProps<'div'> & { glow?: boolean; interactive?: boolean }>(
  ({ className, glow, interactive, ...p }, ref) => (
    <motion.div
      ref={ref}
      variants={item}
      initial="initial"
      animate="animate"
      whileHover={interactive ? { y: -3, transition: spring } : undefined}
      whileTap={interactive ? { scale: 0.985 } : undefined}
      className={cx('glass gborder p-4 sm:p-5', glow && 'shadow-glow', className)}
      {...p}
    />
  ),
);
Card.displayName = 'Card';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = 'primary', loading, icon, children, className, disabled, ...p }: BtnProps) {
  return (
    <motion.button
      whileHover={{ scale: disabled || loading ? 1 : 1.02 }}
      whileTap={{ scale: disabled || loading ? 1 : 0.96 }}
      transition={spring}
      className={cx(variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : 'btn-ghost', className)}
      disabled={disabled || loading}
      {...(p as HTMLMotionProps<'button'>)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </motion.button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cx('relative overflow-hidden rounded-xl bg-white/[0.05]', className)} aria-hidden>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
  );
}

export function PageHeader({ eyebrow, title, action, children }: { eyebrow?: string; title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-7">
      <div>
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-3xl font-bold leading-none text-white sm:text-4xl">{title}</h1>
        {children && <p className="mt-2 text-sm text-zinc-400">{children}</p>}
      </div>
      {action}
    </header>
  );
}

export function LockBadge({ className }: { className?: string }) {
  return (
    <span className={cx('chip bg-zinc-200/10 text-zinc-200 ring-1 ring-white/15', className)} title="Notification sent: squad locked">
      <Lock className="h-3 w-3" aria-hidden /> Locked
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  scheduled: 'bg-sky-400/10 text-sky-300 ring-sky-400/25',
  notified: 'bg-ember-500/15 text-ember-300 ring-ember-400/30',
  live: 'bg-red-500/15 text-red-300 ring-red-400/30',
  done: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25',
  cancelled: 'bg-zinc-500/10 text-zinc-400 ring-zinc-400/20',
  sent: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25',
  failed: 'bg-red-500/15 text-red-300 ring-red-400/30',
  pending: 'bg-amber-400/10 text-amber-300 ring-amber-400/25',
  skipped: 'bg-zinc-500/10 text-zinc-400 ring-zinc-400/20',
};

export function StatusChip({ status, children }: { status: string; children?: ReactNode }) {
  return (
    <span className={cx('chip ring-1', STATUS_STYLE[status] ?? STATUS_STYLE.skipped)}>
      {status === 'live' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" aria-hidden />}
      {children ?? status}
    </span>
  );
}

export function Avatar({ name, src, size = 40, dim }: { name: string; src?: string; size?: number; dim?: boolean }) {
  const clean = name.replace(/^RARE丨/i, '');
  const initials = clean.slice(0, 2).toUpperCase();
  let hash = 0;
  for (const ch of clean) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = 18 + (hash % 30);
  return src ? (
    <img src={src} alt="" width={size} height={size} className={cx('rounded-xl object-cover', dim && 'grayscale')} style={{ width: size, height: size }} />
  ) : (
    <div
      aria-hidden
      className={cx('grid shrink-0 place-items-center rounded-xl font-display font-bold text-ink-950', dim && 'grayscale opacity-60')}
      style={{
        width: size, height: size, fontSize: size * 0.4,
        background: `linear-gradient(135deg, hsl(${hue} 100% 70%), hsl(${hue + 8} 95% 50%))`,
      }}
    >
      {initials}
    </div>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-300">{error}</span> : hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, icon, ...p }: { label: string; value: ReactNode; icon?: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3" {...p}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-400">{icon}{label}</div>
      <div className="mt-1 font-display text-2xl font-bold text-white">{value}</div>
    </div>
  );
}
