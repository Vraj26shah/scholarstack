import type { AdminPushStatsDto, PushDailyDto, PushKind } from '@ss/contracts';
import { plural } from './ui';

type Row = { sent: number; seen: number; opened: number; failed: number; gone: number };
const zero = (): Row => ({ sent: 0, seen: 0, opened: 0, failed: 0, gone: 0 });
const add = (a: Row, b: PushDailyDto) => {
  a.sent += b.sent;
  a.seen += b.seen;
  a.opened += b.opened;
  a.failed += b.failed;
  a.gone += b.gone;
};
const CLASS_KINDS: PushKind[] = ['class', 'nightly'];
const pct = (n: number, of: number) => (of > 0 ? `${Math.min(100, Math.round((n / of) * 100))}%` : '–');
const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Admin › Reminders: did reminders actually reach students? Per day, for class reminders (before a
 * class + tomorrow's list) and meal reminders: sent, reached the screen, tapped, failed.
 */
export function PushDelivery({ s }: { s: AdminPushStatsDto }) {
  const days = [...new Set(s.daily.map((r) => r.day))].sort().reverse();
  const byDay = days.map((day) => {
    const classes = zero();
    const meals = zero();
    const other = zero();
    for (const r of s.daily.filter((x) => x.day === day))
      add(CLASS_KINDS.includes(r.kind) ? classes : r.kind === 'mess' ? meals : other, r);
    return { day, classes, meals, other };
  });
  const week = zero();
  for (const d of byDay.slice(0, 7)) {
    for (const k of ['sent', 'seen', 'opened', 'failed', 'gone'] as const)
      week[k] += d.classes[k] + d.meals[k];
  }

  return (
    <section aria-labelledby="push-delivery-h" className="flex flex-col gap-3 max-w-[860px]">
      <h3 id="push-delivery-h" className="m-0 font-display text-[19px] font-bold text-ink">
        Are reminders reaching students?
      </h3>
      <ul className="m-0 pl-5 text-[14px] text-ink2 flex flex-col gap-1">
        <li>
          <U2>{plural(s.classStudents, 'student')}</U2> signed in with class reminders on (
          {plural(s.withClasses, 'device')} in all, signed-in or not).
        </li>
        <li>
          Last 7 days: <U2>{week.sent}</U2> reminders sent, <U2>{pct(week.seen, week.sent)}</U2> reached the
          screen, <U2>{pct(week.opened, week.sent)}</U2> were tapped
          {week.failed ? `, ${week.failed} failed (retried while there was still time)` : ''}
          {week.gone ? `, ${plural(week.gone, 'device')} had switched notifications off` : ''}.
        </li>
        <li>
          <U2>{plural(s.activeDevices, 'device')}</U2> showed a notification in the last 7 days.
        </li>
        <li>
          {s.queue
            ? 'Big sends go through the queue: hundreds of students with the same class time all get theirs on time.'
            : 'No queue on this server: each five-minute run sends at most a few dozen. Check the PUSH_QUEUE binding.'}
        </li>
      </ul>
      {byDay.length === 0 ? (
        <p className="m-0 text-[14px] text-ink2">Nothing sent yet. Counting started with this update.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px] tabular-nums border-collapse">
            <thead>
              <tr className="text-left text-ink2 border-b border-line">
                <th className="py-2 pr-3 font-semibold">Day</th>
                <th className="py-2 pr-3 font-semibold">Class reminders sent</th>
                <th className="py-2 pr-3 font-semibold">Reached screen</th>
                <th className="py-2 pr-3 font-semibold">Tapped</th>
                <th className="py-2 pr-3 font-semibold hidden sm:table-cell">Meal reminders</th>
                <th className="py-2 pr-3 font-semibold hidden sm:table-cell">Failed</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map(({ day, classes, meals }) => (
                <tr key={day} className="border-b border-line/60">
                  <td className="py-2 pr-3 whitespace-nowrap">{dayLabel(day)}</td>
                  <td className="py-2 pr-3">{classes.sent}</td>
                  <td className="py-2 pr-3">
                    {classes.seen} <span className="text-ink2">({pct(classes.seen, classes.sent)})</span>
                  </td>
                  <td className="py-2 pr-3">{classes.opened}</td>
                  <td className="py-2 pr-3 hidden sm:table-cell">{meals.sent}</td>
                  <td className="py-2 pr-3 hidden sm:table-cell">{classes.failed + meals.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 text-[13px] text-ink2">
        "Reached screen" counts phones that reported back. Some phones (iPhones especially, or a phone with no
        signal at that moment) show the notification but can't report it, so the real number is usually
        higher.
      </p>
    </section>
  );
}

const U2 = ({ children }: { children: React.ReactNode }) => (
  <strong className="text-ink font-semibold">{children}</strong>
);
