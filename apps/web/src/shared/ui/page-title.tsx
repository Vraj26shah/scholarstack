import type { ReactNode } from 'react';

/**
 * The one page heading style: display face, tight tracking, and the full stop in teal, the way
 * "Terms." and "Account." have it. A plain string gets its final "." coloured (or one added);
 * "?" and "…" endings are left alone. Mixed content (a marker word, a line break) is passed as is.
 */
export function PageTitle({
  children,
  size = 'page',
  className = '',
}: {
  children: ReactNode;
  /** page: most screens. state: short status screens (checkout, errors) with longer lines. */
  size?: 'page' | 'state';
  className?: string;
}) {
  const sizes = {
    page: 'text-[clamp(40px,7vw,68px)] leading-[0.95]',
    state: 'text-[clamp(34px,6vw,56px)] leading-[0.98]',
  } as const;
  let content: ReactNode = children;
  if (typeof children === 'string') {
    const text = children.trimEnd();
    if (/[?…!]$/.test(text)) content = text;
    else {
      const body = text.endsWith('.') ? text.slice(0, -1) : text;
      content = (
        <>
          {body}
          <span className="text-teal-text">.</span>
        </>
      );
    }
  }
  return (
    <h1 className={`m-0 font-display font-extrabold tracking-[-0.05em] ${sizes[size]} ${className}`}>
      {content}
    </h1>
  );
}

/** The small label above a page title ("Updated 06 Nov 2026", "Borrower card"): one style everywhere. */
export function Eyebrow({ children }: { children: ReactNode }) {
  // Same as the home page's section labels ("The catalogue", "The toolbox").
  return <p className="m-0 font-mono text-[13px] tracking-[0.14em] text-teal-text">{children}</p>;
}
