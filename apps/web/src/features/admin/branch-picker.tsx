import type { BranchDto } from '@ss/contracts';

export function BranchPicker({
  branches,
  selected,
  onChange,
  label,
  compact = false,
}: {
  branches: BranchDto[];
  selected: string[];
  onChange: (slugs: string[]) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={
        compact ? 'grid grid-cols-3 gap-x-3 gap-y-1' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2'
      }
    >
      {branches.map((branch) => (
        <label
          key={branch.slug}
          title={branch.name}
          className={
            compact
              ? 'flex items-center gap-1.5 text-xs cursor-pointer'
              : 'flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2 cursor-pointer'
          }
        >
          <input
            type="checkbox"
            aria-label={`Assign to ${branch.name}`}
            checked={selected.includes(branch.slug)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, branch.slug]
                  : selected.filter((slug) => slug !== branch.slug),
              )
            }
            className={compact ? 'accent-[var(--teal)]' : 'mt-1 accent-[var(--teal)]'}
          />
          {compact ? (
            branch.code
          ) : (
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{branch.name}</span>
              <span className="block font-mono text-[11px] text-ink2">{branch.code}</span>
            </span>
          )}
        </label>
      ))}
    </div>
  );
}
