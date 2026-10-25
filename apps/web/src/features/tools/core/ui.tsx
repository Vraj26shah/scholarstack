import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BackLink } from '../../../shared/ui/back-link';

/** The input style every tool uses. */
export const field =
  'h-11 w-full min-w-0 rounded-xl bg-surface border-[1.5px] border-line px-3 text-[15px] text-ink outline-none focus:border-teal';

/** A labelled input wrapper. */
export function Labelled({
  label,
  className = '',
  children,
}: { label: string; className?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className={`flex flex-col gap-1.5 text-sm font-semibold text-ink2 min-w-0 ${className}`}>
      {label}
      {children}
    </label>
  );
}

/** The tool's title block: a call number like the catalogue cards, the name and one plain line. */
export function ToolHeader({
  number,
  title,
  lead,
  aside,
}: { number: string; title: string; lead: string; aside?: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <header className="flex flex-col gap-4 pt-2 pb-8">
      <BackLink
        fallback="/#toolbox"
        className="self-start inline-flex items-center h-9 px-3 -ml-3 rounded-full border-0 bg-transparent text-sm font-semibold text-ink2 cursor-pointer hover:bg-sunk print:hidden"
      />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3 max-w-[720px]">
          <span className="font-mono text-[12px] text-ink2">
            TOOL · {number} · FREE · SAVED ON THIS DEVICE
          </span>
          <h1 className="m-0 font-display font-extrabold text-[clamp(40px,7vw,68px)] leading-[0.95] tracking-[-0.05em]">
            {title}
          </h1>
          <p className="m-0 text-[17px] leading-relaxed text-ink2">{lead}</p>
        </div>
        {aside}
      </div>
      <Link
        to={`/help?topic=feature&page=${encodeURIComponent(pathname)}`}
        className="self-start text-[13px] font-semibold text-ink2 hover:text-ink print:hidden"
      >
        Something not working? Tell us →
      </Link>
    </header>
  );
}

/** A ruled index card, the same paper as the catalogue. */
export function ToolCard({
  title,
  children,
  className = '',
}: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[18px] bg-card p-5 sm:p-6 shadow-[0_18px_34px_-26px_var(--shadow),0_0_0_1px_var(--line)] flex flex-col gap-4 min-w-0 ${className}`}
    >
      {title && (
        <h2 className="m-0 font-display font-extrabold text-[24px] tracking-[-0.03em] leading-none">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

/** The navy result panel with the big number, like the price stamp on a course. */
export function ResultPanel({
  label,
  value,
  children,
}: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="rounded-[18px] bg-brand text-white p-6 flex flex-col gap-3" aria-live="polite">
      <span className="font-mono text-[12px] text-on-brand2">{label}</span>
      <span className="font-display font-extrabold text-[clamp(56px,10vw,84px)] leading-none tracking-[-0.05em] tabular-nums">
        {value}
      </span>
      {children}
    </div>
  );
}

/** Segmented choice used for sections inside a tool. */
export function Tabs<K extends string>({
  value,
  onChange,
  items,
}: { value: K; onChange: (k: K) => void; items: [K, string][] }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1.5 rounded-full bg-sunk p-1 self-start max-w-full">
      {items.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={`h-10 rounded-full px-4 text-sm font-semibold ${value === k ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-ink2'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** A numeric input value: '' while empty, otherwise a non-negative number. */
export const toNumber = (v: string): number | '' => (v === '' ? '' : Math.max(0, Number(v)));
