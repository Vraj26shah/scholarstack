import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { pageName, previousPage } from '../../lib/nav-history';
import { ChevronLeft } from './icons';

/**
 * Goes back to the page the student came from (a course, a bundle, the catalogue, their shelf…),
 * like the browser's Back but skipping pages that would be pointless to land on (`skip`). When
 * there is no earlier page in this tab (opened from a link), it goes to `fallback` instead.
 */
export function useBack(fallback: string, skip?: (path: string) => boolean) {
  const navigate = useNavigate();
  const prev = previousPage(skip);
  return {
    label: `Back to ${pageName(prev?.path ?? fallback)}`,
    go: () => (prev ? navigate(prev.delta) : navigate(fallback)),
  };
}

type BackSize = 'md' | 'lg';

const SIZES: Record<BackSize, { pill: string; disc: string; icon: number }> = {
  md: { pill: 'h-10 pl-1.5 pr-4 text-[14px]', disc: 'h-7 w-7', icon: 16 },
  lg: { pill: 'h-11 pl-1.5 pr-5 text-[15px]', disc: 'h-8 w-8', icon: 17 },
};

/**
 * The one "Back to …" look: a quiet pill with a chevron disc that fills navy and nudges left on
 * hover. Every back button and "Back to catalogue" link uses it, so they read as the same control.
 */
export function backClass(size: BackSize = 'md', extra = '') {
  return `group inline-flex items-center gap-2 self-start rounded-full border border-line bg-surface font-semibold text-ink no-underline whitespace-nowrap cursor-pointer select-none shadow-[0_8px_18px_-14px_var(--shadow)] transition-[border-color,box-shadow] duration-200 hover:border-ink2 hover:shadow-[0_10px_22px_-14px_var(--shadow)] focus-visible:outline press ${SIZES[size].pill} ${extra}`;
}

export function BackInner({ size = 'md', children }: { size?: BackSize; children: ReactNode }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={`flex-none grid place-items-center rounded-full bg-sunk text-ink transition-[transform,background-color,color] duration-200 group-hover:-translate-x-0.5 group-hover:bg-brand group-hover:text-white ${SIZES[size].disc}`}
      >
        <ChevronLeft size={SIZES[size].icon} strokeWidth={2.4} />
      </span>
      <span>{children}</span>
    </>
  );
}

export function BackLink({
  fallback,
  skip,
  size = 'md',
  className = '',
  children,
}: {
  fallback: string;
  skip?: (path: string) => boolean;
  size?: BackSize;
  /** Placement only (margins, print:hidden); the look is fixed. */
  className?: string;
  /** Custom content; defaults to "Back to <page>". Receives the label for screen readers. */
  children?: (label: string) => ReactNode;
}) {
  const back = useBack(fallback, skip);
  return (
    <button
      type="button"
      onClick={back.go}
      aria-label={back.label}
      title={back.label}
      className={backClass(size, className)}
    >
      <BackInner size={size}>{children ? children(back.label) : back.label}</BackInner>
    </button>
  );
}

/** A fixed "Back to catalogue" link (404, unsubscribe) in the same look as BackLink. */
export function CatalogueLink({ size = 'md', className = '' }: { size?: BackSize; className?: string }) {
  return (
    <Link to="/" className={backClass(size, className)}>
      <BackInner size={size}>Back to catalogue</BackInner>
    </Link>
  );
}
