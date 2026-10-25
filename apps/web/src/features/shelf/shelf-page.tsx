import type { ShelfItemDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { prefetchChunk } from '../../lib/prefetch';
import { useSession } from '../../lib/session';
import { LinkButton } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { ArrowRight, Play } from '../../shared/ui/icons';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const SPINES = [
  'bg-mist text-on-mist',
  'bg-teal text-white',
  'bg-[#25306A] text-white',
  'bg-blush text-blush-text border border-line',
  'bg-ink text-bg',
];

function Spine({ item, i }: { item: ShelfItemDto; i: number }) {
  const height = Math.min(300, 200 + Math.round(item.course.pageCount / 3));
  const ended = item.access.state !== 'active';
  return (
    <Link
      to={`/c/${item.course.slug}`}
      className={`relative flex-none w-[68px] sm:w-[76px] rounded-lg no-underline flex flex-col items-center justify-between py-3.5 hover:-translate-y-2 transition ${
        ended
          ? 'bg-sunk text-ink2 border-2 border-dashed border-line'
          : `shadow-[inset_-6px_0_0_rgba(0,0,0,0.08)] ${SPINES[i % SPINES.length]}`
      }`}
      style={{ height }}
      aria-label={`${item.course.title}, ${ended ? 'access ended, buy again' : `${item.course.fileCount} files`}`}
    >
      <span className="font-mono text-[10px] font-semibold">
        {ended ? (item.access.state === 'blocked' ? 'PAUSED' : 'ENDED') : `S${item.course.semester}`}
      </span>
      <span className="[writing-mode:vertical-rl] rotate-180 font-display font-extrabold text-[19px] tracking-[-0.03em] leading-none max-h-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
        {item.course.title}
      </span>
      <span aria-hidden="true" className="w-8 h-[3px] bg-current opacity-40" />
    </Link>
  );
}

export function ShelfPage() {
  const { me } = useSession();
  const shelf = useQuery({ queryKey: ['shelf'], queryFn: api.shelf });
  useEffect(() => prefetchChunk('reader'), []);
  const first = me?.fullName?.split(' ')[0] ?? me?.email.split(/[.@]/)[0] ?? '';
  const active = (shelf.data ?? []).filter((s) => s.access.state === 'active');
  const ended = (shelf.data ?? []).filter((s) => s.access.state !== 'active');
  const resume = active.find((s) => s.lastRead);

  return (
    <Page>
      <div className="pt-4 flex flex-col gap-8">
        <div>
          <p className="m-0 text-[15px] text-ink2">
            {first ? `Hi ${first[0]!.toUpperCase()}${first.slice(1)},` : 'Hi,'}
          </p>
          <h1 className="m-0 font-display font-extrabold text-[clamp(40px,6vw,60px)] leading-[1.02]">
            Your <span className="stack-word">shelf</span>
          </h1>
        </div>

        {shelf.isLoading ? (
          <>
            <Skeleton className="h-40" />
            <Skeleton className="h-72" />
          </>
        ) : shelf.isError ? (
          <ErrorState
            title="Your shelf didn't load."
            message={friendly(shelf.error)}
            onRetry={() => shelf.refetch()}
          />
        ) : active.length > 0 || ended.length > 0 ? (
          <>
            {resume?.lastRead && (
              <Link
                to={`/read/${resume.lastRead.fileId}`}
                className="relative flex flex-col gap-2.5 p-5 pr-24 rounded-[22px] bg-brand text-white no-underline max-w-[640px]"
              >
                <span
                  aria-hidden="true"
                  className="absolute left-6 -top-1.5 w-4 h-[30px] bg-blush [clip-path:polygon(0_0,100%_0,100%_100%,50%_75%,0_100%)]"
                />
                <span className="text-[13px] font-semibold text-on-brand2">
                  Pick up where you left off · page {resume.lastRead.page} of {resume.lastRead.pageCount}
                </span>
                <span className="font-display font-extrabold text-[28px] leading-none tracking-[-0.04em] break-words">
                  {resume.lastRead.fileName.replace(/\.[a-z]+$/i, '').replace(/[-_]/g, ' ')}
                </span>
                <span className="text-[13px] text-on-brand2">{resume.course.title}</span>
                <span className="h-1.5 rounded-full bg-white/20 overflow-hidden">
                  <span
                    className="block h-1.5 bg-mist"
                    style={{ width: `${(resume.lastRead.page / resume.lastRead.pageCount) * 100}%` }}
                  />
                </span>
                <span
                  aria-hidden="true"
                  className="absolute right-5 top-5 w-[52px] h-[52px] rounded-full bg-mist text-on-mist inline-flex items-center justify-center"
                >
                  <Play />
                </span>
              </Link>
            )}

            {(active.length > 0 || ended.length > 0) && (
              <section aria-labelledby="shelf-title">
                <div className="flex items-baseline justify-between mb-3">
                  <h2
                    id="shelf-title"
                    className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]"
                  >
                    Your courses
                  </h2>
                  <span className="font-mono text-[11px] text-ink2">
                    {active.length} {active.length === 1 ? 'course' : 'courses'}
                    {ended.length > 0 && ` · ${ended.length} ended`}
                  </span>
                </div>
                <div className="flex items-end gap-2.5 overflow-x-auto px-1.5 pt-4 min-h-[320px]">
                  {[...active, ...ended].map((item, i) => (
                    <Spine key={item.course.id} item={item} i={i} />
                  ))}
                  <Link
                    to="/#catalogue"
                    className="flex-none w-[60px] h-[250px] rounded-lg border-2 border-dashed border-line text-ink2 no-underline flex flex-col items-center justify-center gap-2.5 -rotate-[4deg] origin-bottom-left"
                  >
                    <span className="text-2xl leading-none">+</span>
                    <span className="[writing-mode:vertical-rl] rotate-180 text-[13px] font-semibold">
                      Add from catalogue
                    </span>
                  </Link>
                </div>
                <div aria-hidden="true" className="h-3 rounded bg-brand" />
              </section>
            )}

            {active.length > 0 && (
              <ul className="list-none m-0 p-0 flex flex-col">
                {active.map((item) => (
                  <li key={item.course.id}>
                    <Link
                      to={`/c/${item.course.slug}`}
                      className="flex items-baseline gap-3 py-4 border-b border-line text-ink no-underline"
                    >
                      <span className="font-mono text-xs text-teal-text">{item.course.callNo}</span>
                      <span className="flex-1 font-display font-bold text-xl tracking-[-0.02em]">
                        {item.course.title}
                      </span>
                      <span className="flex flex-col items-end text-sm text-ink2">
                        <span className="hidden sm:inline">
                          {item.course.fileCount} files ·{' '}
                          {item.lastRead ? `p. ${item.lastRead.page}` : 'not started'}
                        </span>
                      </span>
                      <ArrowRight size={18} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {ended.length > 0 && (
              <section aria-labelledby="ended-title" className="flex flex-col gap-2">
                <h2
                  id="ended-title"
                  className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]"
                >
                  Access ended
                </h2>
                <p className="m-0 text-sm text-ink2 max-w-[560px]">
                  These courses no longer open. Your reading progress is kept, so buying a course again picks
                  up where you left off.
                </p>
                <ul className="list-none m-0 p-0 flex flex-col">
                  {ended.map((item) => (
                    <li
                      key={item.course.id}
                      className="flex flex-col gap-2 py-4 border-b border-line sm:flex-row sm:items-center sm:gap-4"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-xs text-ink2">{item.course.callNo}</span>
                        <span className="block font-display font-bold text-xl tracking-[-0.02em] text-ink2">
                          {item.course.title}
                        </span>
                        <span className="block text-sm text-ink2">
                          {item.access.state === 'blocked'
                            ? 'Paused by the library. Contact us if you think this is a mistake.'
                            : `Your access ended${item.access.endedAt ? ` on ${day(item.access.endedAt)}` : ''}.`}
                        </span>
                      </span>
                      {item.access.state === 'blocked' ? (
                        <LinkButton to="/contact" variant="outline" className="self-start sm:self-auto">
                          Contact us
                        </LinkButton>
                      ) : (
                        <LinkButton
                          to={`/c/${item.course.slug}`}
                          variant="brand"
                          className="self-start sm:self-auto"
                        >
                          Buy again
                        </LinkButton>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          <div className="rounded-3xl border-2 border-dashed border-line p-10 flex flex-col items-start gap-4">
            <p className="m-0 font-display font-extrabold text-[34px] leading-none tracking-[-0.04em]">
              An empty shelf, for now.
            </p>
            <p className="m-0 text-ink2 max-w-[460px]">
              Pick your batch drawer, flip through the cards, and the courses you buy will stand here.
            </p>
            <LinkButton to="/#catalogue" variant="brand">
              Open the catalogue
            </LinkButton>
          </div>
        )}
      </div>
    </Page>
  );
}
