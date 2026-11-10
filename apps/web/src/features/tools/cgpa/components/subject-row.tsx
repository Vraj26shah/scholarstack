import { Cross } from '../../../../shared/ui/icons';
import { field, toNumber } from '../../core/ui';
import { GRADES, GRADE_POINTS, type Grade, type SubjectRow } from '../domain';

/** One subject: name, credits, and the grade as tap-able letters. */
export function SubjectRowEditor({
  row,
  index,
  onChange,
  onRemove,
}: {
  row: SubjectRow;
  index: number;
  onChange: (patch: Partial<SubjectRow>) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  return (
    <li className="rounded-2xl border border-line bg-surface p-3 sm:p-3.5 flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[13px] text-ink2 w-6 shrink-0">{String(n).padStart(2, '0')}</span>
        <input
          className={`${field} flex-1 min-w-0`}
          placeholder="Subject (optional)"
          aria-label={`Subject ${n} name`}
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <button
          type="button"
          aria-label={`Remove subject ${n}`}
          onClick={onRemove}
          className="size-10 shrink-0 grid place-items-center rounded-full text-ink2 hover:bg-sunk"
        >
          <Cross size={16} />
        </button>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:pl-[34px]">
        <label className="flex items-center gap-2.5 shrink-0">
          <span className="text-[13px] font-semibold text-ink2 sm:hidden">Credits</span>
          <span className="w-20 sm:w-24">
            <input
              className={`${field} text-center`}
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              placeholder="e.g. 4"
              aria-label={`Subject ${n} credits`}
              value={row.credits}
              onChange={(e) => onChange({ credits: toNumber(e.target.value) })}
            />
          </span>
        </label>
        {/* Seven equal keys that always fit one row, phone or desktop, each with its points. */}
        <div
          role="group"
          aria-label={`Subject ${n} grade`}
          className="grid grid-cols-7 gap-1 flex-1 min-w-0 rounded-xl bg-sunk p-1"
        >
          {GRADES.map((g) => {
            const on = row.grade === g;
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                aria-label={`Grade ${g}, ${GRADE_POINTS[g]} points`}
                onClick={() => onChange({ grade: on ? '' : (g as Grade) })}
                className={`h-11 min-w-0 rounded-lg flex flex-col items-center justify-center leading-none ${
                  on ? 'bg-brand text-white shadow-sm' : 'text-ink hover:bg-card'
                }`}
              >
                <span className="font-mono text-[15px] font-semibold">{g}</span>
                <span className={`mt-0.5 text-[10px] tabular-nums ${on ? 'text-on-brand2' : 'text-ink2'}`}>
                  {GRADE_POINTS[g]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </li>
  );
}
