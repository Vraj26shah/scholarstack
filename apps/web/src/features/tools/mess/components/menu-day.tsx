import {
  DAY_KEYS,
  DAY_NAMES,
  MEAL_NAMES,
  type MealKey,
  type MessDto,
  dishesOn,
  favouritesIn,
  formatClock,
  formatSpan,
  toMinutes,
  weekIndex,
} from '@ss/contracts';
import { MealBell } from '../../../reminders/meal-reminders';

/** The seven dates of this campus week (Monday first), given today's date and weekday. */
export function weekDates(today: string, day: number): string[] {
  const base = Date.parse(`${today}T00:00:00Z`) - day * 86_400_000;
  return DAY_KEYS.map((_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

export function DayStrip({
  dates,
  today,
  value,
  onChange,
}: { dates: string[]; today: string; value: string; onChange: (date: string) => void }) {
  return (
    <div role="tablist" aria-label="Day" className="grid grid-cols-7 gap-1 max-w-[640px]">
      {dates.map((d, i) => {
        const key = DAY_KEYS[i]!;
        const isToday = d === today;
        const on = d === value;
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={`${DAY_NAMES[key]}${isToday ? ', today' : ''}`}
            onClick={() => onChange(d)}
            className={`flex flex-col items-center justify-center h-14 rounded-xl text-[13px] font-semibold ${on ? 'bg-ink text-bg' : isToday ? 'text-teal-text shadow-[inset_0_-2px_0_var(--teal)]' : 'text-ink2 hover:text-ink'}`}
          >
            <span>{DAY_NAMES[key].slice(0, 3)}</span>
            <span className={`text-[12px] font-normal ${on ? 'opacity-75' : ''}`}>
              {isToday ? 'Today' : Number(d.slice(8))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** "Serving now · till 2:30 pm", "In 40 min", "Over" (only for today). */
function mealStatus(
  start: number,
  end: number,
  now: number,
): { text: string; tone: 'now' | 'next' | 'past' } {
  if (now >= start && now < end) return { text: `Serving now · till ${formatClock(end)}`, tone: 'now' };
  if (now < start)
    return { text: start - now <= 90 ? `In ${start - now} min` : `At ${formatClock(start)}`, tone: 'next' };
  return { text: 'Over', tone: 'past' };
}

const TONE = {
  now: 'text-teal-text',
  next: 'text-marigold-text',
  past: 'text-ink2',
};

/** Every meal of one day: time, what's served, what comes with it. */
export function MenuDay({
  mess,
  date,
  isToday,
  nowMinutes,
  focus,
  favourites,
}: {
  mess: MessDto;
  date: string;
  isToday: boolean;
  nowMinutes: number;
  focus: MealKey | null;
  favourites: string[];
}) {
  const week = weekIndex(mess.cycleStart, date, mess.weeks.length);
  const label = mess.weeks[week]?.label;
  // The next meal today is the one that matters most: it goes first on phones.
  const firstOpen = isToday ? mess.meals.find((m) => toMinutes(m.end) > nowMinutes)?.key : null;
  return (
    <div className="flex flex-col gap-3">
      {mess.weeks.length > 1 && (
        <p className="m-0 text-[13px] text-ink2">
          {label || `Week ${week + 1}`} of a {mess.weeks.length}-week menu
        </p>
      )}
      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {mess.meals.map((meal) => {
          const dishes = dishesOn(mess, date, meal.key);
          const start = toMinutes(meal.start);
          const end = toMinutes(meal.end);
          const status = isToday ? mealStatus(start, end, nowMinutes) : null;
          const favs = new Set(favouritesIn(dishes, favourites).map((f) => f.toLowerCase()));
          const star = (name: string) => [...favs].some((f) => name.toLowerCase().includes(f));
          return (
            <section
              key={meal.key}
              id={`meal-${meal.key}`}
              aria-labelledby={`meal-${meal.key}-h`}
              className={`scroll-mt-24 border-t-2 pt-3 flex flex-col gap-2.5 ${status?.tone === 'now' || focus === meal.key ? 'border-teal' : 'border-ink'} ${status?.tone === 'past' ? 'opacity-55' : ''} ${firstOpen === meal.key ? 'order-first sm:order-none' : ''}`}
            >
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h3
                  id={`meal-${meal.key}-h`}
                  className="m-0 font-display text-[24px] leading-tight font-bold tracking-[-0.02em] text-ink"
                >
                  {MEAL_NAMES[meal.key]}
                </h3>
                <span className="flex items-center gap-1 text-[14px] text-ink2 tabular-nums">
                  {formatSpan(meal.start, meal.end)}
                  <MealBell mess={mess} meal={meal.key} />
                </span>
              </header>
              {status && (
                <span
                  className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${TONE[status.tone]}`}
                >
                  {status.text}
                </span>
              )}
              {dishes.length ? (
                <ul className="m-0 p-0 list-none flex flex-col gap-1.5 text-[15px] leading-snug text-ink">
                  {dishes.map((d) => (
                    <li key={d.name}>
                      {d.unsure ? (
                        <span
                          className="text-marigold-text"
                          title="Hard to read on the notice: check before you rely on it"
                        >
                          {d.name}
                          <sup aria-label="(not sure)">?</sup>
                        </span>
                      ) : (
                        d.name
                      )}
                      {star(d.name) && (
                        <span className="ml-1" role="img" aria-label="one of your favourites">
                          ⭐
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-[15px] text-ink2">Not in yet for this day.</p>
              )}
              {meal.extras && dishes.length > 0 && (
                <p className="m-0 border-t border-line pt-3 text-[13px] text-ink2">
                  <span className="font-semibold">Also served:</span> {meal.extras}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
