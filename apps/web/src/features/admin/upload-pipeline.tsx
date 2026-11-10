import {
  type AdminContributionDto,
  type AdminCourseDto,
  type BranchDto,
  type ContributionCourseInput,
  type ContributionReviewInput,
  DEFAULT_ROYALTY_PERCENT,
  type FilePlanDto,
  type PipelineStep,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { formatBytes } from '../contribute/rules';
import { BranchPicker } from './branch-picker';
import { type R2FileSyncProgress, syncR2Files } from './r2-file-sync';
import { Field, U, input, plural } from './ui';
import { YearSelect } from './year-select';

export const CONTRIBUTIONS_KEY = ['admin', 'contributions'] as const;

const STEPS: { key: Exclude<PipelineStep, 'finish' | 'rejected'>; label: string }[] = [
  { key: 'decide', label: 'Decide' },
  { key: 'file', label: 'File' },
  { key: 'pages', label: 'Pages' },
  { key: 'reward', label: 'Reward' },
  { key: 'done', label: 'Done' },
];
const ORDER: PipelineStep[] = ['decide', 'file', 'pages', 'reward', 'finish', 'done'];

/** Check · Decide · File · Pages · Reward · Done, with the current one marked. */
export function StepStrip({ step }: { step: PipelineStep }) {
  if (step === 'rejected') return null;
  const at = ORDER.indexOf(step);
  const all = [{ key: 'check', label: 'Check' }, ...STEPS];
  return (
    <ol aria-label="Progress" className="m-0 p-0 list-none grid grid-cols-6 gap-1">
      {all.map((s, i) => {
        // "check" is done once the card exists; "done" counts as reached at "finish".
        const index = i - 1;
        const label = s.key === 'done' && step === 'finish' ? 'Publish' : s.label;
        const state =
          i === 0 || index < at || step === 'done'
            ? 'done'
            : index === at || (s.key === 'done' && step === 'finish')
              ? 'now'
              : 'later';
        return (
          <li
            key={s.key}
            aria-current={state === 'now' ? 'step' : undefined}
            className="flex flex-col gap-1.5"
          >
            <span
              className={`h-1.5 rounded-full ${state === 'done' ? 'bg-teal' : state === 'now' ? 'bg-marigold' : 'bg-line'}`}
            />
            <span className={`text-[12px] ${state === 'later' ? 'text-ink2' : 'text-ink font-semibold'}`}>
              {state === 'done' ? '✓ ' : ''}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Step 1: what the automatic check found in each file. */
export function CheckList({ c }: { c: AdminContributionDto }) {
  const qc = useQueryClient();
  const download = useMutation({
    mutationFn: (f: { index: number; name: string }) => api.adminDownloadContribution(c.id, f.index, f.name),
  });
  const check = useMutation({
    mutationFn: () => api.adminCheckContribution(c.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY }),
  });
  const unchecked = c.files.some((f) => !f.check);
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-xl shadow-[0_0_0_1px_var(--line)]">
        {c.files.map((f) => (
          <li key={f.index} className="flex flex-col gap-1 px-3 py-2.5 min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex-1 min-w-[160px] truncate text-[14px] font-semibold" title={f.name}>
                {f.name}
              </span>
              {f.check && (
                <span
                  className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${f.check.ok ? 'bg-mist text-on-mist' : 'bg-blush text-blush-text'}`}
                >
                  {f.check.ok ? '✓ ' : '✕ '}
                  {f.check.label}
                </span>
              )}
              <span className="font-mono text-[12px] text-ink2">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => download.mutate(f)}
                className="text-[13px] font-semibold text-teal-text underline underline-offset-4"
                aria-label={`Download ${f.name}`}
              >
                Download
              </button>
            </div>
            {f.check?.problem && <p className="m-0 text-[13px] text-blush-text">{f.check.problem}</p>}
            {f.check?.entries && (
              <details className="text-[13px] text-ink2">
                <summary className="cursor-pointer">What's inside</summary>
                <ul className="m-0 mt-1 pl-4 flex flex-col gap-0.5 font-mono text-[12px]">
                  {f.check.entries.map((e) => (
                    <li key={e.path} className={e.ok ? 'text-ink' : 'text-ink2 line-through'}>
                      {e.path}
                      {!e.ok && e.reason ? ` · ${e.reason}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
      {unchecked && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => check.mutate()}
          disabled={check.isPending}
        >
          {check.isPending ? 'Checking…' : 'Check these files'}
        </Button>
      )}
      {(download.error ?? check.error) && (
        <p className="m-0 text-sm text-blush-text">{friendly(download.error ?? check.error)}</p>
      )}
    </div>
  );
}

/** Step 2: accept quietly (the reward step emails), or reject with a reason. */
export function DecideStep({ c }: { c: AdminContributionDto }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      api.adminReviewContribution(c.id, {
        decision,
        note: decision === 'rejected' ? note : '',
        reward: { type: 'none' },
        notify: decision === 'rejected' ? notify : false,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY }),
  });
  const unusable = c.files.every((f) => f.check && !f.check.ok);
  if (rejecting)
    return (
      <div className="flex flex-col gap-3">
        <Field label="Reason (the student sees this)">
          <textarea
            className={`${input} h-20 py-2 resize-y`}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            placeholder="These look copied from the textbook."
          />
        </Field>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink2">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="size-4 accent-teal"
          />
          Email {c.contributor.email}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ink"
            onClick={() => decide.mutate('rejected')}
            disabled={decide.isPending || note.trim().length < 3}
          >
            Reject
          </Button>
          <Button variant="ghost" onClick={() => setRejecting(false)}>
            Back
          </Button>
        </div>
        {decide.isError && <p className="m-0 text-sm text-blush-text">{friendly(decide.error)}</p>}
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[14px] text-ink2">
        Download and read it. Accepting doesn't email the student yet; they hear about it with the reward.
        {unusable && (
          <strong className="text-blush-text"> None of these files can become pages as they are.</strong>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => decide.mutate('approved')} disabled={decide.isPending}>
          Accept
        </Button>
        <Button variant="outline" onClick={() => setRejecting(true)}>
          Reject…
        </Button>
      </div>
      {decide.isError && <p className="m-0 text-sm text-blush-text">{friendly(decide.error)}</p>}
    </div>
  );
}

/** Short forms students use for subjects. */
const ALIASES: Record<string, string> = {
  dbms: 'database management',
  os: 'operating systems',
  cn: 'computer networks',
  dsa: 'data structures',
  ds: 'data structures',
  daa: 'design analysis algorithms',
  coa: 'computer organisation architecture',
  toc: 'theory computation',
  se: 'software engineering',
  ml: 'machine learning',
  ai: 'artificial intelligence',
  iot: 'internet things',
  dld: 'digital logic design',
  oops: 'object oriented programming',
  cd: 'compiler design',
  bda: 'big data analytics',
};
const FILLER = new Set(
  'and of the in on for with to a an unit units notes note handwritten sem semester module part pyq pyqs paper papers lab slides chapter my full complete'.split(
    ' ',
  ),
);
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .flatMap((w) => (ALIASES[w] ?? w).split(' '))
    .filter((w) => w.length > 1 && !FILLER.has(w) && !/^\d+$/.test(w));

/**
 * Best guess at the course the student meant: what they typed in "course" counts double, the title
 * once. Returns nothing unless at least one real subject word matches (the admin picks then).
 */
export function guessCourse(hint: string, title: string, courses: AdminCourseDto[]): string {
  const want = [...words(hint).map((w) => [w, 2] as const), ...words(title).map((w) => [w, 1] as const)];
  if (!want.length) return '';
  let best = { id: '', score: 0 };
  for (const x of courses) {
    const have = new Set([...words(x.title), ...(x.courseCode ? [x.courseCode.toLowerCase()] : [])]);
    const score = want.reduce((t, [w, weight]) => t + (have.has(w) ? weight : 0), 0);
    if (score > best.score || (score === best.score && score > 0 && x.status === 'live'))
      best = { id: x.id, score };
  }
  return best.score >= 2 ? best.id : '';
}

/** "unit-3 normalisation" → "Unit 3 · Normalisation", as students will see a new module. */
export function moduleLabel(name: string): string {
  const t = name.trim();
  const m = /^(unit|module|chapter|part)[\s_-]*(\d+)\s*[-–:._]?\s*(.*)$/i.exec(t);
  if (!m) return t || 'Notes';
  const kind = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
  const rest = m[3]!.trim();
  return rest ? `${kind} ${m[2]} · ${rest.charAt(0).toUpperCase()}${rest.slice(1)}` : `${kind} ${m[2]}`;
}

/** Step 3: pick the course and unit, see exactly where every file goes, then file it. */
export function FileStep({ c, again = false }: { c: AdminContributionDto; again?: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: api.adminCourses });
  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue });
  const usable = (courses.data ?? []).filter((x) => x.status !== 'archived');
  const [picked, setCourseId] = useState(c.pipeline.filed?.courseId ?? '');
  const [unit, setUnit] = useState(c.pipeline.filed?.folder.replace(/\/$/, '') || 'Notes');
  const [createOpen, setCreateOpen] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [replaceFolder, setReplaceFolder] = useState(false);
  const [syncProgress, setSyncProgress] = useState<R2FileSyncProgress | null>(null);
  const [preserveArchiveFolders, setPreserveArchiveFolders] = useState(() =>
    c.files.some((file) => file.check?.entries?.some((entry) => entry.path.includes('/'))),
  );
  const [courseDraft, setCourseDraft] = useState({
    title: c.courseHint.trim() || c.title,
    courseCode: '',
    description: '',
    batchYear: '',
    branchSlugs: [] as string[],
    rupees: '99',
  });
  // Until the admin picks, start from the course the student named.
  const courseId = picked || guessCourse(c.courseHint, c.title, usable);
  // Per-file choices: another unit, a new name, or leave it out.
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const files = Object.entries(choices).map(([from, { newFolder: _newFolder, ...choice }]) => ({
    from,
    ...choice,
  }));
  const [debounced, setDebounced] = useState({
    courseId,
    unit,
    files,
    preserveFolders: preserveArchiveFolders,
    replaceFolder,
  });
  const filesKey = JSON.stringify(files);
  // biome-ignore lint/correctness/useExhaustiveDependencies: filesKey stands for files
  useEffect(() => {
    const t = setTimeout(
      () =>
        setDebounced({
          courseId,
          unit: unit.trim(),
          files,
          preserveFolders: preserveArchiveFolders,
          replaceFolder,
        }),
      350,
    );
    return () => clearTimeout(t);
  }, [courseId, unit, filesKey, preserveArchiveFolders, replaceFolder]);
  const hasArchiveFolders = c.files.some(
    (file) => file.check?.format === 'zip' && file.check.entries?.some((entry) => entry.path.includes('/')),
  );
  const plan = useQuery({
    queryKey: ['admin-file-plan', c.id, debounced],
    queryFn: () => api.adminFileContribution(c.id, { ...debounced, dryRun: true }),
    enabled: !!debounced.courseId && (debounced.unit.length > 0 || debounced.preserveFolders),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
  const createCourse = useMutation({
    mutationFn: () =>
      api.adminCreateContributionCourse(c.id, {
        title: courseDraft.title.trim(),
        courseCode: courseDraft.courseCode.trim(),
        description: courseDraft.description.trim(),
        batchYear: Number(courseDraft.batchYear),
        branchSlugs: courseDraft.branchSlugs,
        pricePaise: Math.round(Number(courseDraft.rupees) * 100),
      } satisfies ContributionCourseInput),
    onSuccess: async (created) => {
      setCourseId(created.id);
      setUnit(preserveArchiveFolders ? '' : 'Notes');
      setCreatingFolder(false);
      setReplaceFolder(false);
      setCreateOpen(false);
      await qc.invalidateQueries({ queryKey: ['admin-courses'] });
    },
  });
  const go = useMutation({
    mutationFn: async () => {
      const filed = await api.adminFileContribution(c.id, {
        courseId,
        unit: unit.trim(),
        preserveFolders: preserveArchiveFolders || whole,
        replaceFolder,
        files,
        dryRun: false,
      });
      const prefix = usable.find((x) => x.id === courseId)?.r2Prefix ?? '';
      const keys = filed.files
        .filter((file) => file.status === 'new' || file.status === 'replace')
        .map((file) => `${prefix}${file.to}`);
      const synced = await syncR2Files(
        keys.map((key) => ({ courseId, courseTitle: course?.title ?? '', key })),
        setSyncProgress,
      );
      return { filed, prefix, keys, outcomes: synced.outcomes };
    },
    onSuccess: ({ prefix, keys, outcomes }) => {
      void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY });
      void qc.invalidateQueries({ queryKey: ['admin-file-plan', c.id] });
      void qc.invalidateQueries({ queryKey: ['admin-courses'] });
      const params = new URLSearchParams({ section: 'page-jobs', upload: c.id });
      for (const scope of keys.length ? keys : prefix ? [prefix] : []) params.append('scope', scope);
      const issues = outcomes
        .filter((outcome) => outcome.status === 'failed' || outcome.status === 'review')
        .map(({ key, message }) => ({ key, message: message ?? 'Could not add this file to the course.' }));
      navigate(`/admin?${params}`, { state: issues.length ? { contributionSyncIssues: issues } : null });
    },
  });
  const p = plan.data;
  const whole = !!p?.wholeSubject;
  const keepFolders = preserveArchiveFolders || whole;
  const planIsCurrent =
    debounced.courseId === courseId &&
    debounced.unit === unit.trim() &&
    JSON.stringify(debounced.files) === filesKey &&
    debounced.preserveFolders === (preserveArchiveFolders || whole) &&
    debounced.replaceFolder === replaceFolder;
  const fresh = planIsCurrent
    ? (p?.files.filter((f) => f.status === 'new' || f.status === 'replace').length ?? 0)
    : 0;
  const course = usable.find((x) => x.id === courseId);
  const missingNewFolderName = Object.values(choices).some(
    (choice) => choice.newFolder && !choice.unit?.trim(),
  );
  const branches = (catalogue.data?.branches ?? []) as BranchDto[];
  const newCourseReady =
    courseDraft.title.trim().length >= 2 &&
    /^\d{4}$/.test(courseDraft.batchYear) &&
    courseDraft.branchSlugs.length > 0 &&
    Number(courseDraft.rupees) >= 1 &&
    Number(courseDraft.rupees) <= 10_000;
  // Courses by batch year (newest first), so the dropdown reads like the catalogue.
  const byYear = new Map<number, AdminCourseDto[]>();
  for (const x of [...usable].sort((m, n) => m.title.localeCompare(n.title, undefined, { numeric: true })))
    byYear.set(x.batchYear, [...(byYear.get(x.batchYear) ?? []), x]);
  const years = [...byYear.keys()].sort((m, n) => n - m);
  const suggested = !picked && courseId ? usable.find((x) => x.id === courseId) : undefined;
  const modules = p?.units ?? [];
  const newModule = !keepFolders && !!unit.trim() && !modules.includes(unit.trim());
  const rows = p?.files.filter((f) => f.status !== 'skipped' || f.leftOut).length ?? 0;
  const step = (n: number, title: string, done: boolean) => (
    <h4 className="m-0 flex items-center gap-2 text-[15px] font-semibold">
      <span
        aria-hidden="true"
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${done ? 'bg-teal text-white' : 'bg-marigold-soft text-marigold-text'}`}
      >
        {done ? '✓' : n}
      </span>
      {title}
    </h4>
  );
  return (
    <div className="flex flex-col gap-4">
      {!again && (
        <p className="m-0 text-[14px] text-ink2">
          Pick where these notes belong. They are copied into <U>course › module › file</U>; ZIPs are
          unpacked, and files that can't become pages say why. Nothing already in the course is touched unless
          you choose to replace it.
        </p>
      )}

      {/* 1 · Course */}
      <div className="flex flex-col gap-2">
        {step(1, 'Which course?', !!course)}
        <select
          aria-label="Course"
          className={input}
          value={createOpen ? '__new__' : courseId}
          onChange={(e) => {
            if (e.target.value === '__new__') {
              setCreateOpen(true);
              return;
            }
            setCreateOpen(false);
            setCourseId(e.target.value);
            setUnit(c.pipeline.filed?.folder.replace(/\/$/, '') || 'Notes');
            setCreatingFolder(false);
            setReplaceFolder(false);
          }}
        >
          <option value="">{courses.isLoading ? 'Loading courses…' : 'Choose a course'}</option>
          {years.map((y) => (
            <optgroup key={y} label={`${y} batch`}>
              {byYear.get(y)!.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                  {x.courseCode ? ` · ${x.courseCode}` : ''}
                  {x.status === 'draft' ? ' (draft)' : ''}
                  {x.id === suggested?.id ? ' (suggested)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
          <option value="__new__">＋ Make a new course for these notes…</option>
        </select>
        {suggested && !createOpen && (
          <p className="m-0 text-[13px] text-teal-text">
            Suggested from what the student wrote (“{c.courseHint || c.title}”). Pick another if it's wrong.
          </p>
        )}
        {!courseId && !createOpen && !courses.isLoading && (
          <p className="m-0 text-[13px] text-ink2">
            Not in the list? Choose “＋ Make a new course”. It starts as a draft students can't see.
          </p>
        )}
      </div>
      {createOpen && (
        <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <div>
            <h3 className="m-0 text-base font-semibold">New draft course</h3>
            <p className="m-0 mt-1 text-sm text-ink2">
              It gets its own folder in storage and stays off the student site until you publish it.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Course title">
              <input
                className={input}
                value={courseDraft.title}
                maxLength={120}
                onChange={(e) => setCourseDraft({ ...courseDraft, title: e.target.value })}
              />
            </Field>
            <Field label="Course code (optional)">
              <input
                className={`${input} font-mono uppercase`}
                value={courseDraft.courseCode}
                maxLength={24}
                placeholder="e.g. CSE3001"
                onChange={(e) => setCourseDraft({ ...courseDraft, courseCode: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Batch year">
              <YearSelect
                value={courseDraft.batchYear}
                onChange={(batchYear) => setCourseDraft({ ...courseDraft, batchYear })}
              />
            </Field>
            <Field label="Price ₹">
              <input
                className={input}
                inputMode="numeric"
                value={courseDraft.rupees}
                onChange={(e) =>
                  setCourseDraft({ ...courseDraft, rupees: e.target.value.replace(/\D/g, '') })
                }
              />
            </Field>
            <Field label="Branches" className="sm:col-span-2">
              <BranchPicker
                branches={branches}
                selected={courseDraft.branchSlugs}
                onChange={(branchSlugs) => setCourseDraft({ ...courseDraft, branchSlugs })}
                label={`Branches for ${courseDraft.title || 'new course'}`}
              />
            </Field>
            <Field label="Description (optional)" className="sm:col-span-2">
              <textarea
                className={`${input} min-h-20 py-2.5`}
                value={courseDraft.description}
                maxLength={600}
                onChange={(e) => setCourseDraft({ ...courseDraft, description: e.target.value })}
              />
            </Field>
          </div>
          {!newCourseReady && (
            <p className="m-0 text-[13px] text-ink2">
              Still needed:{' '}
              {[
                courseDraft.title.trim().length < 2 && 'a title',
                !/^\d{4}$/.test(courseDraft.batchYear) && 'a batch year',
                !courseDraft.branchSlugs.length && 'at least one branch',
                !(Number(courseDraft.rupees) >= 1 && Number(courseDraft.rupees) <= 10_000) &&
                  'a price (₹1–10,000)',
              ]
                .filter(Boolean)
                .join(', ')}
              .
            </p>
          )}
          {createCourse.isError && (
            <p className="m-0 text-sm text-blush-text">{friendly(createCourse.error)}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => createCourse.mutate()}
              disabled={!newCourseReady || createCourse.isPending || catalogue.isLoading}
            >
              {createCourse.isPending ? 'Making the course…' : 'Make the draft course'}
            </Button>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createCourse.isPending}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      {/* 2 · Module */}
      {course && !createOpen && (
        <div className="flex flex-col gap-2">
          {step(
            2,
            whole ? 'Modules come from the ZIP' : 'Which module (unit)?',
            !!unit.trim() || keepFolders,
          )}
          {whole ? (
            <p className="m-0 text-[14px] text-teal-text">
              This ZIP is a whole subject: its syllabus, unit and past-paper folders become the course's
              modules as they are.
            </p>
          ) : keepFolders ? (
            <Field label="Module for loose files (optional)">
              <input
                className={input}
                value={unit}
                maxLength={80}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="Notes"
              />
            </Field>
          ) : (
            <>
              <select
                aria-label="Module"
                className={input}
                value={creatingFolder ? '__new__' : unit}
                onChange={(e) => {
                  setReplaceFolder(false);
                  if (e.target.value === '__new__') {
                    setUnit('');
                    setCreatingFolder(true);
                    return;
                  }
                  setUnit(e.target.value);
                  setCreatingFolder(false);
                }}
              >
                {!unit && !creatingFolder && <option value="">Choose a module</option>}
                {unit && !modules.includes(unit) && !creatingFolder && (
                  <option value={unit}>{unit} (new module)</option>
                )}
                {modules.length > 0 && (
                  <optgroup label={`In ${course.title}`}>
                    {modules.map((folder) => (
                      <option key={folder} value={folder}>
                        {folder}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="__new__">＋ New module…</option>
              </select>
              {creatingFolder && (
                <div className="flex flex-col gap-1.5">
                  <input
                    className={input}
                    aria-label="New module name"
                    value={unit}
                    maxLength={80}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="e.g. Unit 3 - Normalisation"
                  />
                  <p className="m-0 text-[13px] text-ink2">
                    Name it like <span className="font-mono">Unit 3 - Normalisation</span> or{' '}
                    <span className="font-mono">Module 2 - SQL</span> so students see it in order. Other names
                    (Notes, PYQs, Lab) work too.
                  </p>
                </div>
              )}
              {newModule && (
                <p className="m-0 text-[13px] text-teal-text">
                  A new module “{moduleLabel(unit)}” is made in {course.title} when you file.
                </p>
              )}
              {!creatingFolder && modules.length === 0 && (
                <p className="m-0 text-[13px] text-ink2">
                  This course has no modules yet: these notes start its first one.
                </p>
              )}
            </>
          )}
          {hasArchiveFolders && !whole && (
            <label className="flex items-start gap-2 text-sm text-ink2">
              <input
                type="checkbox"
                className="mt-1 accent-teal"
                checked={preserveArchiveFolders}
                onChange={(e) => {
                  setPreserveArchiveFolders(e.target.checked);
                  if (e.target.checked) setReplaceFolder(false);
                }}
              />
              <span>
                The ZIP has its own folders: keep each one as a module. Untick to put every file in the module
                above.
              </span>
            </label>
          )}
          {!keepFolders && unit.trim() && modules.includes(unit.trim()) && (
            <label className="flex items-start gap-2 rounded-lg border border-marigold/40 bg-marigold-soft/40 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 accent-marigold"
                checked={replaceFolder}
                onChange={(e) => setReplaceFolder(e.target.checked)}
              />
              <span>
                <strong>Replace everything in “{unit.trim()}”.</strong> Files in that module that aren't in
                this upload are removed. Leave unticked to add these files next to what's there.
              </span>
            </label>
          )}
        </div>
      )}

      {/* 3 · Files */}
      {course && !createOpen && (
        <div className="flex flex-col gap-2">
          {step(3, 'Check where each file goes', !!p && planIsCurrent && fresh > 0)}
          {plan.isFetching && !p && (
            <p className="m-0 text-sm text-ink2">Working out where each file goes…</p>
          )}
          {plan.isError && <p className="m-0 text-sm text-blush-text">{friendly(plan.error)}</p>}
          {!plan.isFetching && !p && !unit.trim() && !keepFolders && (
            <p className="m-0 text-sm text-ink2">Choose or name a module above to see the plan.</p>
          )}
          {p && (
            <details open={rows <= 8} className="rounded-xl">
              <summary className="cursor-pointer text-[14px] font-semibold text-teal-text">
                {plural(rows, 'file')} · {fresh} new. Rename, move or leave out single files
              </summary>
              <div className="mt-2">
                <PlanTable
                  plan={p}
                  choices={choices}
                  onChange={(from, x) =>
                    setChoices((all) => {
                      const next = { ...all, [from]: { ...all[from], ...x } };
                      const v = next[from]!;
                      if (!v.unit && !v.name && !v.skip && !v.replace && !v.newFolder) delete next[from];
                      return next;
                    })
                  }
                />
              </div>
            </details>
          )}
        </div>
      )}

      {p && course && !createOpen && fresh > 0 && (
        <div className="rounded-xl bg-sunk p-3 text-[14px]">
          <p className="m-0 font-semibold">When you press File:</p>
          <ul className="m-0 mt-1 pl-5 flex flex-col gap-0.5 text-ink2">
            <li>
              {plural(fresh, 'file')} {fresh === 1 ? 'is' : 'are'} copied into {course.title}
              {keepFolders ? '' : ` › ${moduleLabel(unit)}`}
              {newModule ? ' (a new module)' : ''}.
            </li>
            {replaceFolder && <li className="text-marigold-text">Other files in that module are removed.</li>}
            <li>Pages start being made; Page jobs opens so you can watch them.</li>
            <li>
              {course.status === 'live'
                ? 'The course stays on sale; students see the new pages once they are ready.'
                : 'The course stays a draft until you publish it.'}
            </li>
            <li>Then you choose the student's reward here.</li>
          </ul>
        </div>
      )}
      {p && course && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => go.mutate()} disabled={go.isPending || fresh === 0 || missingNewFolderName}>
            {go.isPending
              ? syncProgress
                ? `Adding files ${syncProgress.completed} of ${syncProgress.total}…`
                : 'Filing…'
              : fresh
                ? replaceFolder
                  ? `Replace folder and file ${plural(fresh, 'file')}`
                  : `File ${plural(fresh, 'file')} and open Page jobs`
                : 'Nothing new to file'}
          </Button>
          {go.isPending && syncProgress && syncProgress.total > 0 && (
            <span className="text-[13px] text-ink2" role="status" aria-live="polite">
              {syncProgress.outcomes.filter((outcome) => outcome.status === 'added').length} added so far
            </span>
          )}
          {course.status === 'live' && (
            <span className="text-[13px] text-ink2">
              The course stays on sale; the new pages appear when ready.
            </span>
          )}
        </div>
      )}
      {go.isError && <p className="m-0 text-sm text-blush-text">{friendly(go.error)}</p>}
    </div>
  );
}

type Choice = { unit?: string; name?: string; skip?: boolean; replace?: boolean; newFolder?: boolean };

/**
 * Where each file goes, editable per file: its unit folder, its name, or leave it out. Files that
 * can't become pages are listed under it with the reason.
 */
function PlanTable({
  plan,
  choices,
  onChange,
}: {
  plan: FilePlanDto;
  choices: Record<string, Choice>;
  onChange: (from: string, x: Choice) => void;
}) {
  const rows = plan.files.filter((f) => f.status !== 'skipped' || f.leftOut);
  const unusable = plan.files.filter((f) => f.status === 'skipped' && !f.leftOut);
  // The unit asked for, the course's units, and any new ones a whole-subject ZIP brings.
  const units = [
    ...new Set(
      [
        plan.folder.replace(/\/$/, ''),
        ...plan.units,
        ...rows.map((f) => f.to.split('/')[0] ?? ''),
        ...Object.values(choices).map((choice) => choice.unit ?? ''),
      ].filter(Boolean),
    ),
  ];
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-sunk p-3 min-w-0" aria-label="Where the files go">
      <p className="m-0 text-[13px] text-ink2">
        Into <strong className="text-ink">{plan.course.title}</strong>. Edit, skip or replace files below.
      </p>
      {plan.folderReplacement && (
        <div className="rounded-lg border border-marigold/50 bg-marigold-soft/30 p-3 text-[13px] text-ink">
          <strong>Folder replacement preview · {plan.folderReplacement.folder}</strong>
          <p className="m-0 mt-1 text-ink2">
            {plan.folderReplacement.overwritten.length} matching{' '}
            {plan.folderReplacement.overwritten.length === 1
              ? 'file will be replaced'
              : 'files will be replaced'}
            ; {plan.folderReplacement.removed.length}{' '}
            {plan.folderReplacement.removed.length === 1
              ? 'other file will be removed'
              : 'other files will be removed'}
            .
          </p>
          {plan.folderReplacement.removed.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold">Review files that will be removed</summary>
              <ul className="m-0 mt-1 pl-5 font-mono text-[12px] break-all">
                {plan.folderReplacement.removed.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {rows.map((f) => {
          const pick = choices[f.from] ?? {};
          const unit = f.to.split('/')[0] ?? '';
          const name =
            f.to
              .slice(unit.length + 1)
              .split('/')
              .pop() ?? f.to;
          const out = f.status === 'skipped';
          return (
            <li
              key={f.from}
              className={`grid gap-3 rounded-lg bg-surface p-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(10rem,.8fr)_minmax(10rem,.8fr)_auto] sm:items-end ${out ? 'opacity-60' : ''}`}
            >
              <div className="min-w-0">
                <p className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink2">
                  Uploaded path
                </p>
                <p className="m-0 break-all font-mono text-[12px] leading-relaxed text-ink" title={f.from}>
                  {f.from}
                </p>
              </div>
              {!out ? (
                <>
                  <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink2">
                    Destination folder
                    <select
                      aria-label={`Folder for ${f.from}`}
                      className={`${input} h-9 text-[13px] normal-case tracking-normal text-ink`}
                      value={
                        pick.newFolder ? '__new__' : (pick.unit ?? (f.from.includes('›') ? '__keep__' : unit))
                      }
                      onChange={(e) =>
                        e.target.value === '__new__'
                          ? onChange(f.from, { newFolder: true, unit: '' })
                          : e.target.value === '__keep__'
                            ? onChange(f.from, { newFolder: false, unit: undefined })
                            : onChange(f.from, { newFolder: false, unit: e.target.value })
                      }
                    >
                      {f.from.includes('›') && <option value="__keep__">Keep ZIP folder path</option>}
                      {units.map((folder) => (
                        <option key={folder} value={folder}>
                          {folder}
                        </option>
                      ))}
                      <option value="__new__">+ Create a folder…</option>
                    </select>
                    {pick.newFolder && (
                      <input
                        aria-label={`New folder for ${f.from}`}
                        className={`${input} h-9 text-[13px] normal-case tracking-normal text-ink`}
                        value={pick.unit ?? ''}
                        maxLength={80}
                        placeholder="e.g. Unit 2 - SQL"
                        onChange={(e) => onChange(f.from, { unit: e.target.value, newFolder: true })}
                      />
                    )}
                  </label>
                  <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink2">
                    File name
                    <input
                      aria-label={`Name for ${f.from}`}
                      className={`${input} h-9 text-[13px] normal-case tracking-normal text-ink`}
                      value={pick.name ?? name}
                      maxLength={120}
                      onChange={(e) => onChange(f.from, { name: e.target.value })}
                    />
                  </label>
                </>
              ) : (
                <span className="text-[13px] text-ink2 sm:col-span-2">Excluded from this filing</span>
              )}
              <div className="flex items-center gap-2 justify-self-start sm:justify-self-end">
                {!out && (
                  <span
                    className={`text-[12px] font-semibold ${f.status === 'new' ? 'text-teal-text' : f.status === 'replace' ? 'text-marigold-text' : 'text-ink2'}`}
                  >
                    {f.status === 'new' ? 'new' : f.status === 'replace' ? 'will replace' : 'already there'}
                  </span>
                )}
                {!out && (f.status === 'exists' || f.status === 'replace') && (
                  <button
                    type="button"
                    onClick={() => onChange(f.from, { replace: !pick.replace })}
                    className={`text-[13px] font-semibold underline underline-offset-4 ${pick.replace ? 'text-ink2' : 'text-marigold-text'}`}
                  >
                    {pick.replace ? 'Keep existing' : 'Replace'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onChange(f.from, { skip: !out })}
                  className="text-[13px] font-semibold text-teal-text underline underline-offset-4"
                >
                  {out ? 'Restore' : 'Exclude'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {unusable.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {unusable.map((f) => (
            <li key={f.from} className="rounded-lg border border-line bg-surface p-3">
              <p className="m-0 break-all font-mono text-[12px] text-ink">{f.from}</p>
              <p className="m-0 mt-1 text-[12px] text-ink2">{f.reason}</p>
              {f.canRename && (
                <label className="mt-2 flex max-w-xl flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink2">
                  Include with a supported file name
                  <input
                    aria-label={`Supported file name for ${f.from}`}
                    className={`${input} h-9 text-[13px] normal-case tracking-normal text-ink`}
                    value={choices[f.from]?.name ?? ''}
                    maxLength={120}
                    placeholder="e.g. syllabus.pdf"
                    onChange={(e) => onChange(f.from, { name: e.target.value })}
                  />
                  <span className="normal-case tracking-normal font-normal">
                    Add the real extension. It will appear in the course plan above when supported.
                  </span>
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type RewardKind = ContributionReviewInput['reward']['type'];

/** Step 4: what the student gets. This is the email that tells them they were accepted. */
export function RewardStep({ c }: { c: AdminContributionDto }) {
  const qc = useQueryClient();
  const filedCourse = c.pipeline.filed?.courseId ?? '';
  // The rule students were given: a whole subject in the right layout earns the 30% royalty;
  // anything smaller is paid once.
  const whole = c.files.some((f) => f.check?.layout?.wholeSubject);
  const [kind, setKind] = useState<RewardKind>(
    c.reward && c.reward.type !== 'none' ? c.reward.type : whole && filedCourse ? 'royalty' : 'cash',
  );
  const [courseId, setCourseId] = useState(
    c.reward?.type === 'course' || c.reward?.type === 'royalty' ? c.reward.courseId : filedCourse,
  );
  const [share, setShare] = useState(
    String(c.reward?.type === 'royalty' ? c.reward.sharePercent : DEFAULT_ROYALTY_PERCENT),
  );
  const [rupees, setRupees] = useState(c.reward?.type === 'cash' ? String(c.reward.amountRupees) : '');
  const [note, setNote] = useState(c.reviewNote);
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: api.adminCourses });
  const save = useMutation({
    mutationFn: () => {
      const reward: ContributionReviewInput['reward'] =
        kind === 'royalty'
          ? { type: 'royalty', courseId, sharePercent: Number(share) }
          : kind === 'course'
            ? { type: 'course', courseId }
            : kind === 'cash'
              ? { type: 'cash', amountRupees: Math.round(Number(rupees)) }
              : { type: 'thanks' };
      return api.adminReviewContribution(c.id, { decision: 'approved', note, reward, notify: true });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY }),
  });
  const invalid =
    ((kind === 'royalty' || kind === 'course') && !courseId) ||
    (kind === 'cash' && !(Number(rupees) >= 1)) ||
    (kind === 'royalty' && !(Number(share) >= 1 && Number(share) <= 90));
  const options: [RewardKind, string][] = [
    ['royalty', `Royalty · ${share || DEFAULT_ROYALTY_PERCENT}% of sales`],
    ['cash', 'Money (UPI)'],
    ['course', 'A free course'],
    ['thanks', 'Thank-you only'],
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[13px] text-ink2">
        {whole
          ? `A whole subject in the right layout: the ${DEFAULT_ROYALTY_PERCENT}% royalty is what students were promised.`
          : `Not a whole subject, so the ${DEFAULT_ROYALTY_PERCENT}% royalty isn't due. Pay once, or give a course.`}
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Reward">
        {options.map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`h-9 rounded-full px-3.5 text-[13px] font-semibold border ${kind === k ? 'bg-brand text-white border-brand' : 'border-line text-ink2 bg-surface'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {(kind === 'royalty' || kind === 'course') && (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label={kind === 'royalty' ? 'Royalty on' : 'Course to give, free'}>
            <select className={input} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">Choose a course</option>
              {(courses.data ?? [])
                .filter((x) => (kind === 'course' ? x.status === 'live' : x.status !== 'archived'))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                    {x.id === filedCourse ? ' (filed here)' : ''}
                  </option>
                ))}
            </select>
          </Field>
          {kind === 'royalty' && (
            <Field label="Share (%)">
              <input
                className={`${input} w-24`}
                inputMode="numeric"
                value={share}
                onChange={(e) => setShare(e.target.value.replace(/\D/g, '').slice(0, 2))}
              />
            </Field>
          )}
        </div>
      )}
      {kind === 'cash' && (
        <Field label="Amount (₹), you pay by UPI">
          <input
            className={`${input} max-w-[200px]`}
            inputMode="numeric"
            value={rupees}
            onChange={(e) => setRupees(e.target.value.replace(/\D/g, ''))}
            placeholder="200"
          />
        </Field>
      )}
      <Field label="Note to the student (optional)">
        <input
          className={input}
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Lovely diagrams!"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending || invalid}>
          {save.isPending
            ? 'Saving…'
            : c.reward && c.reward.type !== 'none'
              ? 'Change reward'
              : 'Give reward and email them'}
        </Button>
        <span className="text-[13px] text-ink2">They get one email: accepted, and what they get.</span>
      </div>
      {save.isError && <p className="m-0 text-sm text-blush-text">{friendly(save.error)}</p>}
    </div>
  );
}

const FILE_TONE = {
  ready: 'text-teal-text',
  waiting: 'text-marigold-text',
  queued: 'text-marigold-text',
  working: 'text-marigold-text',
  paused: 'text-ink2',
  stalled: 'text-blush-text',
  failed: 'text-blush-text',
  hidden: 'text-ink2',
  missing: 'text-blush-text',
} as const;
const FILE_WORD = {
  ready: 'readable',
  waiting: 'needs pages',
  queued: 'queued for pages',
  working: 'pages being made',
  paused: 'page job paused',
  stalled: 'page job stuck',
  failed: 'page job failed',
  hidden: 'kept off the site',
  missing: 'no longer in the course',
} as const;

/** Step 5: each filed file and its pages, refreshing while any are still being made. */
export function PagesStep({ c }: { c: AdminContributionDto }) {
  const f = c.pipeline.filed;
  if (!f) return null;
  const ready = f.files.filter((x) => x.status === 'ready');
  const pages = ready.reduce((t, x) => t + x.pages, 0);
  const jobs = new URLSearchParams({ section: 'page-jobs', upload: c.id });
  for (const file of f.files.filter((x) => x.status !== 'hidden' && x.status !== 'missing'))
    jobs.append('scope', file.key);
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[14px] text-ink2">
        In{' '}
        <Link to={`/c/${f.courseSlug}`} className="font-semibold text-ink">
          {f.courseTitle}
        </Link>{' '}
        › {f.folder} ·{' '}
        <U>
          {ready.length} of {plural(f.files.length, 'file')} readable
        </U>
        {pages ? ` · ${pages} pages` : ''}
        {f.courseStatus !== 'live' && ' · the course is not on sale yet'}
      </p>
      <ul className="m-0 p-0 list-none flex flex-col gap-0.5 text-[13px]">
        {f.files.map((x) => (
          <li key={x.key} className="flex flex-wrap gap-x-2 [overflow-wrap:anywhere]">
            <span className="text-ink">{x.name}</span>
            <span className={FILE_TONE[x.status]}>
              · {FILE_WORD[x.status]}
              {x.status === 'ready' ? `, ${plural(x.pages, 'page')}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {ready.length < f.files.filter((x) => x.status !== 'hidden' && x.status !== 'missing').length && (
        <Link
          to={`/admin?${jobs}`}
          className="self-start inline-flex min-h-9 items-center rounded-full border border-line px-3.5 text-[13px] font-semibold text-ink hover:border-teal hover:text-teal-text"
        >
          View these files in Courses › Page jobs
        </Link>
      )}
    </div>
  );
}

/** Step 6: tick it off. The student gets a "your notes are live" email once. */
export function FinishStep({ c }: { c: AdminContributionDto }) {
  const qc = useQueryClient();
  const [notify, setNotify] = useState(true);
  const courseId = c.pipeline.filed?.courseId;
  const publishCheck = useQuery({
    queryKey: ['admin-publish-check', courseId],
    queryFn: () => api.adminPublishCheck(courseId!),
    enabled: !!courseId && c.pipeline.filed?.courseStatus === 'draft',
    refetchInterval: (query) =>
      query.state.data?.files.some((file) => file.state === 'working' || file.state === 'needs-pages')
        ? 6_000
        : false,
  });
  const publish = useMutation({
    mutationFn: () => api.adminUpdateCourse(courseId!, { status: 'live' }),
    onSuccess: async () => {
      await Promise.all(
        [
          ['admin-publish-check', courseId],
          ['admin-courses'],
          ['catalogue'],
          CONTRIBUTIONS_KEY,
          ['admin-overview'],
        ].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
    },
  });
  const done = useMutation({
    mutationFn: (value: boolean) => api.adminCompleteContribution(c.id, { done: value, notify }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY }),
  });
  const completed = c.pipeline.completedAt;
  return (
    <div className="flex flex-col gap-3">
      {courseId && c.pipeline.filed?.courseStatus === 'draft' && (
        <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
          <div>
            <h3 className="m-0 text-[15px] font-semibold">Publish {c.pipeline.filed.courseTitle}</h3>
            <p className="m-0 mt-1 text-[13px] text-ink2">
              This upload is filed. Publish when the course checks pass.
            </p>
          </div>
          {publishCheck.isPending ? (
            <p className="m-0 text-[13px] text-ink2">Checking the course…</p>
          ) : publishCheck.isError ? (
            <p className="m-0 text-[13px] text-blush-text">{friendly(publishCheck.error)}</p>
          ) : publishCheck.data?.ready ? (
            <Button className="self-start" onClick={() => publish.mutate()} disabled={publish.isPending}>
              {publish.isPending ? 'Publishing…' : 'Publish course'}
            </Button>
          ) : (
            <>
              <ul className="m-0 pl-5 text-[13px] text-ink2">
                {(publishCheck.data?.steps ?? [])
                  .filter((step) => !step.done)
                  .map((step) => (
                    <li key={step.key}>{step.detail}</li>
                  ))}
              </ul>
              <Link
                to={`/admin?${new URLSearchParams({ section: 'courses', course: courseId, tab: 'publish' })}`}
                className="self-start text-[13px] font-semibold text-teal-text underline underline-offset-4"
              >
                Open publish checks
              </Link>
            </>
          )}
          {publish.isError && (
            <p className="m-0 text-[13px] text-blush-text" role="alert">
              {friendly(publish.error)}
            </p>
          )}
        </section>
      )}
      {courseId && c.pipeline.filed?.courseStatus === 'live' && (
        <p className="m-0 text-[13px] text-teal-text">This course is already live.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {completed ? (
          <>
            <span className="text-[14px] font-semibold text-teal-text">
              ✓ Done on {new Date(completed).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
            <Button size="sm" variant="ghost" onClick={() => done.mutate(false)} disabled={done.isPending}>
              Undo
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => done.mutate(true)} disabled={done.isPending}>
              Mark done
            </Button>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink2">
              <input
                type="checkbox"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
                className="size-4 accent-teal"
              />
              Email them that their notes are live
            </label>
          </>
        )}
        {done.isError && <p className="m-0 w-full text-sm text-blush-text">{friendly(done.error)}</p>}
      </div>
    </div>
  );
}
