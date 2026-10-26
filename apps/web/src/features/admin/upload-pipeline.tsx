import {
  type AdminContributionDto,
  type AdminCourseDto,
  type ContributionReviewInput,
  DEFAULT_ROYALTY_PERCENT,
  type FilePlanDto,
  type PipelineStep,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { formatBytes } from '../contribute/rules';
import { Field, U, input, plural } from './ui';

export const CONTRIBUTIONS_KEY = ['admin', 'contributions'] as const;

const STEPS: { key: Exclude<PipelineStep, 'finish' | 'rejected'>; label: string }[] = [
  { key: 'decide', label: 'Decide' },
  { key: 'file', label: 'File' },
  { key: 'reward', label: 'Reward' },
  { key: 'pages', label: 'Pages' },
  { key: 'done', label: 'Done' },
];
const ORDER: PipelineStep[] = ['decide', 'file', 'reward', 'pages', 'finish', 'done'];

/** Check · Decide · File · Reward · Pages · Done, with the current one marked. */
export function StepStrip({ step }: { step: PipelineStep }) {
  if (step === 'rejected') return null;
  const at = ORDER.indexOf(step);
  const all = [{ key: 'check', label: 'Check' }, ...STEPS];
  return (
    <ol aria-label="Progress" className="m-0 p-0 list-none grid grid-cols-6 gap-1">
      {all.map((s, i) => {
        // "check" is done once the card exists; "done" counts as reached at "finish".
        const index = i - 1;
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
            <span
              className={`font-mono text-[11px] uppercase tracking-[0.08em] ${state === 'later' ? 'text-ink2' : 'text-ink font-semibold'}`}
            >
              {state === 'done' ? '✓ ' : ''}
              {s.label}
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

/** Step 3: pick the course and unit, see exactly where every file goes, then file it. */
export function FileStep({ c, again = false }: { c: AdminContributionDto; again?: boolean }) {
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: api.adminCourses });
  const usable = (courses.data ?? []).filter((x) => x.status !== 'archived');
  const [picked, setCourseId] = useState(c.pipeline.filed?.courseId ?? '');
  const [unit, setUnit] = useState(c.pipeline.filed?.folder.replace(/\/$/, '') ?? '');
  // Until the admin picks, start from the course the student named.
  const courseId = picked || guessCourse(c.courseHint, c.title, usable);
  // Per-file choices: another unit, a new name, or leave it out.
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const files = Object.entries(choices).map(([from, x]) => ({ from, ...x }));
  const [debounced, setDebounced] = useState({ courseId, unit, files });
  const filesKey = JSON.stringify(files);
  // biome-ignore lint/correctness/useExhaustiveDependencies: filesKey stands for files
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ courseId, unit: unit.trim(), files }), 350);
    return () => clearTimeout(t);
  }, [courseId, unit, filesKey]);
  const plan = useQuery({
    queryKey: ['admin-file-plan', c.id, debounced],
    queryFn: () => api.adminFileContribution(c.id, { ...debounced, dryRun: true }),
    enabled: !!debounced.courseId && debounced.unit.length > 0,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
  const go = useMutation({
    mutationFn: () => api.adminFileContribution(c.id, { courseId, unit: unit.trim(), files, dryRun: false }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY });
      void qc.invalidateQueries({ queryKey: ['admin-file-plan', c.id] });
      void qc.invalidateQueries({ queryKey: ['admin-courses'] });
    },
  });
  const p = plan.data;
  const fresh = p?.files.filter((f) => f.status === 'new').length ?? 0;
  const course = usable.find((x) => x.id === courseId);
  return (
    <div className="flex flex-col gap-3">
      {!again && (
        <p className="m-0 text-[14px] text-ink2">
          Put it in our layout: <U>course › unit › file</U>. Archives are unpacked; anything that can't become
          pages is left out. Nothing is overwritten.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Course">
          <select className={input} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">{courses.isLoading ? 'Loading courses…' : 'Choose a course'}</option>
            {usable.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title} · {x.callNo} · {x.batchYear}
                {x.status === 'draft' ? ' (draft)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Unit folder">
          <input
            className={input}
            list={`units-${c.id}`}
            value={unit}
            maxLength={80}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="Unit 2 - SQL"
          />
          <datalist id={`units-${c.id}`}>
            {(p?.units ?? []).map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
      </div>
      {p && p.units.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Units already in this course">
          {p.units.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={`h-8 rounded-full border px-3 text-[12px] font-semibold ${unit === u ? 'bg-brand text-white border-brand' : 'border-line text-ink2'}`}
            >
              {u}
            </button>
          ))}
        </div>
      )}
      {plan.isFetching && !p && <p className="m-0 text-sm text-ink2">Working out where each file goes…</p>}
      {plan.isError && <p className="m-0 text-sm text-blush-text">{friendly(plan.error)}</p>}
      {p && (
        <PlanTable
          plan={p}
          choices={choices}
          onChange={(from, x) =>
            setChoices((all) => {
              const next = { ...all, [from]: { ...all[from], ...x } };
              const v = next[from]!;
              if (!v.unit && !v.name && !v.skip) delete next[from];
              return next;
            })
          }
        />
      )}
      {p && course && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => go.mutate()} disabled={go.isPending || fresh === 0}>
            {go.isPending
              ? 'Filing…'
              : fresh
                ? `File ${plural(fresh, 'file')} and make pages`
                : 'Nothing new to file'}
          </Button>
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

type Choice = { unit?: string; name?: string; skip?: boolean };

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
  const units = [...new Set([plan.folder.replace(/\/$/, ''), ...plan.units])];
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-sunk p-3 min-w-0" aria-label="Where the files go">
      <p className="m-0 text-[13px] text-ink2">
        Into <strong className="text-ink">{plan.course.title}</strong>. Change any file's unit or name, or
        leave it out.
      </p>
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {rows.map((f) => {
          const pick = choices[f.from] ?? {};
          const unit = f.to.split('/')[0] ?? '';
          const name = f.to.slice(unit.length + 1);
          const out = f.status === 'skipped';
          return (
            <li
              key={f.from}
              className={`grid gap-2 rounded-lg bg-surface p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center ${out ? 'opacity-60' : ''}`}
            >
              <div className="min-w-0">
                <p className="m-0 truncate font-mono text-[12px] text-ink2" title={f.from}>
                  {f.from}
                </p>
                {!out && (
                  <select
                    aria-label={`Unit for ${f.from}`}
                    className={`${input} h-9 w-full text-[13px]`}
                    value={pick.unit ?? unit}
                    onChange={(e) => onChange(f.from, { unit: e.target.value })}
                  >
                    {units.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {!out ? (
                <input
                  aria-label={`Name for ${f.from}`}
                  className={`${input} h-9 text-[13px]`}
                  value={pick.name ?? name}
                  onChange={(e) => onChange(f.from, { name: e.target.value })}
                />
              ) : (
                <span className="text-[13px] text-ink2">Left out</span>
              )}
              <div className="flex items-center gap-2 justify-self-start sm:justify-self-end">
                {!out && (
                  <span
                    className={`text-[12px] font-semibold ${f.status === 'new' ? 'text-teal-text' : 'text-ink2'}`}
                  >
                    {f.status === 'new' ? 'new' : 'already there'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onChange(f.from, { skip: !out })}
                  className="text-[13px] font-semibold text-teal-text underline underline-offset-4"
                >
                  {out ? 'Put back' : 'Leave out'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {unusable.length > 0 && (
        <ul className="m-0 pl-0 list-none text-[12.5px] text-ink2">
          {unusable.map((f) => (
            <li key={f.from} className="[overflow-wrap:anywhere]">
              ✕ {f.from}: {f.reason}
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
  const [kind, setKind] = useState<RewardKind>(
    c.reward && c.reward.type !== 'none' ? c.reward.type : filedCourse ? 'royalty' : 'cash',
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
  working: 'text-marigold-text',
  failed: 'text-blush-text',
  hidden: 'text-ink2',
  missing: 'text-blush-text',
} as const;
const FILE_WORD = {
  ready: 'readable',
  waiting: 'waiting for pages',
  working: 'making pages…',
  failed: 'pages failed',
  hidden: 'kept off the site',
  missing: 'no longer in the course',
} as const;

/** Step 5: each filed file and its pages, refreshing while any are still being made. */
export function PagesStep({ c }: { c: AdminContributionDto }) {
  const f = c.pipeline.filed;
  if (!f) return null;
  const ready = f.files.filter((x) => x.status === 'ready');
  const pages = ready.reduce((t, x) => t + x.pages, 0);
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
      {f.files.some((x) => x.status === 'failed') && (
        <p className="m-0 text-[13px] text-ink2">
          Open <strong>Courses › Make pages</strong>, pick {f.courseTitle}, and press make pages to try again.
        </p>
      )}
    </div>
  );
}

/** Step 6: tick it off. The student gets a "your notes are live" email once. */
export function FinishStep({ c }: { c: AdminContributionDto }) {
  const qc = useQueryClient();
  const [notify, setNotify] = useState(true);
  const done = useMutation({
    mutationFn: (value: boolean) => api.adminCompleteContribution(c.id, { done: value, notify }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY }),
  });
  const completed = c.pipeline.completedAt;
  return (
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
  );
}
