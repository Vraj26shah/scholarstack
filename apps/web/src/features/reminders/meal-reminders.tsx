import {
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
    mess: { ...r.mess, slug: mess.slug, meals: mealsFor(mess, r.mess.meals) },
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
    set({ favourites: [...m.favourites, f].slice(0, 15) });
    setFavourite('');
  };

  return (
    <ReminderCard
      id="reminders"
      title="Meal reminders"
      ask={`What's on at ${mess.name}, ${m.lead} min before each meal you pick. On this device, even when the site is closed.`}
      sample={sampleFor(mess, m.lead)}
      preset={forMess(mess)}
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
          <Group
            label="Favourite dishes"
            hint="When one is on the menu we'll tell you, even at a meal you didn't pick. They get a ⭐ in the menu too."
          >
            {m.favourites.map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1 h-10 rounded-full bg-mist pl-3.5 pr-1 text-[14px] font-semibold text-on-mist"
              >
                ⭐ {f}
                <button
                  type="button"
                  aria-label={`Remove ${f}`}
                  onClick={() => set({ favourites: m.favourites.filter((x) => x !== f) })}
                  className="grid place-items-center w-8 h-8 rounded-full hover:bg-surface/60"
                >
                  <Cross size={12} />
                </button>
              </span>
            ))}
            <form
              className="flex gap-2 w-full max-w-[420px]"
              onSubmit={(e) => {
                e.preventDefault();
                addFavourite();
              }}
            >
              <input
                value={favourite}
                onChange={(e) => setFavourite(e.target.value)}
                placeholder="e.g. paneer, biryani, jalebi"
                aria-label="Add a favourite dish"
                maxLength={40}
                className={`${field} flex-1 h-10`}
              />
              <Button variant="outline" size="sm" type="submit" disabled={favourite.trim().length < 2}>
                Add
              </Button>
            </form>
          </Group>
          {m.meals.length === 0 && m.favourites.length === 0 && (
            <p className="m-0 text-[14px] text-marigold-text">
              Pick a meal or add a favourite, or nothing will be sent.
            </p>
          )}
        </>
      )}
    </ReminderCard>
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
