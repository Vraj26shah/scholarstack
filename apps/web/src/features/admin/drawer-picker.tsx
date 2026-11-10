import type { DrawerRef } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export const drawerKey = (d: DrawerRef) => `${d.batchYear}:${d.branchSlug}`;
export const fromKey = (k: string): DrawerRef => {
  const [y, slug] = k.split(':');
  return { batchYear: Number(y), branchSlug: slug! };
};

/** Branch codes by slug ("bce" → "BCE"), and "*" as "All". */
export function useBranchCodes() {
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue });
  const codes = new Map((index.data?.branches ?? []).map((b) => [b.slug, b.code || b.slug.toUpperCase()]));
  return (slug: string) => (slug === '*' ? 'All programmes' : (codes.get(slug) ?? slug.toUpperCase()));
}

/** "2025 BCE, BCY · 2024 All programmes": drawers grouped by batch, newest first. */
export function DrawerSummary({ drawers, empty }: { drawers: DrawerRef[]; empty: string }) {
  const code = useBranchCodes();
  if (!drawers.length) return <span className="text-blush-text">{empty}</span>;
  const years = new Map<number, string[]>();
  for (const d of drawers) years.set(d.batchYear, [...(years.get(d.batchYear) ?? []), code(d.branchSlug)]);
  return (
    <span>
      {[...years.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([y, list]) => `${y} ${list.join(', ')}`)
        .join(' · ')}
    </span>
  );
}

/**
 * Pick drawers: per batch, "All" or any programmes. The same picker serves bundles and offers, so
 * "2025, every programme" and "2024 BCE only" are both one tap.
 */
export function DrawerPicker({
  value,
  onChange,
  label,
}: {
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  label: string;
}) {
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue });
  const programmes = (index.data?.branches ?? []).filter((b) => !b.isCommon);
  const years = index.data?.batches ?? [];
  const toggle = (k: string) => {
    const next = new Set(value);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    // "All" for a batch makes its single programmes redundant, and the other way round.
    const [y, slug] = k.split(':');
    if (next.has(k))
      for (const other of [...next])
        if (other.startsWith(`${y}:`) && other !== k && (slug === '*' || other.endsWith(':*')))
          next.delete(other);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-3" role="group" aria-label={label}>
      {years.map((y) => (
        <fieldset key={y.year} className="m-0 p-0 border-0 flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-semibold">
            {y.year} batch <span className="font-normal text-ink2">· {y.label}</span>
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {[{ slug: '*', code: 'All', name: `Every programme in ${y.year}` }, ...programmes].map((b) => {
              const k = `${y.year}:${b.slug}`;
              const on = value.has(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${y.year} ${b.name}`}
                  title={b.name}
                  onClick={() => toggle(k)}
                  className={`h-9 min-w-[3.25rem] rounded-full px-3 text-[13px] font-semibold border cursor-pointer ${
                    on ? 'bg-brand text-white border-brand' : 'border-line text-ink2 hover:text-ink'
                  }`}
                >
                  {b.code || b.slug.toUpperCase()}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
