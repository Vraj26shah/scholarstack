import type { MessKind, MessSummaryDto } from '@ss/contracts';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, SearchIcon } from '../../../../shared/ui/icons';

export const KIND_LABEL: Record<MessKind, string> = {
  hostel: 'Hostel mess',
  restaurant: 'Restaurant for day scholars',
};

type Filter = 'all' | MessKind;
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['hostel', 'Hostellers'],
  ['restaurant', 'Day scholars'],
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]/g, '');

/**
 * Pick a mess: a button that opens a searchable list, grouped into hostel messes and restaurants
 * for day scholars. Type to filter, arrows to move, Enter to choose, Escape to close.
 */
export function MessPicker({
  messes,
  value,
  onChange,
  label = 'Your mess',
  placeholder = 'Choose your mess or restaurant',
  compact = false,
}: {
  messes: MessSummaryDto[];
  value: string | null;
  onChange: (slug: string) => void;
  label?: string;
  placeholder?: string;
  /** A small "Change" link (the page already shows the chosen mess as its title). */
  compact?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [active, setActive] = useState(0);
  /**
   * The list opens in the page, pushing what's below down, so it never covers the menu or the
   * footer, however short the page is.
   */
  const [listMax, setListMax] = useState(300);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = messes.find((m) => m.slug === value);

  const results = useMemo(() => {
    const q = norm(query.trim());
    return messes
      .filter((m) => filter === 'all' || m.kind === filter)
      .filter((m) => !q || norm(`${m.name} ${m.place} ${KIND_LABEL[m.kind]}`).includes(q))
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'hostel' ? -1 : 1));
  }, [messes, query, filter]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => input.current?.focus(), 0);
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  /** Opening starts on the chosen mess; searching or filtering starts from the top. */
  const toggleOpen = () => {
    if (!open) {
      // The list fits the screen, above the phone's bottom bar.
      const bar = window.matchMedia?.('(max-width: 640px)').matches ? 84 : 0;
      setListMax(Math.max(160, Math.min(320, window.innerHeight - bar - 260)));
    }
    if (!open)
      setActive(
        Math.max(
          0,
          results.findIndex((m) => m.slug === value),
        ),
      );
    setOpen(!open);
  };

  const choose = (slug: string) => {
    onChange(slug);
    setOpen(false);
    setQuery('');
    button.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const m = results[active];
      if (m) choose(m.slug);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  };

  useEffect(() => {
    if (open) document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);

  return (
    <div ref={root} className="relative flex flex-col gap-1.5 min-w-0 w-full max-w-[520px]">
      <span id={`${id}-label`} className={compact ? 'sr-only' : 'text-sm font-semibold text-ink2'}>
        {label}
      </span>
      {compact ? (
        <button
          ref={button}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${id}-label ${id}-value`}
          onClick={toggleOpen}
          className="press self-start inline-flex items-center gap-1.5 h-9 rounded-full border border-line px-3.5 text-[13px] font-semibold text-ink hover:border-ink2"
        >
          <span id={`${id}-value`}>
            <span className="sr-only">{current ? `${current.name}, ` : ''}</span>
            Change mess
          </span>
          <ChevronDown
            size={15}
            className={`shrink-0 text-ink2 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      ) : (
        <button
          ref={button}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${id}-label ${id}-value`}
          onClick={toggleOpen}
          className="press flex items-center gap-3 min-h-14 w-full rounded-2xl bg-surface border-[1.5px] border-line px-4 py-2 text-left hover:border-ink2 focus-visible:border-teal outline-none"
        >
          <span id={`${id}-value`} className="flex-1 min-w-0 flex flex-col">
            {current ? (
              <>
                <span className="font-semibold text-[16px] text-ink truncate">{current.name}</span>
                <span className="text-[13px] text-ink2 truncate">
                  {KIND_LABEL[current.kind]}
                  {current.place ? ` · ${current.place}` : ''}
                </span>
              </>
            ) : (
              <span className="text-[15px] text-ink2">{placeholder}</span>
            )}
          </span>
          <ChevronDown
            size={18}
            className={`shrink-0 text-ink2 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      )}

      {open && (
        <div className="mt-1 rounded-2xl bg-surface shadow-[0_18px_34px_-22px_var(--shadow),0_0_0_1px_var(--line)] p-2 flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-xl bg-sunk px-3 h-11">
            <SearchIcon size={16} className="text-ink2 shrink-0" />
            <input
              ref={input}
              role="combobox"
              aria-expanded
              aria-controls={`${id}-list`}
              aria-activedescendant={results[active] ? `${id}-opt-${active}` : undefined}
              aria-autocomplete="list"
              aria-label="Search messes and restaurants"
              placeholder="Search by name or place"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[15px] text-ink"
            />
          </div>
          <div role="radiogroup" aria-label="Show" className="flex gap-1">
            {FILTERS.map(([k, text]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={filter === k}
                onClick={() => {
                  setFilter(k);
                  setActive(0);
                }}
                className={`h-8 rounded-full px-3 text-[13px] font-semibold ${filter === k ? 'bg-ink text-bg' : 'text-ink2 hover:text-ink'}`}
              >
                {text}
              </button>
            ))}
          </div>
          <div
            id={`${id}-list`}
            role="listbox"
            tabIndex={-1}
            aria-label="Messes"
            className="overflow-y-auto overscroll-contain"
            style={{ maxHeight: listMax }}
          >
            {results.map((m, i) => {
              const heading = i === 0 || results[i - 1]!.kind !== m.kind;
              return (
                <div key={m.slug} role="presentation">
                  {heading && filter === 'all' && (
                    <p className="m-0 px-3 pt-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink2">
                      {m.kind === 'hostel' ? 'Hostel messes' : 'Restaurants for day scholars'}
                    </p>
                  )}
                  <div
                    id={`${id}-opt-${i}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={m.slug === value}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => choose(m.slug)}
                    onKeyDown={onKey}
                    className={`cursor-pointer rounded-xl px-3 py-2.5 flex flex-col ${i === active ? 'bg-sunk' : ''}`}
                  >
                    <span className="font-semibold text-[15px] text-ink">
                      {m.name}
                      {m.slug === value && <span className="sr-only"> (chosen)</span>}
                      {!m.published && (
                        <span className="ml-2 align-middle rounded-md bg-marigold-soft px-1.5 py-0.5 text-[11px] font-semibold text-marigold-text">
                          Draft
                        </span>
                      )}
                    </span>
                    <span className="text-[13px] text-ink2">
                      {KIND_LABEL[m.kind]}
                      {m.place ? ` · ${m.place}` : ''}
                    </span>
                  </div>
                </div>
              );
            })}
            {!results.length && (
              <p className="m-0 px-3 py-4 text-[14px] text-ink2">
                {query ? `Nothing matches "${query}".` : 'Nothing here yet.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
