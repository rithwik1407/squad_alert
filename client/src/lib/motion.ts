import type { Transition, Variants } from 'framer-motion';

export const spring: Transition = { type: 'spring', stiffness: 380, damping: 30 };
export const softSpring: Transition = { type: 'spring', stiffness: 220, damping: 26 };

export const list: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

export const item: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

export const shake = { x: [0, -10, 10, -8, 8, -4, 4, 0], transition: { duration: 0.45 } };
