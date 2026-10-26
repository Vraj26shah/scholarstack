import type { TodayItemDto, TodayKey } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { api, friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { Spinner } from '../../shared/ui/feedback';
import { ArrowRight } from '../../shared/ui/icons';

interface Line {
  /** The admin view the button opens. */
  view: string;
  action: string;
  busy: (n: number, item: TodayItemDto) => string;
  clear: string;
  /** What couldn't be checked, in a word or two. */
  what: string;
}

const LINES: Record<TodayKey, Line> = {
  questions: {
    view: 'queries',
    action: 'Answer',
    busy: (n) => `${n === 1 ? 'student is' : 'students are'} waiting for an answer.`,
    clear: 'no questions waiting',
    what: 'questions',
  },
  uploads: {
    view: 'contributions',
    action: 'Review',
    busy: (n) => `${n === 1 ? 'upload is' : 'uploads are'} waiting for your next step.`,
    clear: 'no uploads to review',
    what: 'uploads',
  },
  publish: {
    view: 'courses',
    action: 'Publish',
    busy: (n) => `${n === 1 ? 'course is' : 'courses are'} ready to go on sale.`,
    clear: 'nothing to publish',
    what: 'courses to publish',
  },
  files: {
    view: 'sync',
    action: 'Fix',
    busy: (n) => `${n === 1 ? 'file' : 'files'} can't be opened by students yet.`,
    clear: 'every file opens',
    what: 'files',
  },
  rewards: {
    view: 'earnings',
    action: 'Pay',
    busy: (n, i) =>
      `${formatRupees(i.amountPaise ?? 0)} owed to ${n === 1 ? 'a contributor' : `${n} contributors`}.`,
    clear: 'nothing owed',
    what: 'money owed',
  },
  emails: {
    view: 'features',
    action: 'See',
    busy: (n) => `${n === 1 ? 'email is' : 'emails are'} still going out, a few each day.`,
    clear: 'no emails going out',
    what: 'emails',
  },
  problems: {
    view: 'problems',
    action: 'Look',
    busy: (n) => `${n === 1 ? 'problem' : 'problems'} in the last day.`,
    clear: 'no problems today',
    what: 'problems',
  },
};

const today = () =>
  new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

/** The first admin screen: only what needs you, each with the button that takes you there. */
export function TodayPanel({ go }: { go: (view: string) => void }) {
  const q = useQuery({ queryKey: ['admin-today'], queryFn: api.adminToday, refetchInterval: 60_000 });
  if (q.isLoading) return <Spinner label="Checking" />;
  if (q.error)
    return (
      <p role="alert" className="m-0 rounded-xl bg-blush text-blush-text px-4 py-3">
        {friendly(q.error)}
      </p>
    );
  const items = q.data?.items ?? [];
  const busy = items.filter((i) => (i.count ?? 0) > 0);
  const clear = items.filter((i) => i.count === 0);
  const unknown = items.filter((i) => i.count === null);

  return (
    <section aria-labelledby="today-title" className="flex flex-col gap-6 max-w-[880px]">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[12px] text-ink2 uppercase tracking-[0.12em]">{today()}</span>
        <h2
          id="today-title"
          className="m-0 font-display font-extrabold text-[clamp(30px,4vw,42px)] tracking-[-0.045em] leading-none"
        >
          {busy.length === 0
            ? 'Nothing needs you.'
            : `${busy.length === 1 ? 'One thing needs' : `${busy.length} things need`} you.`}
        </h2>
      </div>

      {busy.length > 0 && (
        <ol className="m-0 p-0 list-none flex flex-col border-t-2 border-ink">
          {busy.map((item) => {
            const line = LINES[item.key];
            const n = item.count ?? 0;
            return (
              <li
                key={item.key}
                className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4 border-b border-dashed border-line"
              >
                <span className="w-14 font-mono text-[28px] font-semibold tabular-nums text-ink leading-none">
                  {n}
                </span>
                <span className="flex-1 min-w-[220px] text-[16px] leading-snug">{line.busy(n, item)}</span>
                <button
                  type="button"
                  onClick={() => go(line.view)}
                  className="h-10 px-4 rounded-full bg-brand text-white text-[14px] font-semibold inline-flex items-center gap-1.5"
                >
                  {line.action} <ArrowRight size={16} />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {clear.length > 0 && (
        <p className="m-0 text-[14px] text-ink2">
          <span className="font-semibold text-ink">All clear:</span>{' '}
          {clear.map((i) => LINES[i.key].clear).join(', ')}.
        </p>
      )}
      {unknown.length > 0 && (
        <p className="m-0 text-[14px] text-ink2">
          Couldn't check {unknown.map((i) => LINES[i.key].what).join(', ')} just now; trying again in a
          minute.
        </p>
      )}
    </section>
  );
}
