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

/**
 * The one "Back to …" look. md: a plain text link at the top of a page (muted; the chevron nudges
 * left on hover). lg: the outline button, for when going back sits beside a screen's other buttons.
 */
const LOOKS: Record<BackSize, string> = {
  md: '-ml-1 h-8 gap-0.5 rounded-md pr-1.5 text-[14px] font-medium text-ink2 hover:text-ink',
  lg: 'h-11 gap-1.5 rounded-full border-[1.5px] border-line pl-3.5 pr-5 text-[15px] font-semibold text-ink hover:border-ink2 press',
};

export function backClass(size: BackSize = 'md', extra = '') {
  return `group inline-flex items-center self-start whitespace-nowrap no-underline cursor-pointer select-none bg-transparent transition-colors duration-150 focus-visible:outline ${LOOKS[size]} ${extra}`;
}

export function BackInner({ size = 'md', children }: { size?: BackSize; children: ReactNode }) {
  return (
    <>
      <ChevronLeft
        size={size === 'lg' ? 18 : 16}
        strokeWidth={2.2}
        className="flex-none transition-transform duration-150 group-hover:-translate-x-0.5"
      />
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
