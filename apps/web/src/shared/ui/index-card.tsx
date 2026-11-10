import type { BundleCardDto, CourseCardDto, PriceOfferDto } from '@ss/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatRupees, formatsLabel, offerEnds } from '../../lib/format';
import { prefetchBundle, prefetchChunk, prefetchCourse } from '../../lib/prefetch';
import { useSession } from '../../lib/session';

/**
 * The price as a small ink tag: calm and clear (red would read as a warning). During an offer the
 * old price sits struck through beside it.
 */
export function PriceTag({
  paise,
  offer,
  className = '',
}: { paise: number; offer?: PriceOfferDto; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="inline-flex items-center h-8 px-3 border-[1.5px] border-price/70 rounded-full text-price font-mono text-sm font-semibold">
        {formatRupees(paise)}
      </span>
      {offer && (
        <span className="font-mono text-[13px] text-ink2 line-through decoration-1">
          <span className="sr-only">was </span>
          {formatRupees(offer.fullPricePaise)}
        </span>
      )}
    </span>
  );
}

/** "Diwali pack · 2025 BCE": a line break never leaves the "·" at the start of a line. */
export const keepDot = (title: string) => title.replace(/ · /g, '\u00a0· ');

/** "Diwali offer · 20% off · till 14 Nov": one quiet line, never a flashing banner. */
export function OfferNote({ offer, className = '' }: { offer: PriceOfferDto; className?: string }) {
  return (
    <span className={`font-mono text-[11.5px] font-semibold tracking-[0.04em] ${className}`}>
      {offer.title} · {offer.percentOff}% off ·{' '}
      <span className="whitespace-nowrap">till {offerEnds(offer.endsAt)}</span>
    </span>
  );
}

/** A course as a ruled, punched index card. Dealt into the drawer, lifts gently on hover. */
export function IndexCard({
  course,
  index = 0,
  animate = true,
}: {
  course: CourseCardDto;
  index?: number;
  animate?: boolean;
}) {
  const qc = useQueryClient();
  const { status } = useSession();
  const warm = () => prefetchCourse(qc, course.slug, status);
  return (
    <div
      className={`h-full ${animate ? 'deal-in' : ''}`}
      style={animate ? { ['--i' as string]: index } : undefined}
    >
      <Link
        to={`/c/${course.slug}`}
        onPointerEnter={warm}
        onFocus={warm}
        onTouchStart={warm}
        className="lift ruled group relative flex flex-col h-full min-h-[240px] p-[16px_18px_44px] rounded-xl no-underline text-ink shadow-[0_18px_36px_-22px_var(--shadow),0_0_0_1px_var(--line)] hover:shadow-[0_28px_48px_-28px_var(--shadow),0_0_0_1px_var(--teal)]"
      >
        <span className="flex justify-between gap-2 font-mono text-[11px] text-ink2 pb-2 border-b-2 border-card-head">
          <span>
            {course.courseCode ? `${course.courseCode} · ` : ''}
            {course.callNo}
          </span>
          <span>{course.fileCount} files</span>
        </span>
        <span className="font-display font-extrabold text-[27px] leading-[1.02] tracking-[-0.035em] mt-3.5">
          {course.title}
        </span>
        {course.blurb && (
          <span className="mt-2 text-[13.5px] leading-snug text-ink2 line-clamp-2">{course.blurb}</span>
        )}
        <span className="font-mono text-xs text-ink2 mt-2.5">
          {course.pageCount} pages · {formatsLabel(course.formats)}
        </span>
        {course.offer && <OfferNote offer={course.offer} className="mt-2.5 text-teal-text" />}
        <span className="mt-auto pt-4 flex items-center justify-between gap-2">
          <PriceTag paise={course.pricePaise} offer={course.offer} />
          <span className="text-sm font-semibold text-teal-text inline-flex items-center gap-1">
            Peek inside <span aria-hidden="true">→</span>
          </span>
        </span>
        <span aria-hidden="true" className="punch-hole" style={{ background: 'var(--surface)' }} />
      </Link>
    </div>
  );
}

/**
 * A bundle as a box of cards tied with a marigold ribbon. Anchors on the struck-through
 * list price so the saving is obvious at a glance. The card lays itself out by its own
 * width (container query): side by side when it has room, stacked and compact when not,
 * so a row of bundles, a phone carousel or a single wide bundle all read cleanly.
 */
export function BundleBox({ bundle, compact = false }: { bundle: BundleCardDto; compact?: boolean }) {
  const savePaise = Math.max(0, bundle.listPricePaise - bundle.pricePaise);
  const qc = useQueryClient();
  const { status } = useSession();
  const warm = () => {
    prefetchChunk('bundle');
    prefetchBundle(qc, bundle.slug, status);
  };
  const n = Math.max(1, bundle.courseCount);
  // "₹70 a course" against what one costs alone: the clearest way to say why a pack is worth it.
  const perCourse = Math.floor(bundle.pricePaise / n / 100) * 100;
  const alone = Math.round(bundle.listPricePaise / n / 100) * 100;
  const inside = bundle.courseTitles ?? [];
  return (
    <Link
      to={`/b/${bundle.slug}`}
      onPointerEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      aria-label={`${bundle.title}: ${bundle.courseCount} courses for ${formatRupees(bundle.pricePaise)}`}
      className={`@container group relative flex h-full no-underline text-white rounded-[22px] bg-brand overflow-hidden shadow-[0_24px_44px_-26px_var(--shadow)] lift ${
        compact ? 'p-4' : 'p-5'
      }`}
    >
      <Ribbon />
      <span className="relative pl-8 flex w-full flex-col gap-4 @xl:flex-row @xl:items-center @xl:justify-between @xl:gap-8">
        <span className="flex min-w-0 flex-col gap-2 @xl:max-w-[600px]">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="font-mono text-[12px] font-semibold tracking-[0.12em] text-marigold">
              {bundle.courseCount} courses
            </span>
            {bundle.offer && (
              <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-marigold text-on-marigold text-[11.5px] font-bold">
                {bundle.offer.title} · {bundle.offer.percentOff}% off
              </span>
            )}
          </span>
          <span className="font-display font-extrabold leading-[1.04] tracking-[-0.035em] text-[clamp(22px,2.4vw,30px)] line-clamp-2">
            {keepDot(bundle.title)}
          </span>
          {inside.length > 0 ? (
            <span className="text-[13.5px] leading-snug text-on-brand2 line-clamp-2">
              {inside.join(' · ')}
            </span>
          ) : (
            !compact &&
            bundle.description && (
              <span className="text-[14px] leading-relaxed text-on-brand2 line-clamp-2">
                {bundle.description}
              </span>
            )
          )}
          <span className="font-mono text-[11.5px] text-on-brand2">
            {bundle.fileCount} files · {bundle.pageCount} pages
            {bundle.offer && (
              <>
                {' · '}
                <span className="whitespace-nowrap">till {offerEnds(bundle.offer.endsAt)}</span>
              </>
            )}
          </span>
        </span>

        <span className="mt-auto flex flex-col gap-3 pt-4 border-t border-white/15 @xl:mt-0 @xl:pt-0 @xl:border-t-0 @xl:items-end @xl:shrink-0">
          <span className="flex items-end justify-between gap-3 @xl:flex-col @xl:items-end @xl:gap-1">
            <span className="flex items-baseline gap-2">
              <span className="font-display font-extrabold text-[36px] @xl:text-[42px] leading-none tracking-[-0.04em] tabular-nums">
                {formatRupees(bundle.pricePaise)}
              </span>
              {savePaise > 0 && (
                <span className="font-mono text-sm text-on-brand2 line-through decoration-1">
                  <span className="sr-only">instead of </span>
                  {formatRupees(bundle.listPricePaise)}
                </span>
              )}
            </span>
            {savePaise > 0 && (
              <span className="shrink-0 inline-flex items-center h-7 px-2.5 rounded-lg bg-white/10 text-marigold text-[13px] font-bold tabular-nums">
                Save {bundle.savePercent}%
              </span>
            )}
          </span>
          {n > 1 && (
            <span className="text-[13px] text-on-brand2 @xl:text-right">
              <strong className="text-white font-semibold">{formatRupees(perCourse)} a course</strong>
              {alone > perCourse && <> · about {formatRupees(alone)} alone</>}
            </span>
          )}
          <span className="inline-flex items-center justify-center gap-1.5 h-11 rounded-full bg-marigold text-on-marigold text-[14px] font-bold @xl:h-auto @xl:bg-transparent @xl:text-white @xl:justify-end @xl:text-[13px] @xl:font-semibold">
            See what's inside <span aria-hidden="true">→</span>
          </span>
        </span>
      </span>
    </Link>
  );
}

/** A satin ribbon tied round a bundle, with a bow that gives a little wiggle on hover. */
export function Ribbon({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`ribbon absolute ${className}`}>
      <span className="ribbon-band" />
      <svg className="ribbon-bow" viewBox="0 0 64 40" width="46" height="29">
        <path d="M32 20 C 22 4, 4 2, 6 14 C 7 24, 22 24, 32 20 Z" />
        <path d="M32 20 C 42 4, 60 2, 58 14 C 57 24, 42 24, 32 20 Z" />
        <path d="M29 22 L 20 38 L 27 34 L 30 39 L 32 23 Z M35 22 L 44 38 L 37 34 L 34 39 L 32 23 Z" />
        <rect x="27.5" y="15.5" width="9" height="9" rx="3" />
      </svg>
    </span>
  );
}

/**
 * Grid spans for bundle cards so no card is left stranded on its own short row: a leftover
 * card stretches across the row, and being wide it switches to its side-by-side layout.
 * Two columns on tablets; three (a six-track grid) on wide screens.
 */
function bundleSpan(i: number, count: number): string {
  const tablet = count % 2 === 1 && i === count - 1 ? 'sm:col-span-2' : '';
  const rem = count % 3;
  const wide =
    rem === 1 && i === count - 1
      ? 'xl:col-span-6'
      : rem === 2 && i >= count - 2
        ? 'xl:col-span-3'
        : 'xl:col-span-2';
  return `${tablet} ${wide}`;
}

/** One soft bar inside a navy bundle card while it loads. */
const Bar = ({ className = '' }: { className?: string }) => (
  <span aria-hidden="true" className={`block rounded-full bg-white/15 bundle-shimmer ${className}`} />
);

/**
 * A bundle card while it loads: the same navy card, ribbon and layout as the real one, with soft
 * bars where the course count, title, courses, price and button will be. The page doesn't jump
 * when the real card arrives, and it is clear a pack is on its way.
 */
export function BundleSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`@container relative flex h-full rounded-[22px] bg-brand overflow-hidden shadow-[0_24px_44px_-26px_var(--shadow)] ${
        compact ? 'p-4' : 'p-5'
      }`}
    >
      <Ribbon />
      <span className="relative pl-8 flex w-full flex-col gap-4 @xl:flex-row @xl:items-center @xl:justify-between @xl:gap-8">
        <span className="flex min-w-0 flex-1 flex-col gap-3 @xl:max-w-[600px]">
          <Bar className="h-3 w-24 !bg-marigold/60" />
          <Bar className="h-7 w-[78%]" />
          <span className="flex flex-col gap-2">
            <Bar className="h-3 w-full" />
            <Bar className="h-3 w-[64%]" />
          </span>
          <Bar className="h-2.5 w-36" />
        </span>
        <span className="mt-auto flex flex-col gap-3 pt-4 border-t border-white/15 @xl:mt-0 @xl:pt-0 @xl:border-t-0 @xl:items-end @xl:w-[260px] @xl:shrink-0">
          <span className="flex items-end justify-between gap-3 @xl:flex-col @xl:items-end @xl:gap-2">
            <Bar className="h-9 w-28 @xl:h-10" />
            <Bar className="h-7 w-24 !rounded-lg @xl:h-6 @xl:w-20" />
          </span>
          <Bar className="h-3 w-44 @xl:w-40" />
          <Bar className="h-11 w-full !bg-marigold/55 @xl:h-3.5 @xl:w-32" />
        </span>
      </span>
    </div>
  );
}

/** Where the drawer's pack will appear, while it loads. */
export function BundleGridSkeleton({ className = '' }: { className?: string }) {
  return (
    <section aria-label="Loading bundles" aria-busy="true" className={className}>
      <BundleSkeleton />
      <span className="sr-only">Loading bundles…</span>
    </section>
  );
}

/** Bundles side by side: a swipeable row on phones, two or three per row on wider screens. */
export function BundleGrid({
  bundles,
  className = '',
  animate = true,
}: {
  bundles: BundleCardDto[];
  className?: string;
  animate?: boolean;
}) {
  if (!bundles.length) return null;
  const one = bundles.length === 1;
  return (
    <section aria-label="Bundles" className={className}>
      <ul
        className={`list-none m-0 p-0 -mx-5 px-5 sm:mx-0 sm:px-0 flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 sm:pb-0 sm:overflow-visible sm:grid ${
          one ? 'sm:grid-cols-1' : 'sm:grid-cols-2 xl:grid-cols-6'
        }`}
      >
        {bundles.map((b, i) => (
          <li
            key={b.id}
            className={`${animate ? 'deal-in ' : ''}snap-start shrink-0 sm:shrink ${one ? 'w-full' : `w-[86%] sm:w-auto ${bundleSpan(i, bundles.length)}`}`}
            style={animate ? { ['--i' as string]: i } : undefined}
          >
            <BundleBox bundle={b} />
          </li>
        ))}
      </ul>
      {!one && <p className="m-0 mt-1 text-xs text-ink2 sm:hidden">Swipe for {bundles.length - 1} more</p>}
    </section>
  );
}
