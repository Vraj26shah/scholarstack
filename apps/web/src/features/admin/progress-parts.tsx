import type { ConversionBoardDto } from '@ss/contracts';
import { buttonClass } from '../../shared/ui/button';
import { plural } from './ui';
import { ProgressBar, errorStageLabel, percentDone, stageLabel } from './workflow-ui';

export type Row = ConversionBoardDto['files'][number];
export type Filter = 'all' | 'active' | 'waiting' | 'problems' | 'ready';

export const FILTERS: { key: Filter; label: string; match: (row: Row) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  {
    key: 'active',
    label: 'Working now',
    match: (r) => !r.offSite && (r.state === 'working' || r.state === 'queued'),
  },
  { key: 'waiting', label: 'Not started', match: (r) => !r.offSite && r.state === 'waiting' },
  {
    key: 'problems',
    label: 'Problems',
    match: (r) => !r.offSite && (r.state === 'failed' || r.state === 'stalled'),
  },
  { key: 'ready', label: 'Done', match: (r) => !r.offSite && r.state === 'ready' },
];

export function FileRow({
  row,
  onRetry,
  retrying,
}: { row: Row; onRetry: (row: Row) => void; retrying: boolean }) {
  const pct = percentDone(row);
  const tone = row.offSite
    ? 'muted'
    : row.state === 'failed' || row.state === 'stalled'
      ? 'blush'
      : row.state === 'ready'
        ? 'teal'
        : row.state === 'waiting'
          ? 'muted'
          : 'marigold';
  const label = row.offSite ? 'Off the site, not converted' : stageLabel(row);
  return (
    <li className="grid grid-cols-1 gap-2 border-b border-line px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center md:gap-5">
      <div className="min-w-0">
        <p className="m-0 truncate font-semibold" title={row.sourceKey}>
          {row.name}
        </p>
        <p className="m-0 truncate text-xs text-ink2">
          {row.unit} · {row.courseTitle}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span
            className={`truncate ${
              row.state === 'failed' || row.state === 'stalled'
                ? 'font-semibold text-blush-text'
                : row.state === 'ready'
                  ? 'font-semibold text-teal-text'
                  : 'text-ink'
            }`}
          >
            {label}
            {row.state === 'ready' && !row.offSite && ` · ${plural(row.pageCount, 'page')}`}
          </span>
          {(row.state === 'working' || row.state === 'queued') && (
            <span className="shrink-0 font-mono text-xs text-ink2">{pct}%</span>
          )}
        </div>
        <ProgressBar value={row.offSite ? 0 : pct} tone={tone} label={`${row.name}: ${label}`} />
        {row.state === 'failed' && (
          <p className="m-0 text-xs leading-snug text-blush-text">
            {errorStageLabel(row.errorStage) && <strong>Stopped {errorStageLabel(row.errorStage)}. </strong>}
            {row.error}
          </p>
        )}
      </div>
      <div className="flex justify-end">
        {!row.offSite && (row.state === 'failed' || row.state === 'stalled' || row.state === 'waiting') && (
          <button
            type="button"
            className={buttonClass(
              row.state === 'waiting' ? 'outline' : 'brand',
              'md',
              'h-9 px-4 text-[13px]',
            )}
            onClick={() => onRetry(row)}
            disabled={retrying}
          >
            {row.state === 'waiting' ? 'Make pages' : 'Try again'}
          </button>
        )}
      </div>
    </li>
  );
}
