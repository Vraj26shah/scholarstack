import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from '../../shared/ui/icons';

/**
 * The student app's look, taken from the website: the navy hero, Fraunces display headings,
 * index cards on paper, and ink line icons (no pastel boxes). Every app screen is built from
 * these, so the app reads as one designed thing.
 */
export const card =
  'rounded-[22px] bg-card shadow-[0_1px_0_var(--line),0_14px_32px_-24px_var(--shadow)] ring-1 ring-line/80';

export function AppScreen({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[720px] flex flex-col gap-8 pb-10">{children}</div>;
}

/**
 * A screen's title on the paper: a small teal line, a serif title, one line under it, then
 * anything else (a button row). Light, so the content is what you see first.
 */
export function AppHero({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5 px-1 pt-5">
      {eyebrow && <p className="m-0 text-[13px] font-semibold text-teal-text">{eyebrow}</p>}
      <h1 className="m-0 font-display font-extrabold text-[30px] leading-[1.05] tracking-[-0.04em] text-balance">
        {title}
      </h1>
      {sub && <p className="m-0 text-[15px] leading-snug text-ink2 max-w-[520px]">{sub}</p>}
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}

/** Today's navy card: the one strong block in the app, inset like an index card. */
export function TodayCard({ children }: { children: ReactNode }) {
  return (
    <section className="relative mt-3 overflow-hidden rounded-[26px] bg-brand text-white px-5 pt-5 pb-4 shadow-[0_22px_40px_-28px_rgba(22,27,58,0.9)]">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-10 h-40 w-40 rotate-12 rounded-[28px] border border-white/10"
      />
      <div className="relative flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

/** A section's heading: serif, like the website's headings, with a quiet link on the right. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 px-1">
      <h2 className="m-0 font-display font-bold text-[23px] leading-none tracking-[-0.03em]">{children}</h2>
      {action}
    </div>
  );
}

/** Kept for small labels inside cards. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <SectionTitle action={action}>{children}</SectionTitle>;
}

export function MoreLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-0.5 text-[14px] font-semibold text-teal-text no-underline pb-0.5"
    >
      {children}
      <ChevronRight size={15} />
    </Link>
  );
}

/** A grouped list of tappable rows, like a phone's settings, with an optional heading. */
export function RowGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      {title && <h2 className="m-0 px-1 text-[13px] font-semibold text-ink2">{title}</h2>}
      <ul className={`${card} m-0 p-0 list-none overflow-hidden`}>{children}</ul>
    </section>
  );
}

export function Row({
  to,
  href,
  onClick,
  icon,
  title,
  hint,
  end,
  danger,
}: {
  to?: string;
  href?: string;
  onClick?: () => void;
  icon: ReactNode;
  /** Ignored (rows use ink line icons); kept so older calls still compile. */
  tone?: string;
  title: ReactNode;
  hint?: ReactNode;
  end?: ReactNode;
  danger?: boolean;
}) {
  const inner = (
    <>
      <span
        className={`grid place-items-center size-6 flex-none ${danger ? 'text-blush-text' : 'text-brand dark:text-mist'}`}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0 py-0.5">
        <span
          className={`block text-[16px] font-semibold leading-tight ${danger ? 'text-blush-text' : 'text-ink'}`}
        >
          {title}
        </span>
        {hint && <span className="block text-[13px] text-ink2 leading-snug mt-0.5">{hint}</span>}
      </span>
      {end ?? (!danger && <ChevronRight size={17} className="flex-none text-ink2/70" />)}
    </>
  );
  const cls =
    'w-full flex items-center gap-4 pl-4 pr-3.5 py-3.5 text-left no-underline bg-transparent active:bg-sunk transition-colors';
  return (
    <li className="relative after:absolute after:left-14 after:right-0 after:bottom-0 after:h-px after:bg-line/70 last:after:hidden">
      {to ? (
        <Link to={to} className={cls}>
          {inner}
        </Link>
      ) : href ? (
        <a href={href} className={cls}>
          {inner}
        </a>
      ) : (
        <button type="button" onClick={onClick} className={cls}>
          {inner}
        </button>
      )}
    </li>
  );
}
