import type { ImportFolderDto, ImportTreeDto, SyncResultDto } from '@ss/contracts';
import { api, friendly } from '../../lib/api';

export interface R2FileSyncTask {
  courseId: string;
  courseTitle: string;
  key: string;
}

export interface R2FileSyncOutcome extends R2FileSyncTask {
  status: 'queued' | 'syncing' | 'checked' | 'added' | 'changed' | 'retired' | 'review' | 'failed';
  message?: string;
}

export interface R2FileSyncProgress {
  completed: number;
  total: number;
  currentKey: string | null;
  outcomes: R2FileSyncOutcome[];
}

export interface R2FileSyncResult {
  summary: SyncResultDto;
  outcomes: R2FileSyncOutcome[];
}

export function sourceKeysInTree(folders: ImportFolderDto[], prefix: string): string[] {
  const keys = new Set<string>();
  const visit = (folder: ImportFolderDto) => {
    if (!folder.prefix.startsWith(prefix) && !prefix.startsWith(folder.prefix)) return;
    if (folder.prefix.startsWith(prefix)) {
      for (const object of folder.looseObjects) keys.add(object.key);
    }
    for (const child of folder.children) visit(child);
  };
  for (const folder of folders) visit(folder);
  return [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

export async function courseSourceKeys(courseId: string, prefix: string, tree?: ImportTreeDto) {
  const [freshTree, units] = await Promise.all([tree ?? api.adminImportTree(), api.adminUnits(courseId)]);
  return [
    ...new Set([
      ...sourceKeysInTree(freshTree.folders, prefix),
      ...units.flatMap((unit) => unit.files.map((file) => file.sourceKey)),
    ]),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

export function emptySyncResult(): SyncResultDto {
  return {
    coursesCreated: 0,
    filesAdded: 0,
    filesChanged: 0,
    filesRetired: 0,
    pageObjectsRemoved: 0,
    conversionQueued: 0,
    skipped: [],
  };
}

function addResult(target: SyncResultDto, next: SyncResultDto) {
  target.coursesCreated += next.coursesCreated;
  target.filesAdded += next.filesAdded;
  target.filesChanged += next.filesChanged;
  target.filesRetired += next.filesRetired;
  target.pageObjectsRemoved += next.pageObjectsRemoved;
  target.conversionQueued += next.conversionQueued;
  target.skipped.push(...next.skipped);
}

function outcomeStatus(result: SyncResultDto): R2FileSyncOutcome['status'] {
  if (result.skipped.length) return 'review';
  if (result.filesRetired) return 'retired';
  if (result.filesChanged) return 'changed';
  if (result.filesAdded) return 'added';
  return 'checked';
}

/** Each R2 source key gets its own Worker request, avoiding cumulative subrequest limits. */
export async function syncR2Files(
  tasks: R2FileSyncTask[],
  onProgress?: (progress: R2FileSyncProgress) => void,
): Promise<R2FileSyncResult> {
  const outcomes: R2FileSyncOutcome[] = tasks.map((task) => ({ ...task, status: 'queued' }));
  const summary = emptySyncResult();
  let completed = 0;
  const publish = (currentKey: string | null) =>
    onProgress?.({ completed, total: tasks.length, currentKey, outcomes: outcomes.slice() });

  publish(null);
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index]!;
    outcomes[index] = { ...task, status: 'syncing' };
    publish(task.key);
    try {
      let result: SyncResultDto | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3 && !result; attempt++) {
        try {
          result = await api.adminSyncFile(task.courseId, task.key);
        } catch (error) {
          lastError = error;
          const status = (error as { status?: number }).status;
          const transient = status === undefined || status === 0 || status === 429 || status >= 500;
          if (!transient || attempt === 2) throw error;
          await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        }
      }
      if (!result) throw lastError ?? new Error('The storage file sync returned no result.');
      addResult(summary, result);
      outcomes[index] = {
        ...task,
        status: outcomeStatus(result),
        ...(result.skipped.length ? { message: result.skipped.join('; ') } : {}),
      };
    } catch (error) {
      outcomes[index] = { ...task, status: 'failed', message: friendly(error) };
    }
    completed++;
    publish(index + 1 < tasks.length ? tasks[index + 1]!.key : null);
  }

  return { summary, outcomes };
}
