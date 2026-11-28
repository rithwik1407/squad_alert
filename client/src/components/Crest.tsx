import { motion } from 'framer-motion';
import { cx } from './ui';

export const CREST_SRC = '/icons/rare-logo.webp';

/**
 * The Team RARE crest (transparent, no black box) with a breathing ember glow behind it
 * and a light sweep that glints across the logo every few seconds. Hover/tap gives it a little kick.
 * All motion is transform/opacity so it stays on the compositor; reduced-motion turns it off (index.css).
 */
export function Crest({ size = 40, className, glow = true, shine = true, interactive = true }: {
  size?: number; className?: string; glow?: boolean; shine?: boolean; interactive?: boolean;
}) {
  return (
    <motion.span
      aria-hidden
      className={cx('crest relative inline-block shrink-0', className)}
      style={{ width: size, height: size }}
      whileHover={interactive ? { scale: 1.1, rotate: [0, -7, 6, -3, 0], transition: { duration: 0.5 } } : undefined}
      whileTap={interactive ? { scale: 0.9 } : undefined}
    >
      {glow && <span className="crest-glow" />}
      <img src={CREST_SRC} alt="" width={size} height={size} draggable={false} className="crest-img relative h-full w-full object-contain" />
      {shine && <span className="crest-shine"><i /></span>}
    </motion.span>
  );
}
