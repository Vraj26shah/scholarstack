import { useEffect, useState } from 'react';
import { type ClassSlot, type Course, GRID, clock, nowAndNext } from '../domain';

/** Re-render every minute, so "now" moves on by itself. */
function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Line({ label, c, when }: { label: string; c: ClassSlot; when: string }) {
  return (
    <div className="flex items-stretch gap-3 min-w-0">
      <span className="w-1.5 flex-none rounded-full" style={{ backgroundColor: c.course.color }} />
      <div className="min-w-0">
        <p className="m-0 font-mono text-[11px] uppercase tracking-[0.1em] text-ink2">{label}</p>
        <p className="m-0 text-[17px] font-semibold leading-snug [overflow-wrap:anywhere]">
          {c.course.code ? `${c.course.code} · ` : ''}
          {c.course.name}
        </p>
        <p className="m-0 text-[13px] text-ink2">
          {when} · slot {c.slot}
          {c.course.room ? ` · ${c.course.room}` : ''}
          {c.course.teacher ? ` · ${c.course.teacher}` : ''}
        </p>
      </div>
    </div>
  );
}

/** "Now" and "Next" from the student's own timetable, at a glance. */
export function NowCard({ courses }: { courses: Course[] }) {
  const at = useMinute();
  if (!courses.some((c) => !c.tentative)) return null;
  const { now, next, nextDay } = nowAndNext(courses, at);
  const mins = at.getHours() * 60 + at.getMinutes();
  const nextWhen = next
    ? nextDay === 0
      ? `in ${next.start - mins < 60 ? `${next.start - mins} min` : `at ${clock(next.start)}`}`
      : `${nextDay === 1 ? 'Tomorrow' : GRID[next.day]!.day} at ${clock(next.start)}`
    : '';
  return (
    <section
      aria-label="Your classes now"
      className="print:hidden grid gap-4 sm:grid-cols-2 rounded-[18px] bg-card p-4 sm:p-5 shadow-[0_0_0_1px_var(--line)]"
    >
      {now ? (
        <Line label="Now" c={now} when={`until ${clock(now.end)}`} />
      ) : (
        <p className="m-0 self-center text-[15px] text-ink2">
          {at.getDay() === 0 ? 'Sunday: no classes.' : 'No class right now.'}
        </p>
      )}
      {next && <Line label="Next" c={next} when={nextWhen} />}
    </section>
  );
}
