import {
  DAY_KEYS,
  DAY_NAMES,
  type DayKey,
  MEAL_NAMES,
  type MessDish,
  type MessMeal,
  type MessWeek,
  campusClock,
  formatSpan,
  weekIndex,
} from '@ss/contracts';
import { useState } from 'react';
import { Plus, Trash } from '../../shared/ui/icons';

/** One dish per line; a line ending in "?" is shown to students as "not sure". */
const toText = (dishes: MessDish[] = []) => dishes.map((d) => `${d.name}${d.unsure ? '?' : ''}`).join('\n');
const fromText = (text: string): MessDish[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((l) =>
      l.endsWith('?') ? { name: l.slice(0, -1).trim(), unsure: true } : { name: l, unsure: false },
    );

const emptyWeek = (label: string): MessWeek => ({
  label,
  days: { mon: {}, tue: {}, wed: {}, thu: {}, fri: {}, sat: {}, sun: {} },
});

/**
 * The weekly menu, edited right in the chart students see: days down the side, meals across.
 * Type one dish per line in a box; the first line is the main dish. Today's row is marked.
 */
export function WeekChartEditor({
  meals,
  weeks,
  cycleStart,
  onChange,
}: {
  meals: MessMeal[];
  weeks: MessWeek[];
  cycleStart: string;
  onChange: (patch: { weeks?: MessWeek[]; meals?: MessMeal[]; cycleStart?: string }) => void;
}) {
  const clock = campusClock(new Date());
  const current = weekIndex(cycleStart, clock.date, weeks.length);
  const [week, setWeek] = useState(current);
  const w = weeks[Math.min(week, weeks.length - 1)]!;
  const at = weeks.indexOf(w);
  // Boxes keep exactly what was typed (blank lines too); dishes are read from it on every change.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const today = DAY_KEYS[clock.day]!;
  /** On a phone the chart is one day at a time (a 7×2 grid doesn't fit a phone). */
  const [phoneDay, setPhoneDay] = useState<DayKey>(today);

  const setCell = (day: DayKey, meal: MessMeal['key'], text: string) => {
    setTyped((t) => ({ ...t, [`${at}:${day}:${meal}`]: text }));
    onChange({
      weeks: weeks.map((x, i) =>
        i !== at ? x : { ...x, days: { ...x.days, [day]: { ...x.days[day], [meal]: fromText(text) } } },
      ),
    });
  };
  const copyDay = (from: DayKey, to: DayKey) => {
    setTyped({});
    onChange({
      weeks: weeks.map((x, i) => (i !== at ? x : { ...x, days: { ...x.days, [to]: { ...x.days[from] } } })),
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-[15px] leading-relaxed text-ink2 max-w-[700px]">
        Type straight into the chart: <strong className="text-ink">one dish per line</strong>, the main dish
        first. This is exactly what students see on your page. Your thali price comes from the Menu card (a
        dish with "thali" in its name).
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {weeks.length > 1 &&
          weeks.map((x, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: weeks have no id; their place is what they are.
              key={i}
              type="button"
              aria-pressed={i === at}
              onClick={() => {
                setWeek(i);
                setTyped({});
              }}
              className={`h-9 rounded-full px-4 text-[14px] font-semibold border ${i === at ? 'bg-ink text-bg border-ink' : 'border-line text-ink2 hover:text-ink'}`}
            >
              {x.label || `Week ${i + 1}`}
              {i === current && <span className="ml-1.5 text-[11px] opacity-80">· this week</span>}
            </button>
          ))}
        <button
          type="button"
          disabled={weeks.length >= 6}
          onClick={() => {
            onChange({ weeks: [...weeks, emptyWeek(`Week ${weeks.length + 1}`)] });
            setWeek(weeks.length);
            setTyped({});
          }}
          className="inline-flex items-center gap-1.5 h-9 rounded-full border-[1.5px] border-dashed border-ink2/60 px-3.5 text-[13px] font-semibold text-ink hover:border-ink"
        >
          <Plus size={15} /> {weeks.length > 1 ? 'Add a week' : 'My menu changes every other week'}
        </button>
        {weeks.length > 1 && (
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(`Delete ${w.label || `week ${at + 1}`}?`)) return;
              onChange({ weeks: weeks.filter((_, i) => i !== at) });
              setWeek(0);
              setTyped({});
            }}
            className="inline-flex items-center gap-1.5 h-9 rounded-full px-3 text-[13px] font-semibold text-ink2 hover:text-blush-text"
          >
            <Trash size={15} /> Delete this week
          </button>
        )}
      </div>
      {weeks.length > 1 && (
        <label className="flex flex-wrap items-center gap-2 text-[14px] text-ink2">
          Week 1 started on
          <input
            type="date"
            value={cycleStart}
            onChange={(e) => e.target.value && onChange({ cycleStart: e.target.value })}
            className="h-9 rounded-lg border-[1.5px] border-line bg-surface px-2 text-[14px] text-ink"
          />
          <span>(the weeks take turns from that day)</span>
        </label>
      )}

      <div className="sm:hidden flex flex-col gap-4">
        <div role="tablist" aria-label="Day" className="grid grid-cols-7 gap-1">
          {DAY_KEYS.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={phoneDay === d}
              aria-label={DAY_NAMES[d]}
              onClick={() => setPhoneDay(d)}
              className={`h-12 rounded-xl text-[14px] font-semibold ${phoneDay === d ? 'bg-ink text-bg' : d === today ? 'text-teal-text [box-shadow:inset_0_0_0_1.5px_var(--teal)]' : 'text-ink2 [box-shadow:inset_0_0_0_1px_var(--line)]'}`}
            >
              {DAY_NAMES[d].slice(0, 3)}
            </button>
          ))}
        </div>
        {meals.map((m) => (
          <label key={m.key} className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between">
              <span className="font-display text-[20px] font-bold text-ink">{MEAL_NAMES[m.key]}</span>
              <span className="text-[13px] tabular-nums text-ink2">{formatSpan(m.start, m.end)}</span>
            </span>
            <textarea
              value={typed[`${at}:${phoneDay}:${m.key}`] ?? toText(w.days[phoneDay]?.[m.key])}
              onChange={(e) => setCell(phoneDay, m.key, e.target.value)}
              rows={5}
              placeholder={`${MEAL_NAMES[m.key]} dishes, one per line`}
              aria-label={`${DAY_NAMES[phoneDay]} ${MEAL_NAMES[m.key].toLowerCase()}`}
              className="block w-full rounded-xl bg-surface border-[1.5px] border-line px-3 py-2.5 text-[16px] leading-snug text-ink outline-none focus:border-teal"
            />
          </label>
        ))}
        {phoneDay !== 'mon' && (
          <button
            type="button"
            onClick={() => copyDay(DAY_KEYS[DAY_KEYS.indexOf(phoneDay) - 1]!, phoneDay)}
            className="self-start text-[14px] font-semibold text-ink2 underline underline-offset-2"
          >
            Same as {DAY_NAMES[DAY_KEYS[DAY_KEYS.indexOf(phoneDay) - 1]!]}
          </button>
        )}
      </div>

      <div className="hidden sm:block overflow-x-auto border-t-2 border-ink">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-left">
          <caption className="sr-only">Weekly menu: one dish per line in each box</caption>
          <thead>
            <tr>
              <th className="w-[110px] py-3 pr-3">
                <span className="sr-only">Day</span>
              </th>
              {meals.map((m) => (
                <th key={m.key} scope="col" className="py-3 px-2 align-bottom font-normal">
                  <span className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-ink">
                    {MEAL_NAMES[m.key]}
                  </span>
                  <span className="block text-[13px] tabular-nums text-ink2">
                    {formatSpan(m.start, m.end)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAY_KEYS.map((day, r) => (
              <tr key={day} className="border-t border-line">
                <th
                  scope="row"
                  className={`py-3 pr-3 align-top text-left font-normal ${day === today ? 'shadow-[inset_3px_0_0_var(--teal)] pl-3' : ''}`}
                >
                  <span className="block font-display text-[18px] font-bold text-ink">{DAY_NAMES[day]}</span>
                  {day === today && (
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-text">
                      Today
                    </span>
                  )}
                  {r > 0 && (
                    <button
                      type="button"
                      onClick={() => copyDay(DAY_KEYS[r - 1]!, day)}
                      className="mt-1 text-[12px] font-semibold text-ink2 underline underline-offset-2 hover:text-ink"
                    >
                      Same as {DAY_NAMES[DAY_KEYS[r - 1]!].slice(0, 3)}
                    </button>
                  )}
                </th>
                {meals.map((m) => (
                  <td key={m.key} className="p-1.5 align-top">
                    <textarea
                      value={typed[`${at}:${day}:${m.key}`] ?? toText(w.days[day]?.[m.key])}
                      onChange={(e) => setCell(day, m.key, e.target.value)}
                      rows={4}
                      placeholder={`${MEAL_NAMES[m.key]} dishes, one per line`}
                      aria-label={`${DAY_NAMES[day]} ${MEAL_NAMES[m.key].toLowerCase()}`}
                      className="block w-full min-h-[104px] resize-y rounded-xl bg-surface border-[1.5px] border-line px-2.5 py-2 text-[14px] leading-snug text-ink outline-none focus:border-teal first-line:font-semibold"
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-ink/60">
              <th
                scope="row"
                className="py-3 pr-3 align-top text-left text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2"
              >
                Every day
              </th>
              {meals.map((m) => (
                <td key={m.key} className="p-1.5 align-top">
                  <input
                    value={m.extras}
                    maxLength={200}
                    onChange={(e) =>
                      onChange({
                        meals: meals.map((x) => (x.key === m.key ? { ...x, extras: e.target.value } : x)),
                      })
                    }
                    placeholder="Served daily, e.g. Roti · Rice · Salad"
                    aria-label={`Served with every ${MEAL_NAMES[m.key].toLowerCase()}`}
                    className="w-full h-10 rounded-xl bg-surface border-[1.5px] border-line px-2.5 text-[13px] text-ink outline-none focus:border-teal"
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
