import type { CourseCardDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { StackWord, Stamp } from '../../shared/ui/brand';
import { LinkButton } from '../../shared/ui/button';
import { Footer, Header } from '../../shared/ui/chrome';
import { ArrowDown } from '../../shared/ui/icons';
import { Reveal } from '../../shared/ui/motion';
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

const POSES = [
  'left-0 top-[150px] w-[min(78vw,320px)] sm:w-[320px] -rotate-[3deg] z-30',
  'left-[22px] sm:left-[36px] top-[80px] w-[min(74vw,304px)] sm:w-[304px] rotate-[1deg] z-20',
  'left-[44px] sm:left-[72px] top-[14px] w-[min(70vw,290px)] sm:w-[290px] rotate-[5deg] z-10',
];

/** Three cards that shuffle every few seconds: the front one slides to the back of the stack. */
function ShufflingStack() {
  const featured = useFeatured();
  const [order, setOrder] = useState([0, 1, 2]);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setOrder(([a, b, c]) => [b!, c!, a!]), 3400);
    return () => clearInterval(t);
  }, []);

  const cards = featured.length === 3 ? featured : null;
  const paper =
    'absolute h-[210px] rounded-xl p-[16px_18px] text-[#161B3A] shadow-[0_20px_40px_-20px_rgba(0,0,0,0.5)] [background-color:#fff] [background-image:repeating-linear-gradient(to_bottom,transparent_0,transparent_27px,#E6EAF2_27px,#E6EAF2_28px)] [background-position:0_50px] transition-[left,top,width,rotate] duration-[900ms] ease-[cubic-bezier(.22,1,.36,1)]';

  return (
    <div
      aria-hidden="true"
      className="relative h-[430px] sm:h-[470px] flex-[1_1_380px] min-w-0 max-w-[460px]"
    >
      {[0, 1, 2].map((slot) => {
        const card = cards?.[slot];
        const pose = POSES[order.indexOf(slot)]!;
        return (
          <div key={slot} className={`${paper} ${pose}`}>
            <div className="flex justify-between font-mono text-[11px] text-[#4D5675] pb-2 border-b-2 border-[#E39AA6]">
              <span>{card?.callNo ?? 'S3 · CSE · 01'}</span>
              <span>{card ? `${card.fileCount} FILES · ${card.pageCount} PP` : 'NOTES'}</span>
            </div>
            <div className="font-display font-extrabold tracking-[-0.03em] mt-3 text-[28px] leading-[1.02]">
              {card?.title ?? ['Your semester', 'Every unit', 'Night-before revision'][slot]}
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
      <Stamp
        label="PAGE 1"
        ring="FREE PREVIEW · EVERY UNIT · "
        size={128}
        tone="marigold"
        rotate={-14}
        animate
        delay={0.9}
        className="absolute left-[calc(100%-120px)] sm:left-[260px] top-[290px] z-40"
      />
    </div>
  );
}

function HowItWorks() {
  const rows: [string, string, string, string][] = [
    [
      'STEP 01',
      'Sign in with your college email',
      'Google, or a one-time code to your @vitbhopal.ac.in inbox.',
      '-rotate-6 border-teal-text text-teal-text',
    ],
    [
      'STEP 02',
      'Peek at page one, then pay',
      'Every unit shows its first page. File names, page counts and sizes are all there. UPI, card or netbanking.',
      'rotate-[4deg] border-teal-text text-teal-text',
    ],
    [
      'STEP 03',
      'Read it on your shelf',
      'Phone or laptop, light or dark, right where you stopped.',
      '-rotate-3 border-marigold bg-marigold text-on-marigold',
    ],
  ];
  return (
    <section
      id="how"
      aria-labelledby="how-title"
      className="mx-auto max-w-[1280px] px-5 sm:px-9 pb-28 flex flex-wrap items-center gap-14"
    >
      <Reveal className="flex-[1_1_380px] min-w-0">
        <p className="font-mono text-[13px] tracking-[0.14em] text-teal-text m-0 mb-3.5">02 — HOW IT WORKS</p>
        <h2
          id="how-title"
          className="m-0 font-display font-extrabold text-[clamp(44px,6vw,76px)] leading-[0.95] tracking-[-0.05em]"
        >
          Three stamps and you're <StackWord className="text-teal-text">in.</StackWord>
        </h2>
        <p className="mt-5 text-[17px] leading-relaxed text-ink2 max-w-[420px]">
          No passwords, no downloads, no drama. Your borrower slip is your college email.
        </p>
      </Reveal>
      <Reveal
        index={1}
        className="flex-[1_1_520px] min-w-0 bg-card rounded-[22px] overflow-hidden shadow-[0_24px_50px_-30px_var(--shadow),0_0_0_1px_var(--line)]"
      >
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
              className={`pop-in flex-none inline-flex items-center justify-center w-[92px] h-10 border-2 rounded-lg font-mono text-[13px] font-semibold ${stamp}`}
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
      </Reveal>
    </section>
  );
}

function HouseRules() {
  const rules: [string, string][] = [
    [
      'Read here, don’t download',
      'Notes open in the reader with your name on every page. It keeps things fair for whoever wrote them.',
    ],
    ['One reader per card', 'One device signed in at a time. Lending your login just logs you both out.'],
    [
      'Look before you buy',
      'Page one of every unit is free to see. One payment covers the whole course, and all sales are final.',
    ],
    ['Run by students', 'An independent project, not run by or affiliated with VIT Bhopal University.'],
  ];
  return (
    <div className="px-2 sm:px-4">
      <section aria-labelledby="rules-title" className="bg-brand text-white rounded-[28px] sm:rounded-[36px]">
        <div className="mx-auto max-w-[1280px] px-5 sm:px-9 py-20">
          <p className="font-mono text-[13px] tracking-[0.14em] text-on-brand2 m-0 mb-3.5">
            03 — HOUSE RULES
          </p>
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
        <section className="bg-brand text-white rounded-[28px] sm:rounded-[36px] overflow-hidden">
          <Header onDark />
          <div className="mx-auto max-w-[1280px] px-5 sm:px-9 pt-6 sm:pt-10 pb-16 sm:pb-20 flex flex-wrap items-center gap-10">
            <div className="flex-[1_1_560px] min-w-0 flex flex-col gap-6">
              <p className="font-mono text-[12px] sm:text-[13px] tracking-[0.14em] text-on-brand2 m-0">
                THE SEMESTER CATALOGUE · FOR @VITBHOPAL.AC.IN
              </p>
              <h1 className="m-0 font-display font-extrabold text-[clamp(56px,9vw,104px)] leading-[0.92] tracking-[-0.055em]">
                Every lecture,
                <br />
                <StackWord onDark animate className="mt-3 text-mist">
                  stacked.
                </StackWord>
              </h1>
              <p className="m-0 text-[17px] sm:text-[19px] leading-relaxed text-on-brand2 max-w-[560px]">
                Handwritten notes from your seniors, filed like a library: batch, then branch, then course.
                Peek at page one of every unit before you pay, then read it the night before.
              </p>
              <div className="flex flex-wrap items-center gap-3.5">
                <LinkButton to="#catalogue" variant="mist" size="lg">
                  Open the catalogue <ArrowDown size={18} />
                </LinkButton>
                <LinkButton to="#toolbox" variant="outline-light" size="lg">
                  Free student tools
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
      </main>
      <Footer />
    </>
  );
}
