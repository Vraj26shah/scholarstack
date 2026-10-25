import type { BundleCardDto, CourseCardDto } from '@ss/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatRupees, formatsLabel } from '../../lib/format';
import { prefetchBundle, prefetchChunk, prefetchCourse } from '../../lib/prefetch';
import { useSession } from '../../lib/session';
import { Box } from './icons';

/** The price as a small ink tag: calm and clear (red would read as a warning). */
export function PriceTag({ paise, className = '' }: { paise: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center h-8 px-3 border-[1.5px] border-price/70 rounded-full text-price font-mono text-sm font-semibold ${className}`}
    >
      {formatRupees(paise)}
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
      className={animate ? 'deal-in' : undefined}
      style={animate ? { ['--i' as string]: index } : undefined}
    >
      <Link
        to={`/c/${course.slug}`}
        onPointerEnter={warm}
        onFocus={warm}
        onTouchStart={warm}
        className="lift ruled group relative flex flex-col min-h-[240px] p-[16px_18px_44px] rounded-xl no-underline text-ink shadow-[0_18px_36px_-22px_var(--shadow),0_0_0_1px_var(--line)] hover:shadow-[0_28px_48px_-28px_var(--shadow),0_0_0_1px_var(--teal)]"
      >
        <span className="flex justify-between gap-2 font-mono text-[11px] text-ink2 pb-2 border-b-2 border-card-head">
          <span>
            {course.courseCode ? `${course.courseCode} · ` : ''}
            {course.callNo}
          </span>
          <span>{course.fileCount} FILES</span>
        </span>
        <span className="font-display font-extrabold text-[27px] leading-[1.02] tracking-[-0.035em] mt-3.5">
          {course.title}
        </span>
        <span className="font-mono text-xs text-ink2 mt-2.5">
          {course.pageCount} PAGES · {formatsLabel(course.formats)}
        </span>
        <span className="mt-auto pt-4 flex items-center justify-between">
          <PriceTag paise={course.pricePaise} />
          <span className="text-sm font-semibold text-teal-text inline-flex items-center gap-1">
            Peek inside <span className="transition-transform group-hover:translate-x-1">→</span>
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
  return (
    <Link
      to={`/b/${bundle.slug}`}
      onPointerEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      className={`@container group relative flex h-full no-underline text-white rounded-[22px] bg-brand overflow-hidden shadow-[0_24px_44px_-26px_var(--shadow)] lift ${
        compact ? 'p-4' : 'p-5'
      }`}
    >
      <Ribbon />
      <span className="relative pl-8 flex w-full flex-col gap-4 @xl:flex-row @xl:items-center @xl:justify-between">
        <span className="flex min-w-0 flex-col gap-2 @xl:max-w-[560px]">
          <span className="inline-flex items-center gap-2 self-start h-7 px-3 rounded-full bg-marigold text-on-marigold text-[12.5px] font-semibold">
            <Box size={14} /> Bundle · {bundle.courseCount} courses
          </span>
          <span className="font-display font-extrabold leading-[1.02] tracking-[-0.035em] text-[clamp(22px,2.4vw,30px)] line-clamp-2">
            {bundle.title}
          </span>
          {!compact && bundle.description && (
            <span className="text-[14.5px] leading-relaxed text-on-brand2 line-clamp-2">
              {bundle.description}
            </span>
          )}
          <span className="font-mono text-xs text-on-brand2">
            {bundle.fileCount} files · {bundle.pageCount} pages
          </span>
        </span>
        <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 @xl:mt-0 @xl:flex-col @xl:items-end @xl:gap-1 @xl:shrink-0">
          <span className="font-display font-extrabold text-[34px] @xl:text-[40px] leading-none tracking-[-0.04em] @xl:order-2">
            {formatRupees(bundle.pricePaise)}
          </span>
          <span className="font-mono text-sm text-on-brand2 line-through decoration-1 @xl:order-1">
            {formatRupees(bundle.listPricePaise)}
          </span>
          <span className="inline-flex items-center h-7 px-3 rounded-full bg-marigold text-on-marigold text-[13px] font-bold @xl:order-3">
            Save {formatRupees(savePaise)} · {bundle.savePercent}%
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
      {!one && <p className="m-0 mt-1 text-xs text-ink2 sm:hidden">Swipe for {bundles.length - 1} more →</p>}
    </section>
  );
}
