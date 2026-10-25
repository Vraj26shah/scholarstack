import type {
  AdminBundleDto,
  BranchDto,
  ImportCourseInput,
  ImportFolderDto,
  SyncResultDto,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { ChevronDown, ChevronRight, Folder } from '../../shared/ui/icons';
import { BranchPicker } from './branch-picker';
import { type R2FileSyncProgress, type R2FileSyncTask, sourceKeysInTree, syncR2Files } from './r2-file-sync';
import { Field, Panel, SEMESTERS, StatusPill, input, plural, rupeesToPaise } from './ui';

interface Draft {
  title: string;
  courseCode: string;
  description: string;
  batchYear: string;
  branchSlugs: string[];
  semester: string;
  rupees: string;
  bundleId: string;
}

const draftFor = (f: ImportFolderDto, fallbackYear: number | null): Draft => ({
  title: f.course?.title ?? f.suggested.title,
  courseCode: f.course?.courseCode ?? f.suggested.courseCode ?? '',
  description: f.course?.description ?? '',
  batchYear: String(f.course?.batchYear ?? f.suggested.batchYear ?? fallbackYear ?? ''),
  branchSlugs: f.course?.branchSlugs ?? f.suggested.branchSlugs,
  semester: String(f.course?.semester ?? f.suggested.semester ?? ''),
  rupees: f.course ? String(f.course.pricePaise / 100) : '99',
  bundleId: f.course?.bundleId ?? '',
});

const valid = (d: Draft) =>
  d.title.trim().length >= 2 &&
  /^\d{4}$/.test(d.batchYear) &&
  Number(d.batchYear) >= 2000 &&
  Number(d.batchYear) <= 2100 &&
  d.branchSlugs.length > 0 &&
  Number(d.semester) >= 1 &&
  Number(d.semester) <= 10 &&
  Number(d.rupees) >= 1 &&
  Number(d.rupees) <= 10_000;

const importInput = (prefix: string, d: Draft): ImportCourseInput => ({
  prefix,
  title: d.title.trim(),
  courseCode: d.courseCode.trim(),
  description: d.description.trim(),
  batchYear: Number(d.batchYear),
  branchSlugs: [...d.branchSlugs],
  semester: Number(d.semester),
  pricePaise: rupeesToPaise(d.rupees),
  bundleId: d.bundleId || null,
});

const unchangedSinceSubmit = (draft: Draft, submitted: ImportCourseInput) => {
  const current = importInput(submitted.prefix, draft);
  return (
    current.title === submitted.title &&
    current.courseCode === submitted.courseCode &&
    current.description === submitted.description &&
    current.batchYear === submitted.batchYear &&
    current.branchSlugs.slice().sort().join(',') === submitted.branchSlugs.slice().sort().join(',') &&
    current.semester === submitted.semester &&
    current.pricePaise === submitted.pricePaise &&
    current.bundleId === submitted.bundleId
  );
};

function DraftForm({
  draft,
  branches,
  bundles,
  onChange,
  pickedCount,
  onApplyToAll,
}: {
  draft: Draft;
  branches: BranchDto[];
  bundles: AdminBundleDto[];
  onChange: (d: Draft) => void;
  pickedCount: number;
  onApplyToAll: () => void;
}) {
  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    onChange({ ...draft, [k]: e.target.value });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-2xl bg-sunk">
      <Field label="Course title" className="sm:col-span-2 md:col-span-1">
        <input
          aria-label="Course title"
          className={input}
          value={draft.title}
          onChange={set('title')}
          maxLength={120}
        />
      </Field>
      <Field label="Course code">
        <input
          aria-label="Course code"
          className={`${input} font-mono uppercase`}
          value={draft.courseCode}
          onChange={(e) => {
            const courseCode = e.target.value.toUpperCase().replace(/[^A-Z0-9._/-]/g, '');
            const mapped = branches
              .filter((branch) => branch.courseCodes.includes(draft.courseCode))
              .map((branch) => branch.slug)
              .sort();
            const nextMapped = branches
              .filter((branch) => branch.courseCodes.includes(courseCode))
              .map((branch) => branch.slug)
              .sort();
            const selected = [...draft.branchSlugs].sort();
            const wasAutoMapped = selected.length === 0 || selected.join(',') === mapped.join(',');
            onChange({
              ...draft,
              courseCode,
              branchSlugs: wasAutoMapped && nextMapped.length ? nextMapped : draft.branchSlugs,
            });
          }}
          maxLength={24}
          placeholder="e.g. CSE3001"
        />
      </Field>
      <Field label="Batch year">
        <input
          aria-label="Batch year"
          className={input}
          value={draft.batchYear}
          onChange={(e) => onChange({ ...draft, batchYear: e.target.value.replace(/\D/g, '') })}
          inputMode="numeric"
          maxLength={4}
        />
      </Field>
      <Field
        label={
          draft.branchSlugs.length ? 'Programmes matched from course code' : 'Choose at least one programme'
        }
        className="sm:col-span-2 md:col-span-4"
      >
        <BranchPicker
          branches={branches}
          selected={draft.branchSlugs}
          onChange={(branchSlugs) => onChange({ ...draft, branchSlugs })}
          label={`Branches for ${draft.title}`}
        />
      </Field>
      <Field label="Semester">
        <select aria-label="Semester" className={input} value={draft.semester} onChange={set('semester')}>
          <option value="">Choose…</option>
          {SEMESTERS.map((n) => (
            <option key={n} value={n}>
              Sem {n}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Price ₹">
        <input
          className={input}
          value={draft.rupees}
          onChange={(e) => onChange({ ...draft, rupees: e.target.value.replace(/\D/g, '') })}
          inputMode="numeric"
          maxLength={5}
        />
      </Field>
      <Field label="Description (optional)" className="sm:col-span-2 md:col-span-4">
        <input
          className={input}
          value={draft.description}
          onChange={set('description')}
          maxLength={600}
          placeholder="What makes these notes good: solved PYQs, diagrams, revision sheet…"
        />
      </Field>
      <Field label="Draft bundle" className="sm:col-span-2 md:col-span-4">
        <select
          aria-label="Bundle for course"
          className={input}
          value={draft.bundleId}
          onChange={(e) => onChange({ ...draft, bundleId: e.target.value })}
        >
          <option value="">Choose later in Bundles</option>
          {bundles
            .filter(
              (bundle) =>
                bundle.status === 'draft' &&
                (bundle.batchYear === null || bundle.batchYear === Number(draft.batchYear)),
            )
            .map((bundle) => (
              <option key={bundle.id} value={bundle.id}>
                {bundle.title} ({bundle.courseIds.length} courses)
              </option>
            ))}
        </select>
      </Field>
      {pickedCount > 1 && (
        <div className="sm:col-span-2 md:col-span-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <span className="text-[13px] text-ink2">
            Same batch, programmes, semester and price for the other picked folders?
          </span>
          <Button variant="outline" onClick={onApplyToAll}>
            Use these for all {pickedCount} folders
          </Button>
        </div>
      )}
    </div>
  );
}

function FolderRow({
  folder,
  depth,
  fallbackYear,
  picked,
  drafts,
  branches,
  bundles,
  toggle,
  setDraft,
  applyFrom,
}: {
  folder: ImportFolderDto;
  depth: number;
  fallbackYear: number | null;
  picked: Set<string>;
  drafts: Map<string, Draft>;
  branches: BranchDto[];
  bundles: AdminBundleDto[];
  toggle: (f: ImportFolderDto, year: number | null) => void;
  setDraft: (prefix: string, d: Draft) => void;
  applyFrom: (prefix: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const year = folder.suggested.batchYear ?? fallbackYear;
  const isPicked = picked.has(folder.prefix);
  const unsupported = folder.fileCount - folder.supportedCount - folder.ignoredCount;
  // Batch children are course folders; deeper folders become course units.
  const canBeCourse = folder.supportedCount > 0 && depth === 1;
  const hasSubfolders = folder.children.length > 0;

  return (
    <li className={depth === 0 ? 'rounded-[22px] border border-line bg-surface overflow-hidden' : ''}>
      <div
        className={`flex flex-wrap items-center gap-3 px-4 py-3 ${depth === 0 ? 'bg-brand text-white' : 'border-t border-line'} ${
          isPicked ? 'bg-mist/30' : ''
        }`}
        style={{ paddingLeft: depth > 1 ? 16 + (depth - 1) * 22 : undefined }}
      >
        {canBeCourse ? (
          <input
            type="checkbox"
            aria-label={`Import ${folder.name} as a course`}
            checked={isPicked}
            onChange={() => toggle(folder, year)}
            className="w-5 h-5 accent-[var(--teal)] cursor-pointer"
          />
        ) : (
          <span className="w-5" />
        )}
        {hasSubfolders && depth > 0 && !isPicked ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${folder.name}`}
            className="w-7 h-7 rounded-lg border-0 bg-transparent text-ink2 inline-flex items-center justify-center cursor-pointer"
          >
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <Folder size={18} className={depth === 0 ? 'text-mist' : 'text-ink2'} />
        )}
        <span className={`font-semibold ${depth === 0 ? 'font-display text-xl' : 'text-[15px]'}`}>
          {folder.name}
        </span>
        {folder.suggested.courseCode && (
          <span className="font-mono text-[11px] px-2 py-1 rounded-md bg-sunk text-ink2">
            {folder.suggested.courseCode}
          </span>
        )}
        {depth === 0 && year && <span className="font-mono text-xs text-on-brand2">→ {year} batch</span>}
        {folder.course ? (
          <StatusPill status={folder.course.status} />
        ) : canBeCourse ? (
          <StatusPill status="new" />
        ) : null}
        <span className={`ml-auto font-mono text-xs ${depth === 0 ? 'text-on-brand2' : 'text-ink2'}`}>
          {plural(folder.supportedCount, 'file')}
          {unsupported > 0 && (
            <span className={depth === 0 ? 'text-marigold' : 'text-blush-text'}>
              {' '}
              · {unsupported} unsupported
            </span>
          )}{' '}
          {folder.ignoredCount > 0 && <span>· {folder.ignoredCount} ignored · </span>}·{' '}
          {formatBytes(folder.sizeBytes)}
        </span>
      </div>
      {folder.looseObjects.length > 0 && (
        <ul className="m-0 px-4 py-2 list-none border-t border-line bg-sunk/50 flex flex-col gap-1">
          {folder.looseObjects.map((file) => (
            <li key={file.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 text-xs">
              <span className="font-mono min-w-0 break-all" title={file.key}>
                {file.name}
              </span>
              <span className={file.classification === 'supported' ? 'text-teal-text' : 'text-blush-text'}>
                {file.classification}
              </span>
              <span className="font-mono text-ink2">{formatBytes(file.sizeBytes)}</span>
            </li>
          ))}
        </ul>
      )}
      {depth > 0 && folder.childNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3" style={{ paddingLeft: 16 + depth * 22 + 30 }}>
          {folder.childNames.map((n) => (
            <span key={n} className="inline-flex items-center h-6 px-2 rounded-md bg-sunk text-ink2 text-xs">
              {n}
            </span>
          ))}
          {folder.childNames.length > 8 && (
            <span className="text-xs text-ink2">+{folder.childNames.length - 8} more</span>
          )}
          {folder.looseFiles > 0 && (
            <span className="inline-flex items-center h-6 px-2 rounded-md bg-sunk text-ink2 text-xs">
              {plural(folder.looseFiles, 'loose file')} → "Notes"
            </span>
          )}
        </div>
      )}
      {isPicked && (
        <div className="px-4 pb-4" style={{ paddingLeft: 16 + depth * 22 }}>
          <DraftForm
            draft={drafts.get(folder.prefix)!}
            branches={branches}
            bundles={bundles}
            onChange={(d) => setDraft(folder.prefix, d)}
            pickedCount={picked.size}
            onApplyToAll={() => applyFrom(folder.prefix)}
          />
        </div>
      )}
      {(open || depth === 0) && !isPicked && hasSubfolders && (
        <ul className="list-none m-0 p-0">
          {folder.children.map((c) => (
            <FolderRow
              key={c.prefix}
              folder={c}
              depth={depth + 1}
              fallbackYear={year}
              picked={picked}
              drafts={drafts}
              branches={branches}
              bundles={bundles}
              toggle={toggle}
              setDraft={setDraft}
              applyFrom={applyFrom}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ResultCard({ r, title }: { r: SyncResultDto; title: string }) {
  return (
    <div role="status" className="rounded-[18px] bg-card border border-line p-5 flex flex-col gap-2">
      <div className="font-semibold">
        {title}: {plural(r.coursesCreated, 'new course')} · {plural(r.filesAdded, 'new file')} ·{' '}
        {r.filesChanged} changed · {r.conversionQueued} queued for conversion
      </div>
      {r.skipped.length > 0 && (
        <details open>
          <summary className="cursor-pointer text-sm text-blush-text">
            {plural(r.skipped.length, 'file')} skipped
          </summary>
          <ul className="m-0 mt-2 pl-5 font-mono text-xs text-ink2 break-all">
            {r.skipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Pick folders in R2 (drive-imports/…) and file them as courses. */
export function ImportPanel() {
  const qc = useQueryClient();
  const previousChangeToken = useRef<string | null>(null);
  const [r2Changed, setR2Changed] = useState(false);
  const [rescanProgress, setRescanProgress] = useState<R2FileSyncProgress | null>(null);
  const tree = useQuery({
    queryKey: ['admin-import'],
    queryFn: api.adminImportTree,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    const changeToken = tree.data?.changeToken;
    if (!changeToken) return;
    const previous = previousChangeToken.current;
    previousChangeToken.current = changeToken;
    if (previous !== null && changeToken !== previous) setR2Changed(true);
  }, [tree.data?.changeToken]);
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue });
  const courseList = useQuery({ queryKey: ['admin-courses'], queryFn: api.adminCourses });
  const bundleQuery = useQuery({ queryKey: ['admin-bundles'], queryFn: api.adminBundles });
  const branches = index.data?.branches ?? [];
  const bundles = bundleQuery.data ?? [];
  const [drafts, setDrafts] = useState(new Map<string, Draft>());
  const picked = useMemo(() => new Set(drafts.keys()), [drafts]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-import'] });
    void qc.invalidateQueries({ queryKey: ['admin-courses'] });
    void qc.invalidateQueries({ queryKey: ['admin-bundles'] });
  };
  const run = useMutation({
    mutationFn: (courses: ImportCourseInput[]) => api.adminImport(courses),
    onSuccess: (_result, submitted) => {
      const submittedByPrefix = new Map(submitted.map((course) => [course.prefix, course]));
      setDrafts(
        (current) =>
          new Map(
            [...current].filter(([prefix, draft]) => {
              const sent = submittedByPrefix.get(prefix);
              return !sent || !unchangedSinceSubmit(draft, sent);
            }),
          ),
      );
      refresh();
    },
  });
  const rescan = useMutation({
    mutationFn: async () => {
      setRescanProgress({ completed: 0, total: 0, currentKey: null, outcomes: [] });
      const [freshTree, courses] = await Promise.all([api.adminImportTree(), api.adminCourses()]);
      const activeCourses = courses
        .filter((course) => course.status !== 'archived')
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
      const tasks: R2FileSyncTask[] = [];
      const inventoryErrors: R2FileSyncProgress['outcomes'] = [];

      for (const course of activeCourses) {
        try {
          const units = await api.adminUnits(course.id);
          const keys = new Set([
            ...sourceKeysInTree(freshTree.folders, course.r2Prefix),
            ...units.flatMap((unit) => unit.files.map((file) => file.sourceKey)),
          ]);
          for (const key of [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
            tasks.push({ courseId: course.id, courseTitle: course.title, key });
          }
        } catch (error) {
          inventoryErrors.push({
            courseId: course.id,
            courseTitle: course.title,
            key: `${course.r2Prefix} [catalogue inventory]`,
            status: 'failed',
            message: friendly(error),
          });
        }
      }

      const result = await syncR2Files(tasks, setRescanProgress);
      const outcomes = [...result.outcomes, ...inventoryErrors];
      setRescanProgress({
        completed: result.outcomes.length,
        total: tasks.length,
        currentKey: null,
        outcomes,
      });
      return { summary: result.summary, outcomes, total: tasks.length };
    },
    onSuccess: () => {
      setR2Changed(false);
      refresh();
    },
  });

  const toggle = (f: ImportFolderDto, year: number | null) =>
    setDrafts((m) => {
      const next = new Map(m);
      if (next.has(f.prefix)) next.delete(f.prefix);
      else next.set(f.prefix, draftFor(f, year));
      return next;
    });
  const setDraft = (prefix: string, d: Draft) => setDrafts((m) => new Map(m).set(prefix, d));
  /** Copy one folder's batch, programmes, semester and price to every other picked folder. */
  const applyFrom = (source: string) =>
    setDrafts((m) => {
      const from = m.get(source);
      if (!from) return m;
      const next = new Map<string, Draft>();
      for (const [k, d] of m)
        next.set(k, {
          ...d,
          batchYear: from.batchYear,
          branchSlugs: from.branchSlugs,
          semester: from.semester,
          rupees: from.rupees,
        });
      return next;
    });

  const ready = drafts.size > 0 && [...drafts.values()].every(valid);
  const missing = [...drafts.values()].filter((d) => !valid(d)).map((d) => d.title || 'untitled');

  return (
    <Panel
      title="Import from R2"
      aside={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void tree.refetch()} disabled={tree.isFetching}>
            {tree.isFetching ? 'Checking…' : 'Check for new folders'}
          </Button>
          <Button
            variant="outline"
            onClick={() => rescan.mutate()}
            disabled={rescan.isPending || courseList.isLoading}
          >
            {rescan.isPending ? 'Syncing files…' : 'Sync imported files'}
          </Button>
        </div>
      }
    >
      <p className="m-0 text-sm text-ink2 max-w-[760px]">
        Everything under <span className="font-mono">{tree.data?.root ?? 'drive-imports/'}</span> in your
        bucket. Tick a folder to make it a course: its sub-folders become units ("Module 2 - SQL" → Module 2),
        loose files go under "Notes". New folders are checked every 30 seconds. Course-code matches preselect
        the programmes from your branch map. Before importing, review the title, course code, programme, batch
        year, semester, price and optional draft bundle. Imports and changed R2 files stay private until an
        admin reviews and publishes them after conversion. Sync checks each file in its own request; complete
        page maps stay as they are, and failures are listed by file.
      </p>
      {run.data && <ResultCard r={run.data} title="Imported" />}
      {rescan.data && <ResultCard r={rescan.data.summary} title="R2 sync" />}
      {rescanProgress && (
        <section
          className="rounded-[18px] border border-line bg-card p-4 flex flex-col gap-2"
          aria-label="R2 sync progress"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <strong>{rescan.isPending ? 'Checking each R2 file' : 'File sync results'}</strong>
            <span className="font-mono text-xs text-ink2">
              {rescanProgress.completed} / {rescanProgress.total} files
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-sunk"
            role="progressbar"
            tabIndex={0}
            aria-label="Files synced"
            aria-valuemin={0}
            aria-valuemax={Math.max(rescanProgress.total, 1)}
            aria-valuenow={rescanProgress.completed}
          >
            <div
              className="h-full rounded-full bg-teal transition-[width]"
              style={{
                width: `${rescanProgress.total ? (rescanProgress.completed / rescanProgress.total) * 100 : 0}%`,
              }}
            />
          </div>
          {rescanProgress.currentKey && (
            <p className="m-0 break-all font-mono text-xs text-ink2">Current: {rescanProgress.currentKey}</p>
          )}
          <details open>
            <summary className="cursor-pointer text-sm text-ink2">
              View {rescanProgress.outcomes.length} file statuses
            </summary>
            <ul className="m-0 mt-2 max-h-64 overflow-y-auto list-none rounded-xl bg-sunk p-2 flex flex-col gap-1">
              {rescanProgress.outcomes.map((item) => (
                <li
                  key={`${item.courseId}:${item.key}`}
                  className="grid gap-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-3"
                >
                  <span
                    className={
                      item.status === 'failed'
                        ? 'font-semibold text-blush-text'
                        : 'font-semibold text-teal-text'
                    }
                  >
                    {item.status}
                  </span>
                  <span
                    className="min-w-0 break-all font-mono text-ink2"
                    title={`${item.courseTitle} · ${item.key}`}
                  >
                    {item.courseTitle} · {item.key}
                    {item.message ? `: ${item.message}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
      {r2Changed && (
        <p
          role="status"
          aria-live="polite"
          className="m-0 rounded-xl border border-teal/40 bg-teal/10 p-3 text-sm text-teal-text"
        >
          R2 files or folders changed. New folders appear here automatically; rescan imported files to map
          additions or replacements to their original course folders and queue conversion. Your current
          selections stay intact.
        </p>
      )}
      {run.isError && <ErrorState title="Import failed." message={friendly(run.error)} />}
      {rescan.isError && (
        <ErrorState
          title="R2 inventory could not be read."
          message={friendly(rescan.error)}
          onRetry={() => rescan.mutate()}
        />
      )}

      {tree.isLoading ? (
        <Skeleton className="h-80" />
      ) : tree.isError ? (
        <ErrorState
          title="Couldn't read the bucket."
          message={friendly(tree.error)}
          onRetry={() => tree.refetch()}
        />
      ) : tree.data && tree.data.folders.length === 0 && tree.data.rootFiles.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-line p-8 text-center text-ink2">
          Nothing under {tree.data.root} yet. Upload folders like{' '}
          <span className="font-mono">23 Batch/DBMS/Unit 1/…</span> to the bucket, then refresh.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {tree.data?.rootFiles.length ? (
            <section className="rounded-[22px] border border-line bg-surface p-4">
              <h3 className="m-0 mb-2 font-semibold">Files directly under {tree.data.root}</h3>
              <ul className="m-0 p-0 list-none flex flex-col gap-1">
                {tree.data.rootFiles.map((file) => (
                  <li key={file.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 text-xs">
                    <span className="font-mono break-all" title={file.key}>
                      {file.name}
                    </span>
                    <span
                      className={file.classification === 'supported' ? 'text-teal-text' : 'text-blush-text'}
                    >
                      {file.classification}
                    </span>
                    <span className="font-mono text-ink2">{formatBytes(file.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <ul className="list-none m-0 p-0 flex flex-col gap-4">
            {tree.data?.folders.map((f) => (
              <FolderRow
                key={f.prefix}
                folder={f}
                depth={0}
                fallbackYear={null}
                picked={picked}
                drafts={drafts}
                branches={branches}
                bundles={bundles}
                toggle={toggle}
                setDraft={setDraft}
                applyFrom={applyFrom}
              />
            ))}
          </ul>
        </div>
      )}

      {drafts.size > 0 && (
        <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] md:bottom-3 z-20 rounded-[22px] bg-brand text-white px-4 py-3 sm:px-5 flex flex-wrap items-center gap-3 shadow-lg">
          <span className="font-semibold">{plural(drafts.size, 'folder')} picked</span>
          {!ready && (
            <span className="text-[13px] text-on-brand2">
              {plural(missing.length, 'folder')} still {missing.length === 1 ? 'needs' : 'need'} a title,
              batch year, programme, semester or price: {missing.join(', ')}.
            </span>
          )}
          <Button
            variant="buy"
            className="ml-auto"
            onClick={() =>
              run.mutate([...drafts.entries()].map(([prefix, draft]) => importInput(prefix, draft)))
            }
            disabled={!ready || run.isPending}
          >
            {run.isPending ? 'Importing…' : `Import ${plural(drafts.size, 'course')}`}
          </Button>
        </div>
      )}
    </Panel>
  );
}
