import type { CourseDetailDto, CourseUnitDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { fileFormatLabel, formatBytes, formatRupees, formatsLabel } from '../../lib/format';
import { useSession } from '../../lib/session';

import { Pill, Stamp } from '../../shared/ui/brand';
import { Button, LinkButton } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { ArrowRight, Check, Cross, Lock } from '../../shared/ui/icons';
import { useBuy } from '../checkout/use-buy';
import { PreviewGallery } from './preview-gallery';
import { ReadingList } from './reading-list';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-ink2 tracking-[0.1em]">{label}</div>
      <div className="text-[15px] font-semibold mt-1">{value}</div>
    </div>
  );
}

function Unit({
  unit,
  open,
  onToggle,
  owned,
}: { unit: CourseUnitDto; open: boolean; onToggle: () => void; owned: boolean }) {
  return (
    <div className="rounded-[18px] bg-surface border border-line overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex flex-wrap items-center gap-x-4 gap-y-2 min-h-[68px] px-5 py-3 border-0 bg-transparent text-ink text-left cursor-pointer"
      >
        <span className="inline-flex items-center h-[30px] px-2.5 rounded-lg bg-brand text-white font-mono text-xs font-semibold">
          {unit.label}
        </span>
        <span className="flex-[1_1_180px] font-display font-bold text-[22px] tracking-[-0.025em]">
          {unit.title}
        </span>
        <span className="font-mono text-[13px] text-ink2">
          {unit.fileCount} {unit.fileCount === 1 ? 'FILE' : 'FILES'} · {unit.pageCount} PP
        </span>
        <span
          aria-hidden="true"
          className={`w-[34px] h-[34px] rounded-full inline-flex items-center justify-center text-xl ${
            open ? 'bg-mist text-on-mist font-semibold' : 'border-[1.5px] border-line'
          }`}
        >
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <ul className="list-none m-0 px-4 pb-4 pt-1 flex flex-col gap-1.5">
          {unit.files.map((f) => {
            const inner = (
              <>
                <span className="font-mono text-[11px] font-semibold px-2 py-1 rounded-md bg-mist text-on-mist">
                  {fileFormatLabel(f.format, f.name)}
                </span>
                <span className="flex-[1_1_200px] text-[15px] font-medium break-all">{f.name}</span>
                <span className="font-mono text-xs text-ink2">
                  {f.pageCount} pp · {formatBytes(f.sizeBytes)}
                </span>
                {owned ? (
                  f.status === 'ready' ? (
                    <span className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full bg-mist text-on-mist text-xs font-semibold">
                      Open <ArrowRight size={12} />
                    </span>
                  ) : (
                    <span className="text-xs text-ink2">being prepared…</span>
                  )
                ) : (
                  <span className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full bg-surface border border-line text-ink2 text-xs font-semibold">
                    <Lock size={12} /> locked
                  </span>
                )}
              </>
            );
            const cls = 'flex flex-wrap items-center gap-x-3.5 gap-y-2 px-3.5 py-3 rounded-xl bg-sunk';
            return (
              <li key={f.id}>
                {owned && f.status === 'ready' ? (
                  <Link
                    to={`/read/${f.id}`}
                    className={`${cls} no-underline text-ink hover:outline hover:outline-2 hover:outline-teal`}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CheckoutPanel({
  course,
  buyState,
}: { course: CourseDetailDto; buyState: ReturnType<typeof useBuy> }) {
  const { buy, busy, error, signedIn } = buyState;
  const firstFile = course.units.flatMap((u) => u.files).find((f) => f.status === 'ready');
  const bundle = course.bundles[0];

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-6">
      <div className="bg-brand text-white rounded-[30px] p-7 flex flex-col gap-5">
        <span className="font-mono text-xs tracking-[0.14em] text-on-brand2">
          {course.owned ? 'ON YOUR SHELF' : 'CHECK OUT THIS CARD'}
        </span>
        <div className="flex items-center gap-4">
          <Stamp
            label={formatRupees(course.pricePaise)}
            ring="WHOLE COURSE · ONE TIME · "
            size={128}
            rotate={-12}
            tone={course.owned ? 'ink' : 'marigold'}
            animate
            delay={0.25}
          />
          <div className="flex flex-col gap-1">
            <span className="font-display font-extrabold text-[28px] leading-none tracking-[-0.04em]">
              {course.owned ? 'It’s yours.' : 'One price, every unit'}
            </span>
            <span className="text-sm text-on-brand2">
              {course.owned ? 'Open any file below' : `${course.fileCount} files · ${course.pageCount} pages`}
            </span>
          </div>
        </div>
        <ul className="list-none m-0 p-0 flex flex-col gap-3 text-[15px]">
          <li className="flex gap-2.5">
            <Check size={18} className="text-mist flex-none" /> All {course.fileCount} files on your shelf
          </li>
          <li className="flex gap-2.5">
            <Check size={18} className="text-mist flex-none" /> Phone or laptop, up to 2 devices
          </li>
          <li className="flex gap-2.5">
            <Check size={18} className="text-mist flex-none" /> New files added to this course included
          </li>
          <li className="flex gap-2.5 text-on-brand2">
            <Cross size={18} className="flex-none" /> Read-only, no downloads
          </li>
        </ul>
        {course.owned ? (
          firstFile ? (
            <LinkButton to={`/read/${firstFile.id}`} variant="mist" size="lg">
              Start reading <ArrowRight size={18} />
            </LinkButton>
          ) : null
        ) : (
          <Button variant="buy" size="lg" onClick={buy} disabled={busy}>
            {busy
              ? 'Opening payment…'
              : signedIn
                ? `Buy for ${formatRupees(course.pricePaise)}`
                : 'Sign in to buy'}{' '}
            <ArrowRight size={18} />
          </Button>
        )}
        {error && (
          <p role="alert" className="m-0 text-sm bg-blush text-blush-text rounded-xl px-3 py-2">
            {error}
          </p>
        )}
        {!course.owned && (
          <span className="text-[13px] leading-relaxed text-on-brand2">
            UPI, cards and netbanking via Razorpay. All sales are final, so peek at page one of every unit
            first.
          </span>
        )}
      </div>

      {bundle && !course.owned && (
        <Link
          to={`/b/${bundle.slug}`}
          className="lift group relative block overflow-hidden rounded-[24px] bg-surface no-underline text-ink shadow-[0_18px_40px_-28px_var(--shadow),0_0_0_1px_var(--line)] hover:shadow-[0_24px_44px_-28px_var(--shadow),0_0_0_1px_var(--marigold)]"
        >
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-marigold" />
          <span className="flex flex-col gap-3 p-5 pl-6">
            <span className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] font-semibold tracking-[0.12em] text-marigold-text">
                BETTER TOGETHER
              </span>
              <Pill>
                Save {formatRupees(Math.max(0, bundle.listPricePaise - bundle.pricePaise))} ·{' '}
                {bundle.savePercent}%
              </Pill>
            </span>
            <span className="font-display font-extrabold text-[22px] leading-[1.05] tracking-[-0.035em]">
              {bundle.title}
            </span>
            <span className="flex items-baseline gap-2.5">
              <span className="font-display font-extrabold text-[30px] leading-none tracking-[-0.04em] tabular-nums">
                {formatRupees(bundle.pricePaise)}
              </span>
              <span className="font-mono text-sm text-ink2 line-through">
                {formatRupees(bundle.listPricePaise)}
              </span>
              <span className="text-sm text-ink2">for {bundle.courseCount} courses</span>
            </span>
            <span className="mt-1 pt-3 border-t border-line flex items-center justify-between text-sm font-semibold text-teal-text">
              This course is in it. See the bundle
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </span>
          </span>
        </Link>
      )}
    </div>
  );
}

export function CoursePage() {
  const { slug = '' } = useParams();
  const { status } = useSession();
  const q = useQuery({ queryKey: ['course', slug, status], queryFn: () => api.course(slug) });
  const [open, setOpen] = useState<number | null>(null);

  if (q.isLoading)
    return (
      <Page wide>
        <Skeleton className="h-72 mt-6" />
        <Skeleton className="h-96 mt-10" />
      </Page>
    );
  if (q.isError || !q.data)
    return (
      <Page wide>
        <div className="mt-10">
          <ErrorState
            title="We couldn't find that card."
            message={friendly(q.error)}
            onRetry={() => q.refetch()}
          />
        </div>
      </Page>
    );

  return <CourseView c={q.data} open={open} setOpen={setOpen} />;
}

function CourseView({
  c,
  open,
  setOpen,
}: {
  c: CourseDetailDto;
  open: number | null;
  setOpen: (n: number) => void;
}) {
  const buyState = useBuy({ courseId: c.id }, `/c/${c.slug}`);
  const openIndex = open ?? Math.min(2, c.units.length - 1);
  return (
    <Page wide>
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2.5 font-mono text-[13px] text-ink2 mb-6 mt-2"
      >
        <Link
          to={`/?batch=${c.batchYear}&branch=${c.branchSlug}#catalogue`}
          className="text-ink2 no-underline"
        >
          DRAWER {c.batchYear}
        </Link>
        <span aria-hidden="true">→</span>
        <Link
          to={`/?batch=${c.batchYear}&branch=${c.branchSlug}#catalogue`}
          className="text-ink2 no-underline uppercase"
        >
          TAB: {c.branchName}
        </Link>
        <span aria-hidden="true">→</span>
        <span className="text-ink">CARD {c.callNo}</span>
      </nav>

      <article
        className="ruled relative rounded-[20px] p-6 sm:p-[26px_36px_64px] shadow-[0_30px_60px_-36px_var(--shadow),0_0_0_1px_var(--line)]"
        style={{ backgroundPosition: '0 92px' }}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-3 pb-4 border-b-[3px] border-card-head font-mono">
          <Field label="CALL NO." value={c.callNo} />
          <Field label="BATCH" value={String(c.batchYear)} />
          <Field label="BRANCH" value={c.branchName} />
          <Field label="FILES" value={String(c.fileCount)} />
          <Field label="PAGES" value={String(c.pageCount)} />
          <Field label="FORMATS" value={formatsLabel(c.formats)} />
        </div>
        <h1 className="mt-7 mb-0 font-display font-extrabold text-[clamp(44px,7vw,92px)] leading-[0.92] tracking-[-0.055em] max-w-[980px]">
          {c.title}
        </h1>
        {c.description && (
          <p className="mt-5 mb-0 text-lg leading-relaxed text-ink2 max-w-[660px]">{c.description}</p>
        )}
        <span
          aria-hidden="true"
          className="punch-hole"
          style={{ width: 20, height: 20, marginLeft: -10, bottom: 22 }}
        />
      </article>

      <PreviewGallery
        units={c.units}
        owned={c.owned}
        onBuy={buyState.buy}
        buyLabel={buyState.signedIn ? `Buy for ${formatRupees(c.pricePaise)}` : 'Sign in to buy'}
      />

      <div className="mt-12 flex flex-wrap items-start gap-11">
        <div className="flex-[999_1_600px] min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h2 className="m-0 font-display font-extrabold text-[clamp(32px,4vw,44px)] tracking-[-0.045em] leading-none">
              What's in the card
            </h2>
            <span className="font-mono text-[13px] text-ink2">TAP A UNIT TO PEEK</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {c.units.map((u, i) => (
              <Unit
                key={u.key}
                unit={u}
                owned={c.owned}
                open={openIndex === i}
                onToggle={() => setOpen(openIndex === i ? -1 : i)}
              />
            ))}
          </div>
          <p className="mt-4 mx-1 text-sm leading-relaxed text-ink2">
            Every name, page count and size here is the real thing. Files open in the reader once you've
            bought the course, or a bundle it's in.
          </p>
          <ReadingList items={c.readingList ?? []} />
        </div>
        <aside className="flex-[1_1_340px] min-w-0">
          <CheckoutPanel course={c} buyState={buyState} />
        </aside>
      </div>
    </Page>
  );
}
