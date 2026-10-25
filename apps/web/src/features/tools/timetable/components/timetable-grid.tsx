import { Fragment, useMemo } from 'react';
import { type Course, GRID, LUNCH_AFTER, PERIODS, occupied } from '../domain';

/** The week as a table. Tapping a free slot selects it; tapping a course's slot opens that course. */
export function TimetableGrid({
  courses,
  picked,
  onPick,
  onOpen,
}: {
  courses: Course[];
  picked: string[];
  onPick: (slot: string) => void;
  onOpen: (course: Course) => void;
}) {
  const taken = useMemo(() => occupied(courses), [courses]);
  const planned = useMemo(() => {
    const m = new Map<string, Course[]>();
    for (const c of courses) if (c.tentative) for (const s of c.slots) m.set(s, [...(m.get(s) ?? []), c]);
    return m;
  }, [courses]);

  return (
    <div className="timetable-print overflow-x-auto rounded-[18px] bg-card shadow-[0_18px_34px_-26px_var(--shadow),0_0_0_1px_var(--line)]">
      <table className="w-full min-w-[860px] border-collapse text-left">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-card w-[104px] p-3 font-mono text-[11px] text-ink2 font-normal">
              DAY
            </th>
            {PERIODS.map((p) => (
              <Fragment key={p.n}>
                <th className="p-2 align-bottom">
                  <span className="block font-semibold text-[14px]">Slot {p.n}</span>
                  <span className="block font-mono text-[11px] text-ink2 font-normal">{p.time}</span>
                </th>
                {p.n === LUNCH_AFTER && <th className="w-8 p-0" aria-label="Lunch" />}
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {GRID.map((d, r) => (
            <tr key={d.day} className="border-t border-line">
              <th scope="row" className="sticky left-0 z-10 bg-card p-3 text-[14px] font-semibold">
                {d.day.slice(0, 3)}
                <span className="hidden sm:inline">{d.day.slice(3)}</span>
              </th>
              {d.slots.map((slot, i) => {
                const c = taken.get(slot);
                const plans = planned.get(slot) ?? [];
                const plan = c ? undefined : plans[0];
                const shown = c ?? plan;
                const isPicked = picked.includes(slot);
                return (
                  <Fragment key={slot}>
                    <td className="p-1">
                      <button
                        type="button"
                        onClick={() => (c ? onOpen(c) : onPick(slot))}
                        aria-pressed={c ? undefined : isPicked}
                        aria-label={
                          c ? `${slot}: ${c.name}. Edit` : `${slot}${plan ? `, planned ${plan.name}` : ''}`
                        }
                        className={`w-full min-h-[68px] rounded-lg p-2 text-left flex flex-col gap-0.5 border transition-colors ${
                          c
                            ? 'border-transparent text-[#161B3A]'
                            : isPicked
                              ? 'border-2 border-teal bg-mist/40'
                              : plan
                                ? 'border-dashed border-ink2/40'
                                : 'border-line hover:border-teal'
                        }`}
                        style={
                          c
                            ? { backgroundColor: c.color }
                            : plan
                              ? {
                                  backgroundImage: `repeating-linear-gradient(135deg, ${plan.color}88 0 6px, transparent 6px 12px)`,
                                }
                              : undefined
                        }
                      >
                        <span className="font-mono text-[11px] opacity-75">{slot}</span>
                        {shown && (
                          <span className="text-[13px] font-semibold leading-tight [overflow-wrap:anywhere]">
                            {shown.code || shown.name}
                            {!c && plans.length > 1 ? ` +${plans.length - 1}` : ''}
                          </span>
                        )}
                      </button>
                    </td>
                    {i === LUNCH_AFTER - 1 && r === 0 && (
                      <td rowSpan={GRID.length} className="p-0 align-middle bg-sunk">
                        <span className="block font-mono text-[11px] text-ink2 [writing-mode:vertical-rl] rotate-180 mx-auto">
                          LUNCH
                        </span>
                      </td>
                    )}
                  </Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
