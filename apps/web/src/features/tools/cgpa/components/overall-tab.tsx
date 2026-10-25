import { Button } from '../../../../shared/ui/button';
import { Cross } from '../../../../shared/ui/icons';
import { newId, useToolState } from '../../core/storage';
import { ResultPanel, ToolCard, field, toNumber } from '../../core/ui';
import { type SemesterRow, fmt, overallCgpa } from '../domain';

const blank = (n: number): SemesterRow => ({ id: newId(), label: `Semester ${n}`, gpa: '', credits: '' });

/** Overall CGPA from each semester's GPA and credits. */
export function OverallTab() {
  const [rows, setRows] = useToolState<SemesterRow[]>('cgpa_semesters', [blank(1), blank(2)]);
  const result = overallCgpa(rows);
  const update = (id: string, patch: Partial<SemesterRow>) =>
    setRows((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
      <ToolCard title="Semester by semester">
        <ol className="m-0 p-0 list-none flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="grid grid-cols-[1fr_1fr_36px] sm:grid-cols-[1fr_120px_120px_36px] gap-2.5 items-center border-b border-dashed border-line pb-3 last:border-b-0"
            >
              <span className="col-span-3 sm:col-span-1 font-semibold">{row.label}</span>
              <input
                className={field}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                max={10}
                placeholder="GPA"
                aria-label={`${row.label} GPA`}
                value={row.gpa}
                onChange={(e) => update(row.id, { gpa: toNumber(e.target.value) })}
              />
              <input
                className={field}
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="Credits"
                aria-label={`${row.label} credits`}
                value={row.credits}
                onChange={(e) => update(row.id, { credits: toNumber(e.target.value) })}
              />
              <button
                type="button"
                aria-label={`Remove ${row.label}`}
                onClick={() => setRows((xs) => xs.filter((x) => x.id !== row.id))}
                className="size-9 grid place-items-center rounded-full text-ink2 hover:bg-sunk"
              >
                <Cross size={16} />
              </button>
            </li>
          ))}
        </ol>
        <Button
          variant="outline"
          className="self-start"
          onClick={() => setRows((xs) => [...xs, blank(xs.length + 1)])}
        >
          Add a semester
        </Button>
      </ToolCard>
      <div className="lg:sticky lg:top-6">
        <ResultPanel label="OVERALL CGPA" value={result ? fmt(result.cgpa) : '–.––'}>
          <span className="text-[15px] text-on-brand2">
            {result ? `${result.credits} credits so far` : 'Add each semester’s GPA and credits.'}
          </span>
        </ResultPanel>
      </div>
    </div>
  );
}
