import type { StorageMovePlanDto, StorageTreeDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Sheet } from '../../shared/ui/feedback';
import { pickUpChanges } from './r2-file-sync';
import { Field, input, plural } from './ui';

const KEY = ['admin', 'storage-tree'] as const;

/** Waits a moment after typing before asking for a fresh plan. */
function useSettled<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  const key = JSON.stringify(value);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for value
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return v;
}

/** The plan as old → new lines, with which site file each one is and where it ends up. */
function PlanList({ plan }: { plan: StorageMovePlanDto }) {
  const shown = plan.moves.slice(0, 60);
  return (
    <div className="flex flex-col gap-2">
      {plan.blocked && <p className="m-0 text-[14px] font-semibold text-blush-text">{plan.blocked}</p>}
      <ul className="m-0 p-0 list-none flex flex-col gap-1.5 max-h-72 overflow-y-auto rounded-xl bg-sunk p-3 font-mono text-[12px]">
        {shown.map((m) => (
          <li key={m.from} className="[overflow-wrap:anywhere]">
            <span className="text-ink2 line-through decoration-ink2/40">{m.from}</span>
            <br />→ <span className="text-ink">{m.to}</span>
            {m.file && m.file.fromCourse !== m.file.toCourse && (
              <span className="text-teal-text">
                {' '}
                · moves from {m.file.fromCourse} to {m.file.toCourse}
              </span>
            )}
            {!m.file && <span className="text-ink2"> · not on the site</span>}
          </li>
        ))}
        {plan.moves.length > shown.length && (
          <li className="text-ink2">…and {plan.moves.length - shown.length} more</li>
        )}
      </ul>
      <p className="m-0 text-[13px] text-ink2">
        Pages are kept: nothing is re-made, students keep reading, and every link still works.
      </p>
    </div>
  );
}

function Done({
  plan,
  onClose,
  hideButton = false,
}: { plan: StorageMovePlanDto; onClose: () => void; hideButton?: boolean }) {
  const d = plan.done!;
  return (
    <>
      <p className="m-0 text-[15px]">
        Moved {plural(d.moved, 'file')}
        {d.files ? `, ${plural(d.files, 'site file')} updated` : ''}.
        {d.coursesUnpublished
          ? ` ${plural(d.coursesUnpublished, 'course')} had nothing left to read and came off sale.`
          : ''}
        {d.leftovers
          ? ` ${plural(d.leftovers, 'old copy')} couldn't be removed; they show under Unused.`
          : ''}
      </p>
      {!hideButton && <Button onClick={onClose}>Done</Button>}
    </>
  );
}

/** After a change, everything that shows files or courses is fetched again. */
function useAfter() {
  const qc = useQueryClient();
  return () => {
    for (const key of [KEY, ['admin-courses'], ['admin', 'courses'], ['catalogue'], ['admin-today']])
      void qc.invalidateQueries({ queryKey: key });
  };
}

/** What "Move" did, plus the notes it added to the course on the way. */
interface MoveOutcome {
  plan: StorageMovePlanDto;
  added: { files: number; queued: number; failed: number; course: string } | null;
}

/**
 * Move the ticked files and folders into a unit of any course (or a new unit). Notes that weren't
 * on the site yet are added to that course straight after the move and their pages start, so
 * "put this folder in that course" is one step, not move-then-pick-up.
 */
export function MoveSheet({
  paths,
  data,
  onClose,
  to,
  onMoved,
}: {
  paths: string[];
  data: StorageTreeDto;
  onClose: () => void;
  /** A folder they were dropped on, to start there. */
  to?: string;
  /** Called with the folder things moved into (to follow them there). */
  onMoved?: (toFolder: string) => void;
}) {
  const refresh = useAfter();
  const courses = useMemo(
    () =>
      [...data.courses].sort(
        (a, b) =>
          (b.batchYear ?? 0) - (a.batchYear ?? 0) ||
          a.title.localeCompare(b.title, undefined, { numeric: true }),
      ),
    [data.courses],
  );
  const dropCourse = to ? courses.find((c) => to.startsWith(c.r2Prefix)) : undefined;
  const fromCourse = courses.find((c) => paths[0]?.startsWith(c.r2Prefix));
  // Start where they were dropped, else in the course of the first ticked item.
  const startCourse = dropCourse?.id ?? fromCourse?.id ?? '';
  const [courseId, setCourseId] = useState(startCourse);
  const [find, setFind] = useState('');
  const [unit, setUnit] = useState(
    dropCourse && to ? to.slice(dropCourse.r2Prefix.length).replace(/\/$/, '') : '',
  );
  const course = courses.find((c) => c.id === courseId);
  const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const listed = courses.filter((c) => {
    const hay = `${c.title} ${c.courseCode ?? ''} ${c.batchYear ?? ''}`.toLowerCase();
    return c.id === courseId || words.every((w) => hay.includes(w));
  });
  const units = useMemo(() => {
    if (!course) return [];
    const set = new Set<string>();
    for (const e of data.entries) {
      if (!e.key.startsWith(course.r2Prefix)) continue;
      const parts = e.key.slice(course.r2Prefix.length).split('/');
      if (parts.length > 1) set.add(parts[0]!);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [course, data.entries]);
  const toFolder = course ? `${course.r2Prefix}${unit.trim() ? `${unit.trim()}/` : ''}` : '';
  const ask = useSettled({ paths, toFolder });
  const plan = useQuery({
    queryKey: ['admin', 'storage-move', ask],
    queryFn: () => api.adminStorageMove({ ...ask, dryRun: true }),
    enabled: !!ask.toFolder,
    placeholderData: (previous) => previous,
  });
  const [step, setStep] = useState<string | null>(null);
  const go = useMutation({
    mutationFn: async (): Promise<MoveOutcome> => {
      setStep('Moving the files…');
      const moved = await api.adminStorageMove({ paths, toFolder, dryRun: false });
      const newNotes = moved.moves.filter((m) => !m.file).length;
      if (!newNotes || !course) return { plan: moved, added: null };
      // They weren't on the site: add them to the course now and start their pages.
      setStep(`Adding ${plural(newNotes, 'file')} to ${course.title}…`);
      try {
        const picked = await pickUpChanges([toFolder]);
        return {
          plan: moved,
          added: {
            files: picked.summary.filesAdded,
            queued: picked.summary.conversionQueued,
            failed: picked.outcomes.filter((o) => o.status === 'failed').length,
            course: course.title,
          },
        };
      } catch {
        return { plan: moved, added: { files: 0, queued: 0, failed: newNotes, course: course.title } };
      }
    },
    onSettled: () => {
      setStep(null);
      refresh();
    },
    onSuccess: () => onMoved?.(toFolder),
  });
  const notOnSite = plan.data?.moves.filter((m) => !m.file).length ?? 0;
  const intoCourse = !fromCourse && notOnSite > 0;
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        go.isSuccess
          ? intoCourse
            ? 'Added to the course'
            : 'Moved'
          : fromCourse
            ? `Move ${plural(paths.length, 'item')}`
            : `Add ${plural(paths.length, 'item')} to a course`
      }
    >
      {go.isSuccess && go.data.plan.done ? (
        <>
          <Done plan={go.data.plan} onClose={onClose} hideButton={!!go.data.added} />
          {go.data.added && (
            <>
              <p className="m-0 text-[15px]">
                {go.data.added.files
                  ? `${plural(go.data.added.files, 'file')} added to ${go.data.added.course}${
                      go.data.added.queued
                        ? `; pages are being made for ${plural(go.data.added.queued, 'file')}`
                        : ''
                    }.`
                  : `Nothing new was added to ${go.data.added.course}.`}
                {go.data.added.failed > 0 && (
                  <span className="text-blush-text">
                    {' '}
                    {plural(go.data.added.failed, 'file')} couldn't be added yet: open the course folder and
                    press “Pick up changes”.
                  </span>
                )}
              </p>
              <Button onClick={onClose}>Done</Button>
            </>
          )}
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5 text-sm sm:col-span-2">
              <span className="font-semibold text-ink2">Into course</span>
              <input
                type="search"
                className={input}
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder="Find a course by name, code or year…"
                aria-label="Find a course"
              />
              <select
                className={`${input} mt-2`}
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                aria-label="Course"
                size={Math.min(6, Math.max(3, listed.length + 1))}
              >
                <option value="" disabled>
                  {listed.length ? 'Pick a course' : 'No course matches'}
                </option>
                {listed.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {c.courseCode ? ` · ${c.courseCode}` : ''}
                    {c.batchYear ? ` · ${c.batchYear}` : ''}
                    {c.status !== 'live' ? ` (${c.status})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <Field label="Unit folder (pick or type a new one)" className="sm:col-span-2">
              <input
                className={input}
                list="move-units"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder={
                  paths.length === 1 && paths[0]!.endsWith('/')
                    ? 'Empty: the folder itself becomes a unit'
                    : 'Unit 3 - Normalisation'
                }
              />
              <datalist id="move-units">
                {units.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </Field>
          </div>
          {!course && <p className="m-0 text-[13px] text-ink2">Pick the course these notes belong to.</p>}
          {plan.isError && <p className="m-0 text-sm text-blush-text">{friendly(plan.error)}</p>}
          {course && plan.data && <PlanList plan={plan.data} />}
          {course && notOnSite > 0 && !plan.data?.blocked && (
            <p className="m-0 text-[13px] text-teal-text">
              {plural(notOnSite, 'file')} {notOnSite === 1 ? "isn't" : "aren't"} on the site yet:{' '}
              {notOnSite === 1 ? 'it is' : 'they are'} added to {course.title} after the move and pages start
              (the course stays as it is until you publish).
            </p>
          )}
          {go.isError && <p className="m-0 text-sm text-blush-text">{friendly(go.error)}</p>}
          {step && (
            <p role="status" className="m-0 text-sm text-ink2">
              {step}
            </p>
          )}
          <div className="flex flex-wrap gap-2.5">
            <Button
              onClick={() => go.mutate()}
              disabled={!course || !plan.data || !!plan.data.blocked || plan.isFetching || go.isPending}
            >
              {go.isPending
                ? 'Working…'
                : intoCourse
                  ? `Add ${plan.data ? plural(plan.data.moves.length, 'file') : ''} to the course`
                  : `Move ${plan.data ? plural(plan.data.moves.length, 'file') : ''}`}
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

/** Rename one file (its type is kept) or one folder, where it is. */
export function RenameSheet({ path, onClose }: { path: string; onClose: () => void }) {
  const refresh = useAfter();
  const isFolder = path.endsWith('/');
  const current = (isFolder ? path.slice(0, -1) : path).split('/').pop() ?? '';
  const [name, setName] = useState(isFolder ? current : current.replace(/\.[^.]+$/, ''));
  const ask = useSettled({ path, newName: name.trim() });
  const plan = useQuery({
    queryKey: ['admin', 'storage-rename', ask],
    queryFn: () => api.adminStorageRename({ ...ask, dryRun: true }),
    enabled: ask.newName.length > 0 && ask.newName !== current,
    placeholderData: (previous) => previous,
  });
  const go = useMutation({
    mutationFn: () => api.adminStorageRename({ path, newName: name.trim(), dryRun: false }),
    onSuccess: refresh,
  });
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={go.isSuccess ? 'Renamed' : `Rename ${isFolder ? 'folder' : 'file'}`}
    >
      {go.isSuccess && go.data.done ? (
        <Done plan={go.data} onClose={onClose} />
      ) : (
        <>
          <p className="m-0 font-mono text-[12px] text-ink2 break-all">{path}</p>
          <Field label="New name">
            <input className={input} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
          {isFolder && (
            <p className="m-0 text-[13px] text-ink2">
              A unit folder's name is what students see: “Unit 3 - Normalisation” shows as Unit 3,
              Normalisation.
            </p>
          )}
          {plan.isError && <p className="m-0 text-sm text-blush-text">{friendly(plan.error)}</p>}
          {plan.data && <PlanList plan={plan.data} />}
          {go.isError && <p className="m-0 text-sm text-blush-text">{friendly(go.error)}</p>}
          <div className="flex flex-wrap gap-2.5">
            <Button
              onClick={() => go.mutate()}
              disabled={!plan.data || !!plan.data.blocked || plan.isFetching || go.isPending}
            >
              {go.isPending ? 'Renaming…' : 'Rename'}
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
