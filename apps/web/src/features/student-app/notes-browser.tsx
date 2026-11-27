import { studentFromEmail } from '@ss/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { rememberDrawer } from '../../lib/my-drawer';
import { useSession } from '../../lib/session';
import { Skeleton } from '../../shared/ui/feedback';
import { ChevronRight } from '../../shared/ui/icons';
import { SearchSelect } from '../../shared/ui/search-select';
import { useSectionSwipe } from '../../shared/ui/swipe';
import { YearPicker } from '../../shared/ui/year-picker';
import { CatalogueSearchBox, CatalogueSearchResults } from '../catalogue/catalogue-search';
import { card } from './app-ui';

/**
 * The app's way to find notes, made for a thumb: search, or pick your year (four buttons) and
 * your branch (one dropdown), then read a plain list of courses. No sideways swiping, no big
 * boxes to decode. Signed-in students start on their own year and branch, from their email.
 */
export function NotesBrowser() {
  const me = useSession((s) => s.me);
  const [params, setParams] = useSearchParams();
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue, staleTime: 60_000 });
  const batches = index.data?.batches ?? [];
  const branches = (index.data?.branches ?? []).filter((b) => !b.isCommon);

  // From the email ("name.23bce…@vitbhopal.ac.in"): their batch and programme, when both exist.
  const mine = me ? studentFromEmail(me.email) : null;
  const myBatch = mine && batches.some((b) => b.year === mine.batchYear) ? mine.batchYear : 0;
  const myBranch = mine ? (branches.find((b) => b.code.toUpperCase() === mine.branchCode)?.slug ?? '') : '';

  const fallbackBatch = batches[1]?.year ?? batches[0]?.year ?? 0;
  const fallbackBranch =
    branches.find((b) => b.code.toUpperCase() === 'BCE')?.slug ?? branches[0]?.slug ?? '';
  const batch = Number(params.get('batch')) || myBatch || fallbackBatch;
  const branch = params.get('branch') || myBranch || fallbackBranch;
  const isMine = batch === myBatch && branch === myBranch && myBatch > 0;

  const pick = (next: { batch?: number; branch?: string }) => {
    const p = new URLSearchParams(params);
    p.set('batch', String(next.batch ?? batch));
    p.set('branch', next.branch ?? branch);
    setParams(p, { replace: true, preventScrollReset: true });
  };

  useEffect(() => {
    if (batch && branch) rememberDrawer(batch, branch);
  }, [batch, branch]);

  // Swipe the course list sideways for the next or previous branch (the picker follows).
  const at = branches.findIndex((b) => b.slug === branch);
  useSectionSwipe({
    enabled: branches.length > 1,
    zone: 'app-courses',
    target: 'app-courses',
    ...(at >= 0 && at < branches.length - 1
      ? { onNext: () => pick({ branch: branches[at + 1]!.slug }) }
      : {}),
    ...(at > 0 ? { onPrev: () => pick({ branch: branches[at - 1]!.slug }) } : {}),
  });

  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(draft.trim()), 220);
    return () => clearTimeout(t);
  }, [draft]);
  const searching = draft.trim().length >= 2;

  const courses = useQuery({
    queryKey: ['drawer', batch, branch],
    queryFn: () => api.drawer(batch, branch),
    enabled: batch > 0 && branch !== '',
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const packs = useQuery({
    queryKey: ['bundles', batch, branch],
    queryFn: () => api.bundles(batch, branch),
    enabled: batch > 0 && branch !== '',
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const pack = (packs.data ?? []).find((b) => b.forDrawer === `${batch}:${branch}`) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <CatalogueSearchBox value={draft} onChange={setDraft} />

      {searching ? (
        <CatalogueSearchResults query={query} batches={batches} onPick={setDraft} />
      ) : (
        <>
          {/* Step 1: the year, as four plain buttons. */}
          <section className="flex flex-col gap-2.5">
            <h2 className="m-0 px-1 text-[15px] font-bold">Year</h2>
            {index.isLoading ? (
              <Skeleton className="h-[60px] rounded-[18px]" />
            ) : (
              <YearPicker batches={batches} value={batch} onChange={(y) => pick({ batch: y })} />
            )}
          </section>

          {/* Step 2: the branch, as one dropdown with full names. */}
          <section className="flex flex-col gap-2.5">
            <SearchSelect
              label="Branch"
              value={branch}
              onChange={(v) => pick({ branch: v })}
              searchPlaceholder="Search branch, e.g. CSE or AI"
              options={branches.map((b) => ({
                value: b.slug,
                label: b.name,
                tag: b.code,
                keywords: `${b.shortName} ${b.code}`,
              }))}
            />
            {isMine && (
              <p className="m-0 px-1 text-[13px] text-teal-text font-semibold">
                Your batch and branch, from your college email.
              </p>
            )}
          </section>

          {/* The courses: one line each, tap to open; swipe sideways for the next branch. */}
          <section id="app-courses" className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-3 px-1">
              <h2 className="m-0 text-[15px] font-bold">Courses</h2>
              {courses.data && (
                <span className="text-[13px] text-ink2">
                  {courses.data.length} course{courses.data.length === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {pack && (
              <Link
                to={`/b/${pack.slug}`}
                className="flex items-center gap-4 rounded-[20px] bg-brand text-white px-4 py-3.5 no-underline press"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-semibold text-marigold">
                    Whole semester · {pack.courseCount} courses
                  </span>
                  <span className="block text-[16px] font-bold leading-tight truncate">{pack.title}</span>
                </span>
                <span className="flex-none text-right">
                  <span className="block font-display text-[20px] font-bold leading-none">
                    {formatMoney(pack.pricePaise)}
                  </span>
                  {pack.savePercent > 0 && (
                    <span className="block text-[12px] text-mist">Save {pack.savePercent}%</span>
                  )}
                </span>
              </Link>
            )}

            {courses.isLoading ? (
              <div className={`${card} p-2 flex flex-col gap-2`}>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            ) : (courses.data ?? []).length === 0 ? (
              <p className="m-0 px-1 py-4 text-[15px] text-ink2">
                No notes here yet. Try another year or branch, or search above.
              </p>
            ) : (
              <ul
                className={`${card} m-0 p-0 list-none overflow-hidden transition-opacity ${courses.isPlaceholderData ? 'opacity-60' : ''}`}
              >
                {(courses.data ?? []).map((c) => (
                  <li
                    key={c.id}
                    className="relative after:absolute after:left-4 after:right-0 after:bottom-0 after:h-px after:bg-line/70 last:after:hidden"
                  >
                    <Link
                      to={`/c/${c.slug}`}
                      className="flex items-center gap-3 px-4 py-3.5 no-underline text-ink active:bg-sunk"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-[16px] font-semibold leading-snug">{c.title}</span>
                        <span className="block text-[12.5px] text-ink2 mt-0.5">
                          {[
                            c.courseCode,
                            `${c.pageCount} pages`,
                            c.formats.map((f) => f.toUpperCase()).join(' + '),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <span className="flex-none text-right">
                        <span className="block text-[15px] font-bold tabular-nums">
                          {formatMoney(c.pricePaise)}
                        </span>
                        {c.offer && (
                          <span className="block text-[12px] text-ink2 line-through tabular-nums">
                            {formatMoney(c.offer.fullPricePaise)}
                          </span>
                        )}
                      </span>
                      <ChevronRight size={17} className="flex-none text-ink2/70" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="m-0 px-1 text-[12.5px] text-ink2">
              Swipe the list sideways for the next branch. Page one of every unit is free to read.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
