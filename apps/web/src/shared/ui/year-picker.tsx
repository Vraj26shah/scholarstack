import type { BatchDto } from '@ss/contracts';

/**
 * Pick a year, made for a thumb: four equal buttons, each with the year and its semesters, the
 * chosen one filled navy. Used by the app's Notes screen and the website's catalogue on phones.
 */
export function YearPicker({
  batches,
  value,
  onChange,
}: {
  batches: BatchDto[];
  value: number;
  onChange: (year: number) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Year" className="grid grid-cols-4 gap-2">
      {batches.map((b) => {
        const on = b.year === value;
        const [num, ...rest] = b.label.split(' ');
        return (
          <button
            key={b.year}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${b.label}, ${b.semesters}, ${b.year} batch`}
            onClick={() => onChange(b.year)}
            className={`relative flex flex-col items-center justify-center gap-0.5 rounded-[18px] py-2.5 px-1 transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.97] ${
              on
                ? 'bg-brand text-white shadow-[0_10px_22px_-14px_rgba(47,60,126,0.9)]'
                : 'bg-card text-ink ring-1 ring-line hover:ring-ink2/40'
            }`}
          >
            <span className="font-display font-bold text-[21px] leading-none tracking-[-0.03em]">
              {num}
              <span
                className={`ml-0.5 font-sans text-[11px] font-semibold tracking-normal ${on ? 'text-mist' : 'text-ink2'}`}
              >
                {rest.join(' ')}
              </span>
            </span>
            <span className={`text-[11px] font-medium ${on ? 'text-on-brand2' : 'text-ink2'}`}>
              {b.semesters}
            </span>
          </button>
        );
      })}
    </div>
  );
}
