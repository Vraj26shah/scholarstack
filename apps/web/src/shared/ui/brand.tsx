import type React from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * The mark: an S built from three stacked slabs (a stack of notes), with a marigold bookmark
 * tucked into the top one, "your semester, stacked, and you know where you stopped".
 * Ink Blue on light backgrounds, white on the blue hero, near-white in dark mode.
 */
export function LogoMark({ size = 36, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={`flex-none logo-mark ${onDark ? 'text-white' : 'text-[#2F3C7E] dark:text-[#ECEEF4]'}`}
    >
      <g fill="currentColor">
        <rect x="4" y="2" width="24" height="7.5" rx="3.2" />
        <rect x="4" y="2" width="7.5" height="18" rx="3.2" />
        <rect x="4" y="12.5" width="24" height="7.5" rx="3.2" />
        <rect x="20.5" y="12.5" width="7.5" height="18" rx="3.2" />
        <rect x="4" y="23" width="24" height="7.5" rx="3.2" />
      </g>
      <path d="M21 0.5h4.6v11.3l-2.3-1.9-2.3 1.9z" fill="#F5B83D" />
    </svg>
  );
}

export function Wordmark({ onDark = false, size = 'md' }: { onDark?: boolean; size?: 'sm' | 'md' }) {
  return (
    <Link
      to="/"
      className="group/logo flex items-center gap-1.5 sm:gap-2.5 no-underline min-w-0"
      aria-label="Scholars Stack home"
    >
      <span
        className={`transition-transform duration-300 group-hover/logo:-translate-y-px ${
          size === 'sm' ? '' : 'scale-[0.86] sm:scale-100 origin-left -mr-1 sm:mr-0'
        }`}
      >
        <LogoMark size={size === 'sm' ? 28 : 34} onDark={onDark} />
      </span>
      <span
        className={`font-brand font-extrabold tracking-[-0.045em] leading-none whitespace-nowrap min-w-0 ${
          size === 'sm' ? 'text-xl' : 'text-[16px] min-[380px]:text-[18px] sm:text-[25px]'
        } ${onDark ? 'text-white' : 'text-ink'}`}
      >
        <span className="hidden min-[360px]:inline">Scholars </span>
        <span className={onDark ? 'text-mist' : 'text-teal-text'}>Stack</span>
      </span>
    </Link>
  );
}

/** True once the element has been on screen (so a marker stroke draws when it's seen). */
function useShown<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setShown(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, shown] as const;
}

/**
 * The signature word ("stacked.", "drawer."): an italic serif with a slow light passing through
 * it. With `animate`, it wipes in softly the first time the page loads.
 */
export function StackWord({
  children,
  className = '',
  onDark = false,
  animate = false,
}: {
  children: string;
  className?: string;
  onDark?: boolean;
  animate?: boolean;
}) {
  // The marker stroke draws itself when the word comes into view, not while it's off-screen.
  const [ref, shown] = useShown<HTMLSpanElement>();
  return (
    <span
      ref={ref}
      data-shown={shown ? '' : undefined}
      className={`stack-word ${onDark ? 'on-dark' : ''} ${animate ? 'animate' : ''} ${className}`}
    >
      {children}
    </span>
  );
}

type PillTone = 'marigold' | 'mist' | 'glass' | 'quiet';

const PILL: Record<PillTone, string> = {
  marigold: 'bg-marigold text-on-marigold',
  mist: 'bg-mist text-on-mist',
  glass: 'bg-white/10 text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm',
  quiet: 'bg-sunk text-ink2 ring-1 ring-inset ring-line',
};

/** A small rounded label: savings, "free preview", counts. Marigold is kept for money moments. */
export function Pill({
  children,
  tone = 'marigold',
  className = '',
}: {
  children: React.ReactNode;
  tone?: PillTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap ${PILL[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

type StampTone = 'ink' | 'marigold' | 'blush';

const TONES: Record<StampTone, { fill: string; ink: string }> = {
  ink: { fill: '#FFFFFF', ink: '#2F3C7E' },
  marigold: { fill: '#F5B83D', ink: '#161B3A' },
  blush: { fill: '#FBEAEB', ink: '#9C3B4A' },
};

/** Circular rubber stamp with text around the edge. `animate` makes it land with a thud. */
export function Stamp({
  label,
  ring,
  size = 132,
  rotate = -14,
  tone = 'ink',
  animate = false,
  delay = 0.5,
  className = '',
}: {
  label: string;
  ring: string;
  size?: number;
  rotate?: number;
  tone?: StampTone;
  animate?: boolean;
  delay?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const t = TONES[tone];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 132 132"
      role="img"
      aria-label={`${label}, ${ring.replace(/·/g, ',')}`}
      className={`flex-none ${animate ? 'stamp-in' : ''} ${className}`}
      style={{
        transform: animate ? undefined : `rotate(${rotate}deg)`,
        ['--r' as string]: `${rotate}deg`,
        ['--delay' as string]: `${delay}s`,
      }}
    >
      <defs>
        <path id={`ring-${id}`} d="M66 66 m-46 0 a46 46 0 1 1 92 0 a46 46 0 1 1 -92 0" />
      </defs>
      <circle cx="66" cy="66" r="62" fill={t.fill} />
      <circle cx="66" cy="66" r="62" fill="none" stroke={t.ink} strokeWidth="3" />
      <circle cx="66" cy="66" r="34" fill="none" stroke={t.ink} strokeWidth="1.5" strokeDasharray="3 4" />
      <text
        fontFamily="JetBrains Mono, monospace"
        fontSize="10.5"
        fontWeight="600"
        letterSpacing="2"
        fill={t.ink}
      >
        <textPath href={`#ring-${id}`}>{ring}</textPath>
      </text>
      <text
        x="66"
        y="75"
        textAnchor="middle"
        fontFamily="Bricolage Grotesque, sans-serif"
        fontWeight="800"
        fontSize={label.length > 5 ? 22 : 28}
        fill={t.ink}
      >
        {label}
      </text>
    </svg>
  );
}

/**
 * A key phrase in body copy: slightly bolder, underlined with the same hand-drawn marker stroke as
 * the accent words. Wraps cleanly across lines. Use one or two per block, for what a student must know.
 */
export function Hl({ children, onDark = false }: { children: React.ReactNode; onDark?: boolean }) {
  const [ref, shown] = useShown<HTMLElement>();
  return (
    <mark ref={ref} data-shown={shown ? '' : undefined} className={`hl ${onDark ? 'on-dark' : ''}`}>
      {children}
    </mark>
  );
}
