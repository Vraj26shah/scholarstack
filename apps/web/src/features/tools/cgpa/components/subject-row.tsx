import { Cross } from '../../../../shared/ui/icons';
import { field, toNumber } from '../../core/ui';
import { GRADES, type Grade, type SubjectRow } from '../domain';

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
    <li className="grid grid-cols-[28px_1fr_auto] sm:grid-cols-[28px_1fr_96px_auto_36px] gap-2.5 items-center border-b border-dashed border-line pb-3 last:border-b-0">
      <span className="font-mono text-[13px] text-ink2">{String(n).padStart(2, '0')}</span>
      <input
        className={field}
        placeholder="Subject (optional)"
        aria-label={`Subject ${n} name`}
        value={row.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <button
        type="button"
        aria-label={`Remove subject ${n}`}
        onClick={onRemove}
        className="sm:order-last size-9 grid place-items-center rounded-full text-ink2 hover:bg-sunk"
      >
        <Cross size={16} />
      </button>
      <input
        className={`${field} col-start-2 sm:col-start-auto`}
        type="number"
        inputMode="numeric"
        min={1}
        max={30}
        placeholder="Credits"
        aria-label={`Subject ${n} credits`}
        value={row.credits}
        onChange={(e) => onChange({ credits: toNumber(e.target.value) })}
      />
      <div
        role="group"
        aria-label={`Subject ${n} grade`}
        className="col-start-2 col-span-2 sm:col-span-1 sm:col-start-auto flex flex-wrap gap-1"
      >
        {GRADES.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={row.grade === g}
            onClick={() => onChange({ grade: row.grade === g ? '' : (g as Grade) })}
            className={`size-9 rounded-lg font-mono text-[14px] font-semibold border ${
              row.grade === g ? 'bg-brand text-white border-brand' : 'border-line text-ink hover:border-teal'
            }`}
          >
            {g}
          </button>
        ))}
      </div>
    </li>
  );
}
