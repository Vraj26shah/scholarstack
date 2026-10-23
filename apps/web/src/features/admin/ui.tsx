import type { ReactNode } from 'react';

export const input =
  'h-11 px-3 rounded-xl bg-surface border-[1.5px] border-line text-ink text-[15px] min-w-0 focus:border-teal outline-none';

export function Field({
  label,
  children,
  className = '',
}: { label: string; children: ReactNode; className?: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className={`flex flex-col gap-1.5 text-sm ${className}`}>
      <span className="font-semibold text-ink2">{label}</span>
      {children}
    </label>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-marigold-soft text-marigold-text',
  live: 'bg-mist text-on-mist',
  archived: 'bg-sunk text-ink2',
  sending: 'bg-marigold-soft text-marigold-text',
  sent: 'bg-mist text-on-mist',
  failed: 'bg-blush text-blush-text',
  soon: 'bg-marigold-soft text-marigold-text',
  hidden: 'bg-sunk text-ink2',
  new: 'bg-marigold text-on-marigold',
  converting: 'bg-marigold-soft text-marigold-text',
  queued: 'bg-marigold-soft text-marigold-text',
  registered: 'bg-mist text-on-mist',
  changed: 'bg-blush text-blush-text',
  unimported: 'bg-marigold-soft text-marigold-text',
  unsupported: 'bg-blush text-blush-text',
  'bad source': 'bg-blush text-blush-text',
  'bad mapping': 'bg-blush text-blush-text',
  'page map mismatch': 'bg-blush text-blush-text',
  'missing source': 'bg-blush text-blush-text',
  'waiting for conversion': 'bg-marigold-soft text-marigold-text',
  'conversion failed': 'bg-blush text-blush-text',
  'pages missing': 'bg-blush text-blush-text',
  'paused while hidden': 'bg-sunk text-ink2',
  'failed while hidden': 'bg-blush text-blush-text',
  ignored: 'bg-sunk text-ink2',
  offline: 'bg-sunk text-ink2',
  ready: 'bg-mist text-on-mist',
  'not converted': 'bg-sunk text-ink2',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center h-6 px-2.5 rounded-md font-mono text-[11px] font-semibold uppercase ${STATUS_STYLES[status] ?? 'bg-sunk text-ink2'}`}
    >
      {status}
    </span>
  );
}

export function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="m-0 font-display font-extrabold text-[30px] tracking-[-0.04em] leading-none">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const rupeesToPaise = (r: string) => Math.round(Number(r) * 100);

export const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
