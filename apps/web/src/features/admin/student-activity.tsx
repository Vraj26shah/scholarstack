import type { StudentActivityItemDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';

const PAGES: Record<string, string> = {
  '/': 'Home (catalogue)',
  '/shelf': 'My shelf',
  '/account': 'Account',
  '/contribute': 'Contribute & earn',
  '/help': 'Help',
  '/sign-in': 'Sign-in page',
  '/terms': 'Terms',
  '/privacy': 'Privacy',
  '/contact': 'Contact',
  '/unsubscribe': 'Unsubscribe',
  '/read': 'Reader (a bought file)',
  '/checkout': 'Payment result',
  '/other': 'Other / not found',
};

const ACTIONS: Record<string, string> = {
  login: 'Signed in',
  peek_open: 'Peeked inside',
  begin_checkout: 'Started checkout',
  apply_promo_code: 'Applied a promo code',
  purchase: 'Paid',
  read_open: 'Opened a file to read',
};

const pageLabel = (path: string): string => {
  if (PAGES[path]) return PAGES[path];
  const page = path.match(/^\/(c|b|tools)\/(.+)$/);
  return page ? `${page[1] === 'c' ? 'Course' : page[1] === 'b' ? 'Bundle' : 'Tool'} · ${page[2]}` : path;
};

/** "/c/dbms-…" → "Course · dbms-…", "/tools/cgpa" → "Tool · cgpa", "peek_open:/c/dbms" → "Peeked inside · dbms". */
export function activityLabel(target: string): string {
  if (target.startsWith('/')) return pageLabel(target);
  const [name = '', on] = target.split(':');
  const action = ACTIONS[name] ?? name;
  return on ? `${action} · ${on.replace(/^\/[cb]\//, '')}` : action;
}

/** A link to the page itself (or the page an action was on), for course, bundle and tool pages. */
export function activityHref(target: string): string | null {
  const page = target.startsWith('/') ? target : (target.split(':')[1] ?? '');
  return /^\/(c|b|tools)\/[a-z0-9-]+$/.test(page) ? page : null;
}

export const ago = (iso: string | null): string => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

type Days = '7' | '30' | '90';

/** One student's pages and actions, newest first, grouped by day (IST). */
export function StudentActivity({ userId }: { userId: string }) {
  const [days, setDays] = useState<Days>('30');
  const q = useQuery({
    queryKey: ['admin-student-activity', userId, days],
    queryFn: () => api.adminStudentActivity(userId, days),
  });
  const byDay = new Map<string, StudentActivityItemDto[]>();
  for (const i of q.data?.items ?? []) byDay.set(i.day, [...(byDay.get(i.day) ?? []), i]);

  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {q.data && (
          <p className="m-0 text-[13px] text-ink2 mr-auto">
            Last seen <strong className="text-ink">{ago(q.data.lastSeenAt)}</strong> · active on {q.data.days}{' '}
            {q.data.days === 1 ? 'day' : 'days'} · {q.data.hits} pages and actions
          </p>
        )}
        <div className="flex gap-1" role="radiogroup" aria-label="Activity period">
          {(['7', '30', '90'] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
              onClick={() => setDays(d)}
              className={`h-7 rounded-full px-2.5 text-[12px] font-semibold border cursor-pointer ${
                days === d ? 'bg-brand text-white border-brand' : 'border-line text-ink2 hover:text-ink'
              }`}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : q.isError ? (
        <ErrorState title="Activity didn't load." message={friendly(q.error)} onRetry={() => q.refetch()} />
      ) : byDay.size === 0 ? (
        <p className="m-0 text-[13px] text-ink2">Nothing opened in this period.</p>
      ) : (
        <ol className="m-0 p-0 list-none flex flex-col gap-2 max-h-80 overflow-y-auto">
          {[...byDay].map(([day, items]) => (
            <li key={day}>
              <div className="font-mono text-[11px] tracking-[0.06em] text-ink2 uppercase">
                {dayLabel(day)}
              </div>
              <ul className="m-0 p-0 list-none divide-y divide-line">
                {items.map((i) => {
                  const href = activityHref(i.target);
                  const label = activityLabel(i.target);
                  return (
                    <li
                      key={`${i.kind}:${i.target}`}
                      className="py-1.5 flex flex-wrap items-baseline gap-x-3 text-[13px]"
                    >
                      <span className="font-mono text-[12px] text-ink2 w-[4.5rem] flex-none">
                        {time(i.lastAt)}
                      </span>
                      <span
                        className={`h-5 px-1.5 rounded text-[11px] font-semibold inline-flex items-center ${
                          i.kind === 'action' ? 'bg-marigold-soft text-marigold-text' : 'bg-line text-ink2'
                        }`}
                      >
                        {i.kind === 'action' ? 'did' : 'opened'}
                      </span>
                      <span className="min-w-0 flex-1">
                        {href ? (
                          <Link to={href} className="text-ink hover:underline">
                            {label}
                          </Link>
                        ) : (
                          label
                        )}
                      </span>
                      {i.hits > 1 && <span className="text-ink2">×{i.hits}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
