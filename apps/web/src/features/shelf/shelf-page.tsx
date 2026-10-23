import type { ShelfItemDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { useSession } from '../../lib/session';
import { LinkButton } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { ArrowRight, Play } from '../../shared/ui/icons';

const SPINES = [
  'bg-mist text-on-mist',
  'bg-teal text-white',
  'bg-[#25306A] text-white',
  'bg-blush text-blush-text border border-line',
  'bg-ink text-bg',
];

function Spine({ item, i }: { item: ShelfItemDto; i: number }) {
  const height = Math.min(300, 200 + Math.round(item.course.pageCount / 3));
  return (
    <Link
      to={`/c/${item.course.slug}`}
      className={`flex-none w-[68px] sm:w-[76px] rounded-lg no-underline flex flex-col items-center justify-between py-3.5 shadow-[inset_-6px_0_0_rgba(0,0,0,0.08)] hover:-translate-y-2 transition ${SPINES[i % SPINES.length]}`}
      style={{ height }}
      aria-label={`${item.course.title}, ${item.course.fileCount} files`}
    >
      <span className="font-mono text-[10px] font-semibold">S{item.course.semester}</span>
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
  const first = me?.fullName?.split(' ')[0] ?? me?.email.split(/[.@]/)[0] ?? '';
  const resume = shelf.data?.find((s) => s.lastRead);

  return (
    <Page>
      <div className="pt-4 flex flex-col gap-8">
        <div>
          <p className="font-mono text-[11px] tracking-[0.14em] text-ink2 m-0 uppercase">
            {first ? `${first}'s` : 'Your'}
          </p>
          <h1 className="m-0 font-display font-extrabold text-[clamp(48px,8vw,72px)] leading-[0.95] tracking-[-0.05em]">
            Shelf<span className="text-teal-text">.</span>
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
        ) : shelf.data && shelf.data.length > 0 ? (
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
                <span className="font-mono text-[11px] tracking-[0.14em] text-on-brand2">
                  BOOKMARKED · P. {String(resume.lastRead.page).padStart(2, '0')} OF{' '}
                  {resume.lastRead.pageCount}
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

            <section aria-labelledby="shelf-title">
              <div className="flex items-baseline justify-between mb-3">
                <h2
                  id="shelf-title"
                  className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]"
                >
                  On your shelf
                </h2>
                <span className="font-mono text-[11px] text-ink2">
                  {shelf.data.length} {shelf.data.length === 1 ? 'COURSE' : 'COURSES'}
                </span>
              </div>
              <div className="flex items-end gap-2.5 overflow-x-auto px-1.5 pt-4 min-h-[320px]">
                {shelf.data.map((item, i) => (
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

            <ul className="list-none m-0 p-0 flex flex-col">
              {shelf.data.map((item) => (
                <li key={item.course.id}>
                  <Link
                    to={`/c/${item.course.slug}`}
                    className="flex items-baseline gap-3 py-4 border-b border-line text-ink no-underline"
                  >
                    <span className="font-mono text-xs text-teal-text">{item.course.callNo}</span>
                    <span className="flex-1 font-display font-bold text-xl tracking-[-0.02em]">
                      {item.course.title}
                    </span>
                    <span className="text-sm text-ink2 hidden sm:inline">
                      {item.course.fileCount} files ·{' '}
                      {item.lastRead ? `p. ${item.lastRead.page}` : 'not started'}
                    </span>
                    <ArrowRight size={18} />
                  </Link>
                </li>
              ))}
            </ul>
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
