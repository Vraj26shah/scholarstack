import { field } from '../tools/core/ui';
import { type Course, GRID, clock, dayClasses, dayIndex } from '../tools/timetable/domain';
import { Chip, Group, ReminderCard, Switch, toggle } from './reminder-card';
import { ReminderSwitch } from './reminder-switch';
import { useReminders } from './use-reminders';

/** The top-of-page switch for class reminders. */
export function ClassReminderSwitch() {
  return (
    <ReminderSwitch
      label="Class reminders"
      settings="class-reminders"
      isOn={(r) => r.classes.nightly || r.classes.before}
      enable={(r) => ({ ...r, classes: { ...r.classes, nightly: true } })}
      disable={(r) => ({ ...r, classes: { ...r.classes, nightly: false, before: false } })}
    />
  );
}

/** A preview of tonight's message, from the student's own timetable. */
function sampleFor(courses: Course[]) {
  const today = dayIndex(new Date());
  const tomorrow = today === -1 ? 0 : today + 1;
  const list = dayClasses(
    courses.filter((c) => !c.tentative),
    tomorrow,
  );
  if (!list.length) return { title: 'Tomorrow · 2 classes', body: 'DSA 8:30 am · OS 10:05 am' };
  return {
    title: `Tomorrow · ${list.length} class${list.length === 1 ? '' : 'es'}`,
    body: list.map((s) => `${s.course.code || s.course.name} ${clock(s.start)}`).join(' · '),
  };
}

/**
 * Class reminders, inside the Timetable maker: tomorrow's classes at a chosen time, a nudge before
 * each class, on the days and for the subjects the student picks.
 */
export function ClassReminders({ courses }: { courses: Course[] }) {
  const r = useReminders();
  const c = r.local.classes;
  const set = (patch: Partial<typeof c>) => r.update((x) => ({ ...x, classes: { ...x.classes, ...patch } }));
  const real = courses.filter((x) => !x.tentative);
  const chosen = c.courseIds === 'all' ? real.map((x) => x.id) : c.courseIds;
  const any = c.nightly || c.before;

  return (
    <ReminderCard
      id="class-reminders"
      title="Class reminders"
      ask="Tomorrow's classes the night before, and a nudge before each class if you want one. Only for the subjects and days you pick, even when the site is closed."
      sample={sampleFor(courses)}
      preset={(x) => ({ ...x, classes: { ...x.classes, nightly: true } })}
      off={{
        label: 'Turn off class reminders',
        isOn: (x) => x.classes.nightly || x.classes.before,
        disable: (x) => ({ ...x, classes: { ...x.classes, nightly: false, before: false } }),
      }}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Switch on={c.nightly} onChange={(v) => set({ nightly: v })}>
            Tomorrow's classes, the night before
          </Switch>
          {c.nightly && (
            <label className="flex items-center gap-2 pl-14 text-[14px] text-ink2">
              at
              <input
                type="time"
                value={c.nightlyAt}
                onChange={(e) => e.target.value && set({ nightlyAt: e.target.value })}
                className={`${field} w-auto h-10`}
              />
            </label>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Switch on={c.before} onChange={(v) => set({ before: v })}>
            A nudge before each class
          </Switch>
          {c.before && (
            <div className="flex flex-wrap items-center gap-2 pl-14">
              {[5, 10, 15, 30].map((n) => (
                <Chip key={n} on={c.lead === n} onClick={() => set({ lead: n })}>
                  {n} min
                </Chip>
              ))}
            </div>
          )}
        </div>
      </div>

      {any && (
        <>
          <Group label="On these days">
            {GRID.map((d, i) => (
              <Chip
                key={d.day}
                on={c.days.includes(i)}
                onClick={() => set({ days: toggle(c.days, i) })}
                label={d.day}
              >
                {d.day.slice(0, 3)}
              </Chip>
            ))}
          </Group>
          <Group
            label="For these subjects"
            hint={real.length ? undefined : 'Add a course above first; reminders follow your timetable.'}
          >
            {real.length > 1 && (
              <Chip on={c.courseIds === 'all'} onClick={() => set({ courseIds: 'all' })}>
                All, including new ones
              </Chip>
            )}
            {real.map((course) => (
              <Chip
                key={course.id}
                color={course.color}
                on={chosen.includes(course.id)}
                onClick={() => set({ courseIds: toggle(chosen, course.id) })}
              >
                {course.code || course.name}
              </Chip>
            ))}
          </Group>
          {c.days.length === 0 || (real.length > 0 && chosen.length === 0) ? (
            <p className="m-0 text-[14px] text-marigold-text">
              Pick at least one day and one subject, or nothing will be sent.
            </p>
          ) : null}
        </>
      )}
    </ReminderCard>
  );
}
