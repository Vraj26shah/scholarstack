import type { AcademicBranchDto, AcademicDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/feedback';
import { Field, Panel, U, input, plural } from './ui';

const KEY = ['admin', 'academic'] as const;

function useAcademicMutation<T>(fn: (v: T) => Promise<AcademicDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      void qc.invalidateQueries({ queryKey: ['admin', 'courses'] });
      void qc.invalidateQueries({ queryKey: ['catalogue'] });
    },
  });
}

function Years({ data }: { data: AcademicDto }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const add = useAcademicMutation((y: number) => api.adminAddYear(y));
  const visible = useAcademicMutation(({ y, v }: { y: number; v: boolean }) => api.adminSetYearVisible(y, v));
  const remove = useAcademicMutation((y: number) => api.adminDeleteYear(y));
  const error = add.error ?? visible.error ?? remove.error;
  return (
    <section className="flex flex-col gap-4">
      <h3 className="m-0 font-display font-extrabold text-[24px] tracking-[-0.03em]">Batch years</h3>
      <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
        {data.years.map((y) => (
          <li key={y.year} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span
              className={`font-display font-extrabold text-[26px] leading-none tabular-nums ${y.visible ? '' : 'text-ink2'}`}
            >
              {y.year}
            </span>
            <span className="text-[13px] text-ink2 flex-1 min-w-[140px]">
              {plural(y.courses, 'course')} · {y.live} on sale{y.visible ? '' : ' · hidden from students'}
            </span>
            <Button size="sm" variant="outline" onClick={() => visible.mutate({ y: y.year, v: !y.visible })}>
              {y.visible ? 'Hide' : 'Show'}
            </Button>
            {y.courses === 0 && (
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(y.year)}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="New year" className="w-32">
          <input
            className={input}
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </Field>
        <Button
          variant="outline"
          onClick={() => add.mutate(Number(year))}
          disabled={add.isPending || year.length !== 4}
        >
          Add year
        </Button>
      </div>
      {error && <p className="m-0 text-sm text-blush-text">{friendly(error)}</p>}
    </section>
  );
}

function MoveYear({ data }: { data: AcademicDto }) {
  const years = data.years.map((y) => y.year);
  const [from, setFrom] = useState(
    String(years.find((y) => data.years.find((x) => x.year === y)!.courses > 0) ?? ''),
  );
  const [to, setTo] = useState(String((years[0] ?? new Date().getFullYear()) + 1));
  const [branch, setBranch] = useState('');
  const [sure, setSure] = useState(false);
  const move = useAcademicMutation((v: { fromYear: number; toYear: number; branchSlug?: string }) =>
    api.adminMoveYear(v),
  );
  const count = data.years.find((y) => y.year === Number(from))?.courses ?? 0;
  return (
    <section className="flex flex-col gap-4">
      <h3 className="m-0 font-display font-extrabold text-[24px] tracking-[-0.03em]">
        Move a year's courses
      </h3>
      <p className="m-0 text-[14px] text-ink2">
        Re-file courses under another batch year <U>in one step</U>; their files, buyers and prices stay as
        they are.
      </p>
      <div className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] items-end">
        <Field label="From">
          <select className={input} value={from} onChange={(e) => setFrom(e.target.value)}>
            {data.years.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year} ({y.courses})
              </option>
            ))}
          </select>
        </Field>
        <Field label="To (new years are added)">
          <input
            className={input}
            inputMode="numeric"
            value={to}
            onChange={(e) => setTo(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </Field>
        <Field label="Branch">
          <select className={input} value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>
            {data.branches
              .filter((b) => b.isActive)
              .map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.code} · {b.name}
                </option>
              ))}
          </select>
        </Field>
        {sure ? (
          <Button
            variant="ink"
            disabled={move.isPending}
            onClick={() =>
              move.mutate(
                { fromYear: Number(from), toYear: Number(to), branchSlug: branch || undefined },
                { onSettled: () => setSure(false) },
              )
            }
          >
            {move.isPending ? 'Moving…' : `Yes, move ${branch ? 'them' : plural(count, 'course')}`}
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => setSure(true)}
            disabled={!from || to.length !== 4 || from === to}
          >
            Move
          </Button>
        )}
      </div>
      {move.isSuccess && (
        <p className="m-0 text-[14px] text-teal-text" role="status">
          Moved {plural((move.data as AcademicDto & { moved: number }).moved, 'course')} to {to}.
        </p>
      )}
      {move.isError && <p className="m-0 text-sm text-blush-text">{friendly(move.error)}</p>}
    </section>
  );
}

function BranchRow({ b }: { b: AcademicBranchDto | null }) {
  const blank = { code: '', name: '', shortName: '', isCommon: false, isActive: true, sort: 100 };
  const [form, setForm] = useState(
    b
      ? {
          code: b.code,
          name: b.name,
          shortName: b.shortName,
          isCommon: b.isCommon,
          isActive: b.isActive,
          sort: b.sort,
        }
      : blank,
  );
  const save = useAcademicMutation(() => api.adminSaveBranch({ ...form, slug: b?.slug }));
  const dirty =
    !b ||
    form.code !== b.code ||
    form.name !== b.name ||
    form.shortName !== b.shortName ||
    form.isCommon !== b.isCommon ||
    form.isActive !== b.isActive;
  return (
    <li
      className={`grid gap-3 px-4 py-3 md:grid-cols-[110px_minmax(0,2fr)_minmax(0,1fr)_auto_auto_auto] md:items-end ${b && !b.isActive ? 'opacity-70' : ''}`}
    >
      <Field label="Code">
        <input
          className={`${input} uppercase`}
          value={form.code}
          onChange={(e) =>
            setForm({
              ...form,
              code: e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, 12),
            })
          }
          placeholder="AIML"
        />
      </Field>
      <Field label="Name">
        <input
          className={input}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="B.Tech AI & ML"
        />
      </Field>
      <Field label="Short name">
        <input
          className={input}
          value={form.shortName}
          onChange={(e) => setForm({ ...form, shortName: e.target.value })}
          placeholder="AI & ML"
        />
      </Field>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink2 h-11">
        <input
          type="checkbox"
          className="size-4 accent-teal"
          checked={form.isCommon}
          onChange={(e) => setForm({ ...form, isCommon: e.target.checked })}
        />
        Common to all
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink2 h-11">
        <input
          type="checkbox"
          className="size-4 accent-teal"
          checked={form.isActive}
          onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
        />
        Shown
      </label>
      <div className="flex items-center gap-2 h-11">
        <Button
          size="sm"
          onClick={() => save.mutate(undefined, { onSuccess: () => !b && setForm(blank) })}
          disabled={!dirty || save.isPending || form.code.length < 2 || form.name.trim().length < 2}
        >
          {b ? 'Save' : 'Add'}
        </Button>
        {b && <span className="text-[12px] text-ink2 whitespace-nowrap">{plural(b.courses, 'course')}</span>}
      </div>
      {save.isError && <p className="m-0 text-sm text-blush-text md:col-span-6">{friendly(save.error)}</p>}
    </li>
  );
}

/** Years and branches, edited here instead of in the database. */
export function YearsBranchesPanel() {
  const q = useQuery({ queryKey: KEY, queryFn: api.adminAcademic });
  if (q.isError) return <p className="m-0 text-blush-text">{friendly(q.error)}</p>;
  if (!q.data) return <Skeleton className="h-64 rounded-2xl" />;
  const data = q.data;
  return (
    <Panel title="Years & branches">
      <div className="grid gap-10 lg:grid-cols-2">
        <Years data={data} />
        <MoveYear data={data} />
      </div>
      <section className="flex flex-col gap-4 pt-4">
        <h3 className="m-0 font-display font-extrabold text-[24px] tracking-[-0.03em]">Branches</h3>
        <p className="m-0 text-[14px] text-ink2">
          Untick <U>Shown</U> to retire a branch without losing its courses; <U>Common to all</U> lists a
          branch's courses under every branch (first-year subjects).
        </p>
        <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
          {data.branches.map((b) => (
            <BranchRow key={`${b.slug}-${b.code}-${b.name}-${b.isActive}-${b.isCommon}`} b={b} />
          ))}
          <BranchRow key={`new-${data.branches.length}`} b={null} />
        </ul>
      </section>
    </Panel>
  );
}
