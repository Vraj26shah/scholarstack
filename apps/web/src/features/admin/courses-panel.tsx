import type { AdminCourseDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { BranchPicker } from './branch-picker';
import { DeleteCourse } from './delete-course';
import { type R2FileSyncProgress, courseSourceKeys, syncR2Files } from './r2-file-sync';
import { Field, Panel, SEMESTERS, StatusPill, input, plural, rupeesToPaise } from './ui';
import { UnitsManager } from './units-manager';

const CONVERSION_PHASES: Record<string, string> = {
  queued: 'Waiting in the sequential queue',
  downloading_source: 'Reading original from R2',
  validating_source: 'Checking file type and integrity',
  rendering_pages: 'Counting and rendering pages',
  clearing_previous_pages: 'Removing stale generated pages from R2',
  writing_preview: 'Writing page-one preview to R2',
  writing_pages: 'Writing protected page objects to R2',
  verifying_r2: 'Verifying all page objects in R2',
  saving_manifest: 'Registering the page map in Supabase',
  complete: 'Conversion complete · R2 and Supabase checked',
  failed: 'Conversion failed',
};

function CourseRow({ c }: { c: AdminCourseDto }) {
  const qc = useQueryClient();
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue });
  const [editing, setEditing] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [syncProgress, setSyncProgress] = useState<R2FileSyncProgress | null>(null);
  const inventoryKey = ['admin-inventory', c.id];
  const inventory = useQuery({
    queryKey: inventoryKey,
    queryFn: () => api.adminInventory(c.id),
    enabled: showInventory,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.totals.pending ? 8_000 : false),
  });
  const [rupees, setRupees] = useState(String(c.pricePaise / 100));
  const [form, setForm] = useState({
    title: c.title,
    courseCode: c.courseCode ?? '',
    description: c.description,
    batchYear: String(c.batchYear),
    branchSlugs: c.branchSlugs,
    semester: String(c.semester),
  });
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof api.adminUpdateCourse>[1]) => api.adminUpdateCourse(c.id, patch),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['admin-courses'] });
      void qc.invalidateQueries({ queryKey: ['catalogue'] });
      void qc.invalidateQueries({ queryKey: ['drawer'] });
      void qc.invalidateQueries({ queryKey: ['bundles'] });
      void qc.invalidateQueries({ queryKey: ['course'] });
      void qc.invalidateQueries({ queryKey: ['bundle'] });
      void qc.invalidateQueries({ queryKey: ['admin-import'] });
    },
  });
  const syncCourse = useMutation({
    mutationFn: async () => {
      const keys = await courseSourceKeys(c.id, c.r2Prefix);
      return syncR2Files(
        keys.map((key) => ({ courseId: c.id, courseTitle: c.title, key })),
        setSyncProgress,
      );
    },
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: inventoryKey }),
        qc.invalidateQueries({ queryKey: ['admin-courses'] }),
        qc.invalidateQueries({ queryKey: ['admin-units', c.id] }),
        qc.invalidateQueries({ queryKey: ['catalogue'] }),
      ]);
    },
  });
  const setFileVisibility = useMutation({
    mutationFn: ({ fileId, hidden }: { fileId: string; hidden: boolean }) =>
      api.adminSetFileHidden(fileId, hidden),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: inventoryKey }),
        qc.invalidateQueries({ queryKey: ['admin-courses'] }),
        qc.invalidateQueries({ queryKey: ['admin-units', c.id] }),
        qc.invalidateQueries({ queryKey: ['catalogue'] }),
        qc.invalidateQueries({ queryKey: ['course', c.slug] }),
      ]);
    },
  });
  const setUnitVisibility = useMutation({
    mutationFn: ({ unitKey, hidden }: { unitKey: string; hidden: boolean }) =>
      api.adminSetUnitHidden(c.id, unitKey, hidden),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: inventoryKey }),
        qc.invalidateQueries({ queryKey: ['admin-courses'] }),
        qc.invalidateQueries({ queryKey: ['admin-units', c.id] }),
        qc.invalidateQueries({ queryKey: ['catalogue'] }),
        qc.invalidateQueries({ queryKey: ['course', c.slug] }),
      ]);
    },
  });
  const ready = c.fileCount > 0 && c.pendingFiles === 0 && c.failedFiles === 0;
  const priceOk = Number(rupees) >= 1 && Number(rupees) <= 10_000;
  const formOk =
    /^\d{4}$/.test(form.batchYear) &&
    Number(form.batchYear) >= 2000 &&
    Number(form.batchYear) <= 2100 &&
    form.branchSlugs.length > 0;

  return (
    <li className="rounded-[18px] border border-line bg-surface p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex-[1_1_260px] min-w-0">
          <div className="flex items-center gap-2.5">
            <StatusPill status={c.status} />
            <Link
              to={`/c/${c.slug}`}
              className="font-semibold text-ink no-underline hover:underline truncate"
            >
              {c.title}
            </Link>
          </div>
          {c.courseCode && <div className="font-mono text-xs text-ink2 mt-1">{c.courseCode}</div>}
          <div className="font-mono text-xs text-ink2 mt-1 truncate" title={c.r2Prefix}>
            {c.callNo} · {c.batchYear} · {c.r2Prefix}
          </div>
          <div className="font-mono text-[11px] text-teal-text mt-1">
            {c.branchSlugs
              .map(
                (slug) =>
                  index.data?.branches.find((branch) => branch.slug === slug)?.code ?? slug.toUpperCase(),
              )
              .join(' · ')}
          </div>
        </div>
        <div className="font-mono text-xs text-ink2 min-w-0">
          {plural(c.unitCount, 'unit')} · {plural(c.fileCount, 'file')} · {c.pageCount} pp · {c.previewCount}{' '}
          previews
          {(c.hiddenUnits > 0 || c.hiddenFiles > 0) && (
            <div>
              {plural(c.hiddenFiles, 'file')} kept off the site
              {c.hiddenUnits > 0 && ` (${plural(c.hiddenUnits, 'folder')})`}
            </div>
          )}
          {c.pendingFiles > 0 && (
            <div className="text-marigold-text">{c.pendingFiles} waiting for conversion</div>
          )}
          {c.failedFiles > 0 && (
            <div className="text-blush-text">{c.failedFiles} failed (skipped from reader)</div>
          )}
        </div>
        {/* Phones: a tidy two-column grid (price + main action, then pairs of buttons).
            Wider screens: one row. */}
        <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap [&>button]:w-full sm:[&>button]:w-auto">
          <label className="flex min-w-0 items-center gap-2">
            <span className="text-ink2">₹</span>
            <input
              aria-label={`Price in rupees for ${c.title}`}
              className={`${input} w-full min-w-0 font-mono sm:w-20`}
              value={rupees}
              maxLength={5}
              inputMode="numeric"
              onChange={(e) => setRupees(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          {c.status === 'live' ? (
            <>
              <Button
                variant="outline"
                aria-label="Save price and unpublish"
                disabled={!priceOk || save.isPending || rupeesToPaise(rupees) === c.pricePaise}
                onClick={() => save.mutate({ pricePaise: rupeesToPaise(rupees) })}
              >
                <span className="sm:hidden">Save price</span>
                <span className="hidden sm:inline">Save & unpublish</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => save.mutate({ status: 'draft' })}
                disabled={save.isPending}
              >
                Unpublish
              </Button>
            </>
          ) : (
            <Button
              variant="brand"
              disabled={!priceOk || !ready || save.isPending}
              title={ready ? undefined : 'Wait until pages are converted'}
              onClick={() => save.mutate({ pricePaise: rupeesToPaise(rupees), status: 'live' })}
            >
              Publish
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowFiles(!showFiles)} aria-expanded={showFiles}>
            {showFiles ? 'Close files' : 'Manage files'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowInventory((value) => !value)}
            aria-expanded={showInventory}
          >
            {showInventory ? 'Close audit' : 'R2 audit'}
          </Button>
          <Button variant="outline" onClick={() => setEditing(!editing)} aria-expanded={editing}>
            Edit
          </Button>
        </div>
      </div>
      {editing && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-2xl bg-sunk">
          {c.status === 'live' && (
            <p className="m-0 text-sm text-ink2 sm:col-span-2 md:col-span-4">
              Saving changes to a published course will move it to drafts until you review and publish it
              again.
            </p>
          )}
          <Field label="Title" className="sm:col-span-2 md:col-span-1">
            <input
              className={input}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="Course code">
            <input
              aria-label={`Course code for ${c.title}`}
              className={`${input} font-mono uppercase`}
              value={form.courseCode}
              maxLength={24}
              onChange={(e) =>
                setForm({ ...form, courseCode: e.target.value.toUpperCase().replace(/[^A-Z0-9._/-]/g, '') })
              }
            />
          </Field>
          <Field label="Batch year">
            <input
              aria-label={`Batch year for ${c.title}`}
              className={input}
              value={form.batchYear}
              inputMode="numeric"
              maxLength={4}
              onChange={(e) => setForm({ ...form, batchYear: e.target.value.replace(/\D/g, '') })}
            />
          </Field>
          <Field label="Branches" className="sm:col-span-2 md:col-span-4">
            <BranchPicker
              branches={index.data?.branches ?? []}
              selected={form.branchSlugs}
              onChange={(branchSlugs) => setForm({ ...form, branchSlugs })}
              label={`Branches for ${c.title}`}
            />
          </Field>
          <Field label="Semester">
            <select
              className={input}
              value={form.semester}
              onChange={(e) => setForm({ ...form, semester: e.target.value })}
            >
              {SEMESTERS.map((n) => (
                <option key={n} value={n}>
                  Sem {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description" className="sm:col-span-2 md:col-span-4">
            <input
              className={input}
              value={form.description}
              maxLength={600}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <div className="sm:col-span-2 md:col-span-3 flex flex-wrap gap-2">
            <Button
              onClick={() =>
                save.mutate({
                  title: form.title.trim(),
                  courseCode: form.courseCode.trim() || null,
                  description: form.description.trim(),
                  batchYear: Number(form.batchYear),
                  branchSlugs: form.branchSlugs,
                  semester: Number(form.semester),
                })
              }
              disabled={save.isPending || form.title.trim().length < 2 || !formOk}
            >
              Save changes
            </Button>
            {c.status !== 'archived' && (
              <Button variant="ghost" onClick={() => save.mutate({ status: 'archived' })}>
                Archive (hide for good)
              </Button>
            )}
            {c.status === 'archived' && <DeleteCourse course={c} />}
          </div>
        </div>
      )}
      {showFiles && <UnitsManager courseId={c.id} live={c.status === 'live'} />}
      {showInventory && (
        <section
          className="rounded-2xl border border-line bg-sunk p-4 flex flex-col gap-3"
          aria-label={`R2 inventory for ${c.title}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <strong className="mr-auto">R2 files and page status</strong>
            <span
              className={`text-sm font-semibold ${inventory.data?.complete ? 'text-teal-text' : 'text-blush-text'}`}
            >
              {inventory.isFetching
                ? 'Checking R2…'
                : inventory.data?.complete
                  ? 'All source files matched'
                  : 'Needs attention'}
            </span>
            <Button variant="outline" onClick={() => syncCourse.mutate()} disabled={syncCourse.isPending}>
              {syncCourse.isPending ? 'Scanning R2…' : 'Sync R2 + convert'}
            </Button>
            <Button variant="ghost" onClick={() => void inventory.refetch()} disabled={inventory.isFetching}>
              Refresh audit
            </Button>
          </div>
          <p className="m-0 font-mono text-xs text-ink2 break-all">{inventory.data?.prefix ?? c.r2Prefix}</p>
          <p className="m-0 text-sm text-ink2">
            R2 sync registers new and changed source files. Conversion creates protected page objects; files
            already converted with complete pages are left alone.
            {import.meta.env.DEV &&
              ' In local development, conversion runs on this computer, not GitHub Actions.'}
          </p>
          {syncCourse.data && (
            <p className="m-0 text-sm text-teal-text" role="status">
              Scan complete: {syncCourse.data.summary.filesAdded} new Â·{' '}
              {syncCourse.data.summary.filesChanged} changed Â· {syncCourse.data.summary.filesRetired} missing
              source{syncCourse.data.summary.filesRetired === 1 ? '' : 's'} taken offline Â·{' '}
              {syncCourse.data.summary.pageObjectsRemoved} old page objects removed Â·{' '}
              {syncCourse.data.summary.conversionQueued} queued for conversion.
            </p>
          )}
          {syncProgress && (
            <div
              className="rounded-xl border border-line bg-surface p-3 flex flex-col gap-2"
              aria-label="Course file sync progress"
            >
              <div className="flex justify-between gap-2 text-xs">
                <strong>
                  {syncCourse.isPending ? 'Syncing source files one at a time' : 'File sync results'}
                </strong>
                <span className="font-mono text-ink2">
                  {syncProgress.completed}/{syncProgress.total}
                </span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-sunk"
                role="progressbar"
                tabIndex={0}
                aria-label="Course files synced"
                aria-valuemin={0}
                aria-valuemax={Math.max(syncProgress.total, 1)}
                aria-valuenow={syncProgress.completed}
              >
                <div
                  className="h-full rounded-full bg-teal transition-[width]"
                  style={{
                    width: `${syncProgress.total ? (syncProgress.completed / syncProgress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              {syncProgress.currentKey && (
                <p className="m-0 break-all font-mono text-[11px] text-ink2">
                  Current: {syncProgress.currentKey}
                </p>
              )}
              <details open>
                <summary className="cursor-pointer text-xs text-ink2">Show all file results</summary>
                <ul className="m-0 mt-2 max-h-40 overflow-y-auto list-none rounded-lg bg-sunk p-2 flex flex-col gap-1">
                  {syncProgress.outcomes.map((item) => (
                    <li key={item.key} className="break-all font-mono text-[11px]">
                      <span className={item.status === 'failed' ? 'text-blush-text' : 'text-teal-text'}>
                        {item.status}
                      </span>
                      {' · '}
                      {item.key}
                      {item.message ? `: ${item.message}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          {syncCourse.data?.summary.skipped.length ? (
            <details open className="rounded-xl border border-line bg-surface p-3 text-sm">
              <summary className="cursor-pointer font-semibold">
                Why {syncCourse.data.summary.skipped.length} items were skipped
              </summary>
              <ul className="m-0 mt-2 max-h-40 overflow-auto pl-5 text-ink2">
                {syncCourse.data.summary.skipped.map((item) => (
                  <li key={item} className="break-all">
                    {item}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {inventory.isError && <p className="m-0 text-sm text-blush-text">{friendly(inventory.error)}</p>}
          {inventory.data && (
            <>
              <p className="m-0 text-sm text-ink2">
                {inventory.data.totals.files} R2 files · {inventory.data.totals.registered} registered ·{' '}
                {inventory.data.totals.changed} changed in R2 · {inventory.data.totals.unmapped} unimported ·{' '}
                {inventory.data.totals.unsupported} unsupported · {inventory.data.totals.missingInR2} missing
                from R2 · {inventory.data.totals.invalidSources} invalid source bytes ·{' '}
                {inventory.data.totals.pageMappingsInvalid} broken page maps · {inventory.data.totals.pending}{' '}
                pending · {inventory.data.totals.failed} failed · checked{' '}
                {new Date(inventory.data.checkedAt).toLocaleString()}
              </p>
              {inventory.data.folders.length > 0 && (
                <ul className="m-0 p-0 list-none flex flex-col gap-1 text-xs font-mono">
                  {inventory.data.folders.map((folder) => (
                    <li key={folder.path} className="flex flex-wrap gap-x-3">
                      <span>{folder.path}</span>
                      <span className={folder.empty ? 'text-blush-text' : 'text-ink2'}>
                        {folder.empty ? 'empty folder' : `${folder.fileCount} files`}
                      </span>
                      {folder.missingCount > 0 && (
                        <span className="text-blush-text">{folder.missingCount} missing in R2</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <ul className="m-0 p-0 list-none flex flex-col gap-1 max-h-72 overflow-auto border-t border-line pt-2">
                {inventory.data.objects.map((object) => {
                  const expectedPages = object.pageCount ?? 0;
                  const foundPages = object.pageAssetsFound ?? 0;
                  const auditPages = object.conversionStatus === 'ready';
                  const progressTotal = auditPages ? expectedPages : object.conversionProgressTotal;
                  const progressCurrent = auditPages
                    ? foundPages
                    : Math.min(object.conversionProgressCurrent, object.conversionProgressTotal);
                  const pageProgress = progressTotal
                    ? Math.min(100, Math.round((progressCurrent / progressTotal) * 100))
                    : 0;
                  const conversionStep =
                    object.conversionStatus === 'ready' && object.pageAssetsComplete === false
                      ? 'Conversion finished · audit found missing R2 objects'
                      : object.conversionStage === 'failed'
                        ? `Failed at ${object.conversionErrorStage === 'dispatch' ? 'converter dispatch' : (CONVERSION_PHASES[object.conversionErrorStage ?? ''] ?? 'conversion')}`
                        : (CONVERSION_PHASES[object.conversionStage ?? ''] ?? null);
                  const objectStatus =
                    object.status === 'registered' || object.status === 'changed-in-r2'
                      ? object.conversionStatus === 'pending' && object.hidden
                        ? 'Paused while hidden'
                        : object.conversionStatus === 'pending'
                          ? (conversionStep ?? 'Waiting for conversion')
                          : object.conversionStatus === 'failed'
                            ? 'Conversion failed'
                            : object.conversionStatus === 'ready' && object.pageAssetsComplete === false
                              ? 'Page objects missing'
                              : object.conversionStatus === 'ready'
                                ? `Objectified · ${object.pageCount} pages`
                                : 'Not objectified'
                      : object.status === 'unmapped'
                        ? 'Not mapped to a course'
                        : object.status;
                  return (
                    <li
                      key={`${object.key}:${object.status}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-xs"
                    >
                      <span className="font-mono break-all" title={object.key}>
                        {object.name}
                      </span>
                      <span
                        className={
                          object.conversionStatus === 'ready' && object.pageAssetsComplete !== false
                            ? 'text-teal-text'
                            : object.conversionStatus === 'failed' || object.pageAssetsComplete === false
                              ? 'text-blush-text'
                              : 'text-marigold-text'
                        }
                      >
                        {object.hidden ? 'Hidden · ' : ''}
                        {object.status === 'changed-in-r2' && 'Source changed · '}
                        {objectStatus}
                      </span>
                      {object.fileId && (
                        <Button
                          variant={object.hidden ? 'outline' : 'ghost'}
                          className="col-start-2 row-start-2 h-8 px-3 text-xs"
                          disabled={setFileVisibility.isPending || setUnitVisibility.isPending}
                          aria-label={`${object.unitHidden ? 'Show unit containing' : object.hidden ? 'Show' : 'Take offline'} ${object.name}`}
                          onClick={() =>
                            object.unitHidden && object.unitKey
                              ? setUnitVisibility.mutate({ unitKey: object.unitKey, hidden: false })
                              : setFileVisibility.mutate({
                                  fileId: object.fileId!,
                                  hidden: !object.hidden,
                                })
                          }
                        >
                          {(setFileVisibility.isPending &&
                            setFileVisibility.variables?.fileId === object.fileId) ||
                          setUnitVisibility.isPending
                            ? 'Saving…'
                            : object.unitHidden
                              ? 'Show unit'
                              : object.hidden
                                ? 'Show file'
                                : 'Take offline'}
                        </Button>
                      )}
                      {object.unit && <span className="col-span-2 text-ink2">{object.unit}</span>}
                      {object.status !== 'folder-marker' && (
                        <div className="col-span-2 flex items-center gap-2 text-ink2">
                          {(() => {
                            const indeterminate =
                              object.conversionStatus === 'pending' && progressTotal === 0;
                            const max = progressTotal || 1;
                            const text =
                              object.status === 'unmapped'
                                ? 'Not registered · sync this course to map it'
                                : object.status === 'unsupported'
                                  ? 'Unsupported format · converter will not run'
                                  : object.status === 'ignored'
                                    ? 'Ignored by import rules'
                                    : (conversionStep ??
                                      (expectedPages
                                        ? `${foundPages}/${expectedPages} pages present in R2`
                                        : object.conversionStatus === 'failed'
                                          ? 'Conversion failed'
                                          : 'Not objectified yet'));
                            const now = object.conversionProgressTotal ? progressCurrent : foundPages;
                            return (
                              <>
                                <div
                                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface"
                                  role="progressbar"
                                  tabIndex={0}
                                  aria-label={`Conversion progress for ${object.name}`}
                                  aria-valuemin={0}
                                  aria-valuemax={max}
                                  aria-valuenow={indeterminate ? 0 : now}
                                  aria-valuetext={`${text}${object.conversionProgressTotal ? ` · ${now} of ${max}` : ''}`}
                                >
                                  <div
                                    className={`h-full rounded-full ${indeterminate ? 'w-1/3 animate-pulse bg-marigold' : pageProgress === 100 ? 'bg-teal' : 'bg-marigold'}`}
                                    style={!indeterminate ? { width: `${pageProgress}%` } : undefined}
                                  />
                                </div>
                                <span className="whitespace-nowrap">
                                  {text}
                                  {object.conversionProgressTotal && !auditPages
                                    ? ` · ${now}/${max} (${pageProgress}%)`
                                    : auditPages
                                      ? ` · ${foundPages}/${expectedPages} pages in R2 (${pageProgress}%)`
                                      : ''}
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      )}
                      {object.conversionError && (
                        <span className="col-span-2 text-blush-text break-words">
                          {conversionStep ? `${conversionStep}: ` : ''}
                          {object.conversionError.replace(/^Broken source:\s*/, 'Needs a new source copy: ')}
                        </span>
                      )}
                      {object.pageAssetsComplete === false && (
                        <span className="col-span-2 text-blush-text">
                          Converted page or preview files are missing from R2.
                        </span>
                      )}
                    </li>
                  );
                })}
                {inventory.data.objects.length === 0 && (
                  <li className="text-ink2">No objects found under this R2 prefix.</li>
                )}
                {setFileVisibility.isError && (
                  <li className="text-sm text-blush-text">{friendly(setFileVisibility.error)}</li>
                )}
              </ul>
            </>
          )}
          {syncCourse.isError && (
            <p className="m-0 text-sm text-blush-text">
              Sync/conversion could not finish: {friendly(syncCourse.error)}
            </p>
          )}
        </section>
      )}
      {save.isError && <p className="m-0 text-sm text-blush-text">{friendly(save.error)}</p>}
    </li>
  );
}

export function CoursesPanel() {
  const courses = useQuery({
    queryKey: ['admin-courses'],
    queryFn: api.adminCourses,
    refetchInterval: 15_000,
  });
  const [filter, setFilter] = useState<'all' | 'draft' | 'live'>('all');
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const list = (courses.data ?? [])
    .filter((c) => filter === 'all' || c.status === filter)
    .filter(
      (c) =>
        !query ||
        [c.title, c.courseCode ?? '', c.r2Prefix, String(c.batchYear), ...c.branchSlugs]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query),
    )
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));

  return (
    <Panel
      title="Courses"
      aside={
        <div
          className="flex flex-wrap items-center justify-end gap-1.5"
          role="group"
          aria-label="Filter courses"
        >
          <input
            aria-label="Search courses"
            className={`${input} h-10 w-full sm:w-60 text-sm`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search courses"
          />
          {(['all', 'draft', 'live'] as const).map((f) => (
            <Button key={f} variant={filter === f ? 'brand' : 'outline'} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'draft' ? 'Drafts' : 'Live'}
            </Button>
          ))}
        </div>
      }
    >
      {courses.isLoading ? (
        <Skeleton className="h-80" />
      ) : courses.isError ? (
        <ErrorState
          title="Courses didn't load."
          message={friendly(courses.error)}
          onRetry={() => courses.refetch()}
        />
      ) : list.length === 0 ? (
        <p className="m-0 text-ink2">
          {search || filter !== 'all'
            ? 'No courses match these filters.'
            : 'No courses here yet. Import some folders first.'}
        </p>
      ) : (
        <>
          <p className="m-0 font-mono text-xs text-ink2">{list.length} courses · sorted A–Z</p>
          <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
            {list.map((c) => (
              <CourseRow key={c.id} c={c} />
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
