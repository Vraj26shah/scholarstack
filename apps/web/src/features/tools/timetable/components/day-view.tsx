import { useState } from 'react';
import { type Course, GRID, PERIOD_TIMES, clock, dayIndex, occupied } from '../domain';

/** One day as a list, for phones: every period, its class or "free" (tap free to pick it). */
export function DayView({
  courses,
  picked,
  onPick,
  onOpen,
}: {
  courses: Course[];
  picked: string[];
  onPick: (slot: string) => void;
  onOpen: (c: Course) => void;
}) {
  const today = dayIndex(new Date());
  const [day, setDay] = useState(today < 0 ? 0 : today);
  const taken = occupied(courses);
  const row = GRID[day]!;
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Day" className="grid grid-cols-6 gap-1">
        {GRID.map((d, i) => (
          <button
            key={d.day}
            type="button"
            role="tab"
            aria-selected={i === day}
            onClick={() => setDay(i)}
            className={`h-10 rounded-full text-[13px] font-semibold ${i === day ? 'bg-brand text-white' : i === today ? 'bg-mist/60 text-ink' : 'text-ink2'}`}
          >
            {d.day.slice(0, 3)}
          </button>
        ))}
      </div>
      <ol className="m-0 p-0 list-none flex flex-col gap-2">
        {row.slots.map((slot, i) => {
          const t = PERIOD_TIMES[i]!;
          const c = taken.get(slot);
          const plan = c ? undefined : courses.find((x) => x.tentative && x.slots.includes(slot));
          const isPicked = picked.includes(slot);
          return (
            <li key={slot}>
              {i === 3 && (
                <p className="m-0 mb-2 text-center font-mono text-[11px] tracking-[0.12em] text-ink2">
                  LUNCH
                </p>
              )}
              <button
                type="button"
                onClick={() => (c ? onOpen(c) : onPick(slot))}
                aria-pressed={c ? undefined : isPicked}
                className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left ${
                  c
                    ? 'border-transparent text-[#161B3A]'
                    : isPicked
                      ? 'border-2 border-teal bg-mist/40'
                      : 'border-line bg-card'
                }`}
                style={c ? { backgroundColor: c.color } : undefined}
              >
                <span className="w-16 flex-none font-mono text-[12px] leading-tight">
                  {clock(t.start)}
                  <br />
                  <span className="opacity-70">{slot}</span>
                </span>
                <span className="min-w-0 flex-1">
                  {c || plan ? (
                    <>
                      <span className="block font-semibold [overflow-wrap:anywhere]">
                        {(c ?? plan)!.code || (c ?? plan)!.name}
                        {plan ? ' · planned' : ''}
                      </span>
                      <span className="block text-[13px] opacity-80 [overflow-wrap:anywhere]">
                        {[(c ?? plan)!.code ? (c ?? plan)!.name : '', (c ?? plan)!.room]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </>
                  ) : (
                    <span className="text-ink2">{isPicked ? 'Picked' : 'Free'}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
