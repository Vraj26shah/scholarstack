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
    <li
      className={`leading-snug [overflow-wrap:anywhere] ${main ? 'text-[14px] font-semibold text-ink' : ''} ${fav ? '-mx-1 rounded-md bg-marigold-soft px-1 text-marigold-text' : ''}`}
    >
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

  const zebra = (r: number) => (r % 2 ? 'bg-sunk/60' : 'bg-surface');

  return (
    <div className="-mx-4 px-4 sm:mx-0 sm:px-0">
      <div className="overflow-x-auto rounded-2xl bg-surface [box-shadow:inset_0_0_0_1px_var(--line)]">
        <table
          className={`w-full table-fixed border-collapse text-left ${wide ? 'min-w-[940px]' : 'min-w-[620px]'}`}
        >
          <caption className="sr-only">{mess.name}: this week's menu. Today is highlighted.</caption>
          <colgroup>
            <col className="w-[96px] sm:w-[128px]" />
            {mess.meals.map((m) => (
              <col key={m.key} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b-2 border-ink">
              <th className="sticky left-0 z-10 bg-surface px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink2">
                Day
              </th>
              {mess.meals.map((m) => {
                const hot = m.key === target.key && !!target.date;
                return (
                  <th
                    key={m.key}
                    scope="col"
                    aria-current={hot ? 'time' : undefined}
                    className={`border-l border-line px-4 py-3 align-bottom font-normal ${hot ? 'bg-mist/50' : ''}`}
                  >
                    <span className="flex items-end justify-between gap-2">
                      <span className="min-w-0">
                        <span
                          className={`block font-display text-[19px] leading-tight font-bold tracking-[-0.02em] ${hot ? 'text-teal-text' : 'text-ink'}`}
                        >
                          {MEAL_NAMES[m.key]}
                        </span>
                        <span className="block text-[12.5px] tabular-nums text-ink2">
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
              const row = isToday ? 'bg-mist/30' : zebra(r);
              return (
                <tr
                  key={date}
                  aria-current={isToday ? 'date' : undefined}
                  className={`border-t border-line ${row}`}
                >
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 px-4 py-3.5 align-top text-left font-normal ${isToday ? 'bg-[color-mix(in_oklab,var(--mist)_30%,var(--surface))] shadow-[inset_4px_0_0_var(--teal)]' : r % 2 ? 'bg-[color-mix(in_oklab,var(--sunk)_60%,var(--surface))]' : 'bg-surface'}`}
                  >
                    <span className="block font-display text-[18px] leading-tight font-bold tracking-[-0.02em] text-ink">
                      {DAY_NAMES[key].slice(0, 3)}
                      <span className="hidden sm:inline">{DAY_NAMES[key].slice(3)}</span>
                    </span>
                    <span className="block text-[12px] tabular-nums text-ink2">
                      {Number(date.slice(8))}{' '}
                      {new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
                        month: 'short',
                        timeZone: 'UTC',
                      })}
                    </span>
                    {isToday && (
                      <span className="mt-1 inline-block rounded-full bg-teal px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white">
                        Today
                      </span>
                    )}
                  </th>
                  {mess.meals.map((m) => {
                    const dishes = dishesOn(mess, date, m.key);
                    const state = isToday ? mealState(m, nowMinutes) : null;
                    const hot = date === target.date && m.key === target.key;
                    const wait = toMinutes(m.start) - nowMinutes;
                    return (
                      <td
                        key={m.key}
                        className={`border-l border-line align-top ${hot ? 'bg-mist/55 shadow-[inset_0_0_0_2px_var(--teal)]' : ''}`}
                      >
                        <div
                          id={isToday ? `meal-${m.key}` : undefined}
                          className={`h-full min-h-[92px] px-4 py-3.5 flex flex-col gap-2 text-[13.5px] text-ink2 ${state === 'over' ? 'opacity-45' : ''}`}
                        >
                          {hot && (
                            <span
                              className={`self-start inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] ${state === 'now' ? 'bg-teal text-white' : 'bg-marigold-soft text-marigold-text'}`}
                            >
                              <span
                                aria-hidden="true"
                                className={`w-1.5 h-1.5 rounded-full ${state === 'now' ? 'bg-white animate-pulse' : 'bg-marigold'}`}
                              />
                              {state === 'now'
                                ? `Serving · till ${formatClock(toMinutes(m.end))}`
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
                            <span className="italic text-ink2/80">Not in yet</span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {anyExtras && (
              <tr className="border-t-2 border-ink bg-surface">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-surface px-4 py-3 align-top text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-ink2"
                >
                  With every meal
                </th>
                {mess.meals.map((m) => (
                  <td
                    key={m.key}
                    className="border-l border-line px-4 py-3 align-top text-[13px] leading-snug text-ink"
                  >
                    {m.extras || '—'}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
