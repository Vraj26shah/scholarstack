import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Fades and lifts its child in the first time it scrolls into view. */
export function Reveal({
  children,
  index = 0,
  as: Tag = 'div',
  className = '',
}: {
  children: ReactNode;
  index?: number;
  as?: 'div' | 'section' | 'li' | 'span';
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (reduced() || typeof IntersectionObserver === 'undefined') return setShown(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return (
    <Tag
      ref={ref as never}
      data-reveal=""
      data-shown={shown ? '' : undefined}
      className={className}
      style={{ ['--i' as string]: index } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

/** Counts up from 0 to `value` once visible. */
export function CountUp({ value, duration = 1100 }: { value: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced() || typeof IntersectionObserver === 'undefined') return setN(value);
    let raf = 0;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / duration);
        setN(Math.round(value * (1 - (1 - p) ** 3)));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);
  return (
    <span ref={ref} aria-label={String(value)}>
      {n.toLocaleString('en-IN')}
    </span>
  );
}
