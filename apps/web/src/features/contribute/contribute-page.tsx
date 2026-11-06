import {
  type ContributionStatusDto,
  CONTRIBUTION_LIMITS as L,
  DEFAULT_ROYALTY_PERCENT as SHARE,
} from '@ss/contracts';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { friendly } from '../../lib/api';
import { useSession } from '../../lib/session';
import { LABEL, PROMISE } from '../../shared/copy';
import { LinkButton } from '../../shared/ui/button';
import { Footer } from '../../shared/ui/chrome';
import { Skeleton } from '../../shared/ui/feedback';
import { Reveal } from '../../shared/ui/motion';
import { U } from '../../shared/ui/note';
import { ContributeForm } from './contribute-form';
import { ContributeHero } from './hero';
import { MyContributions } from './my-contributions';
import { RoyaltyLedger } from './royalty-ledger';
import { MB } from './rules';
import { useContributionStatus } from './use-contributions';
import { WaysToEarn } from './ways-to-earn';

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 text-[16px] leading-relaxed text-ink2" role="status">
      {children}
    </p>
  );
}

/** What stands between this student and the form, if anything. */
function Gate({ s }: { s: ContributionStatusDto }) {
  if (s.blocked)
    return (
      <Notice>
        <U>Uploads are off for your account.</U> Think it's a mistake?{' '}
        <Link to="/help?topic=contribute" className="font-semibold text-teal-text">
          Ask us
        </Link>
        .
      </Notice>
    );
  if (!s.open)
    return (
      <Notice>
        <U>Uploads are paused</U> while we catch up on reviews; check back in a few days.
      </Notice>
    );
  if (s.pending >= s.limits.pendingAtOnce)
    return (
      <Notice>
        <U>{s.pending} uploads are waiting for review.</U> You can send more after we review them.
      </Notice>
    );
  if (s.todayLeft === 0)
    return (
      <Notice>
        That's <U>today's {s.limits.submissionsPerDay} uploads</U>; come back tomorrow with the rest.
      </Notice>
    );
  return <ContributeForm status={s} />;
}

const FAQ: [string, string][] = [
  [
    'Who can become a contributor?',
    'VIT Bhopal students can share original notes, papers, or slides. Sign in with your college email to get paid.',
  ],
  [`How is the ${SHARE}% worked out?`, `${PROMISE.royaltyBasis} It starts when your royalty begins.`],
  ['How long does my royalty last?', PROMISE.royaltyLasts],
  ['Do I keep my notes?', 'Yes. You keep the copyright and can still use your notes anywhere else.'],
  [
    'What if you don’t use them?',
    'We tell you on this page. Nothing goes on sale without your OK on the deal.',
  ],
  ['Is there a yearly bonus?', PROMISE.yearlyBonus],
  ['How do I get paid?', 'By UPI. Earned, paid and due are shown on this page.'],
];

export function ContributePage() {
  const { status: session } = useSession();
  const q = useContributionStatus();
  return (
    <>
      <ContributeHero />
      <main
        id="main"
        className="page-enter mx-auto max-w-[1280px] px-5 sm:px-9 pt-12 sm:pt-14 pb-14 flex flex-col gap-12 sm:gap-14"
      >
        <Reveal>
          <WaysToEarn />
        </Reveal>

        {q.data && q.data.royalties.length > 0 && (
          <Reveal>
            <RoyaltyLedger items={q.data.royalties} />
          </Reveal>
        )}

        <Reveal
          as="section"
          id="share"
          className="scroll-mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start"
        >
          <section className="rounded-[18px] bg-card shadow-[0_18px_34px_-26px_var(--shadow),0_0_0_1px_var(--line)] min-w-0 overflow-hidden">
            <div className="flex justify-between gap-3 px-5 sm:px-7 pt-5 pb-3 font-mono text-[11px] text-ink2 border-b-2 border-card-head">
              <span>Your upload</span>
              <span>Private to us</span>
            </div>
            <div className="p-5 sm:p-7 flex flex-col gap-5">
              <h2 className="m-0 font-display font-extrabold text-[32px] tracking-[-0.04em] leading-none">
                {LABEL.upload}
              </h2>
              {session === 'signed-out' ? (
                <div className="flex flex-col items-start gap-4">
                  <p className="m-0 text-[15px] text-ink2 leading-relaxed">
                    <U>Sign in with your college email</U> to upload notes and receive payments.
                  </p>
                  <LinkButton to="/sign-in?next=%2Fcontribute" variant="brand">
                    Sign in to upload
                  </LinkButton>
                </div>
              ) : q.isError ? (
                <p className="m-0 text-blush-text">{friendly(q.error)}</p>
              ) : q.data ? (
                <>
                  <Gate s={q.data} />
                  {/* What they've sent sits in the same card, under the form. */}
                  {q.data.mine.length > 0 && (
                    <section className="flex flex-col gap-3 pt-5 border-t border-line">
                      <h3 className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em] leading-none">
                        What you've uploaded
                      </h3>
                      <div className="max-h-[520px] overflow-y-auto p-1 -m-1">
                        <MyContributions items={q.data.mine} compact />
                      </div>
                    </section>
                  )}
                </>
              ) : (
                <Skeleton className="h-[420px] rounded-[14px]" />
              )}
            </div>
          </section>

          {/* Follows the form down the page, so the side never sits empty beside a long form. */}
          <aside className="flex flex-col gap-4 min-w-0 lg:sticky lg:top-6">
            <section className="rounded-[18px] bg-card p-5 sm:p-7 shadow-[0_0_0_1px_var(--line)] flex flex-col gap-4">
              <h2 className="m-0 font-display font-extrabold text-[24px] tracking-[-0.03em] leading-none">
                Rules
              </h2>
              <ul className="m-0 pl-5 list-disc marker:text-teal-text flex flex-col gap-2 text-[15px] leading-relaxed text-ink2">
                <li>
                  <U>Share only your own work.</U> No textbook scans, paid material, or personal details.
                </li>
                <li>
                  Upload up to {L.filesPerSubmission} files ({L.bytesPerFile / MB} MB each,{' '}
                  {L.bytesPerSubmission / MB} MB total). Limit: {L.submissionsPerDay} uploads a day.
                </li>
                <li>Copied or spam uploads turn uploading off.</li>
              </ul>
              <p className="m-0 text-[13px] text-ink2">Your files stay private during review.</p>
            </section>
            <section className="rounded-[18px] bg-card p-5 sm:p-7 shadow-[0_0_0_1px_var(--line)] flex flex-col gap-3">
              <h2 className="m-0 font-display font-extrabold text-[24px] tracking-[-0.03em] leading-none">
                How to pack your ZIP
              </h2>
              <p className="m-0 text-[15px] leading-relaxed text-ink2">
                For a whole course, name one ZIP after the course. Add a{' '}
                <strong className="text-ink">Syllabus</strong> folder,{' '}
                <strong className="text-ink">folder for each unit or module</strong>, and{' '}
                <strong className="text-ink">PYQs</strong> folder for past papers. We check the ZIP when you
                choose it. Complete courses earn <strong className="text-teal-text">30% of each sale</strong>.
              </p>
              <pre
                aria-label="Example ZIP layout"
                className="m-0 rounded-xl bg-sunk px-4 py-3 font-mono text-[12.5px] leading-relaxed text-ink overflow-x-auto"
              >{`DBMS (CSE3001).zip
├─ Syllabus/            ← the official syllabus
├─ Module 1 - Introduction/
├─ Module 2 - ER model/
├─ Module 3 - SQL/
├─ …
└─ PYQs/                ← past papers (optional)`}</pre>
            </section>
            <section className="rounded-[18px] bg-card p-5 sm:p-7 shadow-[0_0_0_1px_var(--line)]">
              <h2 className="m-0 mb-4 font-display font-extrabold text-[24px] tracking-[-0.03em] leading-none">
                After you send
              </h2>
              <ol className="m-0 grid list-none gap-4 p-0">
                {[
                  ['01', 'We check each file and the ZIP folder layout.'],
                  ['02', 'Follow the review status under “What you’ve uploaded”.'],
                  ['03', 'Accepted files are placed in the course and credited to your name.'],
                ].map(([step, text]) => (
                  <li
                    key={step}
                    className="grid grid-cols-[2.5rem_1fr] items-start gap-2 text-[14px] leading-relaxed text-ink2"
                  >
                    <span className="font-mono text-[12px] font-semibold text-teal-text">{step}</span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </Reveal>

        <Reveal
          as="section"
          className="rounded-[18px] p-5 sm:p-7 shadow-[0_0_0_1px_var(--line)] flex flex-col gap-1"
        >
          <h2 className="m-0 mb-2 font-display font-extrabold text-[24px] tracking-[-0.03em] leading-none">
            Questions
          </h2>
          <div className="grid md:grid-cols-2 gap-x-10">
            {FAQ.map(([qn, a]) => (
              <details key={qn} className="group border-b border-line py-3">
                <summary className="cursor-pointer list-none flex justify-between gap-3 font-semibold text-[15px]">
                  {qn}
                  <span
                    aria-hidden="true"
                    className="text-teal-text transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="m-0 mt-2 text-[14px] leading-relaxed text-ink2">{a}</p>
              </details>
            ))}
          </div>
          <p className="m-0 mt-3 text-[14px] text-ink2">
            Something else?{' '}
            <Link to="/help?topic=contribute" className="font-semibold text-teal-text">
              Ask us
            </Link>
            .
          </p>
        </Reveal>
      </main>
      <Footer />
    </>
  );
}
