import type { ConversionBoardDto, ConversionStage } from '@ss/contracts';
import type { ReactNode } from 'react';

/** Every conversion stage in words a first-time admin understands. */
export function stageLabel(
  row: Pick<
    ConversionBoardDto['files'][number],
    'stage' | 'current' | 'total' | 'state' | 'queuePosition' | 'queueTotal'
  >,
): string {
  if (row.state === 'ready') return 'Done';
  if (row.state === 'failed') return 'Stopped with a problem';
  if (row.state === 'waiting') return 'Not started yet';
  if (row.state === 'stalled') return 'No news for 15 minutes. Try again.';
  switch (row.stage as ConversionStage | null) {
    case 'queued':
      return row.queuePosition > 0
        ? `Waiting its turn · ${row.queuePosition} of ${row.queueTotal}`
        : 'Waiting its turn';
    case 'downloading_source':
      return 'Fetching the original from R2';
    case 'validating_source':
      return 'Checking the file is a real document';
    case 'rendering_pages':
      return row.total > 0 ? `Reading ${row.total} pages` : 'Counting pages';
    case 'clearing_previous_pages':
      return 'Clearing old pages';
    case 'writing_preview':
      return 'Making the cover preview';
    case 'writing_pages':
      return `Saving page ${row.current} of ${row.total}`;
    case 'verifying_r2':
      return 'Double-checking every page is saved';
    case 'saving_manifest':
      return 'Telling the website the pages are ready';
    default:
      return 'Working';
  }
}

const ERROR_STAGE: Record<string, string> = {
  dispatch: 'could not reach the page maker',
  downloading_source: 'while fetching the file from R2',
  validating_source: 'the file itself is not a valid document',
  rendering_pages: 'while turning pages into images',
  clearing_previous_pages: 'while clearing old pages',
  writing_preview: 'while making the cover preview',
  writing_pages: 'while saving pages to R2',
  verifying_r2: 'some pages did not save to R2',
  saving_manifest: 'while updating the website',
};
export const errorStageLabel = (stage: string | null) => (stage ? (ERROR_STAGE[stage] ?? '') : '');

/** One number for the whole job, so the bar only ever moves forward. */
export function percentDone(
  row: Pick<ConversionBoardDto['files'][number], 'stage' | 'current' | 'total' | 'state'>,
): number {
  if (row.state === 'ready') return 100;
  if (row.state !== 'working' && row.state !== 'queued') return 0;
  const frac = row.total > 0 ? Math.min(1, row.current / row.total) : 0;
  switch (row.stage) {
    case 'downloading_source':
      return 3;
    case 'validating_source':
      return 6;
    case 'rendering_pages':
      return 9;
    case 'clearing_previous_pages':
      return 11;
    case 'writing_preview':
      return 13;
    case 'writing_pages':
      return Math.round(14 + frac * 76);
    case 'verifying_r2':
      return Math.round(90 + frac * 7);
    case 'saving_manifest':
      return 98;
    default:
      return 0;
  }
}

export function ProgressBar({
  value,
  tone = 'teal',
  label,
}: { value: number; tone?: 'teal' | 'blush' | 'marigold' | 'muted'; label: string }) {
  const color = {
    teal: 'bg-teal',
    blush: 'bg-blush-text',
    marigold: 'bg-marigold',
    muted: 'bg-line',
  }[tone];
  return (
    <div
      role="progressbar"
      tabIndex={-1}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="h-2.5 w-full overflow-hidden rounded-full bg-sunk"
    >
      <div
        className={`h-full rounded-full ${color} transition-[width] duration-700 ease-out`}
        style={{ width: `${Math.max(value, tone === 'muted' ? 0 : 2)}%` }}
      />
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = 'plain',
  hint,
}: { label: string; value: number | string; tone?: 'plain' | 'good' | 'warn' | 'bad'; hint?: string }) {
  const ring = {
    plain: 'border-line',
    good: 'border-teal/50',
    warn: 'border-marigold',
    bad: 'border-blush-text/40',
  }[tone];
  const text = {
    plain: 'text-ink',
    good: 'text-teal-text',
    warn: 'text-marigold-text',
    bad: 'text-blush-text',
  }[tone];
  return (
    <div className={`flex flex-col gap-1 rounded-xl border-[1.5px] ${ring} bg-surface px-4 py-3`}>
      <span className="text-[13px] font-semibold text-ink2">{label}</span>
      <span className={`font-display text-[30px] font-extrabold leading-none tracking-[-0.04em] ${text}`}>
        {value}
      </span>
      {hint && <span className="text-xs text-ink2">{hint}</span>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'good' | 'bad'; children: ReactNode }) {
  const style = {
    info: 'border-line bg-sunk text-ink',
    good: 'border-teal/40 bg-mist/30 text-ink',
    bad: 'border-blush-text/30 bg-blush text-blush-text',
  }[tone];
  return (
    <div className={`rounded-xl border-[1.5px] px-4 py-3 text-sm leading-relaxed ${style}`}>{children}</div>
  );
}

/** Plain-language glossary, so "R2" and "Supabase" never confuse a new admin. */
export function Glossary() {
  return (
    <details open className="group rounded-xl border-[1.5px] border-line bg-surface px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold text-ink marker:text-ink2">
        What do these words mean?
      </summary>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-ink2 sm:grid-cols-[max-content_1fr]">
        <dt className="font-semibold text-ink">R2</dt>
        <dd className="m-0">
          Your file storage on Cloudflare. The original PDFs and slides live here. R2 is always right.
        </dd>
        <dt className="font-semibold text-ink">Supabase</dt>
        <dd className="m-0">
          The website's database: courses, prices, who bought what, and which pages each file has.
        </dd>
        <dt className="font-semibold text-ink">Pages</dt>
        <dd className="m-0">
          Protected page images made from each file. Students read these, never the original file.
        </dd>
        <dt className="font-semibold text-ink">Off the site</dt>
        <dd className="m-0">
          Files you chose to hide (like textbooks). They are not converted and students can't see them.
        </dd>
      </dl>
    </details>
  );
}
