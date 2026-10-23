import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { useSession } from '../../lib/session';
import { Stamp } from '../../shared/ui/brand';
import { Button, LinkButton } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { ArrowRight, Box, Check } from '../../shared/ui/icons';
import { PriceTag } from '../../shared/ui/index-card';
import { Reveal } from '../../shared/ui/motion';
import { useBuy } from '../checkout/use-buy';

export function BundlePage() {
  const { slug = '' } = useParams();
  const { status } = useSession();
  const q = useQuery({ queryKey: ['bundle', slug, status], queryFn: () => api.bundle(slug) });
  const buyState = useBuy({ bundleId: q.data?.id ?? slug }, `/b/${slug}`);

  if (q.isLoading)
    return (
      <Page wide>
        <Skeleton className="h-80 mt-6" />
      </Page>
    );
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
    .reduce((sum, course) => sum + course.pricePaise, 0);
  const savePaise = Math.max(0, remainingListPaise - b.yourPricePaise);
  const savePercent =
    remainingListPaise > 0 ? Math.round((savePaise / remainingListPaise) * 100) : b.savePercent;

  return (
    <Page wide>
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2.5 font-mono text-[13px] text-ink2 mb-6 mt-2"
      >
        <Link
          to={b.batchYear ? `/?batch=${b.batchYear}#catalogue` : '/#catalogue'}
          className="text-ink2 no-underline"
        >
          {b.batchYear ? `DRAWER ${b.batchYear}` : 'CATALOGUE'}
        </Link>
        <span aria-hidden="true">→</span>
        <span className="text-ink">BUNDLE</span>
      </nav>

      <section className="relative bg-brand text-white rounded-[32px] overflow-hidden p-6 sm:p-10">
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-2 bg-marigold" />
        <div className="relative pl-3 flex flex-wrap items-center gap-8 justify-between">
          <div className="flex-[1_1_480px] min-w-0 flex flex-col gap-4">
            <span className="inline-flex items-center gap-2 self-start h-8 px-3.5 rounded-full bg-marigold text-on-marigold font-mono text-xs font-semibold tracking-[0.1em]">
              <Box size={15} /> BUNDLE · {b.courseCount} COURSES · {b.pageCount} PAGES
            </span>
            <h1 className="m-0 font-display font-extrabold text-[clamp(40px,6.4vw,80px)] leading-[0.92] tracking-[-0.055em]">
              {b.title}
            </h1>
            {b.description && (
              <p className="m-0 text-lg leading-relaxed text-on-brand2 max-w-[620px]">{b.description}</p>
            )}
          </div>
          <div className="flex-[0_1_340px] min-w-[260px] bg-surface text-ink rounded-[26px] p-6 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center gap-4">
              <Stamp
                label={`${savePercent}%`}
                ring="OFF · BUNDLE PRICE · SAVE · "
                tone="marigold"
                size={104}
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
                    You save {formatRupees(savePaise)} ({savePercent}%)
                  </span>
                )}
              </div>
            </div>
            {b.ownedCount > 0 && !allOwned && (
              <p className="m-0 text-sm rounded-xl bg-sunk px-3 py-2">
                You already own {b.ownedCount} of these, so your price is lower and you get the other{' '}
                {b.courseCount - b.ownedCount}.
              </p>
            )}
            {allOwned ? (
              <LinkButton to="/shelf" variant="brand" size="lg">
                All on your shelf <ArrowRight size={18} />
              </LinkButton>
            ) : (
              <Button variant="buy" size="lg" onClick={buyState.buy} disabled={buyState.busy}>
                {buyState.busy
                  ? 'Opening payment…'
                  : buyState.signedIn
                    ? `Get all ${b.courseCount - b.ownedCount} for ${formatRupees(b.yourPricePaise)}`
                    : 'Sign in to buy'}
              </Button>
            )}
            {buyState.error && (
              <p role="alert" className="m-0 text-sm bg-blush text-blush-text rounded-xl px-3 py-2">
                {buyState.error}
              </p>
            )}
            <span className="text-[13px] leading-relaxed text-ink2">
              One payment, every course below on your shelf. All sales are final.
            </span>
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
          <span className="font-mono text-[13px] text-ink2">OPEN A CARD TO PEEK AT EVERY UNIT</span>
        </div>
        <ul className="list-none m-0 p-0 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {b.courses.map((c, i) => (
            <Reveal as="li" key={c.id} index={i}>
              <Link
                to={`/c/${c.slug}`}
                className="ruled group relative flex flex-col gap-2 h-full p-5 rounded-xl no-underline text-ink shadow-[0_14px_30px_-22px_var(--shadow),0_0_0_1px_var(--line)] hover:-translate-y-1 transition"
              >
                <span className="flex justify-between font-mono text-[11px] text-ink2 pb-2 border-b-2 border-card-head">
                  <span>{c.callNo}</span>
                  <span>{c.fileCount} FILES</span>
                </span>
                <span className="font-display font-extrabold text-[24px] leading-[1.05] tracking-[-0.03em]">
                  {c.title}
                </span>
                <span className="mt-auto pt-3 flex items-center justify-between">
                  {c.owned ? (
                    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-mist text-on-mist text-xs font-semibold">
                      <Check size={13} /> On your shelf
                    </span>
                  ) : (
                    <PriceTag paise={c.pricePaise} className="opacity-70" />
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
