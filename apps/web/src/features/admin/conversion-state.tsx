import type { ConversionBoardDto, ConversionBoardState } from '@ss/contracts';
import { STAGE } from './course-workspace';
import { plural } from './ui';

export type ConversionRow = ConversionBoardDto['files'][number];

/**
 * One place for how a page-making job's state looks and reads, so "Page jobs" and the per-folder
 * progress in "Folders" never drift apart: same words, same colours, same bulk actions.
 */
export const CONVERSION_LABEL: Record<ConversionBoardState, string> = {
  working: 'Working',
  queued: 'Queued',
  paused: 'Paused',
  stalled: 'Stuck',
  failed: 'Failed',
  waiting: 'Needs pages',
  ready: 'Ready',
};

export const CONVERSION_TONE: Record<ConversionBoardState, string> = {
  working: 'bg-marigold/20 text-marigold-text',
  queued: 'bg-marigold/20 text-marigold-text',
  paused: 'bg-sunk text-ink2',
  stalled: 'bg-blush text-blush-text',
  failed: 'bg-blush text-blush-text',
  waiting: 'bg-sunk text-ink2',
  ready: 'bg-teal/15 text-teal-text',
};

/** Rows a bulk Start/Pause/Resume/Delete can act on from this state. */
export const CAN_START: ConversionBoardState[] = ['waiting', 'failed', 'stalled'];
export const CAN_PAUSE: ConversionBoardState[] = ['queued', 'working', 'stalled'];
export const CAN_RESUME: ConversionBoardState[] = ['paused'];
export const CAN_CANCEL: ConversionBoardState[] = ['queued', 'working', 'paused', 'stalled', 'failed'];

/** A short, specific line under the state pill — what's actually happening to this file. */
export function conversionLine(r: ConversionRow): string {
  if (r.state === 'paused') return 'Paused · resume to pick up where it left off.';
  if (r.state === 'failed') return r.error ? r.error.replace(/^Broken source:\s*/, '') : 'Pages failed.';
  if (r.state === 'stalled') return 'No progress for 15 minutes or more. Start it again.';
  if (r.state === 'queued')
    return r.queueTotal ? `Waiting in line · ${r.queuePosition} of ${r.queueTotal}` : 'Waiting in line';
  if (r.state === 'working') {
    const stage = STAGE[r.stage ?? ''] ?? 'Working';
    const progress =
      r.total > 0 && ['rendering_pages', 'writing_pages'].includes(r.stage ?? '')
        ? ` - ${r.current} of ${r.total} pages`
        : r.total > 0 && r.stage === 'verifying_r2'
          ? ` - ${r.current} of ${r.total} objects`
          : '';
    const position = r.queueTotal ? ` - job ${r.queuePosition} of ${r.queueTotal}` : '';
    return `${stage}${progress}${position}`;
  }
  if (r.state === 'ready') return `Ready · ${plural(r.pageCount, 'page')}`;
  return 'Not started yet.';
}

/** 0–1, or null while the step itself has no known length (shows an indeterminate pulse). */
export function conversionProgress(r: ConversionRow): number | null {
  if (r.state === 'working') return r.total ? Math.min(1, r.current / r.total) : null;
  return 1;
}

export function ConversionBar({ value }: { value: number | null }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunk" aria-hidden="true">
      <div
        className={`h-full rounded-full ${value === null ? 'w-1/3 animate-pulse bg-marigold' : 'bg-marigold'}`}
        style={value === null ? undefined : { width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}
