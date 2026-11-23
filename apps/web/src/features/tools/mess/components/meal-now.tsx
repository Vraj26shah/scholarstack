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
    <div className="flex flex-col gap-1 min-w-0">
      <p
        className={`m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${live ? 'text-teal-text' : 'text-ink2'}`}
      >
        {live && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse" />}
        {label}
      </p>
      <p className="m-0 font-display text-[24px] leading-tight font-bold tracking-[-0.02em] text-ink">
        {MEAL_NAMES[meal.key]}{' '}
        <span className="font-sans text-[15px] font-normal tracking-normal text-ink2">{when}</span>
      </p>
      <p className="m-0 text-[15px] leading-snug text-ink2 [overflow-wrap:anywhere]">
        {dishes.length
          ? dishes.map((d, i) => (
              <span key={d}>
                {i > 0 && ', '}
                <span className={i === 0 ? 'text-ink font-medium' : ''}>{d}</span>
                {isFavourite(d, favourites) && ' ⭐'}
              </span>
            ))
          : 'Menu not in yet'}
      </p>
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
      className="print:hidden grid gap-5 sm:grid-cols-2 sm:gap-10 border-y border-line py-5"
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
        <p className="m-0 self-center font-display text-[20px] text-ink2">
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
