import type { ConversionBoardState } from '@ss/contracts';
import type { CourseFile } from '../domain/entities';

const activeConversionStages = new Set([
  'queued',
  'downloading_source',
  'validating_source',
  'rendering_pages',
  'clearing_previous_pages',
  'writing_preview',
  'writing_pages',
  'verifying_r2',
  'saving_manifest',
]);

/** A callback is active until it stops reporting progress for fifteen minutes. */
export function isConversionInFlight(file: CourseFile, now = Date.now()): boolean {
  if (!file.conversionStage || !activeConversionStages.has(file.conversionStage)) return false;
  const updatedAt = file.conversionUpdatedAt ? Date.parse(file.conversionUpdatedAt) : 0;
  return Number.isFinite(updatedAt) && now - updatedAt < 15 * 60_000;
}

/** Shared job status for the admin board, upload pipeline and folder explorer. */
export function boardState(file: CourseFile, now = Date.now()): ConversionBoardState {
  if (file.conversionHeld) return 'paused';
  if (file.conversionStatus === 'ready') return 'ready';
  if (file.conversionStatus === 'failed') return 'failed';
  if (isConversionInFlight(file, now)) return file.conversionStage === 'queued' ? 'queued' : 'working';
  if (file.conversionStage && activeConversionStages.has(file.conversionStage)) return 'stalled';
  return 'waiting';
}
