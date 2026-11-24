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

type State = 'now' | 'next' | 'later' | 'over';

/** "Serving now · till 2:30 pm", "In 40 min", "Done": one short line per meal. */
function statusLine(meal: MessMeal, state: State, nowMinutes: number, tomorrow?: boolean) {
  const start = toMinutes(meal.start);
  if (state === 'now') return `Serving now · till ${formatClock(toMinutes(meal.end))}`;
  if (state === 'over') return 'Done';
  if (tomorrow) return `Tomorrow · ${formatClock(start)}`;
  const wait = start - nowMinutes;
  if (state === 'next' && wait <= 90) return `Next · in ${wait} min`;
  return state === 'next' ? `Next · ${formatClock(start)}` : formatClock(start);
}

function Dishes({ names, favourites, full }: { names: string[]; favourites: string[]; full: boolean }) {
  if (!names.length) return <p className="m-0 text-[14px] italic text-ink2">Menu not in yet</p>;
  const shown = full ? names : names.slice(0, 2);
  const more = names.length - shown.length;
  return (
    <p
      className={`m-0 leading-snug [overflow-wrap:anywhere] ${full ? 'text-[15px]' : 'text-[14px]'} text-ink2`}
    >
      {shown.map((d, i) => (
        <span key={d}>
          {i > 0 && ', '}
          <span className={i === 0 ? 'font-semibold text-ink' : ''}>{d}</span>
          {isFavourite(d, favourites) && ' ⭐'}
        </span>
      ))}
      {more > 0 && <span> +{more} more</span>}
    </p>
  );
}

/**
 * Today at a glance: every meal of the day in order, like stops on a line. Finished meals fold to
 * one word, the one being served (or the next) opens up with the whole menu, so a glance answers
 * "what's on now, and what's next?". After dinner it shows tomorrow's first meal instead.
 */
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
  const raw = mess.meals.map((m) => mealState(m, nowMinutes));
  const nowIdx = raw.indexOf('now');
  const nextIdx = raw.indexOf('later');
  const focusIdx = nowIdx >= 0 ? nowIdx : nextIdx;
  const states: State[] = raw.map((s, i) =>
    s === 'now' ? 'now' : s === 'over' ? 'over' : i === nextIdx && nowIdx < 0 ? 'next' : 'later',
  );
  const allDone = focusIdx < 0;
  const first = mess.meals[0];
  const tomorrowName = DAY_NAMES[DAY_KEYS[(dayIndex + 1) % 7]!];
  const done = states.filter((s) => s === 'over').length;

  return (
    <section aria-label="Meals now" className="print:hidden flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="m-0 text-[18px] font-bold text-ink">
          Today{' '}
          <span className="font-normal text-[15px] text-ink2">
            {DAY_NAMES[DAY_KEYS[dayIndex]!]} · {formatClock(nowMinutes)}
          </span>
        </h2>
        <span className="text-[13px] tabular-nums text-ink2">
          {done} of {mess.meals.length} meals done
        </span>
      </div>

      {/* The day as a line: filled up to now. */}
      <div aria-hidden="true" className="flex gap-1.5">
        {states.map((s, i) => (
          <span
            key={mess.meals[i]!.key}
            className={`h-1.5 flex-1 rounded-full ${s === 'over' ? 'bg-ink/35' : s === 'now' ? 'bg-teal' : s === 'next' ? 'bg-marigold' : 'bg-line'}`}
          />
        ))}
      </div>

      <ol
        className="m-0 p-0 list-none grid gap-x-6 gap-y-3"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${allDone ? 260 : 180}px, 1fr))` }}
      >
        {mess.meals.map((m, i) => {
          const s = states[i]!;
          const focus = i === focusIdx;
          const tone = s === 'now' ? 'text-teal-text' : s === 'next' ? 'text-marigold-text' : 'text-ink2';
          return (
            <li
              key={m.key}
              aria-current={s === 'now' ? 'time' : undefined}
              className={`min-w-0 flex flex-col gap-1 ${s === 'over' ? 'opacity-55' : ''} ${focus ? 'sm:col-span-2' : ''}`}
            >
              <p
                className={`m-0 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] ${tone}`}
              >
                {s === 'now' && (
                  <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse" />
                )}
                {statusLine(m, s, nowMinutes)}
              </p>
              <p
                className={`m-0 font-display font-bold tracking-[-0.02em] text-ink leading-tight ${focus ? 'text-[26px]' : 'text-[19px]'}`}
              >
                {MEAL_NAMES[m.key]}
              </p>
              {s !== 'over' && <Dishes names={names(date, m)} favourites={favourites} full={focus} />}
            </li>
          );
        })}
      </ol>

      {allDone && first && (
        <div className="border-t border-line pt-3 flex flex-col gap-1">
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-marigold-text">
            Next · {tomorrowName} {formatClock(toMinutes(first.start))}
          </p>
          <p className="m-0 font-display text-[22px] font-bold tracking-[-0.02em] text-ink">
            {MEAL_NAMES[first.key]}
          </p>
          <Dishes names={names(tomorrow, first)} favourites={favourites} full />
        </div>
      )}
    </section>
  );
}
