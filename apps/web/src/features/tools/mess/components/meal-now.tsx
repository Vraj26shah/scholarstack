import {
  DAY_KEYS,
  DAY_NAMES,
  MEAL_NAMES,
  type MessDto,
  type MessMeal,
  dishesOn,
  formatClock,
  toMinutes,
} from '@ss/contracts';
import { isFavourite, mealState } from './mess-grid';

function Line({
  label,
  meal,
  when,
  dishes,
  favourites,
  live,
}: {
  label: string;
  meal: MessMeal;
  when: string;
  dishes: string[];
  favourites: string[];
  live?: boolean;
}) {
  return (
    <div className="flex items-stretch gap-3 min-w-0">
      <span className={`w-1.5 flex-none rounded-full ${live ? 'bg-teal' : 'bg-marigold'}`} />
      <div className="min-w-0">
        <p className="m-0 text-[12px] font-medium text-ink2">{label}</p>
        <p className="m-0 text-[17px] font-semibold leading-snug">
          {MEAL_NAMES[meal.key]} <span className="text-[14px] font-normal text-ink2">· {when}</span>
        </p>
        <p className="m-0 text-[14px] text-ink2 [overflow-wrap:anywhere]">
          {dishes.length
            ? dishes.map((d, i) => (
                <span key={d}>
                  {i > 0 && ', '}
                  {d}
                  {isFavourite(d, favourites) && ' ⭐'}
                </span>
              ))
            : 'Menu not in yet'}
        </p>
      </div>
    </div>
  );
}

/** "Now" and "Next" at a glance, like the Timetable maker's card, for meals. */
export function MealNow({
  mess,
  date,
  tomorrow,
  dayIndex,
  nowMinutes,
  favourites,
}: {
  mess: MessDto;
  date: string;
  tomorrow: string;
  /** Today, 0 = Monday. */
  dayIndex: number;
  nowMinutes: number;
  favourites: string[];
}) {
  const names = (d: string, m: MessMeal) => dishesOn(mess, d, m.key).map((x) => x.name);
  const now = mess.meals.find((m) => mealState(m, nowMinutes) === 'now');
  const later = mess.meals.filter((m) => mealState(m, nowMinutes) === 'later');
  const next = later[0];
  const first = mess.meals[0];
  const tomorrowName = DAY_NAMES[DAY_KEYS[(dayIndex + 1) % 7]!];

  const nextWhen = (m: MessMeal) => {
    const wait = toMinutes(m.start) - nowMinutes;
    return wait <= 90 ? `in ${wait} min` : `at ${formatClock(toMinutes(m.start))}`;
  };

  return (
    <section
      aria-label="Meals now"
      className="print:hidden grid gap-4 sm:grid-cols-2 rounded-[18px] bg-card p-4 sm:p-5 shadow-[0_0_0_1px_var(--line)]"
    >
      {now ? (
        <Line
          live
          label="Now"
          meal={now}
          when={`till ${formatClock(toMinutes(now.end))}`}
          dishes={names(date, now)}
          favourites={favourites}
        />
      ) : (
        <p className="m-0 self-center text-[15px] text-ink2">
          {next ? 'Nothing being served right now.' : "Today's meals are over."}
        </p>
      )}
      {next ? (
        <Line
          label="Next"
          meal={next}
          when={nextWhen(next)}
          dishes={names(date, next)}
          favourites={favourites}
        />
      ) : (
        first && (
          <Line
            label={`${tomorrowName}, first up`}
            meal={first}
            when={`at ${formatClock(toMinutes(first.start))}`}
            dishes={names(tomorrow, first)}
            favourites={favourites}
          />
        )
      )}
    </section>
  );
}
