import {
  DAY_KEYS,
  DAY_NAMES,
  MEAL_NAMES,
  type MealKey,
  type MessDish,
  type MessDto,
  dishesOn,
  formatClock,
  formatSpan,
  toMinutes,
} from '@ss/contracts';
import { MealBell } from '../../../reminders/meal-reminders';

/** Where a meal stands today: being served, the next one, or over. */
export function mealState(
  meal: { start: string; end: string },
  nowMinutes: number,
): 'now' | 'later' | 'over' {
  const start = toMinutes(meal.start);
  const end = toMinutes(meal.end);
  if (nowMinutes >= start && nowMinutes < end) return 'now';
  return nowMinutes < start ? 'later' : 'over';
}

/** The meal that matters right now: the one being served, else the next one today. */
export function focusMeal(mess: MessDto, nowMinutes: number): MealKey | null {
  const now = mess.meals.find((m) => mealState(m, nowMinutes) === 'now');
  if (now) return now.key;
  return mess.meals.find((m) => mealState(m, nowMinutes) === 'later')?.key ?? null;
}

export const isFavourite = (name: string, favourites: string[]) =>
  favourites.some((f) => f.length > 1 && name.toLowerCase().includes(f.toLowerCase()));

/** One dish: unsure ones in marigold with "?", favourites with a star. */
export function Dish({ d, favourites, main }: { d: MessDish; favourites: string[]; main?: boolean }) {
  const fav = isFavourite(d.name, favourites);
  return (
    <li className={`leading-snug [overflow-wrap:anywhere] ${main ? 'font-semibold text-ink' : ''}`}>
      {d.unsure ? (
        <span className="text-marigold-text" title="Hard to read on the notice: check before you rely on it">
          {d.name}
          <sup aria-label="(not sure)">?</sup>
        </span>
      ) : (
        d.name
      )}
      {fav && (
        <span className="ml-1" role="img" aria-label="one of your favourites">
          ⭐
        </span>
      )}
    </li>
  );
}

/**
 * The week as a table, like the Timetable maker: days down the side, meals across the top. Today's
 * row is tinted, and the meal being served (or next) is outlined with how long until it starts.
 */
export function MessGrid({
  mess,
  dates,
  today,
  nowMinutes,
  favourites,
}: {
  mess: MessDto;
  dates: string[];
  today: string;
  nowMinutes: number;
  favourites: string[];
}) {
  const focus = focusMeal(mess, nowMinutes);
  // After the last meal, tomorrow's first one is "next" (if tomorrow is still this week).
  const target = focus
    ? { date: today, key: focus }
    : { date: dates[dates.indexOf(today) + 1], key: mess.meals[0]?.key };
  const wide = mess.meals.length > 2;
  const anyExtras = mess.meals.some((m) => m.extras);

  return (
    <div className="overflow-x-auto rounded-[18px] bg-card shadow-[0_18px_34px_-26px_var(--shadow),0_0_0_1px_var(--line)]">
      <table
        className={`w-full table-fixed border-collapse text-left ${wide ? 'min-w-[920px]' : 'min-w-[600px]'}`}
      >
        <caption className="sr-only">{mess.name}: this week's menu. Today is highlighted.</caption>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-card w-[96px] sm:w-[112px] p-3 font-mono text-[11px] text-ink2 font-normal align-bottom">
              DAY
            </th>
            {mess.meals.map((m) => {
              const hot = m.key === target.key && !!target.date;
              return (
                <th
                  key={m.key}
                  scope="col"
                  aria-current={hot ? 'time' : undefined}
                  className="p-2 pl-3 align-bottom font-normal"
                >
                  <span className="flex items-end justify-between gap-2">
                    <span className="min-w-0">
                      <span
                        className={`block font-semibold text-[15px] ${hot ? 'text-teal-text' : 'text-ink'}`}
                      >
                        {MEAL_NAMES[m.key]}
                      </span>
                      <span className="block font-mono text-[11px] text-ink2">
                        {formatSpan(m.start, m.end)}
                      </span>
                    </span>
                    <MealBell mess={mess} meal={m.key} />
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {dates.map((date, r) => {
            const key = DAY_KEYS[r]!;
            const isToday = date === today;
            return (
              <tr
                key={date}
                aria-current={isToday ? 'date' : undefined}
                className={`border-t border-line ${isToday ? 'bg-mist/25' : ''}`}
              >
                <th
                  scope="row"
                  className={`sticky left-0 z-10 p-3 align-top text-[14px] font-semibold ${isToday ? 'bg-mist/40 text-ink' : 'bg-card'}`}
                >
                  {DAY_NAMES[key].slice(0, 3)}
                  <span className="hidden sm:inline">{DAY_NAMES[key].slice(3)}</span>
                  <span className="block font-mono text-[11px] font-normal text-ink2">
                    {Number(date.slice(8))}{' '}
                    {new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
                      month: 'short',
                      timeZone: 'UTC',
                    })}
                  </span>
                  {isToday && (
                    <span className="mt-1 inline-block rounded bg-teal px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                      TODAY
                    </span>
                  )}
                </th>
                {mess.meals.map((m) => {
                  const dishes = dishesOn(mess, date, m.key);
                  const state = isToday ? mealState(m, nowMinutes) : null;
                  const hot = date === target.date && m.key === target.key;
                  const wait = toMinutes(m.start) - nowMinutes;
                  return (
                    <td key={m.key} className="p-1.5 align-top">
                      <div
                        id={isToday ? `meal-${m.key}` : undefined}
                        className={`h-full min-h-[92px] rounded-xl p-3 flex flex-col gap-1.5 text-[13px] text-ink2 ${
                          hot
                            ? 'bg-surface ring-2 ring-teal shadow-[0_10px_24px_-16px_var(--shadow)]'
                            : state === 'over'
                              ? 'opacity-55'
                              : ''
                        }`}
                      >
                        {hot && (
                          <span
                            className={`self-start inline-flex items-center h-6 px-2 rounded-md text-[11.5px] font-semibold ${state === 'now' ? 'bg-teal text-white' : 'bg-marigold-soft text-marigold-text'}`}
                          >
                            {state === 'now'
                              ? `Serving now · till ${formatClock(toMinutes(m.end))}`
                              : !isToday
                                ? `Next · tomorrow ${formatClock(toMinutes(m.start))}`
                                : wait <= 90
                                  ? `Next · in ${wait} min`
                                  : `Next · at ${formatClock(toMinutes(m.start))}`}
                          </span>
                        )}
                        {state === 'over' && (
                          <span className="sr-only">{MEAL_NAMES[m.key]} is over for today.</span>
                        )}
                        {dishes.length ? (
                          <ul className="m-0 p-0 list-none flex flex-col gap-1">
                            {dishes.map((d, i) => (
                              <Dish key={d.name} d={d} favourites={favourites} main={i === 0} />
                            ))}
                          </ul>
                        ) : (
                          <span className="italic">Not in yet</span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {anyExtras && (
            <tr className="border-t border-line bg-sunk/60">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-sunk p-3 align-top text-[12px] font-semibold text-ink2"
              >
                Every day
              </th>
              {mess.meals.map((m) => (
                <td key={m.key} className="p-3 align-top text-[12.5px] leading-snug text-ink2">
                  {m.extras || '—'}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
