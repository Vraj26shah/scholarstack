import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { formatRupees, offerEnds } from '../../lib/format';
import { useSession } from '../../lib/session';
import { Ambient } from '../../shared/ui/ambient';
import { Stamp } from '../../shared/ui/brand';
import { Button, LinkButton } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { ArrowRight, Check } from '../../shared/ui/icons';
import { PriceTag, Ribbon, keepDot } from '../../shared/ui/index-card';
import { Reveal } from '../../shared/ui/motion';
import { PreviewBar } from '../../shared/ui/preview-bar';
import { PaymentProblem } from '../checkout/payment-problem';
import { useBuy } from '../checkout/use-buy';

export function BundlePage() {
  const { slug = '' } = useParams();
  const { status } = useSession();
  const q = useQuery({ queryKey: ['bundle', slug, status], queryFn: () => api.bundle(slug) });
  const buyState = useBuy({ bundleId: q.data?.id ?? slug }, `/b/${slug}`);

  if (q.isLoading) return <BundlePageSkeleton />;
  if (q.isError || !q.data)
    return (
      <Page wide>
        <div className="mt-10">
          <ErrorState
            title="That bundle isn't on the shelf."
            message={friendly(q.error)}
            onRetry={() => q.refetch()}
          />
        </div>
      </Page>
    );

  const b = q.data;
  const allOwned = b.ownedCount === b.courseCount;
  const remainingListPaise = b.courses
    .filter((course) => !course.owned)
    .reduce((sum, course) => sum + (course.offer?.fullPricePaise ?? course.pricePaise), 0);
  const savePaise = Math.max(0, remainingListPaise - b.yourPricePaise);
  const savePercent =
    remainingListPaise > 0 ? Math.round((savePaise / remainingListPaise) * 100) : b.savePercent;

  return (
    <Page wide>
      {b.preview && <PreviewBar what="bundle" section="bundles" />}
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2.5 font-mono text-[13px] text-ink2 mb-6 mt-2"
      >
        <Link
          to={
            b.forDrawer
              ? `/?batch=${b.forDrawer.split(':')[0]}&branch=${b.forDrawer.split(':')[1]}#catalogue`
              : b.batchYear
                ? `/?batch=${b.batchYear}#catalogue`
                : '/#catalogue'
          }
          className="text-ink2 no-underline"
        >
          {b.forDrawer
            ? `Drawer ${b.forDrawer.split(':')[0]}`
            : b.batchYear
              ? `Drawer ${b.batchYear}`
              : 'Catalogue'}
        </Link>
        <span aria-hidden="true">→</span>
        <span className="text-ink">Bundle</span>
      </nav>

      <section className="relative bg-brand text-white rounded-[28px] sm:rounded-[32px] overflow-hidden p-5 sm:p-10">
        <Ambient tone="navy" />
        <Ribbon className="ribbon-lg" />
        <div className="relative pl-12 flex flex-wrap items-center gap-6 sm:gap-8 justify-between">
          <div className="flex-[1_1_480px] min-w-0 flex flex-col gap-3 sm:gap-4">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-[13px] font-semibold tracking-[0.12em] text-marigold">
                Bundle of {b.courseCount} courses
              </span>
              <span className="font-mono text-xs text-on-brand2">{b.pageCount} pages</span>
            </span>
            <h1 className="m-0 font-display font-extrabold text-[clamp(34px,6.4vw,80px)] leading-[0.95] tracking-[-0.05em] text-balance">
              {keepDot(b.title)}
            </h1>
            {b.description && (
              <p className="m-0 text-[15px] sm:text-lg leading-relaxed text-on-brand2 max-w-[620px]">
                {b.description}
              </p>
            )}
          </div>
          <div className="flex-[1_1_300px] sm:flex-[0_1_360px] min-w-0 bg-surface text-ink rounded-[24px] overflow-hidden flex flex-col shadow-2xl">
            {!allOwned && b.offer && (
              <p className="m-0 px-5 sm:px-6 py-2.5 bg-marigold text-on-marigold text-[13.5px] font-bold">
                {b.offer.title} · {b.offer.percentOff}% off ·{' '}
                <span className="whitespace-nowrap">till {offerEnds(b.offer.endsAt)}</span>
              </p>
            )}
            <div className="p-5 sm:p-6 flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <Stamp
                  label={`${savePercent}%`}
                  ring="OFF · BUNDLE PRICE · SAVE · "
                  tone="marigold"
                  size={88}
                  rotate={-14}
                  animate
                  delay={0.3}
                />
                <div className="flex flex-col">
                  <span className="font-mono text-sm text-ink2 line-through">
                    {formatRupees(remainingListPaise || b.listPricePaise)}
                  </span>
                  <span className="font-display font-extrabold text-[46px] leading-none tracking-[-0.04em] tabular-nums">
                    {formatRupees(allOwned ? b.pricePaise : b.yourPricePaise)}
                  </span>
                  {!allOwned && savePaise > 0 && (
                    <span className="text-sm font-semibold text-teal-text">
                      You save {formatRupees(savePaise)}
                    </span>
                  )}
                  {!allOwned && b.courseCount - b.ownedCount > 1 && (
                    <span className="text-[13px] text-ink2">
                      {formatRupees(
                        Math.floor(b.yourPricePaise / (b.courseCount - b.ownedCount) / 100) * 100,
                      )}{' '}
                      a course
                    </span>
                  )}
                </div>
              </div>
              {b.ownedCount > 0 && !allOwned && (
                <p className="m-0 text-sm text-ink2">
                  You already own {b.ownedCount} of these, so your price is lower and you get the other{' '}
                  {b.courseCount - b.ownedCount}.
                </p>
              )}
              {allOwned ? (
                <LinkButton to="/shelf" variant="brand" size="lg">
                  All on your shelf <ArrowRight size={18} />
                </LinkButton>
              ) : (
                <Button variant="buy" size="lg" onClick={buyState.buy} disabled={buyState.busy || b.preview}>
                  {buyState.busy
                    ? 'Opening payment…'
                    : buyState.signedIn
                      ? `Get all ${b.courseCount - b.ownedCount} for ${formatRupees(b.yourPricePaise)}`
                      : 'Sign in to buy'}
                </Button>
              )}
              {buyState.error && (
                <p role="status" className="m-0 text-sm bg-blush text-blush-text rounded-xl px-3 py-2">
                  {buyState.error}
                </p>
              )}
              <PaymentProblem problem={buyState.problem} onRetry={buyState.buy} onClose={buyState.dismiss} />
              <span className="text-[13px] leading-relaxed text-ink2">
                One payment, every course below on your shelf. All sales are final.
              </span>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="inside-title" className="mt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
          <h2
            id="inside-title"
            className="m-0 font-display font-extrabold text-[clamp(32px,4vw,44px)] tracking-[-0.045em] leading-none"
          >
            In this bundle
          </h2>
          <span className="text-sm text-ink2">Open a card to peek at every unit</span>
        </div>
        <ul className="list-none m-0 p-0 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {b.courses.map((c, i) => (
            <Reveal as="li" key={c.id} index={i}>
              <Link
                to={`/c/${c.slug}`}
                className="ruled group relative flex flex-col gap-2 h-full p-5 rounded-xl no-underline text-ink shadow-[0_14px_30px_-22px_var(--shadow),0_0_0_1px_var(--line)] transition"
              >
                <span className="flex justify-between font-mono text-[11px] text-ink2 pb-2 border-b-2 border-card-head">
                  <span>{c.callNo}</span>
                  <span>{c.fileCount} files</span>
                </span>
                <span className="font-display font-extrabold text-[24px] leading-[1.05] tracking-[-0.03em]">
                  {c.title}
                </span>
                {c.blurb && (
                  <span className="text-[13.5px] leading-snug text-ink2 line-clamp-2">{c.blurb}</span>
                )}
                <span className="mt-auto pt-3 flex items-center justify-between">
                  {c.owned ? (
                    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-mist text-on-mist text-xs font-semibold">
                      <Check size={13} /> On your shelf
                    </span>
                  ) : (
                    <PriceTag paise={c.pricePaise} offer={c.offer} className="opacity-70" />
                  )}
                  <span className="text-sm font-semibold text-teal-text">Peek inside →</span>
                </span>
              </Link>
            </Reveal>
          ))}
        </ul>
      </section>
    </Page>
  );
}

const Bar = ({ className = '' }: { className?: string }) => (
  <span aria-hidden="true" className={`block rounded-full bg-white/15 bundle-shimmer ${className}`} />
);

/**
 * The bundle page while it loads, laid out exactly like the real one: breadcrumb, the navy
 * ribbon-tied header with the price box, then the cards in the bundle. Nothing jumps when the
 * bundle arrives.
 */
function BundlePageSkeleton() {
  return (
    <Page wide>
      <div aria-busy="true" aria-label="Loading bundle">
        <span className="sr-only">Loading bundle…</span>
        <Skeleton className="h-4 w-40 mb-6 mt-3" />
        <section className="relative bg-brand rounded-[28px] sm:rounded-[32px] overflow-hidden p-5 sm:p-10">
          <Ribbon className="ribbon-lg" />
          <div className="relative pl-12 flex flex-wrap items-center gap-6 sm:gap-8 justify-between">
            <div className="flex-[1_1_480px] min-w-0 flex flex-col gap-4">
              <Bar className="h-3.5 w-44 !bg-marigold/60" />
              <Bar className="h-12 sm:h-16 w-[85%]" />
              <Bar className="h-12 sm:h-16 w-[55%]" />
              <span className="flex flex-col gap-2 mt-1">
                <Bar className="h-3.5 w-full max-w-[560px]" />
                <Bar className="h-3.5 w-[70%] max-w-[420px]" />
              </span>
            </div>
            <div className="flex-[1_1_300px] sm:flex-[0_1_360px] min-w-0 bg-surface rounded-[24px] p-5 sm:p-6 flex flex-col gap-4 shadow-2xl">
              <div className="flex items-center gap-4">
                <Skeleton className="size-[88px] !rounded-full shrink-0" />
                <div className="flex flex-col gap-2 flex-1">
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-11 w-32" />
                  <Skeleton className="h-3.5 w-24" />
                </div>
              </div>
              <Skeleton className="h-14 w-full !rounded-full" />
              <Skeleton className="h-3 w-[80%]" />
            </div>
          </div>
        </section>
        <Skeleton className="h-10 w-64 mt-14 mb-5" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 !rounded-xl" />
          ))}
        </div>
      </div>
    </Page>
  );
}
