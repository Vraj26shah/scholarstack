import type { CourseDetailDto, CourseUnitDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { track } from '../../lib/analytics';
import { api, friendly } from '../../lib/api';
import { formatBytes, formatRupees, formatsLabel, offerEnds } from '../../lib/format';
import { forMyDrawer, useMyDrawer } from '../../lib/my-drawer';
import { prefetchChunk } from '../../lib/prefetch';
import { useSession } from '../../lib/session';

import { Ambient } from '../../shared/ui/ambient';
import { Hl, Stamp } from '../../shared/ui/brand';
import { Button, LinkButton } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { FormatBadge, FormatsLine } from '../../shared/ui/format-badge';
import { ArrowRight, Lock } from '../../shared/ui/icons';
import { U } from '../../shared/ui/note';
import { PreviewBar } from '../../shared/ui/preview-bar';
import { useSectionSwipe } from '../../shared/ui/swipe';
import { SwipeHint } from '../../shared/ui/swipe-hint';
import { PaymentProblem } from '../checkout/payment-problem';
import { useBuy } from '../checkout/use-buy';
import { PreviewGallery } from './preview-gallery';
import { ReadingList } from './reading-list';

/** "87 days left", "Last day today". */
function daysLeft(iso: string) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return days <= 0 ? 'Ends today' : days === 1 ? '1 day left' : `${days} days left`;
}

const longDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

function Field({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink2 tracking-[0.1em]">{label}</dt>
      <dd className="m-0 mt-0.5 text-[14px] sm:text-[15px] font-semibold truncate" title={title}>
        {value}
      </dd>
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
        {unit.contributors && unit.contributors.length > 0 && (
          <span className="text-[12px] text-ink2">
            Folder contributed by <strong className="text-ink">{unit.contributors.join(', ')}</strong>
          </span>
        )}
        <span className="font-mono text-[13px] text-ink2">
          {unit.fileCount} {unit.fileCount === 1 ? 'file' : 'files'} · {unit.pageCount} pages
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
                <FormatBadge format={f.format} name={f.name} />
                <span className="flex-[1_1_200px] text-[15px] font-medium break-all">{f.name}</span>
                {f.contributors && f.contributors.length > 0 && (
                  <span className="w-full pl-1 text-[12px] text-ink2">
                    Contributed by <strong className="text-ink">{f.contributors.join(', ')}</strong>
                  </span>
                )}
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
  const { buy, busy, signedIn } = buyState;
  const firstFile = course.units.flatMap((u) => u.files).find((f) => f.status === 'ready');
  // Only bundles made by hand and the reader's own drawer pack: never another branch's pack.
  const myDrawer = useMyDrawer();
  const bundle = forMyDrawer(course.bundles, myDrawer)[0];

  return (
    <div className="flex flex-col gap-4">
      {/* One wide bar across the page: the price, what you get, and the button. */}
      <div className="relative overflow-hidden bg-brand text-white rounded-[30px] p-6 sm:p-8 grid gap-6 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)] items-center">
        <Ambient tone="navy" layout="card" />
        <div className="relative flex flex-col gap-4">
          <span className="relative font-mono text-xs tracking-[0.14em] text-on-brand2">
            {course.owned ? 'On your shelf' : 'Check out this card'}
          </span>
          <div className="relative flex items-center gap-4">
            <Stamp
              label={formatRupees(course.pricePaise)}
              ring="WHOLE COURSE · ONE TIME · "
              size={112}
              rotate={0}
              tone={course.owned ? 'ink' : 'marigold'}
              animate
              delay={0.25}
            />
            <div className="flex flex-col gap-1">
              <span className="font-display font-extrabold text-[28px] leading-none tracking-[-0.04em]">
                {course.owned ? 'It’s yours.' : 'One price, every unit'}
              </span>
              <span className="text-sm text-on-brand2">
                {course.owned ? 'Open a file below' : `${course.fileCount} files · ${course.pageCount} pages`}
              </span>
              {!course.owned && course.offer && (
                <span className="text-sm text-marigold font-semibold">
                  {course.offer.title}: {course.offer.percentOff}% off{' '}
                  <span className="whitespace-nowrap">till {offerEnds(course.offer.endsAt)}</span>
                  <span className="ml-2 font-normal text-on-brand2 line-through decoration-1">
                    <span className="sr-only">was </span>
                    {formatRupees(course.offer.fullPricePaise)}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
        {/* A borrower slip: ticked lines, not icon badges. */}
        <ul className="relative list-none m-0 p-0 flex flex-col text-[15px]">
          {[
            `All ${course.fileCount} files on your shelf`,
            'Read on up to 2 devices',
            'New course files included',
            'Your name appears on each page',
          ].map((text, i) => (
            <li
              key={text}
              className={`pop-in flex items-baseline gap-3 py-2 border-b border-dashed border-white/20 last:border-b-0 ${i === 3 ? 'text-on-brand2' : ''}`}
              style={{ ['--delay' as string]: `${0.35 + i * 0.09}s` }}
            >
              <span aria-hidden="true" className="font-mono text-[13px] text-mist w-4 flex-none">
                {i === 3 ? '※' : '✓'}
              </span>
              {text}
            </li>
          ))}
        </ul>
        <div className="relative flex flex-col gap-3 md:col-span-2 lg:col-span-1">
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
          <PaymentProblem problem={buyState.problem} onRetry={buy} onClose={buyState.dismiss} />
          {course.owned && course.yourAccessUntil && (
            <span className="text-[13px] leading-relaxed text-on-brand2">
              <Hl onDark>{daysLeft(course.yourAccessUntil)}</Hl> · yours until{' '}
              {longDay(course.yourAccessUntil)}.
            </span>
          )}
          {!course.owned && (
            <span className="text-[13px] leading-relaxed text-on-brand2">
              <Hl onDark>{course.accessMonths} months of access</Hl>. Pay by UPI, card, or netbanking.{' '}
              <Hl onDark>Purchases are final</Hl>; preview each unit first.
            </span>
          )}
          {!course.owned && (
            <p className="m-0 text-[13px] leading-relaxed text-on-brand2">
              <U onDark>Check these units against your current syllabus</U> before buying.{' '}
              <Link to="/terms#syllabus" className="text-mist">
                Terms
              </Link>
            </p>
          )}
          <Link
            to={`/help?topic=notes&page=${encodeURIComponent(`/c/${course.slug}`)}`}
            className="self-start text-[13px] font-semibold text-on-brand2 hover:text-white"
          >
            Report a problem with these notes
          </Link>
        </div>
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
                Better together
              </span>
              <span className="text-[13px] font-semibold text-marigold-text">
                Save {formatRupees(Math.max(0, bundle.listPricePaise - bundle.pricePaise))} (
                {bundle.savePercent}%)
              </span>
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
              <span aria-hidden="true">→</span>
            </span>
          </span>
        </Link>
      )}
    </div>
  );
}

/**
 * Phones: the price and the buy button stay above the tab bar. When the full buy panel scrolls
 * into view the bar slides down past the tab bar and then leaves the page, so the two prices
 * never sit on screen at once.
 */
function StickyBuyBar({
  course,
  buyState,
}: { course: CourseDetailDto; buyState: ReturnType<typeof useBuy> }) {
  const { buy, busy, signedIn } = buyState;
  const firstFile = course.units.flatMap((u) => u.files).find((f) => f.status === 'ready');
  const [panelSeen, setPanelSeen] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const el = document.getElementById('buy-panel');
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setPanelSeen(!!e?.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // The bar leaves the DOM only once the slide has finished; coming back it slides up again
  // (or pops in, if it had left) instead of blinking in and out with every scroll tick.
  useEffect(() => {
    if (!panelSeen) {
      setGone(false);
      return;
    }
    const t = setTimeout(() => setGone(true), 380);
    return () => clearTimeout(t);
  }, [panelSeen]);
  if (gone || (course.owned && !firstFile)) return null;
  // <main> keeps a transform from its page-enter animation, and a transformed ancestor anchors a
  // fixed child to itself — so the bar is portalled out to the body.
  return createPortal(
    <div
      aria-hidden={panelSeen}
      className={`md:hidden fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 px-3 pb-2.5 pointer-events-none transition-transform duration-300 ease-in-out ${
        panelSeen ? 'translate-y-[calc(100%_+_64px_+_env(safe-area-inset-bottom))]' : 'translate-y-0'
      }`}
    >
      <div
        className={`pop-in mx-auto max-w-[560px] flex items-center gap-3 rounded-2xl bg-ink text-bg pl-4 pr-2 py-2 shadow-[0_18px_40px_-16px_var(--shadow)] border border-white/10 ${
          panelSeen ? 'pointer-events-none' : 'pointer-events-auto'
        }`}
      >
        {course.owned ? (
          <>
            <span className="flex min-w-0 flex-col">
              <span className="font-display font-extrabold text-[17px] leading-none tracking-[-0.03em]">
                It’s yours
              </span>
              <span className="text-[12px] opacity-75">Open any file below</span>
            </span>
            {firstFile && (
              <LinkButton to={`/read/${firstFile.id}`} variant="mist" className="ml-auto flex-none">
                Start reading <ArrowRight size={16} />
              </LinkButton>
            )}
          </>
        ) : (
          <>
            <span className="flex min-w-0 flex-col">
              <span className="font-display font-extrabold text-[19px] leading-none tracking-[-0.03em] tabular-nums whitespace-nowrap">
                {formatRupees(course.pricePaise)}
                {course.offer && (
                  <span className="ml-2 font-mono text-[12px] font-normal opacity-70 line-through decoration-1">
                    <span className="sr-only">was </span>
                    {formatRupees(course.offer.fullPricePaise)}
                  </span>
                )}
              </span>
              <span
                className="text-[12px] opacity-75 truncate"
                title={course.offer ? course.offer.title : undefined}
              >
                {course.offer
                  ? `${course.offer.percentOff}% off till ${offerEnds(course.offer.endsAt)}`
                  : `${course.fileCount} files · ${course.pageCount} pages`}
              </span>
            </span>
            <Button
              variant="buy"
              onClick={buy}
              disabled={busy}
              className="ml-auto flex-none"
              aria-label={
                signedIn ? `Buy ${course.title} for ${formatRupees(course.pricePaise)}` : 'Sign in to buy'
              }
            >
              {busy ? 'Opening…' : signedIn ? 'Buy' : 'Sign in'} <ArrowRight size={16} />
            </Button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Phones: swipe left or right to the next or previous course in the same drawer (batch and
 * programme), in the order the drawer shows them. Uses the drawer the catalogue already loaded.
 */
function useCourseSwipe(c: CourseDetailDto | undefined) {
  const navigate = useNavigate();
  const drawer = useQuery({
    queryKey: ['drawer', c?.batchYear, c?.branchSlug],
    queryFn: () => api.drawer(c!.batchYear, c!.branchSlug),
    enabled: !!c && !c.preview,
    staleTime: 60_000,
  });
  const list = drawer.data ?? [];
  const at = c ? list.findIndex((x) => x.slug === c.slug) : -1;
  const open = (n: number) => navigate(`/c/${list[n]!.slug}`, { replace: true });
  useSectionSwipe({
    enabled: at >= 0,
    ...(at >= 0 && at < list.length - 1 ? { onNext: () => open(at + 1) } : {}),
    ...(at > 0 ? { onPrev: () => open(at - 1) } : {}),
  });
  return at >= 0 && list.length > 1;
}

export function CoursePage() {
  const { slug = '' } = useParams();
  const { status } = useSession();
  const q = useQuery({ queryKey: ['course', slug, status], queryFn: () => api.course(slug) });
  const swipeable = useCourseSwipe(q.data);
  // Owners will open the reader next: fetch its code while they look at the page.
  useEffect(() => {
    if (q.data?.owned) prefetchChunk('reader');
  }, [q.data?.owned]);
  const itemSlug = q.data?.slug;
  const itemTitle = q.data?.title;
  const itemPrice = q.data?.pricePaise;
  useEffect(() => {
    if (!itemSlug) return;
    track('view_item', {
      item_id: itemSlug,
      item_name: itemTitle,
      currency: 'INR',
      value: (itemPrice ?? 0) / 100,
    });
  }, [itemSlug, itemTitle, itemPrice]);
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

  return <CourseView c={q.data} open={open} setOpen={setOpen} swipeable={swipeable} />;
}

function CourseView({
  c,
  open,
  setOpen,
  swipeable = false,
}: {
  c: CourseDetailDto;
  open: number | null;
  setOpen: (n: number) => void;
  swipeable?: boolean;
}) {
  const buyState = useBuy({ courseId: c.id }, `/c/${c.slug}`);
  const openIndex = open ?? Math.min(2, c.units.length - 1);
  return (
    <Page wide>
      {c.preview && <PreviewBar what="course" section="courses" />}
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12.5px] sm:text-[13px] text-ink2 mb-4 mt-1"
      >
        <Link
          to={`/?batch=${c.batchYear}&branch=${c.branchSlug}#catalogue`}
          className="text-ink2 underline decoration-teal underline-offset-4 hover:text-ink"
        >
          Drawer {c.batchYear}
        </Link>
        <span aria-hidden="true">→</span>
        <Link
          to={`/?batch=${c.batchYear}&branch=${c.branchSlug}#catalogue`}
          className="text-ink2 underline decoration-teal underline-offset-4 hover:text-ink"
        >
          {c.branchName}
        </Link>
        <span aria-hidden="true">→</span>
        <span className="text-ink">Card {c.callNo}</span>
      </nav>
      {swipeable && (
        <SwipeHint id="course-next" className="mb-4">
          Swipe for the next course in this drawer
        </SwipeHint>
      )}

      {/* The card's details, kept small: what it is, at a glance. */}
      <article
        className="ruled relative rounded-[18px] px-5 sm:px-7 pt-4 pb-5 shadow-[0_18px_40px_-30px_var(--shadow),0_0_0_1px_var(--line)]"
        style={{ backgroundPosition: '0 70px' }}
      >
        <dl className="m-0 grid grid-cols-3 lg:grid-cols-6 gap-x-5 gap-y-2.5 pb-3 border-b-[3px] border-card-head font-mono">
          <Field label="Call no." value={c.callNo} />
          <Field label="Batch" value={String(c.batchYear)} />
          <Field label="Branch" value={c.branchName} />
          <Field label="Files" value={String(c.fileCount)} />
          <Field label="Pages" value={String(c.pageCount)} />
          <Field
            label="Formats"
            value={<FormatsLine formats={c.formats} />}
            title={formatsLabel(c.formats)}
          />
        </dl>
        <h1 className="mt-4 mb-0 font-display font-extrabold text-[clamp(28px,4.2vw,48px)] leading-[0.98] tracking-[-0.045em] max-w-[980px]">
          {c.title}
        </h1>
        {c.description && (
          <p className="mt-2 mb-0 text-[15px] leading-relaxed text-ink2 max-w-[760px] line-clamp-2">
            {c.description}
          </p>
        )}
        {c.wholeCourseContributors.length > 0 && (
          <p className="mt-3 mb-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] text-ink2">
            <span className="font-mono text-[11px] uppercase tracking-[0.1em]">Course contributors</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-ink">{c.wholeCourseContributors.join(', ')}</span>
          </p>
        )}
      </article>

      {/* The room goes to what students came for: the pages to peek at, then the modules. On a
          phone the free pages come first — see before you scroll the whole syllabus — and on a
          laptop they sit side by side, modules left, peeks right. */}
      <div className="mt-8 grid gap-8 lg:gap-10 lg:grid-cols-2 items-start">
        <section aria-labelledby="modules-title" className="min-w-0 order-2 lg:order-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h2
              id="modules-title"
              className="m-0 font-display font-extrabold text-[clamp(28px,3.6vw,40px)] tracking-[-0.045em] leading-none"
            >
              Modules
            </h2>
            <span className="text-sm text-ink2">Open a module to view files</span>
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
          <p className="mt-4 mx-1 text-sm leading-relaxed text-ink2">Buy the course to open its files.</p>
          <ReadingList items={c.readingList ?? []} />
        </section>
        <div className="min-w-0 order-1 lg:order-2">
          {c.preview ? (
            <p className="m-0 text-[15px] text-ink2">Previews appear here when the course is published.</p>
          ) : (
            <PreviewGallery
              className=""
              units={c.units}
              owned={c.owned}
              onBuy={buyState.buy}
              buyLabel={buyState.signedIn ? `Buy for ${formatRupees(c.pricePaise)}` : 'Sign in to buy'}
            />
          )}
        </div>
      </div>

      <section aria-label="Buy" id="buy-panel" className="mt-10">
        <CheckoutPanel course={c} buyState={buyState} />
      </section>
      {!c.preview && <StickyBuyBar course={c} buyState={buyState} />}
    </Page>
  );
}
