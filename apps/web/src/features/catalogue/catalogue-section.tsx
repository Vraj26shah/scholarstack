import type { BatchDto, BranchDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { LABEL } from '../../shared/copy';
import { StackWord } from '../../shared/ui/brand';
import { LinkButton } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { BundleGrid, IndexCard } from '../../shared/ui/index-card';
import { Reveal } from '../../shared/ui/motion';
import { CatalogueSearchBox, CatalogueSearchResults } from './catalogue-search';

function Drawer({ batch, selected, onPick }: { batch: BatchDto; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={`group w-full h-40 rounded-[18px] p-4 flex flex-col items-center justify-between cursor-pointer border-0 transition-all duration-300 ease-[cubic-bezier(.2,.9,.25,1.2)] ${
        selected
          ? 'bg-mist text-on-mist shadow-[0_14px_0_var(--teal)] -translate-y-3'
          : 'bg-brand text-white shadow-[0_6px_0_var(--shadow)] hover:-translate-y-1.5 hover:shadow-[0_10px_0_var(--shadow)]'
      }`}
    >
      <span className="bg-white text-on-mist border-2 border-on-mist/25 rounded-md px-3 py-1 font-mono text-xs font-semibold">
        {batch.year} batch
      </span>
      <span className="flex flex-col items-center gap-0.5">
        <span className="font-display font-extrabold text-[32px] leading-none tracking-[-0.04em]">
          {batch.label}
        </span>
        <span className={`text-[13px] ${selected ? 'font-medium' : 'text-on-brand2'}`}>
          {batch.semesters}
          {selected ? ' · open' : ''}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`w-[76px] h-3 rounded-full transition-all duration-300 ${
          selected ? 'bg-on-mist/35 w-[96px]' : 'bg-white/35 group-hover:w-[88px]'
        }`}
      />
    </button>
  );
}

function BranchTabs({
  branches,
  selected,
  onPick,
}: {
  branches: BranchDto[];
  selected: string;
  onPick: (slug: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Branch"
      className="flex flex-wrap items-end gap-1.5 border-b-2 border-brand"
    >
      {branches.map((b) => {
        const active = b.slug === selected;
        return (
          <button
            key={b.slug}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls="drawer-cards"
            onClick={() => onPick(b.slug)}
            className={`px-4 sm:px-5 border-2 border-b-0 rounded-t-[14px] cursor-pointer text-[15px] transition ${
              active
                ? 'h-[50px] -mb-0.5 border-brand bg-brand text-white font-semibold'
                : 'h-[42px] border-line bg-bg text-ink font-medium hover:h-[46px]'
            }`}
          >
            {b.name}
          </button>
        );
      })}
    </div>
  );
}

export function CatalogueSection() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue, staleTime: 60_000 });

  const batches = index.data?.batches ?? [];
  const branches = (index.data?.branches ?? []).filter((b) => !b.isCommon);
  const batch = Number(params.get('batch')) || batches[1]?.year || batches[0]?.year || 0;
  const branch = params.get('branch') || branches[0]?.slug || '';
  const current = batches.find((b) => b.year === batch);
  const selectedBranch = branches.find((b) => b.slug === branch);
  const branchName = selectedBranch?.name ?? branch;

  const urlQuery = params.get('q') ?? '';
  const [draft, setDraft] = useState(urlQuery);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [query, setQuery] = useState(urlQuery.trim());

  const patchParams = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(window.location.search);
      const before = next.toString();
      mutate(next);
      const search = next.toString();
      if (search === before) return;
      navigate(
        {
          pathname: location.pathname,
          search: search ? `?${search}` : '',
          hash: location.hash || window.location.hash,
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [location.hash, location.pathname, navigate],
  );

  useEffect(() => {
    if (urlQuery !== draftRef.current && urlQuery !== draftRef.current.trim()) setDraft(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = draft.trim();
      setQuery(trimmed);
      patchParams((p) => {
        if (trimmed) p.set('q', trimmed);
        else p.delete('q');
      });
    }, 220);
    return () => clearTimeout(t);
  }, [draft, patchParams]);

  const pick = (next: { batch?: number; branch?: string }) =>
    patchParams((p) => {
      p.set('batch', String(next.batch ?? batch));
      p.set('branch', next.branch ?? branch);
    });
  const searching = draft.trim().length >= 2;

  const drawer = useQuery({
    queryKey: ['drawer', batch, branch],
    queryFn: () => api.drawer(batch, branch),
    enabled: batch > 0 && branch !== '',
    staleTime: 60_000,
  });

  const bundles = useQuery({
    queryKey: ['bundles', batch],
    queryFn: () => api.bundles(batch),
    enabled: batch > 0,
    staleTime: 60_000,
  });

  return (
    <section
      id="catalogue"
      aria-labelledby="catalogue-title"
      className="mx-auto max-w-[1280px] px-5 sm:px-9 pt-20 pb-24 [overflow-anchor:none]"
    >
      <div className="flex flex-wrap items-end justify-between gap-5 mb-10">
        <div>
          <p className="font-mono text-[13px] tracking-[0.14em] text-teal-text m-0 mb-3.5">The catalogue</p>
          <h2
            id="catalogue-title"
            className="m-0 font-display font-extrabold text-[clamp(48px,7vw,84px)] leading-[0.95] tracking-[-0.05em]"
          >
            Pull out your <StackWord className="text-teal-text">drawer.</StackWord>
          </h2>
        </div>
        <p className="m-0 text-[17px] leading-relaxed text-ink2 max-w-[380px]">
          One drawer per batch year. Inside, a tab for each programme. Shared subjects appear in every
          programme selected by the librarian.
        </p>
      </div>

      {index.isError ? (
        <ErrorState
          title="The catalogue didn't load."
          message={friendly(index.error)}
          onRetry={() => index.refetch()}
        />
      ) : (
        <>
          <CatalogueSearchBox value={draft} onChange={setDraft} />
          {searching ? (
            <CatalogueSearchResults query={query} batches={batches} onPick={setDraft} />
          ) : (
            <>
              <div
                className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 pt-8"
                role="group"
                aria-label="Batch year"
              >
                {index.isLoading
                  ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)
                  : batches.map((b, i) => (
                      <Reveal key={b.year} index={i}>
                        <Drawer
                          batch={b}
                          selected={b.year === batch}
                          onPick={() => pick({ batch: b.year })}
                        />
                      </Reveal>
                    ))}
              </div>

              <div className="mt-9 bg-surface border border-line rounded-[30px] p-5 sm:p-[26px_30px_40px]">
                {index.isLoading ? (
                  <Skeleton className="h-12" />
                ) : (
                  <BranchTabs branches={branches} selected={branch} onPick={(s) => pick({ branch: s })} />
                )}

                <div className="flex flex-wrap items-baseline justify-between gap-2 my-7">
                  <div>
                    <div className="font-display font-extrabold text-[clamp(26px,3.4vw,36px)] leading-none tracking-[-0.04em]">
                      Drawer {batch || '…'} · {branchName}
                    </div>
                    {current && (
                      <div className="text-[15px] text-ink2 mt-2">
                        {current.label}, {current.semesters}
                      </div>
                    )}
                    {selectedBranch?.tagline && (
                      <p className="m-0 text-sm text-ink2 mt-2 max-w-[680px]">
                        <span className="font-semibold text-ink">{selectedBranch.tagline}.</span>{' '}
                        {selectedBranch.description}
                      </p>
                    )}
                  </div>
                  {drawer.data && (
                    <span className="text-sm text-ink2">
                      {drawer.data.length} {drawer.data.length === 1 ? 'card' : 'cards'}
                    </span>
                  )}
                </div>

                {bundles.data && bundles.data.length > 0 && (
                  <BundleGrid key={`b-${batch}`} bundles={bundles.data} className="mb-8" />
                )}

                <div id="drawer-cards" role="tabpanel" aria-live="polite">
                  {drawer.isLoading || index.isLoading ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-60" />
                      ))}
                    </div>
                  ) : drawer.isError ? (
                    <ErrorState
                      title="These cards didn't load."
                      message={friendly(drawer.error)}
                      onRetry={() => drawer.refetch()}
                    />
                  ) : drawer.data && drawer.data.length > 0 ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
                      {drawer.data.map((c, i) => (
                        <IndexCard key={c.id} course={c} index={i} />
                      ))}
                    </div>
                  ) : (
                    <div className="min-h-[220px] rounded-2xl border-2 border-dashed border-line flex flex-col items-center justify-center gap-3 text-center p-8">
                      <span className="font-display font-extrabold text-[34px] tracking-[-0.04em]">
                        This tab is empty, for now.
                      </span>
                      <span className="text-ink2 max-w-[480px]">
                        No {branchName} cards in this drawer yet. Wrote good notes for this branch? Send them
                        in and we'll file them.
                      </span>
                      <LinkButton to="/contribute" variant="brand">
                        {LABEL.upload}
                      </LinkButton>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
