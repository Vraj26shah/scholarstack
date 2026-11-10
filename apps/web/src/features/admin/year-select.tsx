import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { input } from './ui';

/**
 * Batch year as a dropdown of the years set up under Years & branches. Students see the four
 * batches now studying; a course kept under any other year is labelled so it is not missed.
 */
export function YearSelect({
  value,
  onChange,
  label = 'Batch year',
}: {
  value: string;
  onChange: (year: string) => void;
  label?: string;
}) {
  const academic = useQuery({
    queryKey: ['admin', 'academic'],
    queryFn: api.adminAcademic,
    staleTime: 60_000,
  });
  const years = academic.data?.years ?? [];
  const usable = years
    .filter((y) => y.shown || y.label === 'Starts next intake' || String(y.year) === value)
    .sort((a, b) => b.year - a.year);
  const known = usable.some((y) => String(y.year) === value);
  return (
    <select aria-label={label} className={input} value={value} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">Choose…</option>}
      {value && !known && <option value={value}>{value}</option>}
      {usable.map((y) => (
        <option key={y.year} value={y.year}>
          {y.year} · {y.label}
          {y.shown ? '' : ' (students can’t see it)'}
        </option>
      ))}
    </select>
  );
}
