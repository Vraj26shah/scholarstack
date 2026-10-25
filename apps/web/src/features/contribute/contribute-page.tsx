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
        <U>{s.pending} of yours are waiting for review</U>; send more once some are reviewed.
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
    `How is the ${SHARE}% worked out?`,
    'On what students paid for the course your notes became (in a bundle, the course’s share), from the day your royalty starts.',
  ],
  ['How long does my royalty last?', PROMISE.royaltyLasts],
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
        className="page-enter mx-auto max-w-[1280px] px-5 sm:px-9 pt-16 pb-16 flex flex-col gap-16"
      >
        <WaysToEarn />

        {q.data && q.data.royalties.length > 0 && <RoyaltyLedger items={q.data.royalties} />}

        <div
          id="share"
          className="scroll-mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-start"
        >
          <section className="rounded-[18px] bg-card shadow-[0_18px_34px_-26px_var(--shadow),0_0_0_1px_var(--line)] min-w-0 overflow-hidden">
            <div className="flex justify-between gap-3 px-5 sm:px-7 pt-5 pb-3 font-mono text-[11px] text-ink2 border-b-2 border-card-head">
              <span>ACCESSION SLIP</span>
              <span>FOR THE LIBRARY</span>
            </div>
            <div className="p-5 sm:p-7 flex flex-col gap-5">
              <h2 className="m-0 font-display font-extrabold text-[32px] tracking-[-0.04em] leading-none">
                {LABEL.upload}
              </h2>
              {session === 'signed-out' ? (
                <div className="flex flex-col items-start gap-4">
                  <p className="m-0 text-[15px] text-ink2 leading-relaxed">
                    <U>Sign in</U> with your college account so we know who to pay.
                  </p>
                  <LinkButton to="/sign-in?next=%2Fcontribute" variant="brand">
                    Sign in to upload
                  </LinkButton>
                </div>
              ) : q.isError ? (
                <p className="m-0 text-blush-text">{friendly(q.error)}</p>
              ) : q.data ? (
                <Gate s={q.data} />
              ) : (
                <Skeleton className="h-[420px] rounded-[14px]" />
              )}
            </div>
          </section>

          <aside className="flex flex-col gap-6 min-w-0">
            <section className="rounded-[18px] bg-card p-5 sm:p-7 shadow-[0_0_0_1px_var(--line)] flex flex-col gap-4">
              <h2 className="m-0 font-display font-extrabold text-[24px] tracking-[-0.03em] leading-none">
                Rules
              </h2>
              <ul className="m-0 pl-5 list-disc marker:text-teal-text flex flex-col gap-2 text-[15px] leading-relaxed text-ink2">
                <li>
                  <U>Only your own work</U>: no textbook scans, paid material or personal details.
                </li>
                <li>
                  PDF, PPT, Word, ZIP, JPG or PNG; up to {L.filesPerSubmission} files,{' '}
                  {L.bytesPerSubmission / MB} MB, {L.submissionsPerDay} uploads a day.
                </li>
                <li>Copied or spam uploads turn uploading off.</li>
              </ul>
              <p className="m-0 font-mono text-[11.5px] text-ink2">
                STORED PRIVATELY · ONLY THE LIBRARY CAN OPEN THEM
              </p>
            </section>
            <section className="rounded-[18px] p-5 sm:p-7 shadow-[0_0_0_1px_var(--line)] flex flex-col gap-1">
              <h2 className="m-0 mb-2 font-display font-extrabold text-[24px] tracking-[-0.03em] leading-none">
                Questions
              </h2>
              {FAQ.map(([qn, a]) => (
                <details key={qn} className="group border-b border-line last:border-0 py-3">
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
              <p className="m-0 mt-3 text-[14px] text-ink2">
                Something else?{' '}
                <Link to="/help?topic=contribute" className="font-semibold text-teal-text">
                  Ask us
                </Link>
                .
              </p>
            </section>
          </aside>
        </div>

        {q.data && (
          <section className="flex flex-col gap-5">
            <h2 className="m-0 font-display font-extrabold text-[32px] tracking-[-0.04em] leading-none">
              What you've uploaded
            </h2>
            <MyContributions items={q.data.mine} />
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
