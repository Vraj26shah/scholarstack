import type { BranchDto } from '@ss/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from '../../shared/ui/icons';
import { input } from './ui';

/**
 * Branches as a dropdown: the closed control shows the codes already chosen, and opens to a
 * tick list (with a filter once there are many branches). Several branches can be chosen.
 */
export function BranchPicker({
  branches,
  selected,
  onChange,
  label,
}: {
  branches: BranchDto[];
  selected: string[];
  onChange: (slugs: string[]) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const chosen = branches.filter((b) => selected.includes(b.slug));
  const q = filter.trim().toLowerCase();
  const shown = q ? branches.filter((b) => `${b.name} ${b.code}`.toLowerCase().includes(q)) : branches;
  const summary =
    chosen.length === 0
      ? 'Choose branches'
      : chosen.length === branches.length && branches.length > 1
        ? 'Every branch'
        : chosen.length <= 3
          ? chosen.map((b) => b.code).join(', ')
          : `${chosen
              .slice(0, 2)
              .map((b) => b.code)
              .join(', ')} +${chosen.length - 2} more`;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${summary}`}
        onClick={() => setOpen((v) => !v)}
        className={`${input} w-full flex items-center justify-between gap-2 text-left cursor-pointer`}
      >
        <span className={`truncate ${chosen.length ? '' : 'text-ink2'}`}>{summary}</span>
        <ChevronDown size={16} className={`flex-none transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          id={listId}
          className="absolute z-30 left-0 right-0 mt-1.5 rounded-2xl bg-card shadow-[0_0_0_1px_var(--line),0_12px_32px_rgba(15,20,50,0.16)] p-2 flex flex-col gap-1"
        >
          {branches.length > 8 && (
            <input
              type="search"
              aria-label="Filter branches"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className={`${input} h-9 text-sm mb-1`}
            />
          )}
          <div role="group" aria-label={label} className="max-h-64 overflow-y-auto flex flex-col">
            {shown.map((branch) => (
              <label
                key={branch.slug}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 cursor-pointer hover:bg-sunk"
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
                  className="accent-[var(--teal)]"
                />
                <span className="min-w-0 flex-1 text-sm text-ink truncate">{branch.name}</span>
                <span className="font-mono text-[11px] text-ink2">{branch.code}</span>
              </label>
            ))}
            {shown.length === 0 && <p className="m-0 px-2.5 py-2 text-sm text-ink2">No branch matches.</p>}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-line pt-2 px-1">
            <button
              type="button"
              className="text-[13px] text-teal-text font-semibold bg-transparent border-0 cursor-pointer"
              onClick={() => onChange(chosen.length === branches.length ? [] : branches.map((b) => b.slug))}
            >
              {chosen.length === branches.length ? 'Clear all' : 'Choose all'}
            </button>
            <button
              type="button"
              className="h-8 px-3 rounded-full bg-brand text-white text-[13px] font-semibold border-0 cursor-pointer"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
