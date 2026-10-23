import type { BundleCardDto, CourseCardDto } from '@ss/contracts';
import { Link } from 'react-router-dom';
import { formatRupees, formatsLabel } from '../../lib/format';
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
export function IndexCard({ course, index }: { course: CourseCardDto; index: number }) {
  return (
    <div className="deal-in" style={{ ['--i' as string]: index }}>
      <Link
        to={`/c/${course.slug}`}
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
 * list price so the saving is obvious at a glance.
 */
export function BundleBox({ bundle, compact = false }: { bundle: BundleCardDto; compact?: boolean }) {
  const savePaise = Math.max(0, bundle.listPricePaise - bundle.pricePaise);
  return (
    <Link
      to={`/b/${bundle.slug}`}
      className={`group relative block no-underline text-white rounded-[22px] bg-brand overflow-hidden shadow-[0_24px_44px_-26px_var(--shadow)] lift ${
        compact ? 'p-5' : 'p-6 sm:p-7'
      }`}
    >
      {/* the ribbon tied down the side of the box, with a bow */}
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-marigold" />
      <span className="relative pl-4 flex flex-wrap items-start justify-between gap-4">
        <span className="flex flex-col gap-2 max-w-[560px]">
          <span className="inline-flex items-center gap-2 self-start h-7 px-3 rounded-full bg-marigold text-on-marigold font-mono text-[11px] font-semibold tracking-[0.1em]">
            <Box size={14} /> BUNDLE · {bundle.courseCount} COURSES
          </span>
          <span
            className={`font-display font-extrabold leading-[0.98] tracking-[-0.04em] ${compact ? 'text-[24px]' : 'text-[clamp(28px,3.4vw,38px)]'}`}
          >
            {bundle.title}
          </span>
          {!compact && bundle.description && (
            <span className="text-[15px] leading-relaxed text-on-brand2">{bundle.description}</span>
          )}
          <span className="font-mono text-xs text-on-brand2">
            {bundle.fileCount} FILES · {bundle.pageCount} PAGES
          </span>
        </span>
        <span className="flex flex-col items-end gap-1 bg-brand/80 rounded-2xl p-2">
          <span className="font-mono text-sm text-on-brand2 line-through decoration-1">
            {formatRupees(bundle.listPricePaise)}
          </span>
          <span className="font-display font-extrabold text-[40px] leading-none tracking-[-0.04em]">
            {formatRupees(bundle.pricePaise)}
          </span>
          <span className="inline-flex items-center h-7 px-3 rounded-full bg-marigold text-on-marigold text-[13px] font-bold">
            Save {formatRupees(savePaise)} · {bundle.savePercent}% off
          </span>
        </span>
      </span>
    </Link>
  );
}
