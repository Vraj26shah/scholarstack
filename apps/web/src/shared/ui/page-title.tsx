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
  /**
   * hero: the big landing headings (home, contribute, sign-in). page: most screens.
   * state: short status screens (checkout, errors, 404) with longer lines.
   */
  size?: 'hero' | 'page' | 'state';
  className?: string;
}) {
  const sizes = {
    hero: 'text-[clamp(48px,8.5vw,96px)] leading-[0.92]',
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

/**
 * The top of every ordinary page, so the gap above the title, eyebrow-to-title spacing and the
 * lead line are identical on Terms, Privacy, Account, Shelf, Help and the tools.
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  back,
  children,
  flush = false,
  className = '',
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  /** Usually a <BackLink />; sits above the eyebrow. */
  back?: ReactNode;
  /** Extra lines under the lead (a note, a link). */
  children?: ReactNode;
  /** No space below: the page's own layout spaces what follows. */
  flush?: boolean;
  className?: string;
}) {
  return (
    <header className={`flex flex-col pt-4 ${flush ? '' : 'pb-10'} ${className}`}>
      {back && <div className="mb-5 print:hidden">{back}</div>}
      <div>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <PageTitle>{title}</PageTitle>
      </div>
      {lead && <p className="mt-4 mb-0 max-w-[640px] text-[17px] leading-relaxed text-ink2">{lead}</p>}
      {children}
    </header>
  );
}
