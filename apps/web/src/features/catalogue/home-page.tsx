import type { CourseCardDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { Ambient } from '../../shared/ui/ambient';
import { Hl, StackWord, Stamp } from '../../shared/ui/brand';
import { LinkButton } from '../../shared/ui/button';
import { Footer, Header } from '../../shared/ui/chrome';
import { ArrowDown } from '../../shared/ui/icons';
import { Reveal } from '../../shared/ui/motion';
import { ContributeBand } from '../contribute/contribute-band';
import { Toolbox } from '../tools/toolbox';
import { CatalogueSection } from './catalogue-section';

/** A few real cards from the catalogue for the hero, so the numbers on them are true. */
function useFeatured(): CourseCardDto[] {
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue, staleTime: 60_000 });
  const batch = index.data?.batches[1]?.year ?? index.data?.batches[0]?.year;
  const branch = index.data?.branches.find((b) => !b.isCommon)?.slug;
  const drawer = useQuery({
    queryKey: ['drawer', batch, branch],
    queryFn: () => api.drawer(batch!, branch!),
    enabled: !!batch && !!branch,
    staleTime: 60_000,
  });
  return [...(drawer.data ?? [])].sort((a, b) => b.pageCount - a.pageCount).slice(0, 3);
}

// Poses are transforms only, so the shuffle runs on the graphics chip with no layout work.
const POSES = [
  'z-30 [transform:translate(0,196px)_rotate(-3deg)]',
  'z-20 [transform:translate(22px,100px)_rotate(1.5deg)_scale(.95)] sm:[transform:translate(36px,100px)_rotate(1.5deg)_scale(.95)]',
  'z-10 [transform:translate(44px,6px)_rotate(4deg)_scale(.906)] sm:[transform:translate(72px,6px)_rotate(4deg)_scale(.906)]',
];

/** Three cards that shuffle every few seconds: the front one slides to the back of the stack. */
function ShufflingStack() {
  const featured = useFeatured();
  const [order, setOrder] = useState([0, 1, 2]);
  const stackRef = useRef<HTMLDivElement>(null);
  const paused = useRef({ offscreen: false });
  // A steady shuffle that nothing interrupts: the pointer, a hover or a click never change
  // it. (It only rests while the stack is out of sight or the tab is hidden, which saves
  // battery and is invisible to the reader.)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const el = stackRef.current;
    const io =
      el && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((e) => {
            paused.current.offscreen = !e.some((x) => x.isIntersecting);
          })
        : null;
    if (el) io?.observe(el);
    const t = setInterval(() => {
      if (paused.current.offscreen || document.hidden) return;
      setOrder(([a, b, c]) => [b!, c!, a!]);
    }, 3400);
    return () => {
      clearInterval(t);
      io?.disconnect();
    };
  }, []);

  const cards = featured.length === 3 ? featured : null;
  const paper =
    'absolute h-[210px] rounded-xl p-[16px_18px] text-[#161B3A] shadow-[0_20px_40px_-20px_rgba(0,0,0,0.5)] [background-color:#fff] [background-image:repeating-linear-gradient(to_bottom,transparent_0,transparent_27px,#E6EAF2_27px,#E6EAF2_28px)] [background-position:0_50px] left-0 top-0 w-[min(78vw,320px)] sm:w-[320px] origin-top-left will-change-transform transition-transform duration-[900ms] ease-[cubic-bezier(.22,1,.36,1)]';

  return (
    <div
      ref={stackRef}
      aria-hidden="true"
      className="relative h-[440px] sm:h-[480px] flex-[1_1_380px] min-w-0 max-w-[460px]"
    >
      <div className="absolute inset-0">
        {[0, 1, 2].map((slot) => {
          const card = cards?.[slot];
          const pose = POSES[order.indexOf(slot)]!;
          return (
            <div key={slot} className={`${paper} ${pose}`}>
              <div className="flex justify-between font-mono text-[11px] text-[#4D5675] pb-2 border-b-2 border-[#E39AA6]">
                <span>{card?.callNo ?? 'S3 · CSE · 01'}</span>
                <span>{card ? `${card.fileCount} files · ${card.pageCount} pp` : 'notes'}</span>
              </div>
              <div className="font-display font-extrabold mt-3 text-[26px] leading-[1.15] truncate">
                {card?.title ?? ['Your semester', 'Every unit', 'Night-before notes'][slot]}
              </div>
              {card && (
                <div className="absolute left-[18px] bottom-4 font-mono text-xs font-semibold text-[#2F3C7E]">
                  {formatRupees(card.pricePaise)}
                </div>
              )}
              <span className="absolute left-1/2 bottom-3 w-3.5 h-3.5 -ml-[7px] rounded-full bg-[#2F3C7E]" />
            </div>
          );
        })}
      </div>
      <Stamp
        label="PAGE 1"
        ring="FREE PREVIEW · EVERY UNIT · "
        size={128}
        tone="marigold"
        rotate={-14}
        animate
        delay={0.9}
        className="absolute left-[calc(100%-120px)] sm:left-[262px] top-[320px] z-40"
      />
    </div>
  );
}

function HowItWorks() {
  const rows: [string, string, ReactNode, string][] = [
    [
      'STEP 01',
      'Sign in with your college email',
      <>
        Google, or a one-time code to your <Hl key="hl">@vitbhopal.ac.in</Hl> inbox.
      </>,
      '-rotate-6 border-teal-text text-teal-text',
    ],
    [
      'STEP 02',
      'Peek at page one, then pay',
      <>
        Every unit shows its <Hl key="hl">first page free</Hl>. File names, page counts and sizes are all
        there. UPI, card or netbanking.
      </>,
      'rotate-[4deg] border-teal-text text-teal-text',
    ],
    [
      'STEP 03',
      'Read it on your shelf',
      <>
        Phone or laptop, light or dark, <Hl key="hl">right where you stopped</Hl>.
      </>,
      '-rotate-3 border-marigold bg-marigold text-on-marigold',
    ],
  ];
  return (
    <section
      id="how"
      aria-labelledby="how-title"
      className="relative mx-auto max-w-[1280px] px-5 sm:px-9 pb-28 flex flex-wrap items-center gap-14"
    >
      <Ambient tone="paper" layout="paper" />
      <Reveal className="flex-[1_1_380px] min-w-0">
        <p className="font-mono text-[13px] tracking-[0.14em] text-teal-text m-0 mb-3.5">How it works</p>
        <h2
          id="how-title"
          className="m-0 font-display font-extrabold text-[clamp(44px,6vw,76px)] leading-[0.95] tracking-[-0.05em]"
        >
          Three stamps and you’re <StackWord className="text-teal-text">in.</StackWord>
        </h2>
        <p className="mt-5 text-[17px] leading-relaxed text-ink2 max-w-[420px]">
          No passwords, no downloads, no drama. Your borrower slip is <Hl>your college email</Hl>.
        </p>
      </Reveal>
      <Reveal
        index={1}
        className="flex-[1_1_520px] min-w-0 bg-card rounded-[22px] overflow-hidden shadow-[0_24px_50px_-30px_var(--shadow),0_0_0_1px_var(--line)]"
      >
        <div className="rounded-[22px]">
          <div className="bg-mist text-on-mist px-6 py-3.5 flex justify-between font-mono text-xs font-semibold tracking-[0.12em]">
            <span>BORROWER SLIP</span>
            <span>SCHOLARS STACK</span>
          </div>
          {rows.map(([step, title, text, stamp], i) => (
            <div
              key={step}
              className={`flex items-center gap-5 px-6 sm:px-7 py-6 ${i < 2 ? 'border-b border-line' : ''}`}
            >
              <span
                className={`stamp-land flex-none inline-flex items-center justify-center w-[92px] h-10 border-2 rounded-lg font-mono text-[13px] font-semibold ${stamp}`}
                style={{ ['--delay' as string]: `${0.3 + i * 0.25}s` }}
              >
                {step}
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-display font-extrabold text-[22px] tracking-[-0.03em]">{title}</span>
                <span className="text-[15px] leading-normal text-ink2">{text}</span>
              </span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function HouseRules() {
  const rules: [string, ReactNode][] = [
    [
      'Read here, don’t download',
      <>
        Notes open in the reader with{' '}
        <Hl key="hl" onDark>
          your name on every page
        </Hl>
        . It keeps things fair for whoever wrote them.
      </>,
    ],
    [
      'One reader per card',
      <>
        Your phone and laptop,{' '}
        <Hl key="hl" onDark>
          two devices at most
        </Hl>
        . Lending your login just logs someone out.
      </>,
    ],
    [
      'Look before you buy',
      <>
        Page one of every unit is free to see. One payment covers the whole course, and{' '}
        <Hl key="hl" onDark>
          all sales are final
        </Hl>
        .
      </>,
    ],
    [
      'Run by students',
      <>
        An independent project,{' '}
        <Hl key="hl" onDark>
          not affiliated with VIT Bhopal University
        </Hl>
        .
      </>,
    ],
  ];
  return (
    <div className="px-2 sm:px-4">
      <section
        aria-labelledby="rules-title"
        className="relative overflow-hidden bg-brand text-white rounded-[28px] sm:rounded-[36px]"
      >
        <Ambient tone="navy" dust={false} />
        <div className="relative z-10 mx-auto max-w-[1280px] px-5 sm:px-9 py-20">
          <p className="font-mono text-[13px] tracking-[0.14em] text-on-brand2 m-0 mb-3.5">House rules</p>
          <h2
            id="rules-title"
            className="m-0 mb-12 font-display font-extrabold text-[clamp(44px,6vw,76px)] leading-[0.95] tracking-[-0.05em]"
          >
            Library rules, <span className="text-mist">short version.</span>
          </h2>
          <ol className="list-none m-0 p-0 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-8 sm:gap-x-12 gap-y-9">
            {rules.map(([title, text], i) => (
              <Reveal as="li" key={title} index={i} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="font-display font-extrabold text-[80px] leading-[0.8] text-mist"
                >
                  {i + 1}
                </span>
                <span className="flex flex-col gap-1.5">
                  <span className="text-xl font-semibold">{title}</span>
                  <span className="text-[15px] leading-relaxed text-on-brand2">{text}</span>
                </span>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}

export function HomePage() {
  return (
    <>
      <div className="p-2 sm:p-4">
        <section className="relative bg-brand text-white rounded-[28px] sm:rounded-[36px] overflow-hidden">
          <Ambient tone="navy" plane />
          <div className="relative z-10">
            <Header onDark />
          </div>
          <div className="relative z-10 mx-auto max-w-[1280px] px-5 sm:px-9 pt-6 sm:pt-10 pb-16 sm:pb-20 flex flex-wrap items-center gap-10">
            <div className="flex-[1_1_560px] min-w-0 flex flex-col gap-6">
              <p className="font-mono text-[12px] sm:text-[13px] tracking-[0.14em] text-on-brand2 m-0">
                The semester catalogue for @vitbhopal.ac.in
              </p>
              <h1 className="m-0 font-display font-extrabold text-[clamp(56px,9vw,104px)] leading-[0.92] tracking-[-0.055em]">
                Every lecture,
                <br />
                <StackWord onDark animate className="mt-3 text-mist">
                  stacked.
                </StackWord>
              </h1>
              <div className="flex flex-col gap-3 max-w-[560px]">
                <p className="m-0 text-[17px] sm:text-[19px] leading-relaxed text-on-brand2">
                  Handwritten notes from <Hl onDark>seniors who sat the same exams</Hl>, sorted the way you’d
                  look for them: batch, branch, course. Read <Hl onDark>page one</Hl> of every unit before you
                  spend a rupee.
                </p>
                <p className="m-0 text-[15px] sm:text-[16px] leading-relaxed text-on-brand2/85">
                  Not here for notes? The student tools are <Hl onDark>free, no account needed</Hl>.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3.5">
                <LinkButton to="#catalogue" variant="mist" size="lg">
                  Find your notes <ArrowDown size={18} />
                </LinkButton>
                <LinkButton to="#toolbox" variant="outline-light" size="lg">
                  Try the free tools
                </LinkButton>
              </div>
            </div>
            <ShufflingStack />
          </div>
        </section>
      </div>
      <main id="main">
        <CatalogueSection />
        <HowItWorks />
        <HouseRules />
        <Toolbox />
        <ContributeBand />
      </main>
      <Footer />
    </>
  );
}
