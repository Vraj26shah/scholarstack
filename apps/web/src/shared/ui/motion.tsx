import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Fades and lifts its child in the first time it scrolls into view. */
export function Reveal({
  children,
  index = 0,
  as: Tag = 'div',
  className = '',
  id,
}: {
  children: ReactNode;
  index?: number;
  as?: 'div' | 'section' | 'li' | 'span';
  className?: string;
  id?: string;
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
      id={id}
      className={className}
      style={{ ['--i' as string]: index } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
