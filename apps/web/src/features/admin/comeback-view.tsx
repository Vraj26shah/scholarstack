import type { AdminActivityDto } from '@ss/contracts';
import { comeback } from './insights-derive';

const n = (v: number) => v.toLocaleString('en-IN');
const weekLabel = (day: string) =>
  `Week of ${new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })}`;

/**
 * "Who comes back": students grouped by the week they signed up, and how many opened anything
 * again. The number that says whether the site is useful enough to return to. Hidden until the
 * database sends it (the retention migration), so it can never break the Students tab.
 */
export function ComebackView({ activity }: { activity?: AdminActivityDto }) {
  const c = comeback(activity);
  if (!c) return null;
  return (
    <section
      aria-label="Who comes back"
      className="rounded-2xl border border-line bg-surface p-4 flex flex-col gap-2"
    >
      <div>
        <h3 className="m-0 text-[15px] font-semibold">Who comes back</h3>
        <p className="m-0 text-[12px] text-ink2">
          Students grouped by the week they signed up. "Back within a week" means they opened anything again
          in the 7 days after signing up; "Still here in week 4" means days 22–28. Admins and restaurant
          owners are left out. Not affected by the period above.
        </p>
      </div>
      {c.rows.length === 0 ? (
        <p className="m-0 py-6 text-center text-sm text-ink2">
          No new students since counting started{c.countingSince ? ` (${c.countingSince})` : ''}. This fills
          in as people sign up.
        </p>
      ) : (
        <>
          <p className="m-0 text-[14px]">
            {c.weekPct === null ? (
              <>Nobody has been signed up for a full week yet. Check back in a few days.</>
            ) : (
              <>
                <strong className="tabular-nums">{c.weekPct}%</strong> of new students came back within a week
                <span className="text-ink2"> ({n(c.weekReady)} who joined at least 7 days ago)</span>.{' '}
                {c.weekPct < 25
                  ? 'Low: most people try it once and leave. Push the timetable + reminders, which bring people back daily.'
                  : c.weekPct < 45
                    ? 'Okay. Reminders and new notes before exams are what lift this.'
                    : 'Strong: people find it worth coming back to.'}
              </>
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] tabular-nums">
              <thead className="text-ink2 text-left">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Signed up</th>
                  <th className="py-1.5 pr-3 font-medium text-right">New students</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Back within a week</th>
                  <th className="py-1.5 font-medium text-right">Still here in week 4</th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map((w) => (
                  <tr key={w.week} className="border-t border-line">
                    <td className="py-1.5 pr-3">{weekLabel(w.week)}</td>
                    <td className="py-1.5 pr-3 text-right">{n(w.joined)}</td>
                    <td className="py-1.5 pr-3 text-right">
                      {w.weekPct === null ? (
                        <span className="text-ink2">too soon</span>
                      ) : (
                        <>
                          {w.weekPct}%{' '}
                          <span className="text-ink2 hidden sm:inline">
                            ({w.weekBack}/{w.weekReady})
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      {w.monthPct === null ? (
                        <span className="text-ink2">too soon</span>
                      ) : (
                        <>
                          {w.monthPct}%{' '}
                          <span className="text-ink2 hidden sm:inline">
                            ({w.monthBack}/{w.monthReady})
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
