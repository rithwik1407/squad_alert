import Lenis from 'lenis';

/**
 * Smooth, eased page scrolling for mouse wheels and trackpads (Lenis). Phones keep their own native
 * scrolling, which already feels right and is what people expect, so nothing changes on touch.
 * Anything that scrolls on its own (chat, pop-ups, side lists) keeps native scrolling too.
 */
let lenis: Lenis | null = null;

const SCROLLS = /(^|\s)(overflow-(y-)?(auto|scroll)|no-scrollbar)(\s|$)/;

export function startSmoothScroll() {
  if (lenis || typeof window === 'undefined') return;
  const fine = window.matchMedia('(pointer: fine)').matches;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduce) return;
  lenis = new Lenis({
    autoRaf: true,
    lerp: 0.12,
    allowNestedScroll: true,
    wheelMultiplier: 1,
    // Let inner scroll areas scroll themselves.
    prevent: (node) => node instanceof HTMLElement && (node.hasAttribute('data-lenis-prevent') || SCROLLS.test(node.className)),
  });
  // Lenis owns smooth scrolling now, so the CSS version would double it up.
  document.documentElement.style.scrollBehavior = 'auto';
}

/** Jump to the top on a new page, without a long eased scroll. */
export function scrollTopNow() {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  else window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
}

/** Pause page scrolling while a sheet or pop-up is open. */
export function setScrollLocked(locked: boolean) {
  if (!lenis) return;
  if (locked) lenis.stop(); else lenis.start();
}
