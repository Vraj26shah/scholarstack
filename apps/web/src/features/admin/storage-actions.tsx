import type { StorageMovePlanDto, StorageTreeDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Sheet } from '../../shared/ui/feedback';
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

function Done({ plan, onClose }: { plan: StorageMovePlanDto; onClose: () => void }) {
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
      <Button onClick={onClose}>Done</Button>
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

/** Move the ticked files and folders into a unit of any course (or a new unit). */
export function MoveSheet({
  paths,
  data,
  onClose,
}: {
  paths: string[];
  data: StorageTreeDto;
  onClose: () => void;
}) {
  const refresh = useAfter();
  const courses = [...data.courses].sort((a, b) => a.title.localeCompare(b.title));
  // Start in the course of the first ticked item.
  const startCourse = courses.find((c) => paths[0]?.startsWith(c.r2Prefix))?.id ?? courses[0]?.id ?? '';
  const [courseId, setCourseId] = useState(startCourse);
  const [unit, setUnit] = useState('');
  const course = courses.find((c) => c.id === courseId);
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
  const go = useMutation({
    mutationFn: () => api.adminStorageMove({ paths, toFolder, dryRun: false }),
    onSuccess: refresh,
  });
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={go.isSuccess ? 'Moved' : `Move ${plural(paths.length, 'item')}`}
    >
      {go.isSuccess && go.data.done ? (
        <Done plan={go.data} onClose={onClose} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Into course">
              <select className={input} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {c.status !== 'live' ? ` (${c.status})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Unit folder (pick or type a new one)">
              <input
                className={input}
                list="move-units"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="Unit 3 - Normalisation"
              />
              <datalist id="move-units">
                {units.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </Field>
          </div>
          {plan.isError && <p className="m-0 text-sm text-blush-text">{friendly(plan.error)}</p>}
          {plan.data && <PlanList plan={plan.data} />}
          {go.isError && <p className="m-0 text-sm text-blush-text">{friendly(go.error)}</p>}
          <div className="flex flex-wrap gap-2.5">
            <Button
              onClick={() => go.mutate()}
              disabled={!plan.data || !!plan.data.blocked || plan.isFetching || go.isPending}
            >
              {go.isPending ? 'Moving…' : `Move ${plan.data ? plural(plan.data.moves.length, 'file') : ''}`}
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
