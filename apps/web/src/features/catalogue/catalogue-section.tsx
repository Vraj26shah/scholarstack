import { type BatchDto, type BranchDto, studentFromEmail } from '@ss/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { rememberDrawer } from '../../lib/my-drawer';
import { useSession } from '../../lib/session';
import { LABEL } from '../../shared/copy';
import { StackWord } from '../../shared/ui/brand';
import { LinkButton } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { ChevronLeft, ChevronRight } from '../../shared/ui/icons';
import { BundleGrid, BundleGridSkeleton } from '../../shared/ui/index-card';
import { Reveal } from '../../shared/ui/motion';
import { slideTo, useSectionSwipe, useTrackpadSwipe } from '../../shared/ui/swipe';
import { SwipeHint } from '../../shared/ui/swipe-hint';
import { CatalogueSearchBox, CatalogueSearchResults } from './catalogue-search';
import { StudyYearCourseGroups } from './study-year-course-groups';

function Drawer({ batch, selected, onPick }: { batch: BatchDto; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={`group w-full h-40 rounded-[18px] p-4 flex flex-col items-center justify-between cursor-pointer border-0 transition-colors duration-200 ${
        selected
          ? 'bg-mist text-on-mist shadow-[0_8px_0_var(--teal)]'
          : 'bg-brand text-white shadow-[0_8px_0_var(--shadow)] hover:bg-[#35448c]'
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
      <span className="text-[12px] font-semibold tracking-wide">
        {selected ? 'Currently open' : 'View courses →'}
      </span>
    </button>
  );
}

function BranchTabs({
  branches,
  selected,
  onPick,
  onWarm,
}: {
  branches: BranchDto[];
  selected: string;
  onPick: (slug: string, dir?: 'next' | 'prev') => void;
  /** Hovering or focusing a tab loads its cards ahead, so picking it is instant. */
  onWarm: (slug: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  // When the tabs don't all fit, the edge that hides more tabs fades, so it reads as "scroll".
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const check = () =>
      setEdges({
        left: el.scrollLeft > 4,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      });
    check();
    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      el.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);
  const fade = `linear-gradient(to right, ${edges.left ? 'transparent, black 40px' : 'black'}, ${
    edges.right ? 'black calc(100% - 40px), transparent' : 'black'
  })`;
  // Keep the chosen tab in sight when the row scrolls sideways.
  // Keep the chosen tab in sight. On first load, and on laptops, only the row moves: the page
  // must not scroll down to the tabs by itself, and a trackpad swipe must leave the courses under
  // the pointer. After a swipe on a phone the tabs come into view too, so the student sees which
  // branch they are on now.
  const placed = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the chosen tab changes.
  useEffect(() => {
    const r = row.current;
    const tab = r?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!r || !tab) return;
    if (placed.current && window.matchMedia?.('(max-width: 767px)').matches) {
      tab.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
      return;
    }
    const behavior = placed.current ? 'smooth' : 'auto';
    placed.current = true;
    const pad = 40;
    const left = tab.offsetLeft - r.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left - pad < r.scrollLeft) r.scrollTo({ left: Math.max(0, left - pad), behavior });
    else if (right + pad > r.scrollLeft + r.clientWidth)
      r.scrollTo({ left: right + pad - r.clientWidth, behavior });
  }, [selected]);
  // Arrow keys move between tabs (and open the branch), like any tab row.
  const onKey = (e: React.KeyboardEvent) => {
    const i = branches.findIndex((b) => b.slug === selected);
    const to =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? branches.length - 1
              : -1;
    const next = branches[to];
    if (!next || to === i) return;
    e.preventDefault();
    onPick(next.slug, to > i ? 'next' : 'prev');
    requestAnimationFrame(() =>
      row.current?.querySelector<HTMLElement>(`[data-slug="${next.slug}"]`)?.focus(),
    );
  };
  const scrollBy = (dir: 1 | -1) =>
    row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.7, behavior: 'smooth' });
  const edge =
    'hidden md:grid absolute bottom-[7px] z-10 size-8 place-items-center rounded-full border border-line bg-surface text-ink shadow-[0_6px_16px_-8px_var(--shadow)] cursor-pointer hover:border-teal hover:text-teal-text transition-colors';
  return (
    <div className="relative">
      {edges.left && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show earlier branches"
          onClick={() => scrollBy(-1)}
          className={`${edge} -left-2`}
        >
          <ChevronLeft size={16} />
        </button>
      )}
      {edges.right && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show more branches"
          onClick={() => scrollBy(1)}
          className={`${edge} -right-2`}
        >
          <ChevronRight size={16} />
        </button>
      )}
      <div
        ref={row}
        role="tablist"
        aria-label="Branch"
        data-swipe-through
        onKeyDown={onKey}
        className="flex items-end gap-1.5 overflow-x-auto [scrollbar-width:none] border-b-2 border-brand -mx-5 px-5 sm:-mx-[30px] sm:px-[30px]"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
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
              tabIndex={active ? 0 : -1}
              data-slug={b.slug}
              onClick={() => onPick(b.slug)}
              onPointerEnter={() => onWarm(b.slug)}
              onFocus={() => onWarm(b.slug)}
              className={`h-11 shrink-0 whitespace-nowrap px-4 sm:px-5 rounded-t-[12px] border-2 border-b-0 text-[14.5px] transition-colors duration-200 cursor-pointer ${
                active
                  ? 'border-brand bg-brand text-white font-semibold'
                  : 'border-line bg-bg text-ink font-medium hover:bg-mist/40 hover:border-mist'
              }`}
            >
              {b.name}
            </button>
          );
        })}
      </div>
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
  // Signed in with a college address ("vraj.23bce11796@…"): open their own batch and programme.
  const me = useSession((s) => s.me);
  const mine = me ? studentFromEmail(me.email) : null;
  const myBatch = mine && batches.some((b) => b.year === mine.batchYear) ? mine.batchYear : 0;
  // The programme code in the email ("BCE") against the codes set in the admin.
  const myBranch = mine ? (branches.find((b) => b.code.toUpperCase() === mine.branchCode)?.slug ?? '') : '';
  // Lock to a student's drawer only when both email fields map to live catalogue entries.
  const matchedStudent = myBatch > 0 && myBranch !== '';
  const defaultBatch = batches[1]?.year ?? batches[0]?.year ?? 0;
  const defaultBranch =
    branches.find((b) => b.code.toUpperCase() === 'BCE')?.slug ??
    branches.find((b) => b.slug === 'bce')?.slug ??
    branches[0]?.slug ??
    '';
  const batch = (matchedStudent ? myBatch : Number(params.get('batch'))) || defaultBatch;
  // A student we can place sees only their own programme: no branch tabs to pick from.
  const branch = (matchedStudent ? myBranch : params.get('branch')) || defaultBranch;
  // Remember the drawer, so a course page can show this drawer's pack.
  useEffect(() => {
    if (batches.length && branch) rememberDrawer(batch, branch);
  }, [batch, branch, batches.length]);
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

  // Switching tabs swaps the cards in place: the last drawer stays on screen (slightly dimmed)
  // until the next one arrives, so nothing is torn down and rebuilt in front of you.
  const drawer = useQuery({
    queryKey: ['drawer', batch, branch],
    queryFn: () => api.drawer(batch, branch),
    enabled: batch > 0 && branch !== '',
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const bundles = useQuery({
    // Bundles follow the drawer: each one shows to the batches and programmes it was made for.
    queryKey: ['bundles', batch, branch],
    queryFn: () => api.bundles(batch, branch),
    enabled: batch > 0 && branch !== '',
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const qc = useQueryClient();
  const warm = (slug: string) =>
    batch > 0 &&
    void qc.prefetchQuery({
      queryKey: ['drawer', batch, slug],
      queryFn: () => api.drawer(batch, slug),
      staleTime: 60_000,
    });
  // Phones: swiping across the drawer moves between branches, like Instagram's tabs. Past the
  // last (or first) branch the swipe goes on to the next section of the site instead.
  const at = branches.findIndex((b) => b.slug === branch);
  useSectionSwipe({
    enabled: !searching && !matchedStudent && branches.length > 1,
    zone: 'branch-zone',
    target: 'drawer-cards',
    ...(at >= 0 && at < branches.length - 1
      ? { onNext: () => pick({ branch: branches[at + 1]!.slug }) }
      : {}),
    ...(at > 0 ? { onPrev: () => pick({ branch: branches[at - 1]!.slug }) } : {}),
  });
  // Laptops: a two-finger swipe on the trackpad does the same, and so do the ‹ › buttons.
  const nextBranch = at >= 0 && at < branches.length - 1 ? branches[at + 1] : undefined;
  const prevBranch = at > 0 ? branches[at - 1] : undefined;
  useTrackpadSwipe({
    enabled: !searching && !matchedStudent && branches.length > 1,
    zone: 'branch-zone',
    target: 'drawer-cards',
    ...(nextBranch ? { onNext: () => pick({ branch: nextBranch.slug }) } : {}),
    ...(prevBranch ? { onPrev: () => pick({ branch: prevBranch.slug }) } : {}),
  });
  const step = (dir: 'next' | 'prev') => {
    const to = dir === 'next' ? nextBranch : prevBranch;
    if (to) slideTo('drawer-cards', dir, () => pick({ branch: to.slug }));
  };
  // Cards deal in once, the first time the drawer is shown; after that they just update.
  const dealt = useRef(false);
  const animateCards = !dealt.current;
  useEffect(() => {
    if (drawer.data && drawer.data.length > 0) dealt.current = true;
  }, [drawer.data]);

  return (
    <section
      id="catalogue"
      aria-labelledby="catalogue-title"
      className="mx-auto max-w-[1280px] px-5 sm:px-9 pt-14 pb-20 [overflow-anchor:none]"
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
          {matchedStudent
            ? 'Courses for your batch and programme, including shared subjects.'
            : 'Choose a batch and branch, or search for a course.'}
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
          <p className="m-0 mb-2.5 text-[14px] text-ink2">
            {matchedStudent
              ? 'Looking for another course? Search by name or code.'
              : 'Search by course name or code.'}
          </p>
          <CatalogueSearchBox value={draft} onChange={setDraft} />
          {searching ? (
            <CatalogueSearchResults query={query} batches={batches} onPick={setDraft} />
          ) : (
            <>
              {!matchedStudent && (
                <div
                  className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 pt-8"
                  role="group"
                  aria-label="Batch year"
                  data-no-swipe
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
              )}

              <div
                id="branch-zone"
                className="mt-9 bg-surface border border-line rounded-[30px] p-5 sm:p-[26px_30px_40px] overflow-x-clip"
              >
                {index.isLoading ? (
                  <Skeleton className="h-12" />
                ) : matchedStudent ? null : (
                  <BranchTabs
                    branches={branches}
                    selected={branch}
                    onPick={(s, dir) =>
                      dir ? slideTo('drawer-cards', dir, () => pick({ branch: s })) : pick({ branch: s })
                    }
                    onWarm={warm}
                  />
                )}
                {!matchedStudent && (
                  <>
                    <SwipeHint id="catalogue-branches" className="mt-4">
                      Swipe the courses sideways to change branch
                    </SwipeHint>
                    <SwipeHint id="catalogue-branches-laptop" laptop className="mt-4">
                      Swipe with two fingers on the trackpad, or use the ‹ › buttons, to change branch
                    </SwipeHint>
                  </>
                )}

                <div
                  className={`flex flex-wrap items-baseline justify-between gap-2 ${matchedStudent ? 'mb-7' : 'my-7'}`}
                >
                  <div>
                    <div className="font-display font-extrabold text-[clamp(26px,3.4vw,36px)] leading-none tracking-[-0.04em]">
                      {`Drawer ${batch || '…'} · ${branchName}`}
                    </div>
                    {current && (
                      <div className="text-[15px] text-ink2 mt-2">
                        {matchedStudent
                          ? `Your ${current.label} · ${current.semesters}`
                          : `${current.label}, ${current.semesters}`}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {drawer.data && (
                      <span className="text-sm text-ink2">
                        {drawer.data.length} {drawer.data.length === 1 ? 'card' : 'cards'}
                      </span>
                    )}
                    {!matchedStudent && branches.length > 1 && (
                      <nav aria-label="Change branch" className="hidden md:flex items-center gap-1.5">
                        <BranchStep dir="prev" branch={prevBranch} onClick={() => step('prev')} />
                        <span className="font-mono text-xs text-ink2 tabular-nums px-1">
                          {at + 1} / {branches.length}
                        </span>
                        <BranchStep dir="next" branch={nextBranch} onClick={() => step('next')} />
                      </nav>
                    )}
                  </div>
                </div>

                <div
                  id="drawer-cards"
                  role="tabpanel"
                  aria-live="polite"
                  aria-busy={drawer.isPlaceholderData}
                  className={`transition-opacity duration-200 [overscroll-behavior-x:contain] ${drawer.isPlaceholderData ? 'opacity-60' : ''}`}
                >
                  {/* The drawer's pack slides with its cards when the branch changes. */}
                  {bundles.isLoading || index.isLoading ? (
                    <BundleGridSkeleton className="mb-8" />
                  ) : (
                    bundles.data &&
                    bundles.data.length > 0 && (
                      <BundleGrid key={`b-${batch}-${branch}`} bundles={bundles.data} className="mb-8" />
                    )
                  )}
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
                    <StudyYearCourseGroups courses={drawer.data} animate={animateCards} />
                  ) : (
                    <div className="min-h-[220px] rounded-2xl border-2 border-dashed border-line flex flex-col items-center justify-center gap-3 text-center p-8">
                      <span className="font-display font-extrabold text-[34px] tracking-[-0.04em]">
                        No courses here yet.
                      </span>
                      <span className="text-ink2 max-w-[480px]">
                        Try another batch or search for it. You can also contribute notes for this programme.
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

/** A laptop button to the previous or next branch, named by its short code ("‹ BAI", "BCY ›"). */
function BranchStep({
  dir,
  branch,
  onClick,
}: {
  dir: 'next' | 'prev';
  branch: BranchDto | undefined;
  onClick: () => void;
}) {
  const code = branch ? branch.code || branch.slug.toUpperCase() : '';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!branch}
      aria-label={branch ? `${dir === 'next' ? 'Next' : 'Previous'} branch: ${branch.name}` : undefined}
      title={branch?.name}
      className="inline-flex items-center gap-1 h-9 rounded-full border border-line bg-bg px-3 text-[13px] font-semibold text-ink cursor-pointer transition-colors hover:border-teal hover:text-teal-text disabled:opacity-35 disabled:cursor-default disabled:hover:border-line disabled:hover:text-ink"
    >
      {dir === 'prev' && <ChevronLeft size={15} />}
      <span className="font-mono">{code || (dir === 'next' ? 'Next' : 'Prev')}</span>
      {dir === 'next' && <ChevronRight size={15} />}
    </button>
  );
}
