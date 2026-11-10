import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SwipeHint } from './swipe-hint';

/** Phones only. A swipe counts past a quarter of the screen, or as a quick flick. */
const PHONE = '(max-width: 767px)';
const COMMIT = 0.25;

/** Places that own sideways gestures themselves: sheets, form fields, the reader's canvas. */
function ownsSwipe(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return !!el?.closest('[data-no-swipe], [role="dialog"], input, textarea, select, canvas');
}

/**
 * The nearest thing under the finger that scrolls sideways (a table, a row of tabs), unless it is
 * marked data-swipe-through (rows of section tabs, which follow the swipe instead).
 */
function scrollerAt(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== document.body) {
    if (el.hasAttribute('data-swipe-through')) return null;
    const style = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && (style.overflowX === 'auto' || style.overflowX === 'scroll'))
      return el;
    el = el.parentElement;
  }
  return null;
}

/** Swipe zones inside a page (the catalogue's branch drawer): id → which ways it can go. */
const zones = new Map<string, () => { next: boolean; prev: boolean }>();

/** The zone that takes this swipe, if the touch began inside one that can go that way. */
function zoneFor(start: EventTarget | null, dx: number): string | null {
  if (!(start instanceof Node)) return null;
  for (const [id, can] of zones) {
    const el = document.getElementById(id);
    if (el?.contains(start) && (dx < 0 ? can().next : can().prev)) return id;
  }
  return null;
}

/**
 * Sideways swipes between sections, the way Instagram moves between tabs: the page follows the
 * finger one to one, a quarter of the way across (or a quick flick) carries it off the screen
 * and the next section slides in from that side; less than that and it springs back. At the
 * first or last section the page only gives a little, so it's clear there's nothing more.
 *
 * With `zone`, only swipes that begin inside that element count, and they move `target` (the
 * branch drawer's cards between branches). A zone takes a swipe only when it has somewhere to go
 * that way; otherwise the page's own swipe gets it (last branch → the next tab). Anything that
 * scrolls sideways (a carousel, a wide table) keeps the swipe for itself.
 */
export function useSectionSwipe(opts: {
  enabled: boolean;
  onNext?: () => void;
  onPrev?: () => void;
  /** The element (by id) that follows the finger and slides in. */
  target?: string;
  /** Only swipes that start inside this element (by id). */
  zone?: string;
}) {
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    if (!opts.enabled || typeof window === 'undefined' || !window.matchMedia?.(PHONE).matches) return;
    const zone = ref.current.zone;
    if (zone) zones.set(zone, () => ({ next: !!ref.current.onNext, prev: !!ref.current.onPrev }));
    let start: {
      x: number;
      y: number;
      t: number;
      target: EventTarget | null;
      scroller: HTMLElement | null;
    } | null = null;
    let sideways = false;
    let leaving = false;
    const el = () => document.getElementById(ref.current.target ?? 'main');
    const set = (x: number, ms = 0) => {
      const m = el();
      if (!m) return;
      m.style.transition = ms ? `transform ${ms}ms cubic-bezier(.22,1,.36,1)` : 'none';
      m.style.transform = x ? `translate3d(${x.toFixed(1)}px,0,0)` : '';
    };
    const down = (e: TouchEvent) => {
      if (leaving || e.touches.length !== 1 || ownsSwipe(e.target)) {
        start = null;
        return;
      }
      if (zone && !(e.target instanceof Node && document.getElementById(zone)?.contains(e.target))) {
        start = null;
        return;
      }
      const t = e.touches[0]!;
      start = { x: t.clientX, y: t.clientY, t: Date.now(), target: e.target, scroller: scrollerAt(e.target) };
      sideways = false;
    };
    const move = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!sideways) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          start = null; // a scroll: let it be
          return;
        }
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          // Who takes it: anything that scrolls sideways keeps the gesture for itself (a carousel
          // flicked to its end must not throw you to the next page), then a zone, then the page.
          const taker = start.scroller ? 'scroller' : zoneFor(start.target, dx);
          if (taker === 'scroller' || (zone ? taker !== zone : taker !== null)) {
            start = null;
            return;
          }
          sideways = true;
        }
      }
      if (!sideways) return;
      const can = dx < 0 ? !!ref.current.onNext : !!ref.current.onPrev;
      set(can ? dx : dx * 0.18);
    };
    const up = (e: TouchEvent) => {
      if (!start) return;
      const t = e.changedTouches[0]!;
      const dx = t.clientX - start.x;
      const ms = Date.now() - start.t;
      const wasSideways = sideways;
      start = null;
      sideways = false;
      if (!wasSideways) return set(0);
      const width = el()?.clientWidth || window.innerWidth;
      const flick = ms < 280 && Math.abs(dx) > 50;
      const go = dx < 0 ? ref.current.onNext : ref.current.onPrev;
      if (!go || (Math.abs(dx) < width * COMMIT && !flick)) return set(0, 220);
      // Carry it off the screen, then show the next one sliding in from that side.
      leaving = true;
      set(dx < 0 ? -window.innerWidth : window.innerWidth, 170);
      window.setTimeout(() => {
        const root = document.documentElement;
        root.dataset.swipe = dx < 0 ? 'next' : 'prev';
        root.dataset.swipeTarget = ref.current.target ?? 'main';
        set(0);
        go();
        // A whole section starts at the top; a zone stays where it is.
        if (!zone) window.scrollTo({ top: 0 });
        // The next swipe can start while this one slides in.
        leaving = false;
        window.setTimeout(() => {
          delete root.dataset.swipe;
          delete root.dataset.swipeTarget;
        }, 320);
      }, 170);
    };
    const cancel = () => {
      start = null;
      sideways = false;
      set(0, 200);
    };
    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', up, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      if (zone) zones.delete(zone);
      document.removeEventListener('touchstart', down);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      document.removeEventListener('touchcancel', cancel);
      set(0);
    };
  }, [opts.enabled]);
}

/**
 * Slide a section over to its next (or previous) page, the same way a swipe does: the old view
 * leaves to one side, `go` swaps the content, and the new one slides in from the other side.
 * Used by laptop arrows and trackpad swipes so every way of changing branch feels the same.
 */
export function slideTo(target: string, dir: 'next' | 'prev', go: () => void, from = 0) {
  const el = document.getElementById(target);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!el || reduce) return go();
  const width = el.clientWidth || window.innerWidth;
  const off = dir === 'next' ? -width : width;
  el.style.transition = `transform ${from ? 170 : 140}ms cubic-bezier(.4,0,1,1)`;
  if (!from) el.style.transform = 'translate3d(0,0,0)';
  // Next frame, so the browser sees where it starts.
  requestAnimationFrame(() => {
    el.style.transform = `translate3d(${off}px,0,0)`;
  });
  window.setTimeout(
    () => {
      const root = document.documentElement;
      root.dataset.swipe = dir;
      root.dataset.swipeTarget = target;
      el.style.transition = 'none';
      el.style.transform = '';
      go();
      window.setTimeout(() => {
        delete root.dataset.swipe;
        delete root.dataset.swipeTarget;
      }, 320);
    },
    from ? 170 : 140,
  );
}

/**
 * Laptops: a two-finger sideways swipe on the trackpad (or Shift + mouse wheel) over `zone`
 * moves `target` to the next or previous page, following the fingers the way a phone swipe does.
 * The browser's own "swipe to go back" is held off while the swipe is ours, and the trackpad's
 * coasting after a swipe is swallowed, so one swipe moves exactly one page.
 */
export function useTrackpadSwipe(opts: {
  enabled: boolean;
  zone: string;
  target: string;
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    if (!opts.enabled || typeof window === 'undefined' || window.matchMedia?.(PHONE).matches) return;
    let pull = 0; // how far the fingers have moved (negative: towards next)
    let active = false;
    let locked = false; // after a page change, until the trackpad stops coasting
    let idle: number | undefined;
    let quiet: number | undefined;
    const el = () => document.getElementById(ref.current.target);
    const set = (x: number, ms = 0) => {
      const m = el();
      if (!m) return;
      m.style.transition = ms ? `transform ${ms}ms cubic-bezier(.22,1,.36,1)` : 'none';
      m.style.transform = x ? `translate3d(${x.toFixed(1)}px,0,0)` : '';
    };
    const settle = () => {
      if (active) set(0, 220);
      active = false;
      pull = 0;
    };
    const wheel = (e: WheelEvent) => {
      const z = document.getElementById(ref.current.zone);
      if (!z || !(e.target instanceof Node) || !z.contains(e.target)) return;
      const dx = e.deltaX * (e.deltaMode === 1 ? 16 : 1);
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      if (locked) {
        if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
        window.clearTimeout(quiet);
        quiet = window.setTimeout(() => {
          locked = false;
        }, 220);
        return;
      }
      if (!active) {
        // Up-and-down scrolling, the tab row and anything that scrolls sideways keep the wheel.
        if (Math.abs(dx) < 4 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        const t = e.target instanceof Element ? e.target : null;
        if (ownsSwipe(t) || t?.closest('[role="tablist"]') || scrollerAt(t)) return;
      }
      e.preventDefault();
      active = true;
      pull -= dx;
      const go = pull < 0 ? ref.current.onNext : ref.current.onPrev;
      const width = el()?.clientWidth || 900;
      const shown = go ? Math.max(-width, Math.min(width, pull)) * 0.55 : pull * 0.1;
      window.clearTimeout(idle);
      if (go && Math.abs(pull) > Math.min(200, width * 0.16)) {
        active = false;
        locked = true;
        quiet = window.setTimeout(() => {
          locked = false;
        }, 400);
        const dir = pull < 0 ? 'next' : 'prev';
        pull = 0;
        slideTo(ref.current.target, dir, go, shown);
        return;
      }
      set(shown);
      idle = window.setTimeout(settle, 300);
    };
    document.addEventListener('wheel', wheel, { passive: false });
    return () => {
      document.removeEventListener('wheel', wheel);
      window.clearTimeout(idle);
      window.clearTimeout(quiet);
      set(0);
    };
  }, [opts.enabled]);
}

/** The phone tabs, in the order of the tab bar. */
const TABS = ['/#catalogue', '/shelf', '/contribute', '/#toolbox'] as const;

function tabIndex(pathname: string, hash: string): number {
  if (pathname === '/') return hash === '#toolbox' ? 3 : 0;
  if (pathname === '/shelf') return 1;
  if (pathname === '/contribute') return 2;
  return -1;
}

/**
 * Swipe between Catalogue, Shelf, Earn and Toolbox on phones. Only on those four screens: a
 * course swipes to the next course in its drawer, the reader's swipes turn pages, and the admin
 * swipes between its own sections.
 */
export function SwipeTabs() {
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const i = tabIndex(pathname, hash);
  useSectionSwipe({
    enabled: i >= 0,
    ...(i >= 0 && i < TABS.length - 1 ? { onNext: () => navigate(TABS[i + 1]!) } : {}),
    ...(i > 0 ? { onPrev: () => navigate(TABS[i - 1]!) } : {}),
  });
  // Above the phone tab bar, the first few visits: the four tabs can be swiped between.
  return i >= 0 ? (
    <SwipeHint
      id="main-tabs"
      times={2}
      floating
      className="pointer-events-none fixed left-1/2 z-40 -translate-x-1/2 bottom-[calc(84px+env(safe-area-inset-bottom))] shadow-[0_10px_30px_-12px_var(--shadow)] whitespace-nowrap"
    >
      Swipe sideways between tabs
    </SwipeHint>
  ) : null;
}
