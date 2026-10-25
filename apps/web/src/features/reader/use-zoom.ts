import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Options {
  min: number;
  max: number;
  /** Full-screen: the plain wheel zooms and a drag pans. Otherwise only Ctrl/⌘ + wheel zooms. */
  immersive: boolean;
}

type Point = { clientX: number; clientY: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Zoom and pan for one scrolling element. The point under the cursor (or between two fingers)
 * stays put while zooming, like a photo viewer. Works with a mouse wheel, a trackpad pinch
 * (Ctrl + wheel in every browser), a two-finger pinch on touch screens, and a drag to pan.
 */
export function useZoom(scroller: RefObject<HTMLElement | null>, { min, max, immersive }: Options) {
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

  return { zoom, zoomTo, reset: () => zoomTo(1) };
}
