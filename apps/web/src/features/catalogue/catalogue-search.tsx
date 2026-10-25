import type { BatchDto, CourseCardDto } from '@ss/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, friendly } from '../../lib/api';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { Cross, SearchIcon } from '../../shared/ui/icons';
import { BundleGrid, IndexCard } from '../../shared/ui/index-card';

const EXAMPLES = ['DBMS', 'CSE3001', 'sem 3', 'Java', '2024 batch', 'PYQ'];

/**
 * One box that searches the whole live catalogue, every batch and programme at once.
 * Press "/" anywhere on the page to jump into it.
 */
export function CatalogueSearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(value);
      }}
      className="group relative"
    >
      <label htmlFor="catalogue-search" className="sr-only">
        Search every course
      </label>
      <SearchIcon
        size={20}
        className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink2 group-focus-within:text-teal-text"
      />
      <input
        ref={ref}
        id="catalogue-search"
        type="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={80}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          onChange('');
        }}
        placeholder="Search every course: a subject, a code like CSE3001, or “sem 3”"
        className="w-full h-14 rounded-full bg-surface border-[1.5px] border-line pl-13 pr-24 text-[16px] text-ink shadow-[0_10px_26px_-20px_var(--shadow)] outline-none focus:border-teal [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full border-0 bg-sunk text-ink2 inline-flex items-center justify-center cursor-pointer hover:text-ink"
        >
          <Cross size={16} />
        </button>
      ) : (
        <kbd className="hidden sm:inline-flex absolute right-5 top-1/2 -translate-y-1/2 h-7 min-w-7 px-2 items-center justify-center rounded-md border border-line bg-sunk font-mono text-xs text-ink2">
          /
        </kbd>
      )}
    </form>
  );
}

/** Results across every batch, grouped by batch so a 2023 card never looks like a 2025 one. */
export function CatalogueSearchResults({
  query,
  batches,
  onPick,
}: {
  query: string;
  batches: BatchDto[];
  onPick: (q: string) => void;
}) {
  const result = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.search(query),
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const label = (year: number) => batches.find((b) => b.year === year)?.label;
  const groups = new Map<number, CourseCardDto[]>();
  for (const c of result.data?.courses ?? [])
    groups.set(c.batchYear, [...(groups.get(c.batchYear) ?? []), c]);
  const total = (result.data?.courses.length ?? 0) + (result.data?.bundles.length ?? 0);
  const waiting = query.length < 2 || result.isLoading || (result.isPending && !result.data);

  return (
    <div
      className="mt-6 bg-surface border border-line rounded-[30px] p-5 sm:p-[26px_30px_40px] [overflow-anchor:none]"
      aria-live="polite"
      aria-busy={result.isFetching || waiting}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-6">
        <div className="font-display font-extrabold text-[clamp(24px,3vw,34px)] leading-none tracking-[-0.04em]">
          {waiting
            ? 'Searching…'
            : result.isError
              ? `Searching for “${query}”`
              : `${total} ${total === 1 ? 'match' : 'matches'} for “${query}”`}
        </div>
        {result.data && total > 0 && (
          <span className="text-sm text-ink2">
            {result.data.courses.length} {result.data.courses.length === 1 ? 'course' : 'courses'}
            {result.data.bundles.length > 0 &&
              ` · ${result.data.bundles.length} ${result.data.bundles.length === 1 ? 'bundle' : 'bundles'}`}
          </span>
        )}
      </div>

      {waiting ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-60" />
          ))}
        </div>
      ) : result.isError ? (
        <ErrorState
          title="Search didn't work."
          message={friendly(result.error)}
          onRetry={() => result.refetch()}
        />
      ) : total === 0 ? (
        <div className="min-h-[200px] rounded-2xl border-2 border-dashed border-line flex flex-col items-center justify-center gap-3 text-center p-8">
          <span className="font-display font-extrabold text-[30px] tracking-[-0.04em]">
            Nothing by that name yet.
          </span>
          <span className="text-ink2 max-w-[480px]">Try fewer words, the course code, or one of these:</span>
          <span className="flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onPick(e)}
                className="h-9 px-3.5 rounded-full border border-line bg-sunk text-sm text-ink cursor-pointer hover:border-teal"
              >
                {e}
              </button>
            ))}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-9">
          {result.data && result.data.bundles.length > 0 && (
            <BundleGrid bundles={result.data.bundles} animate={false} />
          )}
          {[...groups.entries()].map(([year, courses]) => (
            <section key={year} aria-label={`${year} batch`} className="flex flex-col gap-4">
              <h3 className="m-0 flex items-baseline gap-3">
                <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-md bg-sunk text-ink">
                  {year} batch
                </span>
                {label(year) && <span className="text-sm text-ink2">{label(year)}</span>}
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
                {courses.map((c) => (
                  <IndexCard key={c.id} course={c} animate={false} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
