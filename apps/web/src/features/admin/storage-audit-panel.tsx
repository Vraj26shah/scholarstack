import type { StorageAuditDto, StorageInventoryPageDto, SyncResultDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { type R2FileSyncProgress, type R2FileSyncTask, syncR2Files } from './r2-file-sync';
import { Panel, StatusPill } from './ui';

type AuditFile = StorageAuditDto['files'][number] & { pageAuditIncluded: boolean };
type BucketObject = StorageInventoryPageDto['objects'][number];
type BucketRecord = NonNullable<StorageInventoryPageDto['records']>[number];

const isZipArchive = (file: Pick<AuditFile, 'name'>) => /\.zip$/i.test(file.name);

interface BucketScanState {
  checkedAt: string;
  scopePrefix: string;
  importRoot: string;
  objects: BucketObject[];
  records: BucketRecord[];
  courses: NonNullable<StorageInventoryPageDto['courses']>;
  pageAuditedFileIds: string[];
  pageAuditCompleted: number;
  pageAuditTotal: number;
  pageAuditCurrentKey: string | null;
  pageAuditScopeIncluded: boolean;
  pageAuditComplete: boolean;
  complete: boolean;
  requestCount: number;
  error: Error | null;
}

function conversionLabel(file: AuditFile): string {
  if (file.sourceIssue && isZipArchive(file)) return 'archive not extracted';
  if (file.sourceIssue) return 'bad source file';
  if (file.pageMappingIssues?.length) return 'page map mismatch';
  if (!file.fileId) return 'not converted';
  if (file.hidden && file.conversionStatus === 'pending') return 'paused while hidden';
  if (file.hidden && file.conversionStatus === 'failed') return 'failed while hidden';
  if (file.conversionStatus === 'failed') return 'conversion failed';
  if (file.conversionStatus === 'pending') {
    return file.conversionStage && file.conversionStage !== 'queued'
      ? 'converting'
      : 'waiting for conversion';
  }
  if (file.conversionStatus !== 'ready') return 'not converted';
  if (!file.pageCount || file.pageCount < 1) return 'page count missing';
  if (!file.pageAuditIncluded) return 'pages not checked in this scope';
  if (file.missingPageNumbers.length || !file.previewPresent) return 'pages missing';
  return file.hidden ? 'offline' : 'ready';
}

function sourceLabel(file: AuditFile): string {
  if (file.sourceIssue && isZipArchive(file)) return 'archive needs extraction';
  if (file.sourceIssue) return 'bad source';
  if (file.pageMappingIssues?.length) return 'bad mapping';
  return file.status.replace('-', ' ');
}

function progress(file: AuditFile): number {
  if (file.conversionStatus === 'ready') {
    if (!file.pageCount || file.pageCount < 1) return 0;
    if (file.pageAssetsExpected > 0) {
      return Math.min(100, Math.round((file.pageAssetsFound / file.pageAssetsExpected) * 100));
    }
    return file.previewPresent ? 100 : 0;
  }
  if (file.conversionProgressTotal > 0) {
    return Math.min(100, Math.round((file.conversionProgressCurrent / file.conversionProgressTotal) * 100));
  }
  if (file.pageAssetsExpected > 0) {
    return Math.min(100, Math.round((file.pageAssetsFound / file.pageAssetsExpected) * 100));
  }
  return 0;
}

const STAGE_LABELS: Record<string, string> = {
  downloading_source: 'Reading original from storage',
  validating_source: 'Checking file type and integrity',
  rendering_pages: 'Counting and rendering pages',
  clearing_previous_pages: 'Replacing old generated pages',
  writing_preview: 'Saving the preview to storage',
  writing_pages: 'Saving protected pages to storage',
  verifying_r2: 'Checking each generated object in storage',
  saving_manifest: 'Saving the page map in the database',
  complete: 'Pages verified in storage and mapped in the database',
};

function processLabel(file: AuditFile): string {
  if (file.sourceIssue && isZipArchive(file)) {
    return 'ZIP archive: extract its documents into this storage folder before conversion';
  }
  if (file.sourceIssue)
    return 'Storage source failed its content check; replace the original before conversion';
  if (file.pageMappingIssues?.length) return 'The saved page list doesn’t match the pages in storage';
  if (file.hidden && file.conversionStatus === 'pending') {
    return 'Paused while hidden; show the file to resume conversion';
  }
  if (file.conversionStatus === 'ready' && (!file.pageCount || file.pageCount < 1)) {
    return 'Conversion marked ready without a verified page count';
  }
  if (file.conversionStatus === 'ready' && !file.pageAuditIncluded) {
    return 'Generated pages are outside this scope; scan the course, its folder, or the whole bucket';
  }
  if (file.conversionStatus === 'ready' && (file.missingPageNumbers.length > 0 || !file.previewPresent)) {
    return 'Conversion finished, but the storage audit found missing objects';
  }
  if (file.conversionStage === 'failed') {
    const failedAt =
      file.conversionErrorStage === 'dispatch'
        ? 'converter dispatch'
        : (STAGE_LABELS[file.conversionErrorStage ?? ''] ?? 'conversion');
    return `Failed during ${failedAt}`;
  }
  if (file.conversionStage === 'queued' && file.conversionQueuePosition > 0) {
    return `Waiting in queue, file ${file.conversionQueuePosition} of ${file.conversionQueueTotal}`;
  }
  if (file.conversionStage && STAGE_LABELS[file.conversionStage]) {
    return STAGE_LABELS[file.conversionStage] ?? 'Conversion in progress';
  }
  if (file.status === 'changed') return 'Storage source changed; sync this file to refresh its record';
  if (file.status === 'unimported') return 'Storage file is not registered; sync this file to map it';
  if (file.status === 'unsupported') return 'Unsupported source format; conversion cannot start';
  if (file.status === 'missing-source') return 'Source missing from storage; re-upload or remove the record';
  if (file.status === 'ignored') return 'Ignored by import rules';
  if (file.conversionStatus === 'ready') return 'Converted pages are registered';
  return 'Not queued for conversion';
}

function needsReview(file: AuditFile): boolean {
  return (
    ['changed', 'unimported', 'unsupported', 'missing-source'].includes(file.status) ||
    !!file.sourceIssue ||
    !!file.pageMappingIssues?.length ||
    file.conversionStatus === 'failed' ||
    (file.conversionStatus === 'ready' && (!file.pageCount || file.pageCount < 1)) ||
    (file.pageAuditIncluded && file.missingPageNumbers.length > 0) ||
    (file.pageAuditIncluded && file.conversionStatus === 'ready' && !file.previewPresent)
  );
}

type FileAuditFilter =
  | 'all'
  | 'needs-review'
  | 'pending'
  | 'ready'
  | 'offline'
  | 'failed'
  | 'changed'
  | 'unimported'
  | 'unsupported'
  | 'missing-source'
  | 'invalid-source'
  | 'invalid-mapping'
  | 'ignored';

function matchesFileFilter(file: AuditFile, filter: FileAuditFilter): boolean {
  switch (filter) {
    case 'needs-review':
      return needsReview(file);
    case 'pending':
      return file.conversionStatus === 'pending';
    case 'ready':
      return file.conversionStatus === 'ready' && !file.hidden && !needsReview(file);
    case 'offline':
      return file.hidden;
    case 'failed':
      return file.conversionStatus === 'failed';
    case 'changed':
      return file.status === 'changed';
    case 'unimported':
      return file.status === 'unimported';
    case 'unsupported':
      return file.status === 'unsupported';
    case 'missing-source':
      return file.status === 'missing-source';
    case 'invalid-source':
      return !!file.sourceIssue;
    case 'invalid-mapping':
      return !!file.pageMappingIssues?.length;
    case 'ignored':
      return file.status === 'ignored';
    default:
      return true;
  }
}

type AuditRowMutations = {
  actionsBusy: boolean;
  sync: {
    isPending: boolean;
    isSuccess: boolean;
    isError: boolean;
    variables?: { kind: 'file' | 'folder'; courseId: string; key: string };
    data?: SyncResultDto;
    error: Error | null;
    mutate: (input: { kind: 'file' | 'folder'; courseId: string; key: string }) => void;
  };
  setVisibility: {
    isPending: boolean;
    variables?: { fileId: string; hidden: boolean };
    mutate: (input: { fileId: string; hidden: boolean }) => void;
  };
  setUnitVisibility: {
    isPending: boolean;
    variables?: { courseId: string; unitKey: string; hidden: boolean };
    mutate: (input: { courseId: string; unitKey: string; hidden: boolean }) => void;
  };
  retry: {
    isPending: boolean;
    isError: boolean;
    variables?: string;
    error: Error | null;
    mutate: (fileId: string) => void;
  };
};

function AuditFileRow({
  file,
  actionsBusy,
  sync,
  setVisibility,
  setUnitVisibility,
  retry,
}: {
  file: AuditFile;
} & AuditRowMutations) {
  const status = conversionLabel(file);
  const source = sourceLabel(file);
  const percent = progress(file);
  const auditPages = file.conversionStatus === 'ready' && file.pageAuditIncluded;
  const pageCheckSkipped = file.conversionStatus === 'ready' && !file.pageAuditIncluded;
  const total = auditPages ? file.pageAssetsExpected : file.conversionProgressTotal;
  const current = auditPages ? file.pageAssetsFound : file.conversionProgressCurrent;
  const knownTotal = total > 0;
  const indeterminate = file.conversionStatus === 'pending' && !knownTotal;
  const stale =
    file.conversionStatus === 'pending' &&
    !!file.conversionUpdatedAt &&
    Date.now() - Date.parse(file.conversionUpdatedAt) > 15 * 60_000;
  const broken =
    !!file.sourceIssue ||
    !!file.pageMappingIssues?.length ||
    file.conversionStatus === 'failed' ||
    (file.conversionStatus === 'ready' &&
      (!file.pageCount ||
        file.pageCount < 1 ||
        (file.pageAuditIncluded && (file.missingPageNumbers.length > 0 || !file.previewPresent))));
  const barColor = broken ? 'bg-blush-text' : auditPages ? 'bg-teal' : 'bg-marigold';
  const isSyncable = ['registered', 'changed', 'unimported'].includes(file.status);
  const syncingThisFile =
    sync.isPending && sync.variables?.kind === 'file' && sync.variables.key === file.key;
  const syncedThisFile = sync.variables?.kind === 'file' && sync.variables.key === file.key;
  const isRepairable =
    file.fileId &&
    !file.sourceIssue &&
    (file.pageMappingIssues?.length ||
      file.conversionStatus === 'failed' ||
      (file.conversionStatus === 'ready' &&
        (!file.pageCount ||
          file.pageCount < 1 ||
          (file.pageAuditIncluded && (file.missingPageNumbers.length > 0 || !file.previewPresent)))));

  return (
    <li className="grid grid-cols-1 gap-4 border-b border-line p-4 transition-colors hover:bg-sunk/40 last:border-b-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] lg:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-ink" title={file.key}>
          {file.name}
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-ink2" title={file.key}>
          {file.key}
        </div>
        <div className="mt-1 text-xs text-ink2">
          {file.courseTitle ? (
            <>
              {file.courseTitle} <span aria-hidden="true">·</span> {file.unit ?? 'Unassigned unit'}
            </>
          ) : (
            <span className={file.inImportRoot ? 'text-marigold-text' : 'text-ink2'}>
              Not mapped to a course
            </span>
          )}
          <span aria-hidden="true"> · </span>
          {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB
          {!file.inImportRoot && (
            <span className="ml-2 text-marigold-text">Outside the configured import folder</span>
          )}
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={source} />
          <StatusPill status={status} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          {pageCheckSkipped ? (
            <>
              <div
                className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-sunk"
                aria-hidden="true"
              />
              <span className="shrink-0 text-[10px] text-ink2">Page check not included</span>
            </>
          ) : (
            <>
              <div
                className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-sunk"
                role="progressbar"
                tabIndex={0}
                aria-label={`Conversion status for ${file.name}`}
                aria-valuemin={0}
                aria-valuemax={knownTotal ? total : 100}
                aria-valuenow={knownTotal ? Math.min(current, total) : percent}
                aria-valuetext={processLabel(file) + (knownTotal ? `, ${current} of ${total}` : '')}
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${barColor}${indeterminate ? ' w-1/3 animate-pulse' : ''}`}
                  style={indeterminate ? undefined : { width: `${percent}%` }}
                />
              </div>
              <span className="shrink-0 font-mono text-[10px] text-ink2">
                {knownTotal
                  ? auditPages
                    ? `${current}/${total} pages`
                    : `${current}/${total}`
                  : `${percent}%`}
              </span>
            </>
          )}
        </div>
        <p
          className={`mb-0 mt-1 text-xs leading-relaxed ${broken || stale ? 'text-blush-text' : 'text-ink2'}`}
        >
          {processLabel(file)}
          {stale ? ' · No update in 15 minutes; retry or recheck this file.' : ''}
        </p>
        {file.conversionError && (
          <div className="mt-2 rounded-lg border border-blush bg-blush/40 px-3 py-2 text-xs leading-relaxed text-blush-text">
            <strong>{file.conversionErrorStage ? `${processLabel(file)}: ` : 'Problem: '}</strong>
            {file.conversionError}
            {file.conversionError.startsWith('Broken source:') && (
              <div className="mt-1">Replace the original object in storage, then sync this course.</div>
            )}
          </div>
        )}
        {file.sourceIssue && (
          <div
            className="mt-2 rounded-lg border border-blush bg-blush/40 px-3 py-2 text-xs leading-relaxed text-blush-text"
            role="alert"
          >
            <strong>Storage source check:</strong> {file.sourceIssue.replace(/^Broken source:\s*/i, '')}
            <div className="mt-1">
              {isZipArchive(file)
                ? 'Upload the extracted PDFs, PowerPoint, and Word files into this storage folder, keep their subfolders, then rescan. Take the ZIP offline after checking the extracted files.'
                : 'Replace the original file in storage, then rescan this scope.'}
            </div>
          </div>
        )}
        {!!file.pageMappingIssues?.length && (
          <div
            className="mt-2 rounded-lg border border-blush bg-blush/40 px-3 py-2 text-xs leading-relaxed text-blush-text"
            role="alert"
          >
            <strong>Saved page list:</strong>
            <ul className="mb-0 mt-1 list-disc pl-5">
              {file.pageMappingIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
              {file.pageMappingIssues.length > 5 && (
                <li>+{file.pageMappingIssues.length - 5} more mapping issues</li>
              )}
            </ul>
          </div>
        )}
        {file.missingPageNumbers.length > 0 && (
          <details open className="mt-1 text-xs text-blush-text">
            <summary className="cursor-pointer">
              {file.missingPageNumbers.length} page objects missing
            </summary>
            <p className="mb-0 mt-1 break-all font-mono">
              Page numbers: {file.missingPageNumbers.join(', ')}
            </p>
          </details>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
        {isSyncable && file.courseId && (
          <Button
            variant="outline"
            className="!h-9 !px-3 !text-xs"
            disabled={actionsBusy}
            onClick={() => sync.mutate({ kind: 'file', courseId: file.courseId!, key: file.key })}
          >
            {syncingThisFile ? 'Syncing this file…' : 'Sync this file'}
          </Button>
        )}
        {file.fileId && file.unitHidden && file.courseId && file.unitKey ? (
          <Button
            variant="outline"
            className="!h-9 !px-3 !text-xs"
            disabled={actionsBusy}
            onClick={() =>
              setUnitVisibility.mutate({
                courseId: file.courseId!,
                unitKey: file.unitKey!,
                hidden: false,
              })
            }
          >
            {setUnitVisibility.isPending && setUnitVisibility.variables?.unitKey === file.unitKey
              ? 'Saving…'
              : 'Show unit'}
          </Button>
        ) : (
          file.fileId && (
            <Button
              variant="ghost"
              className="!h-9 !px-3 !text-xs"
              disabled={actionsBusy}
              onClick={() => setVisibility.mutate({ fileId: file.fileId!, hidden: !file.fileHidden })}
            >
              {setVisibility.isPending && setVisibility.variables?.fileId === file.fileId
                ? 'Saving…'
                : file.fileHidden
                  ? 'Show on site'
                  : 'Take offline'}
            </Button>
          )
        )}
        {isRepairable && (
          <Button
            variant="outline"
            className="!h-9 !px-3 !text-xs"
            disabled={actionsBusy}
            onClick={() => retry.mutate(file.fileId!)}
          >
            {retry.isPending && retry.variables === file.fileId
              ? 'Retrying…'
              : file.conversionStatus === 'ready'
                ? 'Repair pages'
                : 'Retry conversion'}
          </Button>
        )}
        {file.courseSlug && (
          <Link
            className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-teal-text no-underline hover:underline"
            to={`/c/${file.courseSlug}`}
          >
            Open course
          </Link>
        )}
        {!file.courseId && file.inImportRoot && file.status === 'unimported' && (
          <Link
            className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-teal-text no-underline hover:underline"
            to="/admin?tab=import"
          >
            Map in Import
          </Link>
        )}
        {syncedThisFile && sync.isSuccess && (
          <p className="m-0 basis-full text-xs text-teal-text" role="status">
            This file was checked; {sync.data?.conversionQueued ?? 0} conversion
            {(sync.data?.conversionQueued ?? 0) === 1 ? '' : 's'} queued.
          </p>
        )}
        {syncedThisFile && sync.isError && (
          <p className="m-0 basis-full text-xs text-blush-text" role="alert">
            This file could not sync: {friendly(sync.error)}
          </p>
        )}
        {retry.isError && retry.variables === file.fileId && (
          <p className="m-0 basis-full text-xs text-blush-text" role="alert">
            This file could not be queued: {friendly(retry.error)}
          </p>
        )}
      </div>
    </li>
  );
}

function bucketFileRows(scan: BucketScanState): AuditFile[] {
  const pageAuditedFileIds = new Set(scan.pageAuditedFileIds);
  const recordsByKey = new Map(scan.records.map((record) => [record.sourceKey, record]));
  const pagesByFile = new Map<string, Set<string>>();
  for (const object of scan.objects) {
    if (object.kind !== 'page') continue;
    const fileId = /^pages\/([^/]+)\//.exec(object.key)?.[1];
    if (!fileId) continue;
    const pageKeys = pagesByFile.get(fileId) ?? new Set<string>();
    pageKeys.add(object.key);
    pagesByFile.set(fileId, pageKeys);
  }
  const sourceObjects = scan.objects.filter((object) => object.kind === 'source');
  const sourceKeys = new Set(sourceObjects.map((object) => object.key));
  const bestCourse = (key: string) =>
    scan.courses
      .filter((course) => key.startsWith(course.prefix))
      .sort((a, b) => b.prefix.length - a.prefix.length)[0];

  const makeRow = (input: {
    key: string;
    sizeBytes: number;
    etag?: string;
    fallbackStatus?: AuditFile['status'];
    sourceIssue?: string | null;
  }): AuditFile => {
    const record = recordsByKey.get(input.key);
    const pageAuditIncluded = scan.scopePrefix === '' || (!!record && pageAuditedFileIds.has(record.fileId));
    const course = record ? undefined : bestCourse(input.key);
    const pageKeys = record ? (pagesByFile.get(record.fileId) ?? new Set<string>()) : new Set<string>();
    const validPageNumbers = record
      ? [...pageKeys]
          .map((key) => new RegExp(`^pages/${record.fileId}/(\\d+)\\.webp$`).exec(key)?.[1])
          .filter((value): value is string => !!value)
          .map(Number)
          .filter((number) => number >= 1 && number <= record.pageCount)
      : [];
    const foundPageNumbers = new Set(validPageNumbers);
    const missingPageNumbers =
      record && pageAuditIncluded && scan.complete
        ? Array.from({ length: record.pageCount }, (_, index) => index + 1).filter(
            (page) => !foundPageNumbers.has(page),
          )
        : [];
    const changed = !!record && (record.sourceEtag !== input.etag || record.sizeBytes !== input.sizeBytes);

    return {
      key: input.key,
      name: input.key.split('/').filter(Boolean).at(-1) ?? input.key,
      sizeBytes: input.sizeBytes,
      courseId: record?.courseId ?? course?.id ?? null,
      courseTitle: record?.courseTitle ?? course?.title ?? null,
      courseSlug: record?.courseSlug ?? course?.slug ?? null,
      fileId: record?.fileId ?? null,
      unitKey: record?.unitKey ?? null,
      unit: record?.unit ?? null,
      conversionStatus: record?.conversionStatus ?? null,
      conversionError: record?.conversionError ?? null,
      conversionErrorStage: record?.conversionErrorStage ?? null,
      conversionStage: record?.conversionStage ?? null,
      conversionProgressCurrent: record?.conversionProgressCurrent ?? 0,
      conversionProgressTotal: record?.conversionProgressTotal ?? 0,
      conversionQueueId: record?.conversionQueueId ?? null,
      conversionQueuePosition: record?.conversionQueuePosition ?? 0,
      conversionQueueTotal: record?.conversionQueueTotal ?? 0,
      conversionUpdatedAt: record?.conversionUpdatedAt ?? null,
      pageCount: record?.pageCount ?? null,
      pageAssetsFound: scan.complete ? foundPageNumbers.size : 0,
      pageAssetsExpected: record?.pageCount ?? 0,
      missingPageNumbers,
      previewPresent: !!record?.previewKey && pageKeys.has(record.previewKey),
      status:
        input.fallbackStatus === 'unsupported'
          ? 'unsupported'
          : record
            ? changed
              ? 'changed'
              : 'registered'
            : (input.fallbackStatus ?? 'unimported'),
      inImportRoot: input.key.startsWith(scan.importRoot),
      hidden: record?.hidden ?? false,
      fileHidden: record?.fileHidden ?? false,
      unitHidden: record?.unitHidden ?? false,
      pageAuditIncluded,
      sourceIssue: input.sourceIssue ?? null,
      pageMappingIssues: record?.pageMappingIssues ?? [],
    };
  };

  const rows = sourceObjects.map((object) =>
    makeRow({
      key: object.key,
      sizeBytes: object.sizeBytes,
      etag: object.etag,
      fallbackStatus: object.unregisteredStatus ?? 'unsupported',
      sourceIssue: object.sourceIssue,
    }),
  );
  for (const record of scan.records) {
    if (!sourceKeys.has(record.sourceKey)) {
      rows.push(
        makeRow({ key: record.sourceKey, sizeBytes: record.sizeBytes, fallbackStatus: 'missing-source' }),
      );
    }
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }));
}

function inventoryFolderSummary(objects: BucketObject[], scopePrefix: string) {
  const folders = new Map<string, { explicit: boolean; objectCount: number }>();
  const minimumDepth = scopePrefix.split('/').filter(Boolean).length;
  for (const object of objects) {
    // Keep this as a view of source folders. Generated pages and internal worker
    // objects are audited in the object table, not presented as import folders.
    if (
      (scopePrefix && !object.key.startsWith(scopePrefix)) ||
      (object.kind !== 'source' && object.kind !== 'folder')
    )
      continue;
    const parts = object.key.split('/').filter(Boolean);
    const folderParts = object.kind === 'folder' ? parts : parts.slice(0, -1);
    for (let i = Math.max(1, minimumDepth); i <= folderParts.length; i++) {
      const path = `${folderParts.slice(0, i).join('/')}/`;
      const entry = folders.get(path) ?? { explicit: false, objectCount: 0 };
      entry.objectCount += object.kind === 'folder' ? 0 : 1;
      folders.set(path, entry);
    }
    if (object.kind === 'folder') {
      const path = `${parts.join('/')}/`;
      const entry = folders.get(path) ?? { explicit: false, objectCount: 0 };
      entry.explicit = true;
      folders.set(path, entry);
    }
  }
  return [...folders]
    .map(([path, counts]) => ({ path, ...counts }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
}

function pageObjectStatus(object: BucketObject, recordsById: Map<string, BucketRecord>) {
  const match = /^pages\/([^/]+)\/(.+)$/.exec(object.key);
  if (!match) return 'invalid page path';
  const [, fileId, relative] = match;
  if (!fileId || !relative) return 'invalid page path';
  const record = recordsById.get(fileId);
  if (!record) return 'orphan: no file record on the website';
  if (record.previewKey === object.key) return 'preview object';
  const pageNo = /^([1-9]\d*)\.webp$/.exec(relative)?.[1];
  if (!pageNo) return 'unexpected page object';
  if (record.pageCount < 1) return 'page object has no recorded page count';
  if (Number(pageNo) > record.pageCount) return 'page number exceeds recorded count';
  return 'page object';
}

function syncOutcomeLabel(status: R2FileSyncProgress['outcomes'][number]['status']): string {
  switch (status) {
    case 'queued':
      return 'Waiting';
    case 'syncing':
      return 'Checking storage and updating its record';
    case 'checked':
      return 'Already in sync';
    case 'added':
      return 'Mapped; conversion queued';
    case 'changed':
      return 'Updated; conversion queued';
    case 'retired':
      return 'Source missing; taken offline';
    case 'review':
      return 'Needs review';
    case 'failed':
      return 'Sync failed';
  }
}

function BucketInventoryPanel() {
  const qc = useQueryClient();
  const syncHealthQuery = useQuery({
    queryKey: ['admin-sync-health'],
    queryFn: api.adminSyncHealth,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const coursesQuery = useQuery({
    queryKey: ['admin-courses'],
    queryFn: api.adminCourses,
    staleTime: 30_000,
  });
  const running = useRef(false);
  const [scan, setScan] = useState<BucketScanState | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStale, setScanStale] = useState(false);
  const [scopeSyncResult, setScopeSyncResult] = useState<{
    prefix: string;
    result: Awaited<ReturnType<typeof syncR2Files>>;
    unmapped: number;
  } | null>(null);
  const [scopeSyncProgress, setScopeSyncProgress] = useState<R2FileSyncProgress | null>(null);
  const [search, setSearch] = useState('');
  const [courseScope, setCourseScope] = useState('all');
  const [scopeKind, setScopeKind] = useState<'bucket' | 'import-root' | 'course' | 'folder'>('bucket');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedFolderPrefix, setSelectedFolderPrefix] = useState('');
  const [fileFilter, setFileFilter] = useState<FileAuditFilter>('all');
  const [objectKind, setObjectKind] = useState<'all' | BucketObject['kind']>('all');
  const [visibleFiles, setVisibleFiles] = useState(50);
  const [visibleObjects, setVisibleObjects] = useState(100);
  const [visibleFolders, setVisibleFolders] = useState(100);

  const runScan = useCallback(async (scopePrefix: string, auditPageAssets: boolean) => {
    if (running.current) return;
    running.current = true;
    setIsScanning(true);
    setScanStale(false);
    setScopeSyncResult(null);
    setScan({
      checkedAt: new Date().toISOString(),
      scopePrefix,
      importRoot: '',
      objects: [],
      records: [],
      courses: [],
      pageAuditedFileIds: [],
      pageAuditCompleted: 0,
      pageAuditTotal: 0,
      pageAuditCurrentKey: null,
      pageAuditScopeIncluded: scopePrefix === '' || auditPageAssets,
      pageAuditComplete: scopePrefix === '',
      complete: false,
      requestCount: 0,
      error: null,
    });
    setVisibleFiles(50);
    setVisibleObjects(100);
    setVisibleFolders(100);
    let cursor: string | undefined;
    const knownCursors = new Set<string>();
    const seenObjectKeys = new Set<string>();
    let scopedRecords: BucketRecord[] = [];
    try {
      do {
        let page: StorageInventoryPageDto | undefined;
        let lastError: unknown;
        for (let attempt = 0; attempt < 3 && !page; attempt++) {
          try {
            page = await api.adminStorageInventoryPage(cursor, scopePrefix);
          } catch (error) {
            lastError = error;
            const status = (error as { status?: number }).status;
            if (status !== undefined && status < 500 && status !== 0) break;
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
          }
        }
        if (!page) throw lastError instanceof Error ? lastError : new Error('Storage inventory page failed.');
        if (page.scopePrefix !== scopePrefix) {
          throw new Error(
            'Storage returned a different prefix than the one requested; this scan cannot be trusted.',
          );
        }
        for (const object of page.objects) {
          if (seenObjectKeys.has(object.key)) {
            throw new Error(
              `Storage returned the object ${object.key} more than once. Restart the scan before syncing.`,
            );
          }
          seenObjectKeys.add(object.key);
        }
        if (!cursor) scopedRecords = page.records ?? [];
        setScan((current) => ({
          checkedAt: current?.objects.length ? current.checkedAt : page!.checkedAt,
          scopePrefix: page!.scopePrefix,
          importRoot: current?.importRoot || page!.importRoot,
          objects: [...(current?.objects ?? []), ...page!.objects],
          records: current?.records.length ? current.records : (page!.records ?? []),
          courses: current?.courses.length ? current.courses : (page!.courses ?? []),
          pageAuditedFileIds: current?.pageAuditedFileIds ?? [],
          pageAuditCompleted: current?.pageAuditCompleted ?? 0,
          pageAuditTotal: auditPageAssets ? current?.pageAuditTotal || page!.records?.length || 0 : 0,
          pageAuditCurrentKey: current?.pageAuditCurrentKey ?? null,
          pageAuditScopeIncluded: current?.pageAuditScopeIncluded ?? (scopePrefix === '' || auditPageAssets),
          pageAuditComplete: scopePrefix === '',
          complete: page!.complete && !auditPageAssets,
          requestCount: (current?.requestCount ?? 0) + 1,
          error: null,
        }));
        if (!page.nextCursor) break;
        if (knownCursors.has(page.nextCursor) || page.nextCursor === cursor) {
          throw new Error(
            'Storage returned a repeated continuation cursor. Restart the scan to avoid skipping objects.',
          );
        }
        knownCursors.add(page.nextCursor);
        cursor = page.nextCursor;
      } while (cursor);

      if (auditPageAssets) {
        const scopedFiles = scopedRecords.filter((record) => record.sourceKey.startsWith(scopePrefix));
        setScan((current) =>
          current ? { ...current, pageAuditTotal: scopedFiles.length, pageAuditComplete: false } : current,
        );

        for (const [index, record] of scopedFiles.entries()) {
          const pagePrefix = `pages/${record.fileId}/`;
          let pageCursor: string | undefined;
          const pageCursors = new Set<string>();
          do {
            let page: StorageInventoryPageDto | undefined;
            let lastError: unknown;
            for (let attempt = 0; attempt < 3 && !page; attempt++) {
              try {
                page = await api.adminStorageInventoryPage(pageCursor, pagePrefix);
              } catch (error) {
                lastError = error;
                const status = (error as { status?: number }).status;
                if (status !== undefined && status < 500 && status !== 0) break;
                if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
              }
            }
            if (!page) {
              const reason = lastError instanceof Error ? lastError.message : 'Storage page listing failed';
              throw new Error(`Generated pages for ${record.sourceKey} could not be checked: ${reason}`);
            }
            if (page.scopePrefix !== pagePrefix) {
              throw new Error(`Storage returned the wrong prefix while checking ${record.sourceKey}.`);
            }
            for (const object of page.objects) {
              if (seenObjectKeys.has(object.key)) {
                throw new Error(
                  `Storage returned the object ${object.key} more than once. Restart the scan before syncing.`,
                );
              }
              seenObjectKeys.add(object.key);
            }
            setScan((current) =>
              current
                ? {
                    ...current,
                    objects: [...current.objects, ...page!.objects],
                    pageAuditCurrentKey: record.sourceKey,
                    requestCount: current.requestCount + 1,
                  }
                : current,
            );
            if (!page.nextCursor) break;
            if (pageCursors.has(page.nextCursor) || page.nextCursor === pageCursor) {
              throw new Error(
                `Storage repeated a page cursor while checking generated pages for ${record.sourceKey}.`,
              );
            }
            pageCursors.add(page.nextCursor);
            pageCursor = page.nextCursor;
          } while (pageCursor);

          setScan((current) =>
            current
              ? {
                  ...current,
                  pageAuditedFileIds: [...current.pageAuditedFileIds, record.fileId],
                  pageAuditCompleted: index + 1,
                }
              : current,
          );
        }
        setScan((current) =>
          current
            ? {
                ...current,
                pageAuditCompleted: scopedFiles.length,
                pageAuditCurrentKey: null,
                pageAuditComplete: true,
                complete: true,
              }
            : current,
        );
      }
    } catch (error) {
      setScan((current) =>
        current
          ? {
              ...current,
              error: error instanceof Error ? error : new Error('Storage inventory scan failed.'),
            }
          : current,
      );
    } finally {
      running.current = false;
      setIsScanning(false);
    }
  }, []);

  const files = useMemo(() => (scan?.complete ? bucketFileRows(scan) : []), [scan]);
  const folderSummary = useMemo(
    () => inventoryFolderSummary(scan?.objects ?? [], scan?.scopePrefix ?? ''),
    [scan?.objects, scan?.scopePrefix],
  );
  const recordsById = new Map((scan?.records ?? []).map((record) => [record.fileId, record]));
  const recordsByKey = new Map((scan?.records ?? []).map((record) => [record.sourceKey, record]));
  const matchesCourseFilter = (courseId: string | null) =>
    courseScope === 'all' || (courseScope === 'unmapped' ? !courseId : courseId === courseScope);
  const matchingFiles = files.filter(
    (file) =>
      matchesCourseFilter(file.courseId) &&
      matchesFileFilter(file, fileFilter) &&
      (!search ||
        `${file.key} ${file.courseTitle ?? ''} ${file.unit ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const matchingObjects = (scan?.objects ?? []).filter((object) => {
    if (objectKind !== 'all' && object.kind !== objectKind) return false;
    if (courseScope !== 'all') {
      if (courseScope === 'unmapped' && object.kind === 'system') return false;
      const record =
        object.kind === 'source'
          ? recordsByKey.get(object.key)
          : object.kind === 'page'
            ? recordsById.get(/^pages\/([^/]+)\//.exec(object.key)?.[1] ?? '')
            : undefined;
      const objectCourseId =
        record?.courseId ??
        scan?.courses
          .filter((course) => object.key.startsWith(course.prefix))
          .sort((a, b) => b.prefix.length - a.prefix.length)[0]?.id ??
        null;
      if (!matchesCourseFilter(objectCourseId)) return false;
    }
    return !search || object.key.toLowerCase().includes(search.toLowerCase());
  });
  const matchingFolders = folderSummary.filter((folder) => {
    const folderCourse = scan?.courses
      .filter((course) => folder.path.startsWith(course.prefix))
      .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    return (
      matchesCourseFilter(folderCourse?.id ?? null) &&
      (!search || folder.path.toLowerCase().includes(search.toLowerCase()))
    );
  });

  const courses = (coursesQuery.data ?? []).slice().sort((a, b) => a.title.localeCompare(b.title));
  const selectedCourse = courses.find((course) => course.id === selectedCourseId);
  const importRoot = scan?.importRoot || 'drive-imports/';
  const foldersForSelectedCourse =
    scan?.complete &&
    selectedCourse &&
    (scan.scopePrefix === '' || scan.scopePrefix === selectedCourse.r2Prefix)
      ? folderSummary.filter(
          (folder) =>
            folder.path.startsWith(selectedCourse.r2Prefix) && folder.path !== selectedCourse.r2Prefix,
        )
      : [];
  const scanPrefix =
    scopeKind === 'bucket'
      ? ''
      : scopeKind === 'import-root'
        ? importRoot
        : scopeKind === 'course'
          ? (selectedCourse?.r2Prefix ?? '')
          : selectedFolderPrefix;
  const scopeCanRun = scopeKind === 'bucket' || (scopeKind === 'import-root' && !!importRoot) || !!scanPrefix;
  const scanTargetLabel =
    scopeKind === 'bucket'
      ? 'all storage'
      : scopeKind === 'import-root'
        ? 'the import root'
        : scopeKind === 'course'
          ? 'this course'
          : 'this folder';

  const markAuditStale = () => setScanStale(true);
  const refreshRelatedCourseData = (courseId?: string) => {
    void qc.invalidateQueries({ queryKey: ['admin-courses'] });
    if (courseId) void qc.invalidateQueries({ queryKey: ['admin-inventory', courseId] });
  };

  const sync = useMutation({
    mutationFn: ({ kind, courseId, key }: { kind: 'file' | 'folder'; courseId: string; key: string }) =>
      kind === 'file' ? api.adminSyncFile(courseId, key) : api.adminSyncFolder(courseId, key),
    onSuccess: (_data, variables) => {
      markAuditStale();
      refreshRelatedCourseData(variables.courseId);
    },
  });
  const syncSelectedScope = useMutation({
    mutationFn: async (prefix: string) => {
      if (!scan?.complete || scan.scopePrefix !== prefix)
        throw new Error('Run a complete scan of this scope first.');
      setScopeSyncProgress({ completed: 0, total: 0, currentKey: null, outcomes: [] });
      const tasks = new Map<string, R2FileSyncTask>();
      const inScope = (key: string) => !prefix || key.startsWith(prefix);
      let unmapped = 0;
      for (const object of scan.objects) {
        if (object.kind !== 'source' || !inScope(object.key)) continue;
        const record = recordsByKey.get(object.key);
        const owner = scan.courses
          .filter((course) => object.key.startsWith(course.prefix))
          .sort((a, b) => b.prefix.length - a.prefix.length)[0];
        const courseId = record?.courseId ?? owner?.id;
        const courseTitle = record?.courseTitle ?? owner?.title;
        if (!courseId || !courseTitle) {
          unmapped++;
          continue;
        }
        tasks.set(`${courseId}:${object.key}`, { courseId, courseTitle, key: object.key });
      }
      for (const record of scan.records) {
        if (!inScope(record.sourceKey)) continue;
        tasks.set(`${record.courseId}:${record.sourceKey}`, {
          courseId: record.courseId,
          courseTitle: record.courseTitle,
          key: record.sourceKey,
        });
      }
      const result = await syncR2Files(
        [...tasks.values()].sort(
          (a, b) =>
            a.courseTitle.localeCompare(b.courseTitle, undefined, { sensitivity: 'base' }) ||
            a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }),
        ),
        setScopeSyncProgress,
      );
      if (prefix === '') {
        const cleanup = await api.adminCleanupOrphanPages();
        result.summary.pageObjectsRemoved += cleanup.pageObjectsRemoved;
      }
      return { prefix, result, unmapped };
    },
    onSuccess: (data) => {
      setScopeSyncResult(data);
      markAuditStale();
      void qc.invalidateQueries({ queryKey: ['admin-courses'] });
      void qc.invalidateQueries({ queryKey: ['admin-inventory'] });
      void qc.invalidateQueries({ queryKey: ['catalogue'] });
    },
  });
  const setVisibility = useMutation({
    mutationFn: ({ fileId, hidden }: { fileId: string; hidden: boolean }) =>
      api.adminSetFileHidden(fileId, hidden),
    onSuccess: (_data, variables) => {
      markAuditStale();
      const courseId = scan?.records.find((record) => record.fileId === variables.fileId)?.courseId;
      refreshRelatedCourseData(courseId);
    },
  });
  const setUnitVisibility = useMutation({
    mutationFn: ({ courseId, unitKey, hidden }: { courseId: string; unitKey: string; hidden: boolean }) =>
      api.adminSetUnitHidden(courseId, unitKey, hidden),
    onSuccess: (_data, variables) => {
      markAuditStale();
      refreshRelatedCourseData(variables.courseId);
    },
  });
  const retry = useMutation({
    mutationFn: (fileId: string) => api.adminRetryConversion(fileId),
    onSuccess: (_data, fileId) => {
      markAuditStale();
      const courseId = scan?.records.find((record) => record.fileId === fileId)?.courseId;
      refreshRelatedCourseData(courseId);
    },
  });

  const sourceCount = scan?.objects.filter((object) => object.kind === 'source').length ?? 0;
  const outsideImportRootObjectCount =
    scan?.objects.filter((object) => object.kind === 'source' && !object.key.startsWith(scan.importRoot))
      .length ?? 0;
  const unassignedSupportedCount =
    scan?.objects.filter(
      (object) =>
        object.kind === 'source' &&
        object.unregisteredStatus === 'unimported' &&
        !recordsByKey.has(object.key) &&
        !scan.courses.some((course) => object.key.startsWith(course.prefix)),
    ).length ?? 0;
  const unassignedOutsideImportRootCount =
    scan?.objects.filter(
      (object) =>
        object.kind === 'source' &&
        object.unregisteredStatus === 'unimported' &&
        !object.key.startsWith(scan.importRoot) &&
        !recordsByKey.has(object.key) &&
        !scan.courses.some((course) => object.key.startsWith(course.prefix)),
    ).length ?? 0;
  const registeredSourceByFingerprint = new Map<string, string>();
  for (const object of scan?.objects ?? []) {
    if (object.kind === 'source' && object.etag && recordsByKey.has(object.key)) {
      const fingerprint = `${object.sizeBytes}:${object.etag}`;
      if (!registeredSourceByFingerprint.has(fingerprint))
        registeredSourceByFingerprint.set(fingerprint, object.key);
    }
  }
  const pageCount = scan?.objects.filter((object) => object.kind === 'page').length ?? 0;
  const numberedPageCount =
    scan?.objects.filter((object) => object.kind === 'page' && /\/\d+\.webp$/i.test(object.key)).length ?? 0;
  const previewCount =
    scan?.objects.filter((object) => object.kind === 'page' && /\/preview\.webp$/i.test(object.key)).length ??
    0;
  const otherPageAssetCount = Math.max(0, pageCount - numberedPageCount - previewCount);
  const systemCount = scan?.objects.filter((object) => object.kind === 'system').length ?? 0;
  const explicitFolders =
    scan?.objects.filter((object) => object.kind === 'folder' && !object.key.startsWith('pages/')).length ??
    0;
  const missingSourceCount = scan?.complete
    ? files.filter((file) => file.status === 'missing-source').length
    : 0;
  const unresolvedPageCount = scan?.complete
    ? scan.objects.filter(
        (object) =>
          object.kind === 'page' &&
          !['page object', 'preview object'].includes(pageObjectStatus(object, recordsById)),
      ).length
    : 0;
  const generatedPagesChecked = scan?.pageAuditScopeIncluded === true && scan.pageAuditComplete === true;
  const fileIssues = scan?.complete ? files.filter(needsReview).length : 0;
  const actionsBusy =
    isScanning ||
    sync.isPending ||
    syncSelectedScope.isPending ||
    setVisibility.isPending ||
    setUnitVisibility.isPending ||
    retry.isPending;
  const rowActions: AuditRowMutations = { actionsBusy, sync, setVisibility, setUnitVisibility, retry };
  const syncScope = sync.variables;
  const canApplyScope =
    scan?.complete === true && scan.scopePrefix === scanPrefix && !scanStale && scopeCanRun;

  return (
    <Panel
      title="Full check"
      aside={
        <Button
          variant="outline"
          className="!h-10 !px-4 !text-sm"
          onClick={() => void runScan(scanPrefix, scopeKind === 'course' || scopeKind === 'folder')}
          disabled={actionsBusy || !scopeCanRun}
        >
          {isScanning
            ? 'Scanning storage…'
            : scan?.scopePrefix === scanPrefix && !scan.complete
              ? 'Retry this scan'
              : scan?.scopePrefix === scanPrefix
                ? `Recheck ${scanTargetLabel}`
                : `Scan ${scanTargetLabel}`}
        </Button>
      }
    >
      <p className="m-0 mb-4 max-w-[80ch] text-sm leading-relaxed text-ink2">
        Course and folder scans reconcile every source key and check generated objects under each mapped
        file's own <code>pages/&lt;file-id&gt;/</code> prefix. A whole-bucket scan also finds unlinked page
        objects that cannot be assigned to a course. Import-root scans stay limited to source files.
      </p>
      <section className="mb-4 rounded-xl border border-line bg-surface p-4" aria-label="Sync system health">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="m-0 text-sm font-semibold">Sync systems</h3>
            <p className="m-0 mt-1 text-xs text-ink2">
              Original files are listed on the website; their pages are saved back to storage.
            </p>
          </div>
          <Button
            variant="outline"
            className="!h-9 !px-3 !text-xs"
            onClick={() => void syncHealthQuery.refetch()}
            disabled={syncHealthQuery.isFetching}
          >
            {syncHealthQuery.isFetching ? 'Checking…' : 'Refresh checks'}
          </Button>
        </div>
        {syncHealthQuery.isError ? (
          <p
            className="m-0 rounded-lg border border-blush bg-blush/30 p-3 text-sm text-blush-text"
            role="alert"
          >
            System checks could not load: {friendly(syncHealthQuery.error)}
          </p>
        ) : syncHealthQuery.data ? (
          <div className="grid gap-2 md:grid-cols-3">
            {[
              {
                name: 'Storage',
                status: syncHealthQuery.data.r2.status,
                detail: `${syncHealthQuery.data.r2.message}${syncHealthQuery.data.r2.sampleObjects === null ? '' : ` (${syncHealthQuery.data.r2.sampleObjects} sample object${syncHealthQuery.data.r2.sampleObjects === 1 ? '' : 's'} read)`}`,
              },
              {
                name: 'Website records',
                status: syncHealthQuery.data.supabase.status,
                detail: `${syncHealthQuery.data.supabase.message}${syncHealthQuery.data.supabase.courses === null ? '' : ` ${syncHealthQuery.data.supabase.courses} courses · ${syncHealthQuery.data.supabase.fileRecords} source records.`}`,
              },
              {
                name: 'Conversion queue',
                status: syncHealthQuery.data.conversion.status,
                detail: `${syncHealthQuery.data.conversion.message}${syncHealthQuery.data.conversion.queuedJobs === null ? '' : ` ${syncHealthQuery.data.conversion.queuedJobs} queued.`}${syncHealthQuery.data.conversion.deadLetterJobs ? ` ${syncHealthQuery.data.conversion.deadLetterJobs} need retry or review.` : ''}`,
              },
            ].map((system) => {
              const healthy = system.status === 'connected' || system.status === 'ready';
              const setupNeeded = system.status === 'not-configured';
              return (
                <div key={system.name} className="rounded-lg border border-line bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{system.name}</strong>
                    <span
                      className={`text-[11px] font-semibold uppercase tracking-wide ${healthy ? 'text-teal-text' : setupNeeded ? 'text-marigold-text' : 'text-blush-text'}`}
                    >
                      {healthy ? 'Connected' : setupNeeded ? 'Setup needed' : 'Error'}
                    </span>
                  </div>
                  <p className="mb-0 mt-2 break-words text-xs leading-relaxed text-ink2">{system.detail}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="m-0 text-sm text-ink2">Checking storage, the database, and the conversion queue…</p>
        )}
        {syncHealthQuery.data && (
          <p className="mb-0 mt-2 text-[11px] text-ink2">
            Checked {new Date(syncHealthQuery.data.checkedAt).toLocaleString()}. A completed scope scan
            reconciles every source key against its website record and generated pages.
          </p>
        )}
      </section>
      <section className="mb-4 rounded-xl border border-line bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-ink2">
            Scan scope
            <select
              className="h-10 rounded-lg border border-line bg-card px-3 text-sm text-ink"
              value={scopeKind}
              onChange={(event) => {
                const next = event.target.value as typeof scopeKind;
                setScopeKind(next);
                if (next === 'folder' && !selectedCourseId && courses[0]) {
                  setSelectedCourseId(courses[0].id);
                }
              }}
            >
              <option value="bucket">Entire bucket</option>
              <option value="import-root">Configured import root</option>
              <option value="course">One course folder</option>
              <option value="folder">One module or folder</option>
            </select>
          </label>
          {(scopeKind === 'course' || scopeKind === 'folder') && (
            <label className="flex flex-col gap-1.5 text-xs font-medium text-ink2">
              Course folder
              <select
                className="h-10 rounded-lg border border-line bg-card px-3 text-sm text-ink"
                value={selectedCourseId}
                onChange={(event) => {
                  setSelectedCourseId(event.target.value);
                  setSelectedFolderPrefix('');
                }}
                disabled={coursesQuery.isLoading || courses.length === 0}
              >
                <option value="">{coursesQuery.isLoading ? 'Loading courses…' : 'Choose a course'}</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title} · {course.r2Prefix}
                  </option>
                ))}
              </select>
            </label>
          )}
          {scopeKind === 'folder' && (
            <label className="flex flex-col gap-1.5 text-xs font-medium text-ink2">
              Module or nested folder
              <select
                className="h-10 rounded-lg border border-line bg-card px-3 text-sm text-ink"
                value={selectedFolderPrefix}
                onChange={(event) => setSelectedFolderPrefix(event.target.value)}
                disabled={foldersForSelectedCourse.length === 0}
              >
                <option value="">
                  {foldersForSelectedCourse.length ? 'Choose a folder' : 'Scan this course first'}
                </option>
                {foldersForSelectedCourse.map((folder) => (
                  <option key={folder.path} value={folder.path}>
                    {folder.path.slice(selectedCourse?.r2Prefix.length ?? 0)} · {folder.objectCount} files
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-end text-xs leading-relaxed text-ink2">
            {scopeKind === 'folder'
              ? 'Run a course scan first to load every module and nested folder. Then select one folder to inspect its full subtree.'
              : scopeKind === 'bucket'
                ? 'Includes source files, folder markers, converted pages, and internal storage objects.'
                : 'Reads every object under the selected prefix, including nested folders.'}
          </div>
        </div>
        <p className="mb-0 mt-3 break-all font-mono text-[11px] text-ink2">
          Selected prefix: {scanPrefix || 'Entire bucket'}
        </p>
        {coursesQuery.isError && (
          <p className="mb-0 mt-2 text-xs text-blush-text" role="alert">
            Course folders could not load: {friendly(coursesQuery.error)}
          </p>
        )}
      </section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-3">
        <p className="m-0 max-w-[75ch] text-xs leading-relaxed text-ink2">
          Sync applies only after this scope has been fully scanned. Sources missing from this scope go
          offline; only their generated page objects are removed, while students’ reading history is kept.
        </p>
        <Button onClick={() => syncSelectedScope.mutate(scanPrefix)} disabled={actionsBusy || !canApplyScope}>
          {syncSelectedScope.isPending ? 'Applying storage changes…' : 'Sync this scope'}
        </Button>
      </div>
      {scopeSyncProgress && syncSelectedScope.isPending && (
        <section
          className="mb-4 rounded-xl border border-line bg-card p-3 flex flex-col gap-2"
          aria-label="Scoped storage sync progress"
        >
          <div className="flex justify-between gap-2 text-sm">
            <strong>Syncing each source file separately</strong>
            <span className="font-mono text-xs text-ink2">
              {scopeSyncProgress.completed}/{scopeSyncProgress.total}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-sunk"
            role="progressbar"
            tabIndex={0}
            aria-label="Scoped files synced"
            aria-valuemin={0}
            aria-valuemax={Math.max(scopeSyncProgress.total, 1)}
            aria-valuenow={scopeSyncProgress.completed}
          >
            <div
              className="h-full rounded-full bg-teal transition-[width]"
              style={{
                width: `${scopeSyncProgress.total ? (scopeSyncProgress.completed / scopeSyncProgress.total) * 100 : 0}%`,
              }}
            />
          </div>
          {scopeSyncProgress.currentKey && (
            <p className="m-0 break-all font-mono text-xs text-ink2">
              Current: {scopeSyncProgress.currentKey}
            </p>
          )}
          {scopeSyncProgress.outcomes.length > 0 && (
            <ul className="m-0 max-h-64 list-none overflow-y-auto rounded-lg border border-line p-2">
              {scopeSyncProgress.outcomes.map((outcome) => {
                const finished = !['queued', 'syncing'].includes(outcome.status);
                const percent = finished ? 100 : 0;
                const failed = outcome.status === 'failed' || outcome.status === 'review';
                return (
                  <li
                    key={`${outcome.courseId}:${outcome.key}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-line/70 py-2 last:border-0"
                  >
                    <span className="truncate font-mono text-[11px]" title={outcome.key}>
                      {outcome.key}
                    </span>
                    <span className={`text-right text-[11px] ${failed ? 'text-blush-text' : 'text-ink2'}`}>
                      {syncOutcomeLabel(outcome.status)}
                    </span>
                    <div
                      className="col-span-2 h-1.5 overflow-hidden rounded-full bg-sunk"
                      role="progressbar"
                      tabIndex={0}
                      aria-label={`Storage sync progress for ${outcome.key}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={outcome.status === 'syncing' ? 50 : percent}
                      aria-valuetext={`${syncOutcomeLabel(outcome.status)}${outcome.message ? `: ${outcome.message}` : ''}`}
                    >
                      <div
                        className={`h-full rounded-full transition-[width] ${failed ? 'bg-blush-text' : finished ? 'bg-teal' : 'bg-marigold'}${outcome.status === 'syncing' ? ' w-1/2 animate-pulse' : ''}`}
                        style={outcome.status === 'syncing' ? undefined : { width: `${percent}%` }}
                      />
                    </div>
                    {outcome.message && (
                      <span className="col-span-2 break-all text-[11px] text-blush-text">
                        {outcome.message}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {syncSelectedScope.isError && (
        <p
          className="mb-4 rounded-xl border border-blush bg-blush/30 p-3 text-sm text-blush-text"
          role="alert"
        >
          Scope sync failed: {friendly(syncSelectedScope.error)}
        </p>
      )}
      {scopeSyncResult?.prefix === scanPrefix && (
        <div
          className="mb-4 rounded-xl border border-line bg-surface p-3 text-sm"
          role="status"
          aria-live="polite"
        >
          <strong>Storage scope applied · {scopeSyncResult.prefix || 'everything'}</strong>
          <p className="mb-0 mt-1 text-ink2">
            {scopeSyncResult.result.summary.filesAdded} added · {scopeSyncResult.result.summary.filesChanged}{' '}
            changed · {scopeSyncResult.result.summary.filesRetired} missing source
            {scopeSyncResult.result.summary.filesRetired === 1 ? '' : 's'} taken offline ·{' '}
            {scopeSyncResult.result.summary.pageObjectsRemoved} old page objects removed ·{' '}
            {scopeSyncResult.result.summary.conversionQueued} conversion jobs queued
            {scopeSyncResult.result.summary.skipped.length || scopeSyncResult.unmapped
              ? ` · ${scopeSyncResult.result.summary.skipped.length} items need review · ${scopeSyncResult.unmapped} source files have no imported course mapping`
              : ''}
            . Recheck this scope to refresh its audit snapshot.
          </p>
          {scopeSyncResult.result.outcomes.some(
            (item) => item.status === 'failed' || item.status === 'review',
          ) && (
            <details open className="mt-2">
              <summary className="cursor-pointer text-xs text-blush-text">Show file sync errors</summary>
              <ul className="m-0 mt-2 max-h-48 overflow-y-auto list-none rounded-lg bg-sunk p-2 flex flex-col gap-1 text-xs">
                {scopeSyncResult.result.outcomes
                  .filter((item) => item.status === 'failed' || item.status === 'review')
                  .map((item) => (
                    <li key={`${item.courseId}:${item.key}`} className="break-all font-mono">
                      {item.courseTitle} · {item.key}: {item.message ?? item.status}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          <details open className="mt-2 text-xs">
            <summary className="cursor-pointer">
              Show per-file results ({scopeSyncResult.result.outcomes.length})
            </summary>
            <ul className="m-0 mt-2 max-h-64 overflow-y-auto list-none rounded-lg bg-sunk p-2 flex flex-col gap-2">
              {scopeSyncResult.result.outcomes.map((item) => (
                <li
                  key={`${item.courseId}:${item.key}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3"
                >
                  <span className="break-all font-mono">{item.key}</span>
                  <span
                    className={
                      item.status === 'failed' || item.status === 'review'
                        ? 'text-blush-text'
                        : 'text-teal-text'
                    }
                  >
                    {syncOutcomeLabel(item.status)}
                  </span>
                  {item.message && (
                    <span className="col-span-2 break-all text-blush-text">{item.message}</span>
                  )}
                </li>
              ))}
              {scopeSyncResult.result.outcomes.length === 0 && (
                <li className="text-ink2">No course-mapped source files were in this scope.</li>
              )}
            </ul>
          </details>
        </div>
      )}
      {!scan && (
        <div className="rounded-xl border border-line bg-surface p-4 text-sm leading-relaxed text-ink2">
          No scan has run in this session. Choose a scope above and start a scan. Incomplete scans stay marked
          incomplete until the final storage cursor has been read.
        </div>
      )}
      {scan && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-line bg-surface p-4" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <strong>
                {scan.error
                  ? 'Scan incomplete'
                  : scan.complete
                    ? scan.scopePrefix
                      ? 'Scoped storage scan complete'
                      : 'Full bucket scan complete'
                    : isScanning
                      ? 'Scanning this storage scope'
                      : 'Scan incomplete'}
              </strong>
              <span className="font-mono text-xs text-ink2">
                {scan.objects.length} storage objects | {scan.requestCount} storage list requests
              </span>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-sunk"
              role="progressbar"
              tabIndex={0}
              aria-label="Storage scan progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={scan.complete ? 100 : undefined}
            >
              <div
                className={`h-full rounded-full bg-teal transition-[width] ${scan.complete ? 'w-full' : 'w-1/3 animate-pulse'}`}
              />
            </div>
            {scan.pageAuditScopeIncluded && scan.pageAuditTotal > 0 && !scan.pageAuditComplete && (
              <div className="mt-3 rounded-lg border border-line bg-card p-3" aria-live="polite">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <strong>Checking generated pages for each file</strong>
                  <span className="font-mono text-ink2">
                    {scan.pageAuditCompleted}/{scan.pageAuditTotal} file folders
                  </span>
                </div>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunk"
                  role="progressbar"
                  tabIndex={0}
                  aria-label="Generated page audit progress"
                  aria-valuemin={0}
                  aria-valuemax={scan.pageAuditTotal}
                  aria-valuenow={scan.pageAuditCompleted}
                >
                  <div
                    className="h-full rounded-full bg-teal transition-[width]"
                    style={{ width: `${(scan.pageAuditCompleted / scan.pageAuditTotal) * 100}%` }}
                  />
                </div>
                {scan.pageAuditCurrentKey && (
                  <p className="mb-0 mt-2 break-all font-mono text-[11px] text-ink2">
                    Checking: {scan.pageAuditCurrentKey}
                  </p>
                )}
              </div>
            )}
            {scan.error && (
              <p className="mb-0 mt-2 text-sm text-blush-text">
                The scan stopped before completion: {friendly(scan.error)}. No partial result is marked
                complete. Retry this scope after resolving the request error.
              </p>
            )}
            <p className="mb-0 mt-2 text-xs text-ink2">
              {scan.complete
                ? `Checked ${new Date(scan.checkedAt).toLocaleString()}.`
                : isScanning
                  ? scan.pageAuditScopeIncluded && !scan.pageAuditComplete
                    ? 'Source keys are read. Checking each mapped file’s generated-page folder now.'
                    : 'The list remains explicitly incomplete until the final cursor is read.'
                  : 'The scan stopped before the final cursor or generated-page check; retry to finish this scope.'}
            </p>
            <p className="mb-0 mt-1 break-all font-mono text-[11px] text-ink2">
              Scope: {scan.scopePrefix || 'Entire bucket'}
            </p>
          </div>

          {scanStale && scan.complete && (
            <div
              className="rounded-xl border border-marigold/40 bg-marigold-soft/30 p-3 text-sm text-ink2"
              role="status"
            >
              A file action changed the catalogue or generated pages after this scan. Open that course’s
              storage audit for live progress, or recheck this scope to refresh the snapshot.
            </div>
          )}

          {sync.isError && (
            <p
              className="m-0 rounded-xl border border-blush bg-blush/30 p-3 text-sm text-blush-text"
              role="alert"
            >
              {syncScope?.kind === 'folder' ? 'Folder sync failed' : 'File sync failed'}
              {syncScope ? ` for ${syncScope.key}` : ''}: {friendly(sync.error)}
            </p>
          )}
          {sync.isSuccess && sync.data && (
            <div
              className="rounded-xl border border-line bg-surface p-3 text-sm"
              role="status"
              aria-live="polite"
            >
              <strong>
                {syncScope?.kind === 'folder' ? 'Folder sync finished' : 'File sync finished'}
                {syncScope ? ` · ${syncScope.key}` : ''}
              </strong>
              <p className="mb-0 mt-1 text-ink2">
                {sync.data.filesAdded} added · {sync.data.filesChanged} changed · {sync.data.filesRetired}{' '}
                missing sources taken offline · {sync.data.pageObjectsRemoved} old page objects removed ·{' '}
                {sync.data.conversionQueued} queued for conversion
                {sync.data.skipped.length > 0 ? ` · ${sync.data.skipped.length} skipped` : ''}
              </p>
              {sync.data.skipped.length > 0 && (
                <details open className="mt-2 text-xs">
                  <summary className="cursor-pointer">Show skipped objects</summary>
                  <ul className="mb-0 mt-1 list-disc break-all pl-5">
                    {sync.data.skipped.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {(setVisibility.isError || setUnitVisibility.isError) && (
            <p
              className="m-0 rounded-xl border border-blush bg-blush/30 p-3 text-sm text-blush-text"
              role="alert"
            >
              Visibility could not be changed: {friendly(setVisibility.error ?? setUnitVisibility.error)}
            </p>
          )}

          {scan.complete ? (
            <section aria-label={scan.scopePrefix ? 'Selected scope totals' : 'Whole bucket totals'}>
              <h3 className="mb-2 text-sm font-semibold text-ink2">
                {scan.scopePrefix ? 'Selected scope totals' : 'Whole bucket totals'}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                {[
                  {
                    label: 'Storage source files',
                    value: sourceCount,
                    detail:
                      scan.scopePrefix === ''
                        ? `${outsideImportRootObjectCount} outside ${scan.importRoot}`
                        : undefined,
                  },
                  {
                    label: 'Folder prefixes',
                    value: folderSummary.length,
                    detail: 'Inferred from object paths',
                  },
                  {
                    label: 'Folder marker keys',
                    value: explicitFolders,
                    detail: 'Optional; folders can exist without marker objects',
                  },
                  {
                    label: 'Generated page assets',
                    value: generatedPagesChecked ? pageCount : 'Not checked',
                    detail: generatedPagesChecked
                      ? `${numberedPageCount} pages | ${previewCount} previews${otherPageAssetCount ? ` | ${otherPageAssetCount} other assets` : ''}`
                      : 'Run the page audit to count them',
                  },
                  { label: 'Internal objects', value: systemCount },
                  { label: 'Website files with no original', value: missingSourceCount },
                  {
                    label: 'Invalid storage sources',
                    value: scan.objects.filter((object) => !!object.sourceIssue).length,
                  },
                  {
                    label: 'Page lists that don’t match',
                    value: scan.records.filter((record) => record.pageMappingIssues.length > 0).length,
                  },
                  { label: 'Files needing action', value: fileIssues },
                ].map(({ label, value, detail }) => (
                  <div key={label} className="rounded-xl border border-line bg-surface px-3 py-3">
                    <div className="text-xs text-ink2">{label}</div>
                    <strong className="mt-1 block text-xl">{value}</strong>
                    {detail && <div className="mt-1 text-[11px] leading-snug text-ink2">{detail}</div>}
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <p className="m-0 text-xs text-ink2">
              Scope totals appear after the final storage page is read; partial counts are not presented as
              complete.
            </p>
          )}
          {scan.complete && scan.scopePrefix === '' && unassignedSupportedCount > 0 && (
            <div className="rounded-xl border border-marigold/40 bg-marigold/10 p-3 text-sm" role="status">
              <strong>{unassignedSupportedCount} supported storage files have no course mapping.</strong>{' '}
              {unassignedOutsideImportRootCount > 0 &&
                `${unassignedOutsideImportRootCount} are outside ${scan.importRoot} and cannot be converted by a course-scoped sync. `}
              Use the “Not mapped to a course” filter to review them. The object audit marks files with the
              same storage size and ETag as a registered source, so existing copies can be distinguished from
              files that still need review.
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  to="/admin?tab=import"
                  className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-xs font-semibold text-ink no-underline hover:bg-sunk"
                >
                  Open Import to map these folders
                </Link>
                <span className="text-xs text-ink2">
                  Import creates a draft; publishing remains an explicit admin action.
                </span>
              </div>
            </div>
          )}
          {scan.complete && scan.scopePrefix !== '' && (
            <p className="m-0 rounded-xl border border-line bg-surface p-3 text-sm text-ink2">
              {scan.pageAuditScopeIncluded
                ? `Checked every source key in ${scan.scopePrefix} and each registered file's generated-page prefix. ${scan.pageAuditedFileIds.length} file page folders were checked. Unlinked page objects are only discoverable in a whole-bucket scan.`
                : `This scan checked only keys beginning with ${scan.scopePrefix}. Select a course or folder to check its generated pages, or scan the whole bucket to include unlinked page objects.`}
            </p>
          )}
          {scan.complete && (unresolvedPageCount > 0 || missingSourceCount > 0) && (
            <p className="m-0 rounded-xl border border-blush bg-blush/30 p-3 text-sm text-blush-text">
              {unresolvedPageCount} page objects do not map to a registered file; {missingSourceCount} Some
              files on the website have no original in storage. Review the rows below.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="flex flex-col gap-1.5 text-xs font-medium text-ink2">
              Display filter (no rescan)
              <select
                className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
                value={courseScope}
                onChange={(event) => {
                  setCourseScope(event.target.value);
                  setVisibleFiles(50);
                  setVisibleObjects(100);
                  setVisibleFolders(100);
                }}
              >
                <option value="all">All courses in this scan</option>
                <option value="unmapped">Not mapped to a course</option>
                {(scan.courses ?? [])
                  .slice()
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title} · {course.prefix}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-ink2">
              File status
              <select
                className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
                value={fileFilter}
                onChange={(event) => {
                  setFileFilter(event.target.value as FileAuditFilter);
                  setVisibleFiles(50);
                }}
              >
                <option value="all">All source files</option>
                <option value="needs-review">Needs attention</option>
                <option value="pending">Pending conversion (including paused)</option>
                <option value="ready">Ready conversion records</option>
                <option value="offline">Offline or hidden</option>
                <option value="failed">Conversion failed</option>
                <option value="changed">Changed in storage</option>
                <option value="unimported">Not mapped yet</option>
                <option value="unsupported">Unsupported format</option>
                <option value="missing-source">Missing from storage</option>
                <option value="invalid-source">Bad source contents</option>
                <option value="invalid-mapping">Page list mismatch</option>
                <option value="ignored">Ignored by import rules</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-ink2">
              Storage object type
              <select
                className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
                value={objectKind}
                onChange={(event) => {
                  setObjectKind(event.target.value as 'all' | BucketObject['kind']);
                  setVisibleObjects(100);
                }}
              >
                <option value="all">All storage objects</option>
                <option value="source">Source files</option>
                <option value="folder">Folder markers</option>
                <option value="page">Converted pages and previews</option>
                <option value="system">Internal conversion objects</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-ink2">
              Search this scope
              <input
                className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setVisibleFiles(50);
                  setVisibleObjects(100);
                  setVisibleFolders(100);
                }}
                placeholder="Folder, file, page, or conversion object"
              />
            </label>
          </div>

          {scan.complete && (
            <section className="rounded-xl border border-line bg-surface p-3 sm:p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 text-base font-semibold">Source files and conversion controls</h3>
                <span className="text-xs text-ink2">{matchingFiles.length} matching source records</span>
              </div>
              <ul className="m-0 list-none rounded-xl border border-line bg-card p-0">
                {matchingFiles.slice(0, visibleFiles).map((file) => (
                  <AuditFileRow key={file.key} file={file} {...rowActions} />
                ))}
              </ul>
              {matchingFiles.length === 0 && (
                <p className="m-0 py-4 text-sm text-ink2">No source file matches this search.</p>
              )}
              {matchingFiles.length > visibleFiles && (
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => setVisibleFiles((count) => count + 50)}
                >
                  Show next 50 files ({matchingFiles.length - visibleFiles} remaining)
                </Button>
              )}
            </section>
          )}

          <details className="rounded-xl border border-line bg-surface p-3 sm:p-4" open={!scan.complete}>
            <summary className="cursor-pointer font-semibold">
              Every storage object key ({matchingObjects.length} matching
              {scan.complete ? '' : ', scan in progress'})
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-ink2">
                    <th className="p-2">Type</th>
                    <th className="p-2">Storage key</th>
                    <th className="p-2">Audit result</th>
                    <th className="p-2 text-right">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {matchingObjects.slice(0, visibleObjects).map((object) => {
                    const record = object.kind === 'source' ? recordsByKey.get(object.key) : undefined;
                    const status =
                      object.kind === 'page'
                        ? pageObjectStatus(object, recordsById)
                        : object.kind === 'source'
                          ? record
                            ? record.sourceEtag === object.etag && record.sizeBytes === object.sizeBytes
                              ? 'registered in the database'
                              : 'Storage source changed'
                            : object.etag &&
                                registeredSourceByFingerprint.has(`${object.sizeBytes}:${object.etag}`)
                              ? `same storage size + ETag as ${registeredSourceByFingerprint.get(`${object.sizeBytes}:${object.etag}`)}`
                              : (object.unregisteredStatus ?? 'needs review')
                          : object.kind === 'folder'
                            ? 'explicit folder marker'
                            : 'internal conversion object';
                    return (
                      <tr key={object.key} className="border-b border-line/70 last:border-0">
                        <td className="p-2 capitalize">{object.kind}</td>
                        <td className="break-all p-2 font-mono">{object.key}</td>
                        <td className="p-2">{status}</td>
                        <td className="p-2 text-right font-mono">{object.sizeBytes.toLocaleString()} B</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {matchingObjects.length > visibleObjects && (
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => setVisibleObjects((count) => count + 100)}
                >
                  Show next 100 objects ({matchingObjects.length - visibleObjects} remaining)
                </Button>
              )}
            </div>
          </details>

          {scan.complete && matchingFolders.length > 0 && (
            <details open className="rounded-xl border border-line bg-surface p-3 sm:p-4">
              <summary className="cursor-pointer font-semibold">
                Source folders ({matchingFolders.length} of {folderSummary.length})
              </summary>
              <ul className="mb-0 mt-3 grid list-none gap-1 p-0">
                {matchingFolders.slice(0, visibleFolders).map((folder) => {
                  const course = scan.courses
                    .filter((entry) => folder.path.startsWith(entry.prefix))
                    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
                  const syncing =
                    sync.isPending && sync.variables?.kind === 'folder' && sync.variables.key === folder.path;
                  return (
                    <li
                      key={folder.path}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card px-3 py-2 text-xs"
                    >
                      <code className="min-w-0 break-all">{folder.path}</code>
                      <span className="shrink-0 font-mono text-ink2">
                        {folder.objectCount} objects · {folder.explicit ? 'explicit' : 'inferred'}
                      </span>
                      {course && folder.objectCount > 0 && (
                        <Button
                          variant="outline"
                          className="!h-8 !px-3 !text-xs"
                          disabled={actionsBusy}
                          onClick={() =>
                            sync.mutate({ kind: 'folder', courseId: course.id, key: folder.path })
                          }
                        >
                          {syncing ? 'Syncing…' : 'Sync this folder'}
                        </Button>
                      )}
                      {sync.isSuccess &&
                        sync.variables?.kind === 'folder' &&
                        sync.variables.key === folder.path && (
                          <span className="basis-full text-xs text-teal-text" role="status">
                            {sync.data?.filesAdded ?? 0} added · {sync.data?.filesChanged ?? 0} changed ·{' '}
                            {sync.data?.filesRetired ?? 0} missing sources taken offline ·{' '}
                            {sync.data?.pageObjectsRemoved ?? 0} old page objects removed ·{' '}
                            {sync.data?.conversionQueued ?? 0} conversions queued
                          </span>
                        )}
                      {sync.isError &&
                        sync.variables?.kind === 'folder' &&
                        sync.variables.key === folder.path && (
                          <span className="basis-full text-xs text-blush-text" role="alert">
                            Sync failed: {friendly(sync.error)}
                          </span>
                        )}
                    </li>
                  );
                })}
              </ul>
              {matchingFolders.length > visibleFolders && (
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => setVisibleFolders((count) => count + 100)}
                >
                  Show next 100 folders ({matchingFolders.length - visibleFolders} remaining)
                </Button>
              )}
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}

export function StorageAuditPanel() {
  return <BucketInventoryPanel />;
}
