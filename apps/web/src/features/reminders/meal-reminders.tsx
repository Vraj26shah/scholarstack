import {
  DAY_KEYS,
  MEAL_NAMES,
  type MealKey,
  type MessDto,
  campusClock,
  dishesOn,
  formatClock,
  toMinutes,
} from '@ss/contracts';
import { useState } from 'react';
import { Button } from '../../shared/ui/button';
import { Bell, Cross } from '../../shared/ui/icons';
import { field } from '../tools/core/ui';
import { Chip, Group, ReminderCard, toggle } from './reminder-card';
import { ReminderSwitch } from './reminder-switch';
import type { LocalReminders } from './settings-store';
import { useReminders } from './use-reminders';

const EMOJI: Record<MealKey, string> = { breakfast: '🍳', lunch: '🍛', snacks: '☕', dinner: '🍽️' };

/** The meals of this mess to remind about: the student's choice, else lunch and dinner. */
const mealsFor = (mess: MessDto, wanted: MealKey[]) => {
  const has = mess.meals.map((m) => m.key);
  const picked = wanted.filter((k) => has.includes(k));
  return picked.length ? picked : has.filter((k) => k === 'lunch' || k === 'dinner');
};

/** Turn on (or switch) meal reminders for this mess. */
const forMess =
  (mess: MessDto) =>
  (r: LocalReminders): LocalReminders => ({
    ...r,
    mess: { ...r.mess, slug: mess.slug, meals: mealsFor(mess, r.mess.meals), only: r.mess.only === true },
  });

/** Today's next meal, as the reminder will read. */
function sampleFor(mess: MessDto, lead: number) {
  const now = campusClock(new Date());
  const meal =
    mess.meals.find((m) => toMinutes(m.start) > now.minutes && dishesOn(mess, now.date, m.key).length) ??
    mess.meals.find((m) => dishesOn(mess, now.date, m.key).length);
  if (!meal) return { title: `Lunch in ${lead} min 🍛`, body: `Today's menu · ${mess.name}` };
  const dishes = dishesOn(mess, now.date, meal.key)
    .map((d) => d.name)
    .join(', ');
  return {
    title: `${MEAL_NAMES[meal.key]} in ${lead} min ${EMOJI[meal.key]}`,
    body: `${dishes} · ${mess.name}`,
  };
}

/**
 * Meal reminders, inside the Mess menu: which meals of this mess, how early, and favourite dishes
 * (a favourite on the menu is sent even for a meal not ticked).
 */
export function MealReminders({ mess, otherName }: { mess: MessDto; otherName?: string }) {
  const r = useReminders();
  const m = r.local.mess;
  const [favourite, setFavourite] = useState('');
  const set = (patch: Partial<typeof m>) => r.update((x) => ({ ...x, mess: { ...x.mess, ...patch } }));
  const mine = m.slug === mess.slug;

  const addFavourite = () => {
    const f = favourite.trim().slice(0, 40);
    if (f.length < 2 || m.favourites.some((x) => x.toLowerCase() === f.toLowerCase())) return;
    set({ favourites: [...m.favourites, f].slice(0, 40) });
    setFavourite('');
  };

  return (
    <ReminderCard
      id="reminders"
      title="Meal reminders"
      ask={`What's on at ${mess.name}, ${m.lead} min before each meal you pick. On this device, even when the site is closed.`}
      sample={sampleFor(mess, m.lead)}
      preset={forMess(mess)}
      testKind="meal"
      off={{
        label: 'Turn off meal reminders',
        isOn: (x) => x.mess.slug === mess.slug && (x.mess.meals.length > 0 || x.mess.favourites.length > 0),
        disable: (x) => ({ ...x, mess: { ...x.mess, slug: null } }),
      }}
    >
      {!mine ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-sunk px-4 py-3">
          <p className="m-0 flex-1 min-w-[220px] text-[15px] text-ink">
            {m.slug ? (
              <>
                Your meal reminders are for <strong>{otherName ?? 'another mess'}</strong>.
              </>
            ) : (
              'No mess picked for meal reminders yet.'
            )}
          </p>
          <Button variant="brand" size="sm" onClick={() => r.update(forMess(mess))}>
            Remind me about {mess.name}
          </Button>
        </div>
      ) : (
        <>
          <Group label="Which meals">
            {mess.meals.map((meal) => (
              <Chip
                key={meal.key}
                on={m.meals.includes(meal.key)}
                onClick={() => set({ meals: toggle(m.meals, meal.key) })}
              >
                {MEAL_NAMES[meal.key]}
                <span className="font-normal opacity-75">{formatClock(toMinutes(meal.start))}</span>
              </Chip>
            ))}
          </Group>
          <Group label="How early">
            {[15, 30, 45, 60].map((n) => (
              <Chip key={n} on={m.lead === n} onClick={() => set({ lead: n })}>
                {n} min before
              </Chip>
            ))}
          </Group>
          <Group label="Remind me about">
            <Chip on={!m.only} onClick={() => set({ only: false })}>
              Every dish
            </Chip>
            <Chip on={m.only} onClick={() => set({ only: true })}>
              Only dishes I tick
            </Chip>
          </Group>
          <DishPicker
            mess={mess}
            meals={m.meals}
            picked={m.favourites}
            only={m.only}
            onChange={(favourites) => set({ favourites })}
          />
          <form
            className="flex gap-2 w-full max-w-[460px]"
            onSubmit={(e) => {
              e.preventDefault();
              addFavourite();
            }}
          >
            <input
              value={favourite}
              onChange={(e) => setFavourite(e.target.value)}
              placeholder="Or type a word: paneer, biryani, jalebi"
              aria-label="Add a favourite word"
              maxLength={40}
              className={`${field} flex-1 h-10`}
            />
            <Button variant="outline" size="sm" type="submit" disabled={favourite.trim().length < 2}>
              Add
            </Button>
          </form>
          {(m.meals.length === 0 || (m.only && m.favourites.length === 0)) && (
            <p className="m-0 text-[14px] text-marigold-text">
              {m.meals.length === 0
                ? 'Pick at least one meal, or nothing will be sent.'
                : 'Tick at least one dish (or switch to "Every dish"), or nothing will be sent.'}
            </p>
          )}
        </>
      )}
    </ReminderCard>
  );
}

/** Every dish this mess serves at a meal across its weeks, most frequent first. */
function dishesAt(mess: MessDto, meal: MealKey): string[] {
  const count = new Map<string, number>();
  for (const w of mess.weeks)
    for (const d of DAY_KEYS)
      for (const dish of w.days[d]?.[meal] ?? []) {
        const name = dish.name.trim();
        if (name.length >= 2) count.set(name, (count.get(name) ?? 0) + 1);
      }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
}

/**
 * The mess's own dishes as tick boxes, meal by meal. "Every dish": ticked ones get a ⭐ and are
 * announced even at a meal you didn't pick. "Only dishes I tick": a meal is announced only when it
 * serves one of them.
 */
function DishPicker({
  mess,
  meals,
  picked,
  only,
  onChange,
}: {
  mess: MessDto;
  meals: MealKey[];
  picked: string[];
  only: boolean;
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<MealKey | null>(null);
  const shown = mess.meals.filter((m) => meals.includes(m.key) || !only);
  const q = query.trim().toLowerCase();
  const isPicked = (n: string) => picked.some((p) => p.toLowerCase() === n.toLowerCase());
  const flip = (n: string) =>
    onChange(
      isPicked(n) ? picked.filter((p) => p.toLowerCase() !== n.toLowerCase()) : [...picked, n].slice(0, 40),
    );
  const custom = picked.filter((p) => !mess.meals.some((m) => dishesAt(mess, m.key).some((d) => d === p)));

  return (
    <div role="group" aria-label="Dishes" className="flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <span className="flex flex-col">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-ink2">
            {only ? 'Dishes to be told about' : 'Favourite dishes (optional)'}
          </span>
          <span className="text-[13px] text-ink2">
            {only
              ? 'You only hear about a meal when one of these is on it.'
              : "Ticked dishes get a ⭐ and we'll tell you even at a meal you didn't pick."}{' '}
            {picked.length > 0 && <strong className="text-ink">{picked.length} ticked.</strong>}
          </span>
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search dishes"
          aria-label="Search dishes"
          className={`${field} h-10 w-full sm:w-[220px]`}
        />
      </div>
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
        {shown.map((meal) => {
          const all = dishesAt(mess, meal.key).filter((n) => !q || n.toLowerCase().includes(q));
          const expanded = open === meal.key || !!q;
          const list = expanded ? all : all.slice(0, 8);
          return (
            <fieldset key={meal.key} className="m-0 p-0 border-0 min-w-0">
              <legend className="mb-1.5 flex w-full items-baseline justify-between gap-2 border-b border-line pb-1 text-[14px] font-bold text-ink">
                {MEAL_NAMES[meal.key]}
                <span className="text-[12px] font-normal text-ink2">{all.length} dishes</span>
              </legend>
              {all.length === 0 ? (
                <p className="m-0 text-[13px] text-ink2">{q ? 'No match.' : 'No dishes in the menu yet.'}</p>
              ) : (
                <ul className="m-0 p-0 list-none flex flex-col">
                  {list.map((n) => (
                    <li key={n}>
                      <label className="flex items-start gap-2.5 py-1.5 text-[14px] leading-snug text-ink cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isPicked(n)}
                          onChange={() => flip(n)}
                          className="mt-0.5 w-[18px] h-[18px] shrink-0 accent-[var(--teal)]"
                        />
                        <span className="[overflow-wrap:anywhere]">{n}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {!q && all.length > 8 && (
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : meal.key)}
                  className="mt-1 border-0 bg-transparent p-0 text-[13px] font-semibold text-teal-text underline underline-offset-2 cursor-pointer"
                >
                  {expanded ? 'Show fewer' : `Show all ${all.length}`}
                </button>
              )}
            </fieldset>
          );
        })}
      </div>
      {custom.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {custom.map((f) => (
            <span
              key={f}
              className="inline-flex items-center gap-1 h-9 rounded-full bg-mist pl-3.5 pr-1 text-[13.5px] font-semibold text-on-mist"
            >
              ⭐ {f}
              <button
                type="button"
                aria-label={`Remove ${f}`}
                onClick={() => onChange(picked.filter((x) => x !== f))}
                className="grid place-items-center w-7 h-7 rounded-full border-0 bg-transparent hover:bg-surface/60 cursor-pointer"
              >
                <Cross size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {picked.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-ink2 underline underline-offset-2 cursor-pointer"
        >
          Untick all
        </button>
      )}
    </div>
  );
}

/** The top-of-page switch for meal reminders at this mess. */
export function MealReminderSwitch({ mess }: { mess: MessDto }) {
  return (
    <ReminderSwitch
      label="Meal reminders"
      settings="reminders"
      isOn={(r) => r.mess.slug === mess.slug && (r.mess.meals.length > 0 || r.mess.favourites.length > 0)}
      enable={forMess(mess)}
      disable={(r) => ({ ...r, mess: { ...r.mess, slug: null } })}
    />
  );
}

/**
 * The bell in a meal's column of the week grid: once reminders are on for this mess, one tap
 * adds or removes that meal. Nothing is shown before reminders are on.
 */
export function MealBell({ mess, meal }: { mess: MessDto; meal: MealKey }) {
  const r = useReminders();
  if (r.state !== 'on' || r.local.mess.slug !== mess.slug) return null;
  const on = r.local.mess.meals.includes(meal);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${MEAL_NAMES[meal]} reminder`}
      title={on ? `Reminder on: ${r.local.mess.lead} min before` : 'Remind me before this meal'}
      onClick={() => r.update((x) => ({ ...x, mess: { ...x.mess, meals: toggle(x.mess.meals, meal) } }))}
      className={`grid place-items-center w-8 h-8 rounded-full transition-colors ${on ? 'bg-teal text-white' : 'text-ink2 hover:text-ink hover:bg-sunk'}`}
    >
      <Bell size={15} />
    </button>
  );
}
