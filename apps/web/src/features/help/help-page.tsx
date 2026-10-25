import { SUPPORT_TOPICS, type SupportTopic } from '@ss/contracts';
import { Link, useSearchParams } from 'react-router-dom';
import { friendly } from '../../lib/api';
import { useSession } from '../../lib/session';
import { BackLink } from '../../shared/ui/back-link';
import { LinkButton } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { Skeleton } from '../../shared/ui/feedback';
import { U } from '../../shared/ui/note';
import { AskForm } from './ask-form';
import { MyQuestions } from './my-questions';
import { useMySupport } from './use-support';

/** Ask the library: questions, problem reports with screenshots, and the answers. */
export function HelpPage() {
  const [params] = useSearchParams();
  const topicParam = params.get('topic') as SupportTopic | null;
  const topic =
    topicParam && (SUPPORT_TOPICS as readonly string[]).includes(topicParam) ? topicParam : 'feature';
  const page = (params.get('page') ?? '').startsWith('/') ? (params.get('page') ?? '').slice(0, 300) : '';
  const { status: session } = useSession();
  const q = useMySupport();
  const next = `/help${params.toString() ? `?${params}` : ''}`;
  return (
    <Page wide>
      <header className="flex flex-col gap-4 pt-2 pb-10">
        <BackLink
          fallback="/"
          className="self-start inline-flex items-center h-9 px-3 -ml-3 rounded-full border-0 bg-transparent text-sm font-semibold text-ink2 cursor-pointer hover:bg-sunk"
        />
        <span className="font-mono text-[12px] text-ink2">HELP & SUGGESTIONS</span>
        <h1 className="m-0 max-w-[880px] font-display font-extrabold text-[clamp(44px,7.5vw,80px)] leading-[0.93] tracking-[-0.05em]">
          Ask us anything.
        </h1>
        <p className="m-0 max-w-[640px] text-[17px] leading-relaxed text-ink2">
          A problem, a question or an idea: <U>a person reads it and replies by email</U>.
        </p>
      </header>

      <div className="max-w-[820px]">
        <section className="rounded-[18px] bg-card p-5 sm:p-7 shadow-[0_18px_34px_-26px_var(--shadow),0_0_0_1px_var(--line)] flex flex-col gap-5 min-w-0">
          {session === 'signed-out' ? (
            <div className="flex flex-col items-start gap-4">
              <p className="m-0 text-[15px] text-ink2 leading-relaxed">
                <U>Sign in</U> with your college account so we can reply. Not a student?{' '}
                <Link to="/contact" className="font-semibold text-teal-text">
                  Contact us
                </Link>
                .
              </p>
              <LinkButton to={`/sign-in?next=${encodeURIComponent(next)}`}>Sign in to ask</LinkButton>
            </div>
          ) : q.isError ? (
            <p className="m-0 text-blush-text">{friendly(q.error)}</p>
          ) : !q.data ? (
            <Skeleton className="h-[460px] rounded-[14px]" />
          ) : q.data.open >= q.data.limits.openAtOnce ? (
            <p className="m-0 text-[15px] text-ink2">
              You have <U>{q.data.open} open</U>; reply on one below, or close one that's sorted.
            </p>
          ) : q.data.todayLeft === 0 ? (
            <p className="m-0 text-[15px] text-ink2">
              That's <U>{q.data.limits.newPerDay} for today</U>; you can still reply on the ones below.
            </p>
          ) : (
            <AskForm status={q.data} initialTopic={topic} page={page} />
          )}
        </section>
      </div>

      {q.data && (
        <section className="pt-12 flex flex-col gap-5">
          <h2 className="m-0 font-display font-extrabold text-[32px] tracking-[-0.04em] leading-none">
            Your messages
          </h2>
          <MyQuestions items={q.data.queries} />
        </section>
      )}
    </Page>
  );
}
