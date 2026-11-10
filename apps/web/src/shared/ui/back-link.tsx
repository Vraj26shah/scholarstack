import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { pageName, previousPage } from '../../lib/nav-history';

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

export function BackLink({
  fallback,
  skip,
  className = '',
  children,
}: {
  fallback: string;
  skip?: (path: string) => boolean;
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
      className={`inline-flex min-h-10 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-sm transition-colors hover:border-teal hover:bg-sunk focus-visible:outline ${className}`}
    >
      {children ? children(back.label) : back.label}
    </button>
  );
}
