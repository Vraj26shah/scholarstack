import type { MouseEvent } from 'react';

/**
 * An in-page link that works every time: scrolls straight to the element (its scroll-margin keeps
 * it clear of sticky bars) without changing the address. A plain #hash link does nothing when the
 * address already has that hash, so a second tap on "Order now" or a category looked broken.
 */
export function jumpTo(id: string) {
  return (e?: MouseEvent) => {
    e?.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
}
