import {
  type AdminContributionDto,
  type AdminStudentDto,
  type AdminSupportQueryDto,
  studentFromEmail,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Sheet, Skeleton } from '../../shared/ui/feedback';
import { GiveAccessCard } from './grant-access';
import { Field, Panel, input, plural } from './ui';

type Course = AdminStudentDto['courses'][number];
/** One person, from everything the site knows: courses, uploads and questions. */
type Person = AdminStudentDto & { uploads: AdminContributionDto[]; questions: AdminSupportQueryDto[] };

const STEP: Record<AdminContributionDto['pipeline']['step'], string> = {
  decide: 'To review',
  file: 'Accepted, to file',
  reward: 'Filed, to reward',
  pages: 'Pages being made',
  finish: 'Ready to finish',
  done: 'Done',
  rejected: 'Rejected',
};

/** Everyone the site knows, joined by account: buyers, contributors and people who asked. */
function people(
  students: AdminStudentDto[],
  uploads: AdminContributionDto[],
  questions: AdminSupportQueryDto[],
): Person[] {
  const map = new Map<string, Person>();
  const ensure = (id: string, email: string, name: string | null) => {
    let p = map.get(id);
    if (!p) {
      const placed = studentFromEmail(email);
      p = {
        userId: id,
        email,
        fullName: name,
        batchYear: placed?.batchYear ?? null,
        branchCode: placed?.branchCode ?? null,
        courses: [],
        uploads: [],
        questions: [],
      };
      map.set(id, p);
    }
    return p;
  };
  for (const st of students) map.set(st.userId, { ...st, uploads: [], questions: [] });
  for (const u of uploads) ensure(u.contributor.id, u.contributor.email, u.contributor.name).uploads.push(u);
  for (const q of questions) ensure(q.student.id, q.student.email, q.student.name).questions.push(q);
  return [...map.values()];
}
type Action = 'renew' | 'end' | 'block' | 'unblock';

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const STATE: Record<Course['state'], { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'bg-mist text-on-mist' },
  ended: { label: 'Ended', tone: 'bg-sunk text-ink2' },
  blocked: { label: 'Blocked', tone: 'bg-blush text-blush-text' },
  disputed: { label: 'Bank dispute', tone: 'bg-blush text-blush-text' },
};

const ACTION: Record<Action, { title: string; button: string; hint: string }> = {
  renew: {
    title: 'Renew access',
    button: 'Renew and tell them',
    hint: 'Access runs to the date you pick. The student is emailed with your reason.',
  },
  end: {
    title: 'End access now',
    button: 'End now and tell them',
    hint: 'The course stops opening at once and leaves their shelf after 48 hours.',
  },
  block: {
    title: 'Block this course',
    button: 'Block and tell them',
    hint: 'Stops access at once and keeps the record. Unblock undoes it.',
  },
  unblock: {
    title: 'Unblock this course',
    button: 'Unblock and tell them',
    hint: 'They can read it again straight away.',
  },
};

const inMonths = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};

/** One change to one student's course, with the reason they will read. */
function ChangeSheet({
  who,
  courseId,
  courseTitle,
  userIds,
  action,
  onClose,
}: {
  /** Whom it is for, as shown: a name, or "5 students". */
  who: string;
  courseId: string;
  courseTitle: string;
  userIds: string[];
  action: Action;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState(inMonths(3));
  const [forever, setForever] = useState(false);
  const change = useMutation({
    mutationFn: () =>
      api.adminChangeAccess({
        courseId,
        userIds,
        action: action === 'block' ? 'block' : action === 'unblock' ? 'restore' : 'until',
        ...(action === 'renew'
          ? { until: forever ? null : new Date(`${until}T23:59:59+05:30`).toISOString() }
          : action === 'end'
            ? { until: new Date().toISOString() }
            : {}),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'students'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'access'] });
    },
  });
  const a = ACTION[action];
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={a.title}>
      <p className="m-0 text-[15px]">
        <strong>{who}</strong> · {courseTitle}
      </p>
      <p className="m-0 text-sm text-ink2">{a.hint}</p>
      {change.isSuccess ? (
        <>
          <p className="m-0 text-teal-text" role="status">
            Done{userIds.length > 1 ? `: ${plural(change.data.changed, 'student')} updated` : ''}.{' '}
            {change.data.emailed?.length
              ? 'They were emailed with your reason.'
              : 'Saved; the email could not go out today (daily limit), but they see the reason on their shelf.'}
          </p>
          <Button onClick={onClose}>Close</Button>
        </>
      ) : (
        <>
          {action === 'renew' && (
            <>
              <Field label="Access until">
                <input
                  type="date"
                  className={input}
                  value={until}
                  min={inMonths(0)}
                  disabled={forever}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="w-5 h-5 accent-[var(--teal)]"
                  checked={forever}
                  onChange={(e) => setForever(e.target.checked)}
                />
                No end date
              </label>
            </>
          )}
          <Field label="Reason (the student reads this)">
            <textarea
              className={`${input} h-24 py-2 resize-y`}
              value={reason}
              maxLength={300}
              placeholder={
                action === 'block'
                  ? 'e.g. Your account was used on more devices than allowed.'
                  : action === 'renew'
                    ? 'e.g. Extended for your re-exam.'
                    : 'e.g. Refunded at your request.'
              }
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {change.isError && <p className="m-0 text-sm text-blush-text">{friendly(change.error)}</p>}
          <div className="flex gap-2">
            <Button disabled={reason.trim().length < 3 || change.isPending} onClick={() => change.mutate()}>
              {change.isPending ? 'Saving…' : a.button}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function StudentRow({
  s,
  open,
  onToggle,
  pick,
  branchName,
  go,
}: {
  s: Person;
  branchName: string | null;
  go: (section: string) => void;
  open: boolean;
  onToggle: () => void;
  /** With a course chosen in the filter, students can be ticked to change many at once. */
  pick?: { checked: boolean; onChange: () => void };
}) {
  const [act, setAct] = useState<{ course: Course; action: Action } | null>(null);
  const counts = (['active', 'ended', 'blocked'] as const)
    .map((k) => [k, s.courses.filter((c) => c.state === k).length] as const)
    .filter(([, n]) => n > 0);
  return (
    <li className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] overflow-hidden flex flex-wrap">
      {pick && (
        <input
          type="checkbox"
          aria-label={`Select ${s.email}`}
          className="ml-4 mt-4 w-5 h-5 flex-none accent-[var(--teal)]"
          checked={pick.checked}
          onChange={pick.onChange}
        />
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left bg-transparent border-0 cursor-pointer"
      >
        <span className="flex-[1_1_240px] min-w-0">
          <span className="block font-semibold text-ink truncate">{s.fullName ?? s.email.split('@')[0]}</span>
          <span className="block font-mono text-[12px] text-ink2 truncate">{s.email}</span>
        </span>
        <span className="font-mono text-[12px] text-ink2" title={branchName ?? undefined}>
          {s.batchYear ?? '—'} · {s.branchCode ?? '—'}
        </span>
        {s.uploads.length > 0 && (
          <span className="h-6 px-2 rounded-md text-[12px] font-semibold inline-flex items-center bg-marigold-soft text-marigold-text">
            {plural(s.uploads.length, 'upload')}
          </span>
        )}
        {s.questions.some((q) => q.status === 'open') && (
          <span className="h-6 px-2 rounded-md text-[12px] font-semibold inline-flex items-center bg-blush text-blush-text">
            question waiting
          </span>
        )}
        <span className="flex flex-wrap gap-1.5">
          {counts.map(([k, n]) => (
            <span
              key={k}
              className={`h-6 px-2 rounded-md text-[12px] font-semibold inline-flex items-center ${STATE[k].tone}`}
            >
              {n} {STATE[k].label.toLowerCase()}
            </span>
          ))}
        </span>
      </button>
      {open && (
        <div className="basis-full border-t border-line grid gap-px bg-line lg:grid-cols-3">
          <section className="bg-card min-w-0">
            <h4 className="m-0 px-4 pt-3 pb-1 text-[13px] font-semibold text-ink2">
              Courses · {s.courses.length}
            </h4>
            {s.courses.length === 0 ? (
              <p className="m-0 px-4 pb-3 text-[13px] text-ink2">No course yet.</p>
            ) : (
              <ul className="m-0 p-0 list-none divide-y divide-line">
                {s.courses.map((c) => (
                  <li key={c.courseId} className="px-4 py-3 flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span
                        className={`h-6 px-2 rounded-md text-[12px] font-semibold inline-flex items-center ${STATE[c.state].tone}`}
                      >
                        {STATE[c.state].label}
                      </span>
                      <strong className="mr-auto">{c.title}</strong>
                      <span className="text-[13px] text-ink2">
                        {c.source === 'purchase' ? 'Bought' : 'Given free'} {day(c.grantedAt)} · ends{' '}
                        {c.expiresAt ? day(c.expiresAt) : 'never'}
                      </span>
                    </div>
                    {c.note && (
                      <p className="m-0 text-[13px] text-ink2">
                        Last reason ({day(c.noteAt)}): “{c.note}”
                      </p>
                    )}
                    {c.state !== 'disputed' && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAct({ course: c, action: 'renew' })}
                        >
                          Renew
                        </Button>
                        {c.state === 'active' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAct({ course: c, action: 'end' })}
                          >
                            End now
                          </Button>
                        )}
                        {c.state === 'blocked' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAct({ course: c, action: 'unblock' })}
                          >
                            Unblock
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAct({ course: c, action: 'block' })}
                          >
                            Block
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="bg-card min-w-0">
            <h4 className="m-0 px-4 pt-3 pb-1 text-[13px] font-semibold text-ink2">
              Uploads · {s.uploads.length}
            </h4>
            {s.uploads.length === 0 ? (
              <p className="m-0 px-4 pb-3 text-[13px] text-ink2">Hasn't shared notes.</p>
            ) : (
              <ul className="m-0 p-0 list-none divide-y divide-line">
                {s.uploads.map((u) => (
                  <li key={u.id} className="px-4 py-2.5 flex flex-col gap-0.5">
                    <span className="text-[14px] font-semibold [overflow-wrap:anywhere]">{u.title}</span>
                    <span className="text-[12px] text-ink2">
                      {STEP[u.pipeline.step]} · {day(u.createdAt)}
                      {u.pipeline.filed ? ` · in ${u.pipeline.filed.courseTitle}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {s.uploads.length > 0 && (
              <button
                type="button"
                onClick={() => go('contributions')}
                className="mx-4 mb-3 text-[13px] font-semibold text-teal-text bg-transparent border-0 p-0 cursor-pointer underline underline-offset-4"
              >
                Open uploads
              </button>
            )}
          </section>
          <section className="bg-card min-w-0">
            <h4 className="m-0 px-4 pt-3 pb-1 text-[13px] font-semibold text-ink2">
              Questions · {s.questions.length}
            </h4>
            {s.questions.length === 0 ? (
              <p className="m-0 px-4 pb-3 text-[13px] text-ink2">No questions asked.</p>
            ) : (
              <ul className="m-0 p-0 list-none divide-y divide-line">
                {s.questions.map((q) => (
                  <li key={q.id} className="px-4 py-2.5 flex flex-col gap-0.5">
                    <span className="text-[14px] font-semibold [overflow-wrap:anywhere]">{q.subject}</span>
                    <span className={`text-[12px] ${q.status === 'open' ? 'text-blush-text' : 'text-ink2'}`}>
                      {q.status === 'open'
                        ? 'Waiting for you'
                        : q.status === 'answered'
                          ? 'Answered'
                          : 'Closed'}{' '}
                      · {day(q.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {s.questions.length > 0 && (
              <button
                type="button"
                onClick={() => go('queries')}
                className="mx-4 mb-3 text-[13px] font-semibold text-teal-text bg-transparent border-0 p-0 cursor-pointer underline underline-offset-4"
              >
                Open queries
              </button>
            )}
          </section>
        </div>
      )}
      {act && (
        <ChangeSheet
          who={s.fullName ?? s.email}
          courseId={act.course.courseId}
          courseTitle={act.course.title}
          userIds={[s.userId]}
          action={act.action}
          onClose={() => setAct(null)}
        />
      )}
    </li>
  );
}

/**
 * Every student with a course: filter by batch, branch, course and state; open one to see what
 * they bought or were given, when it started and ends, and renew, end, block or unblock it with
 * a reason they are emailed.
 */
export function StudentsPanel({ go }: { go: (section: string) => void }) {
  const students = useQuery({ queryKey: ['admin', 'students'], queryFn: api.adminStudents });
  // The same lists the Uploads and Queries screens use, so everything stays in step.
  const uploads = useQuery({
    queryKey: ['admin', 'contributions', 'all'],
    queryFn: () => api.adminContributions('all'),
  });
  const questions = useQuery({
    queryKey: ['admin', 'support', 'all'],
    queryFn: () => api.adminSupport('all'),
  });
  const academic = useQuery({ queryKey: ['admin', 'academic'], queryFn: api.adminAcademic });
  const [kind, setKind] = useState('');
  const [giving, setGiving] = useState(false);
  const [q, setQ] = useState('');
  const [batch, setBatch] = useState('');
  const [branch, setBranch] = useState('');
  const [course, setCourse] = useState('');
  const [state, setState] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<Action | null>(null);

  if (students.isPending) return <Skeleton className="h-96" />;
  if (students.isError && !students.data)
    return (
      <ErrorState
        title="Students didn't load."
        message={friendly(students.error)}
        onRetry={() => students.refetch()}
      />
    );
  const all = people(students.data, uploads.data?.items ?? [], questions.data?.items ?? []).sort((a, b) =>
    (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email),
  );
  const branchNames = new Map((academic.data?.branches ?? []).map((b) => [b.code.toUpperCase(), b.name]));
  const tiles: [string, number][] = [
    ['People', all.length],
    ['With a course now', all.filter((p) => p.courses.some((c) => c.state === 'active')).length],
    ['Shared notes', all.filter((p) => p.uploads.length > 0).length],
    ['Questions waiting', all.filter((p) => p.questions.some((q) => q.status === 'open')).length],
  ];
  const batches = [...new Set(all.map((s) => s.batchYear).filter((y): y is number => !!y))].sort(
    (a, b) => b - a,
  );
  const branches = [...new Set(all.map((s) => s.branchCode).filter((b): b is string => !!b))].sort();
  const courses = [
    ...new Map(all.flatMap((s) => s.courses.map((c) => [c.courseId, c.title] as const))).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const courseTitle = courses.find(([id]) => id === course)?.[1] ?? '';
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = all.filter(
    (s) =>
      words.every((w) => `${s.email} ${s.fullName ?? ''}`.toLowerCase().includes(w)) &&
      (!batch || s.batchYear === Number(batch)) &&
      (!branch || s.branchCode === branch) &&
      (!course || s.courses.some((c) => c.courseId === course)) &&
      (!state || s.courses.some((c) => c.state === state && (!course || c.courseId === course))) &&
      (!kind ||
        (kind === 'buyers' && s.courses.length > 0) ||
        (kind === 'contributors' && s.uploads.length > 0) ||
        (kind === 'askers' && s.questions.length > 0)),
  );
  const select = 'h-10 w-full min-w-0 px-3 rounded-xl bg-surface border-[1.5px] border-line text-[14px]';

  return (
    <Panel
      title="Students"
      aside={
        !giving && (
          <Button size="sm" variant="brand" onClick={() => setGiving(true)}>
            Give access
          </Button>
        )
      }
    >
      <p className="m-0 text-sm text-ink2 max-w-[760px]">
        Everyone who bought, shared notes or asked a question. Open a person to see and change everything.
      </p>
      <dl className="m-0 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(([label, n]) => (
          <div key={label} className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] px-4 py-3">
            <dt className="text-[12px] text-ink2">{label}</dt>
            <dd className="m-0 mt-1 font-display font-extrabold text-[28px] leading-none tabular-nums">
              {n}
            </dd>
          </div>
        ))}
      </dl>
      {giving && <GiveAccessCard onClose={() => setGiving(false)} />}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <input
          type="search"
          aria-label="Find a student"
          placeholder="Name or email"
          className={`${input} h-10 w-full text-sm col-span-2 md:col-span-3 xl:col-span-1`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select aria-label="Who" className={select} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Everyone</option>
          <option value="buyers">Has a course</option>
          <option value="contributors">Shared notes</option>
          <option value="askers">Asked a question</option>
        </select>
        <select
          aria-label="Batch"
          className={select}
          value={batch}
          onChange={(e) => setBatch(e.target.value)}
        >
          <option value="">Every batch</option>
          {batches.map((y) => (
            <option key={y} value={y}>
              {y} batch
            </option>
          ))}
        </select>
        <select
          aria-label="Branch"
          className={select}
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        >
          <option value="">Every branch</option>
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
              {branchNames.get(b) ? ` · ${branchNames.get(b)}` : ''}
            </option>
          ))}
        </select>
        <select
          aria-label="Course"
          className={select}
          value={course}
          onChange={(e) => {
            setCourse(e.target.value);
            setPicked(new Set());
          }}
        >
          <option value="">Every course</option>
          {courses.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
        <select
          aria-label="State"
          className={select}
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="">Any state</option>
          <option value="active">Active</option>
          <option value="ended">Ended</option>
          <option value="blocked">Blocked</option>
          <option value="disputed">Bank dispute</option>
        </select>
      </div>
      <p className="m-0 font-mono text-xs text-ink2">
        {list.length} {list.length === 1 ? 'person' : 'people'}
        {list.length !== all.length ? ` of ${all.length}` : ''}
        {course ? ' · tick students to change many at once' : ' · choose a course to change many at once'}
      </p>
      {course && picked.size > 0 && (
        <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] md:bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-[18px] bg-brand p-3 text-white shadow-lg">
          <span className="mr-auto text-sm font-semibold">
            {plural(picked.size, 'student')} · {courseTitle}
          </span>
          {(['renew', 'end', 'block', 'unblock'] as const).map((a) => (
            <Button key={a} size="sm" variant="outline-light" onClick={() => setBulk(a)}>
              {a === 'renew' ? 'Renew' : a === 'end' ? 'End now' : a === 'block' ? 'Block' : 'Unblock'}
            </Button>
          ))}
          <Button size="sm" variant="outline-light" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
        </div>
      )}
      {bulk && course && (
        <ChangeSheet
          who={plural(picked.size, 'student')}
          courseId={course}
          courseTitle={courseTitle}
          userIds={[...picked]}
          action={bulk}
          onClose={() => {
            setBulk(null);
            setPicked(new Set());
          }}
        />
      )}
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {list.map((s) => (
          <StudentRow
            key={s.userId}
            s={s}
            branchName={s.branchCode ? (branchNames.get(s.branchCode) ?? null) : null}
            go={go}
            open={open === s.userId}
            onToggle={() => setOpen(open === s.userId ? null : s.userId)}
            {...(course
              ? {
                  pick: {
                    checked: picked.has(s.userId),
                    onChange: () =>
                      setPicked((p) => {
                        const n = new Set(p);
                        n.has(s.userId) ? n.delete(s.userId) : n.add(s.userId);
                        return n;
                      }),
                  },
                }
              : {})}
          />
        ))}
        {list.length === 0 && (
          <li className="text-ink2">{all.length ? 'No student matches.' : 'Nobody has a course yet.'}</li>
        )}
      </ul>
    </Panel>
  );
}
