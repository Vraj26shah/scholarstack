import type { AdminCourseDto, AdminUnitDto, CourseInventoryDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button, LinkButton } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { ChevronLeft } from '../../shared/ui/icons';
import { ScrambledPage } from '../../shared/ui/scrambled-page';
import { BooksManager } from './books-manager';
import { CourseDetails } from './course-details';
import { DeleteSheet } from './delete-sheet';
import { PublishSteps } from './publish-steps';
import { type R2FileSyncProgress, pickUpChanges } from './r2-file-sync';
import { StatusPill, plural } from './ui';

type Obj = CourseInventoryDto['objects'][number];

/** A file waiting this long with no progress is reported as stuck, with a way to try again. */
const STUCK_MS = 30 * 60_000;

export const STAGE: Record<string, string> = {
  queued: 'Waiting in line',
  downloading_source: 'Reading the file',
  validating_source: 'Checking the file',
  rendering_pages: 'Making pages',
  clearing_previous_pages: 'Clearing old pages',
  writing_preview: 'Making the free preview',
  writing_pages: 'Saving pages',
  verifying_r2: 'Checking every page is saved',
  saving_manifest: 'Finishing',
};

/** One plain line, a tone and (while working) a progress fraction, for any file in the folder. */
export function fileState(o: Obj): {
  tone: 'ok' | 'work' | 'bad' | 'muted';
  text: string;
  progress: number | null;
  canMake: boolean;
} {
  if (o.status === 'unmapped')
    return { tone: 'muted', text: 'In storage, not on the site yet', progress: null, canMake: false };
  if (o.status === 'unsupported')
    return { tone: 'muted', text: 'This file type can’t be made into pages', progress: null, canMake: false };
  if (o.status === 'ignored')
    return { tone: 'muted', text: 'Skipped (system file)', progress: null, canMake: false };
  if (o.status === 'missing-in-r2')
    return { tone: 'bad', text: 'Gone from storage: upload it again', progress: null, canMake: false };
  const changed = o.status === 'changed-in-r2' ? 'Changed in storage · ' : '';
  if (o.conversionStatus === 'failed')
    return {
      tone: 'bad',
      text: `${changed}Couldn’t make pages${o.conversionError ? `: ${o.conversionError.replace(/^Broken source:\s*/, '')}` : ''}`,
      progress: null,
      canMake: true,
    };
  if (o.conversionStatus === 'ready') {
    if (o.pageAssetsComplete === false)
      return { tone: 'bad', text: 'Some pages are missing: make them again', progress: null, canMake: true };
    return {
      tone: 'ok',
      text: `${changed}Ready · ${plural(o.pageCount ?? 0, 'page')}`,
      progress: 1,
      canMake: changed !== '',
    };
  }
  if (o.hidden)
    return { tone: 'muted', text: 'Waiting · paused while hidden', progress: null, canMake: false };
  const stuck =
    o.conversionUpdatedAt &&
    Date.now() - new Date(o.conversionUpdatedAt).getTime() > STUCK_MS &&
    o.conversionStage;
  if (stuck) return { tone: 'bad', text: 'Stuck: no progress for 30 minutes', progress: null, canMake: true };
  if (o.conversionStage) {
    const total = o.conversionProgressTotal;
    const line =
      o.conversionStage === 'queued' && o.conversionQueueTotal
        ? `Waiting in line · ${o.conversionQueuePosition} of ${o.conversionQueueTotal}`
        : (STAGE[o.conversionStage] ?? 'Working');
    return {
      tone: 'work',
      text: total ? `${line} · ${Math.min(o.conversionProgressCurrent, total)} of ${total}` : line,
      progress: total ? Math.min(1, o.conversionProgressCurrent / total) : null,
      canMake: false,
    };
  }
  return { tone: 'work', text: 'Needs pages', progress: 0, canMake: true };
}

function Bar({ value, tone }: { value: number | null; tone: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunk" aria-hidden="true">
      <div
        className={`h-full rounded-full ${
          value === null
            ? 'w-1/3 animate-pulse bg-marigold'
            : tone === 'ok'
              ? 'bg-teal'
              : tone === 'bad'
                ? 'bg-blush-text'
                : 'bg-marigold'
        }`}
        style={value === null ? undefined : { width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

/** Every file in the course's folder, unit by unit: its status, its progress, and what to do. */
function FilesTab({ c }: { c: AdminCourseDto }) {
  const qc = useQueryClient();
  const key = ['admin-inventory', c.id];
  const inventory = useQuery({
    queryKey: key,
    queryFn: () => api.adminInventory(c.id),
    refetchInterval: (q) => (q.state.data && q.state.data.totals.pending > 0 ? 5_000 : false),
  });
  const units = useQuery({ queryKey: ['admin-units', c.id], queryFn: () => api.adminUnits(c.id) });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: key }),
      qc.invalidateQueries({ queryKey: ['admin-units', c.id] }),
      qc.invalidateQueries({ queryKey: ['admin-courses'] }),
      qc.invalidateQueries({ queryKey: ['course'] }),
      qc.invalidateQueries({ queryKey: ['admin-publish-check', c.id] }),
    ]);
  };
  const [syncProgress, setSyncProgress] = useState<R2FileSyncProgress | null>(null);
  const [deleteSelection, setDeleteSelection] = useState<{ paths: string[]; label: string } | null>(null);
  const pickUp = useMutation({
    mutationFn: async () => {
      // Only what differs from storage is touched; unchanged files keep their pages.
      return pickUpChanges([c.r2Prefix], setSyncProgress);
    },
    onSettled: refresh,
  });
  const make = useMutation({
    mutationFn: (scope: { unitKey?: string; fileIds?: string[] }) =>
      api.adminConvert({ courseId: c.id, include: 'both', ...scope }),
    onSettled: refresh,
  });
  const register = useMutation({
    mutationFn: (key: string) => api.adminSyncFile(c.id, key),
    onSettled: refresh,
  });
  const hideFile = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => api.adminSetFileHidden(id, hidden),
    onSettled: refresh,
  });
  const hideUnit = useMutation({
    mutationFn: ({ unitKey, hidden }: { unitKey: string; hidden: boolean }) =>
      api.adminSetUnitHidden(c.id, unitKey, hidden),
    onSettled: refresh,
  });
  const error = pickUp.error ?? make.error ?? register.error ?? hideFile.error ?? hideUnit.error;

  if (inventory.isPending) return <Skeleton className="h-72" />;
  if (inventory.isError && !inventory.data)
    return (
      <ErrorState
        title="The folder didn't load."
        message={friendly(inventory.error)}
        onRetry={() => inventory.refetch()}
      />
    );
  const inv = inventory.data;
  const objects = inv.objects.filter((o) => o.status !== 'folder-marker');
  const groups = new Map<string, Obj[]>();
  for (const o of objects) {
    const k = o.unitKey ?? '';
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const unitInfo = new Map((units.data ?? []).map((u) => [u.key, u]));
  const states = objects.map(fileState);
  const ready = states.filter((s) => s.tone === 'ok').length;
  const working = states.filter((s) => s.tone === 'work' && !s.canMake).length;
  const failed = states.filter((s) => s.tone === 'bad').length;
  const needs = states.filter((s) => s.canMake).length;
  // These R2 objects have no course_files record, so the site does not reference them.
  // Missing sources are listed separately: they are stale database records, not unused R2 objects.
  const unusedObjects = objects.filter(
    (o) => o.fileId === null && ['unmapped', 'unsupported', 'ignored'].includes(o.status),
  );
  const missingRecords = objects.filter((o) => o.status === 'missing-in-r2' && o.fileId !== null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-sunk px-4 py-3">
        <span className="text-[14px]">
          <strong className="tabular-nums">{ready}</strong> ready ·{' '}
          <strong className="tabular-nums">{working}</strong> being made ·{' '}
          <strong className={`tabular-nums ${needs ? 'text-marigold-text' : ''}`}>{needs}</strong> need pages
          · <strong className={`tabular-nums ${failed ? 'text-blush-text' : ''}`}>{failed}</strong> with a
          problem
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => pickUp.mutate()} disabled={pickUp.isPending}>
            {pickUp.isPending ? 'Checking storage…' : 'Pick up changes from storage'}
          </Button>
          <Button size="sm" onClick={() => make.mutate({})} disabled={make.isPending || needs === 0}>
            Make pages for {needs || 'nothing'} {needs === 1 ? 'file' : needs ? 'files' : ''}
          </Button>
        </span>
      </div>
      <p className="m-0 text-[12px] text-ink2 break-all">
        Folder: {inv.prefix}{' '}
        <a
          href={`/admin?section=folders&folder=${encodeURIComponent(inv.prefix)}`}
          className="font-semibold text-teal-text"
        >
          Open in Folders
        </a>
      </p>
      {syncProgress && pickUp.isPending && (
        <div className="flex flex-col gap-1" role="status">
          <Bar value={syncProgress.total ? syncProgress.completed / syncProgress.total : null} tone="work" />
          <span className="text-[12px] text-ink2">
            Checked {syncProgress.completed} of {syncProgress.total} files
          </span>
        </div>
      )}
      {pickUp.data && !pickUp.isPending && (
        <p className="m-0 text-sm text-teal-text" role="status">
          {pickUp.data.differences
            ? `Picked up: ${pickUp.data.summary.filesAdded} new, ${pickUp.data.summary.filesChanged} changed, ${pickUp.data.summary.filesRetired} removed.`
            : 'Already up to date: storage and the site agree.'}
        </p>
      )}
      {make.data && (
        <p className="m-0 text-sm text-teal-text" role="status">
          {make.data.queued
            ? `${plural(make.data.queued, 'file')} sent to be made into pages.`
            : 'Nothing needed pages.'}
          {make.data.skipped.length > 0 && ` ${make.data.skipped.join(' ')}`}
        </p>
      )}
      {error && <p className="m-0 text-sm text-blush-text">{friendly(error)}</p>}

      {[...groups.entries()].map(([unitKey, list]) => {
        const u = unitInfo.get(unitKey);
        const unitNeeds = list.map(fileState).filter((s) => s.canMake).length;
        return (
          <section
            key={unitKey || 'loose'}
            aria-label={u ? `${u.label}: ${u.title}` : 'Not in a unit'}
            className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] overflow-hidden"
          >
            <header className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-line bg-surface">
              {u && (
                <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-brand text-white">
                  {u.label}
                </span>
              )}
              <strong className="text-[15px] mr-auto">{u ? u.title : 'Not in a unit yet'}</strong>
              {u?.hidden && <span className="text-[12px] text-ink2">Hidden from students</span>}
              {u && unitNeeds > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={make.isPending}
                  onClick={() => make.mutate({ unitKey })}
                >
                  Make pages ({unitNeeds})
                </Button>
              )}
              {u && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={hideUnit.isPending}
                  onClick={() => hideUnit.mutate({ unitKey, hidden: !u.hidden })}
                >
                  {u.hidden ? 'Show unit' : 'Hide unit'}
                </Button>
              )}
            </header>
            <ul className="m-0 p-0 list-none divide-y divide-line">
              {list.map((o) => {
                const s = fileState(o);
                return (
                  <li
                    key={o.key}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-2.5"
                  >
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-[14px] ${o.hidden ? 'text-ink2' : 'text-ink'}`}
                        title={o.key}
                      >
                        {o.name.split('/').pop()}
                      </span>
                      <span
                        className={`block text-[12px] ${
                          s.tone === 'ok'
                            ? 'text-teal-text'
                            : s.tone === 'bad'
                              ? 'text-blush-text'
                              : s.tone === 'work'
                                ? 'text-marigold-text'
                                : 'text-ink2'
                        }`}
                      >
                        {o.hidden && !o.unitHidden ? 'Hidden · ' : ''}
                        {s.text}
                      </span>
                    </span>
                    <span className="flex items-start gap-1.5">
                      {o.fileId && s.canMake && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={make.isPending}
                          onClick={() => make.mutate({ fileIds: [o.fileId!] })}
                        >
                          {s.tone === 'bad' ? 'Try again' : 'Make pages'}
                        </Button>
                      )}
                      {o.fileId && !o.unitHidden && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={hideFile.isPending}
                          aria-label={`${o.hidden ? 'Show' : 'Hide'} ${o.name}`}
                          onClick={() => hideFile.mutate({ id: o.fileId!, hidden: !o.hidden })}
                        >
                          {o.hidden ? 'Show' : 'Hide'}
                        </Button>
                      )}
                      {!o.fileId && o.status === 'unmapped' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={register.isPending}
                          onClick={() => register.mutate(o.key)}
                        >
                          {register.isPending ? 'Adding…' : 'Add & make pages'}
                        </Button>
                      )}
                    </span>
                    {s.tone !== 'muted' && s.tone !== 'ok' && (
                      <div className="col-span-2">
                        <Bar value={s.progress} tone={s.tone} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {objects.length === 0 && (
        <p className="m-0 text-ink2">
          This course's folder is empty. Add files in Storage, then press Pick up changes.
        </p>
      )}
      <section
        className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] p-4 flex flex-col gap-3"
        aria-labelledby="course-cleanup-title"
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto">
            <h3 id="course-cleanup-title" className="m-0 text-[17px]">
              Storage clean-up
            </h3>
            <p className="m-0 mt-1 text-[13px] text-ink2">
              Review files in this course folder that have no course record. Deleting removes the R2 object
              and, when present, its database record and generated pages.
            </p>
          </div>
          {unusedObjects.length > 1 && unusedObjects.length <= 500 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setDeleteSelection({
                  paths: unusedObjects.map((o) => o.key),
                  label: `${plural(unusedObjects.length, 'untracked object')} in ${c.title}`,
                })
              }
            >
              Review all {unusedObjects.length} extras
            </Button>
          )}
        </div>
        {unusedObjects.length ? (
          <ul className="m-0 p-0 list-none divide-y divide-line rounded-xl border border-line">
            {unusedObjects.map((o) => (
              <li key={o.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[14px]" title={o.key}>
                    {o.name.split('/').pop()}
                  </strong>
                  <span className="block text-[12px] text-ink2 break-all">
                    {o.key} ·{' '}
                    {o.status === 'unmapped'
                      ? 'Not registered to this course'
                      : o.status === 'ignored'
                        ? 'System or hidden metadata file'
                        : 'Unsupported file type; not registered'}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleteSelection({ paths: [o.key], label: o.key })}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 rounded-xl bg-sunk px-3 py-2.5 text-[13px] text-ink2">
            No untracked storage objects in this course folder.
          </p>
        )}
        {missingRecords.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <div>
              <strong className="text-[14px]">
                Database records with missing files ({missingRecords.length})
              </strong>
              <p className="m-0 mt-1 text-[12px] text-ink2">
                These are not unused uploads. Removing one also deletes its generated pages and course record,
                so review each item before proceeding.
              </p>
            </div>
            <ul className="m-0 p-0 list-none divide-y divide-line rounded-xl border border-line">
              {missingRecords.map((o) => (
                <li key={o.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[14px]" title={o.key}>
                      {o.name.split('/').pop()}
                    </strong>
                    <span className="block text-[12px] text-blush-text">
                      Missing from R2 · database record remains
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDeleteSelection({ paths: [o.key], label: `Missing source and record: ${o.key}` })
                    }
                  >
                    Remove record
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      {deleteSelection && (
        <DeleteSheet
          paths={deleteSelection.paths}
          label={deleteSelection.label}
          onClose={() => {
            setDeleteSelection(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

const PAGE_STRIP = 8;

/** One unit's free preview: pick a file, look at its pages, tick up to five, save. */
function UnitPreview({ c, unit }: { c: AdminCourseDto; unit: AdminUnitDto }) {
  const qc = useQueryClient();
  const ready = unit.files.filter((f) => f.status === 'ready' && f.pageCount > 0 && !f.hidden);
  const current = unit.preview ?? { fileId: null, pages: [1], chosen: false };
  const [fileId, setFileId] = useState(current.fileId ?? ready[0]?.id ?? '');
  const [pages, setPages] = useState<number[]>(current.pages);
  const [from, setFrom] = useState(1);
  const [editing, setEditing] = useState(false);
  const saved = `${current.fileId}|${current.pages.join(',')}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the saved choice changes
  useEffect(() => {
    setFileId(current.fileId ?? ready[0]?.id ?? '');
    setPages(current.pages);
  }, [saved]);
  const file = ready.find((f) => f.id === fileId);
  const save = useMutation({
    mutationFn: (choice: { fileId: string | null; pages: number[] }) =>
      api.adminSetUnitPreview(c.id, unit.key, choice.fileId, choice.pages),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-units', c.id] });
      void qc.invalidateQueries({ queryKey: ['course'] });
    },
  });
  const toggle = (n: number) =>
    setPages((p) =>
      p.includes(n) ? p.filter((x) => x !== n) : p.length >= 5 ? p : [...p, n].sort((a, b) => a - b),
    );
  const changed = fileId !== current.fileId || pages.join(',') !== current.pages.join(',');

  return (
    <section
      className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] p-4 flex flex-col gap-3"
      aria-label={`Free preview for ${unit.label}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-brand text-white">
          {unit.label}
        </span>
        <strong className="mr-auto">{unit.title}</strong>
        <span className="text-[13px] text-ink2">
          Students see{' '}
          {current.fileId
            ? `page${current.pages.length > 1 ? 's' : ''} ${current.pages.join(', ')} of ${
                ready.find((f) => f.id === current.fileId)?.name ?? 'a file'
              }`
            : 'nothing yet'}
          {current.chosen ? ' (your choice)' : ' (default)'}
        </span>
        {!unit.hidden && ready.length > 0 && (
          <Button size="sm" variant={editing ? 'ghost' : 'outline'} onClick={() => setEditing(!editing)}>
            {editing ? 'Close' : 'Change'}
          </Button>
        )}
      </div>
      {unit.hidden ? (
        <p className="m-0 text-sm text-ink2">This unit is hidden, so it has no free preview.</p>
      ) : ready.length === 0 ? (
        <p className="m-0 text-sm text-ink2">
          No file in this unit has pages yet. Make its pages in the Files tab first.
        </p>
      ) : !editing ? null : (
        <>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            File to preview
            <select
              className="h-10 px-3 rounded-xl bg-surface border-[1.5px] border-line text-[14px] font-normal"
              value={fileId}
              onChange={(e) => {
                setFileId(e.target.value);
                setPages([1]);
                setFrom(1);
              }}
            >
              {ready.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {plural(f.pageCount, 'page')}
                </option>
              ))}
            </select>
          </label>
          {file && (
            <>
              <p className="m-0 text-[13px] text-ink2">
                Tick up to 5 pages students can read free ({pages.length} ticked). Pages {from}–
                {Math.min(file.pageCount, from + PAGE_STRIP - 1)} of {file.pageCount}:
              </p>
              <ul className="m-0 p-0 list-none grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {Array.from(
                  { length: Math.min(PAGE_STRIP, file.pageCount - from + 1) },
                  (_, i) => from + i,
                ).map((n) => {
                  const on = pages.includes(n);
                  return (
                    <li key={n}>
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-label={`${on ? 'Untick' : 'Tick'} page ${n}`}
                        onClick={() => toggle(n)}
                        className={`relative block w-full p-0 rounded-lg overflow-hidden border-2 cursor-pointer bg-white ${
                          on ? 'border-teal shadow-[0_0_0_3px_rgba(25,149,173,0.25)]' : 'border-line'
                        }`}
                      >
                        <ScrambledPage
                          fileId={file.id}
                          page={n}
                          admin
                          stamp=""
                          className="aspect-[1/1.414]"
                        />
                        <span
                          className={`absolute left-1.5 top-1.5 min-w-6 h-6 px-1.5 rounded-full text-[11px] font-bold inline-flex items-center justify-center ${
                            on ? 'bg-teal text-white' : 'bg-white/90 text-ink'
                          }`}
                        >
                          {on ? `✓ ${n}` : n}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={from === 1}
                  onClick={() => setFrom(Math.max(1, from - PAGE_STRIP))}
                >
                  ← Earlier pages
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={from + PAGE_STRIP > file.pageCount}
                  onClick={() => setFrom(from + PAGE_STRIP)}
                >
                  Later pages →
                </Button>
                <span className="ml-auto flex gap-2">
                  {current.chosen && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={save.isPending}
                      onClick={() => save.mutate({ fileId: null, pages: [1] })}
                    >
                      Use the default
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={!changed || pages.length === 0 || save.isPending}
                    onClick={() => save.mutate({ fileId, pages })}
                  >
                    {save.isPending ? 'Saving…' : 'Save preview'}
                  </Button>
                </span>
              </div>
            </>
          )}
        </>
      )}
      {save.isError && <p className="m-0 text-sm text-blush-text">{friendly(save.error)}</p>}
      {save.isSuccess && !changed && (
        <p className="m-0 text-sm text-teal-text" role="status">
          Saved. Students see it now.
        </p>
      )}
    </section>
  );
}

function PreviewTab({ c }: { c: AdminCourseDto }) {
  const units = useQuery({ queryKey: ['admin-units', c.id], queryFn: () => api.adminUnits(c.id) });
  if (units.isPending) return <Skeleton className="h-72" />;
  if (units.isError && !units.data)
    return (
      <ErrorState
        title="Units didn't load."
        message={friendly(units.error)}
        onRetry={() => units.refetch()}
      />
    );
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[14px] text-ink2">
        Free pages students see before buying: page 1 by default, or up to five you pick.
      </p>
      {units.data.map((u) => (
        <UnitPreview key={u.key} c={c} unit={u} />
      ))}
      {units.data.length === 0 && <p className="m-0 text-ink2">This course has no units yet.</p>}
    </div>
  );
}

/** The course's steps, in the order they're done. "Check & publish" is always last. */
const TABS = [
  ['files', 'Files & pages'],
  ['preview', 'Free preview'],
  ['details', 'Details'],
  ['books', 'Books'],
  ['publish', 'Check & publish'],
] as const;
export type WorkspaceTab = (typeof TABS)[number][0];
type Tab = WorkspaceTab;

/** Everything about one course in one place: its files and pages, free preview, details and books. */
export function CourseWorkspace({
  courseId,
  onBack,
  initialTab = 'files',
}: {
  courseId: string;
  onBack: () => void;
  initialTab?: Tab;
}) {
  const courses = useQuery({
    queryKey: ['admin-courses'],
    queryFn: api.adminCourses,
    refetchInterval: 15_000,
  });
  const [params, setParams] = useSearchParams();
  const [tab, setTabState] = useState<Tab>(initialTab);
  // The open tab lives in the address too, so a refresh or a shared link lands on the same place.
  const setTab = (next: Tab) => {
    setTabState(next);
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };
  const c = courses.data?.find((x) => x.id === courseId);
  if (courses.isPending) return <Skeleton className="h-96" />;
  if (!c)
    return (
      <div className="flex flex-col gap-3 items-start">
        <p className="m-0 text-ink2">That course isn't here any more.</p>
        <Button variant="outline" onClick={onBack}>
          Back to all courses
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft size={16} /> All courses
        </Button>
        <StatusPill status={c.status} />
        <h2 className="m-0 font-display font-extrabold text-[28px] tracking-[-0.03em] leading-tight mr-auto">
          {c.title}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setParams({ section: 'folders', folder: c.r2Prefix })}
          title={c.r2Prefix}
        >
          Open its folder
        </Button>
        <LinkButton to={`/c/${c.slug}`} variant="outline" size="sm">
          {c.status === 'live' ? 'Open on the site' : 'Preview as a student'}
        </LinkButton>
      </div>
      <p className="m-0 font-mono text-[12px] text-ink2">
        {[c.courseCode, c.callNo, `${c.batchYear} batch`, `Sem ${c.semester}`].filter(Boolean).join(' · ')} ·{' '}
        {plural(c.fileCount, 'readable file')} · {c.pageCount} pages · ₹{c.pricePaise / 100}
      </p>
      <div role="tablist" aria-label="Course" className="flex flex-wrap gap-2 border-b border-line pb-3">
        {TABS.map(([k, label], i) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`h-9 rounded-full px-3.5 text-[14px] font-semibold border cursor-pointer ${
              tab === k ? 'bg-ink text-bg border-ink' : 'border-line text-ink2 hover:text-ink'
            }`}
          >
            <span aria-hidden="true" className="mr-1.5 tabular-nums opacity-60">
              {i + 1}
            </span>
            {label}
            {k === 'files' && c.pendingFiles + c.failedFiles > 0 && (
              <span aria-hidden="true" className="ml-1.5 tabular-nums text-marigold-text">
                {c.pendingFiles + c.failedFiles}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'files' && <FilesTab c={c} />}
        {tab === 'preview' && <PreviewTab c={c} />}
        {tab === 'details' && <CourseDetails c={c} />}
        {tab === 'books' && <BooksManager courseId={c.id} slug={c.slug} />}
        {tab === 'publish' && <PublishSteps c={c} openTab={setTab} />}
      </div>
    </div>
  );
}
