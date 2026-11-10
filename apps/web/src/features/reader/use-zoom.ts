import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

interface Options {
  min: number;
  max: number;
  /** Full-screen: the plain wheel zooms and a drag pans. Otherwise only Ctrl/⌘ + wheel zooms. */
  immersive: boolean;
  /** A one-finger swipe past the edge of the page: 1 = next page, -1 = previous. */
  onSwipe?: (direction: 1 | -1) => void;
}

type Point = { clientX: number; clientY: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The + and − buttons move between round sizes (125%, 150%…), never 173%. */
export const ZOOM_STEPS = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

/** The next round size above (dir 1) or below (dir -1) the current zoom. */
export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? ZOOM_STEPS.at(-1)!;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_STEPS[0]!;
}

/**
 * Zoom and pan for one scrolling element. The point under the cursor (or between two fingers)
 * stays put while zooming, like a photo viewer. Works with a mouse wheel, a trackpad pinch
 * (Ctrl + wheel in every browser), a two-finger pinch on touch screens, and a drag to pan.
 */
export function useZoom(scroller: RefObject<HTMLElement | null>, { min, max, immersive, onSwipe }: Options) {
  const swipeRef = useRef(onSwipe);
  swipeRef.current = onSwipe;
  const [zoom, setZoomState] = useState(1);
  const zoomRef = useRef(1);
  const anchor = useRef<{ ax: number; ay: number; cx: number; cy: number; k: number } | null>(null);

  const zoomTo = useCallback(
    (next: number | ((z: number) => number), at?: Point) => {
      const prev = zoomRef.current;
      const z = clamp(Math.round((typeof next === 'function' ? next(prev) : next) * 100) / 100, min, max);
      if (z === prev) return;
      const el = scroller.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const ax = at ? at.clientX - rect.left : el.clientWidth / 2;
        const ay = at ? at.clientY - rect.top : el.clientHeight / 2;
        anchor.current = { ax, ay, cx: el.scrollLeft + ax, cy: el.scrollTop + ay, k: z / prev };
      }
      zoomRef.current = z;
      setZoomState(z);
    },
    [min, max, scroller],
  );

  // Keep the anchored point under the cursor once the new size has been laid out.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after each zoom change by design
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    anchor.current = null;
    if (!el || !a) return;
    el.scrollLeft = a.cx * a.k - a.ax;
    el.scrollTop = a.cy * a.k - a.ay;
  }, [zoom, scroller]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || immersive)) return;
      e.preventDefault();
      // Trackpad pinches send small deltas, mouse wheels large ones; both feel even this way.
      const factor = Math.exp(-clamp(e.deltaY, -120, 120) * (e.ctrlKey ? 0.01 : 0.0012));
      zoomTo((z) => z * factor, e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scroller, immersive, zoomTo]);

  // Pointer gestures (full screen only): drag to pan, two fingers to pinch, double-tap to zoom.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !immersive) return;
    const pointers = new Map<number, Point>();
    let pinch: { distance: number; zoom: number } | null = null;
    let lastTap = 0;
    // Where a one-finger drag began, and how far the page could still scroll each way then.
    let gesture: {
      x: number;
      y: number;
      t: number;
      left: boolean;
      right: boolean;
      top: boolean;
      bottom: boolean;
      multi: boolean;
    } | null = null;
    const distance = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
    };
    const mid = (): Point => {
      const [a, b] = [...pointers.values()];
      return { clientX: (a!.clientX + b!.clientX) / 2, clientY: (a!.clientY + b!.clientY) / 2 };
    };
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, a, input, textarea')) return;
      pointers.set(e.pointerId, e);
      el.setPointerCapture(e.pointerId);
      if (pointers.size === 1) {
        const slack = 2;
        gesture = {
          x: e.clientX,
          y: e.clientY,
          t: performance.now(),
          left: el.scrollLeft <= slack,
          right: el.scrollLeft + el.clientWidth >= el.scrollWidth - slack,
          top: el.scrollTop <= slack,
          bottom: el.scrollTop + el.clientHeight >= el.scrollHeight - slack,
          multi: false,
        };
      } else if (gesture) gesture.multi = true;
      if (pointers.size === 2) pinch = { distance: distance(), zoom: zoomRef.current };
      const now = performance.now();
      if (pointers.size === 1 && now - lastTap < 280) zoomTo((z) => (z > 1.05 ? 1 : 2), e);
      lastTap = now;
      el.dataset.dragging = '';
    };
    const move = (e: PointerEvent) => {
      const before = pointers.get(e.pointerId);
      if (!before) return;
      pointers.set(e.pointerId, e);
      if (pointers.size === 2 && pinch) {
        zoomTo(pinch.zoom * (distance() / pinch.distance), mid());
      } else if (pointers.size === 1) {
        el.scrollLeft -= e.clientX - before.clientX;
        el.scrollTop -= e.clientY - before.clientY;
      }
    };
    const up = (e: PointerEvent) => {
      const g = gesture;
      if (g && pointers.size === 1 && !g.multi && e.type === 'pointerup') {
        gesture = null;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        const quick = performance.now() - g.t < 800;
        // A flick that the page could not follow (it was already at that edge) turns the page.
        if (quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          if (dx < 0 && g.right) swipeRef.current?.(1);
          else if (dx > 0 && g.left) swipeRef.current?.(-1);
        } else if (quick && Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.4) {
          if (dy < 0 && g.bottom) swipeRef.current?.(1);
          else if (dy > 0 && g.top) swipeRef.current?.(-1);
        }
      }
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) delete el.dataset.dragging;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [scroller, immersive, zoomTo]);

  // Stable functions, so key handlers that use them aren't re-attached on every render.
  const actions = useMemo(
    () => ({
      reset: () => zoomTo(1),
      zoomIn: () => zoomTo((z) => stepZoom(z, 1)),
      zoomOut: () => zoomTo((z) => stepZoom(z, -1)),
    }),
    [zoomTo],
  );
  return { zoom, zoomTo, ...actions };
}

/**
 * Turning pages with a finger outside full screen: a sideways flick on the page goes to the
 * next or previous page, while up and down still scroll the screen and two fingers still zoom.
 */
export function useSwipe(el: HTMLElement | null, onSwipe: (direction: 1 | -1) => void, on = true) {
  const cb = useRef(onSwipe);
  cb.current = onSwipe;
  useEffect(() => {
    if (!el || !on) return;
    let start: { x: number; y: number; t: number; id: number } | null = null;
    let touches = 0;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      touches += 1;
      start = touches === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId } : null;
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      touches = Math.max(0, touches - 1);
      const s = start;
      if (!s || s.id !== e.pointerId || e.type !== 'pointerup') {
        start = null;
        return;
      }
      start = null;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (performance.now() - s.t < 800 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4)
        cb.current(dx < 0 ? 1 : -1);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [el, on]);
}
