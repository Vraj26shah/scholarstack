import { MEAL_KEYS, MEAL_NAMES, type MealKey, type MessMeal, type OwnerMessInput } from '@ss/contracts';
import type { ReactNode } from 'react';
import { Phone } from '../../shared/ui/icons';

const box =
  'h-12 w-full rounded-xl bg-surface border-[1.5px] border-line px-3.5 text-[16px] text-ink outline-none focus:border-teal';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children.
    <label className="flex flex-col gap-1.5">
      <span className="text-[15px] font-bold text-ink">{label}</span>
      {children}
      {hint && <span className="text-[13px] leading-snug text-ink2">{hint}</span>}
    </label>
  );
}

/** Restaurants serve lunch and dinner by default; the owner can add breakfast or evening snacks. */
const DEFAULT_TIMES: Record<MealKey, [string, string]> = {
  breakfast: ['08:00', '10:00'],
  lunch: ['12:00', '15:00'],
  snacks: ['17:00', '18:30'],
  dinner: ['19:00', '22:00'],
};

/** Name, contact, delivery, prices and opening times: everything students read about the place. */
export function DetailsEditor({
  form,
  onChange,
}: { form: OwnerMessInput; onChange: (patch: Partial<OwnerMessInput>) => void }) {
  const served = (k: MealKey) => form.meals.find((m) => m.key === k);
  const setMeal = (k: MealKey, patch: Partial<MessMeal> | null) => {
    const others = form.meals.filter((m) => m.key !== k);
    const [start, end] = DEFAULT_TIMES[k];
    const current = served(k) ?? { key: k, start, end, extras: '' };
    const meals = patch === null ? others : [...others, { ...current, ...patch }];
    if (!meals.length) return;
    onChange({ meals: meals.sort((a, b) => MEAL_KEYS.indexOf(a.key) - MEAL_KEYS.indexOf(b.key)) });
  };
  const digits = form.phone.replace(/\D/g, '');

  return (
    <div className="grid gap-x-10 gap-y-7 lg:grid-cols-2 max-w-[980px]">
      <Row label="Restaurant name" hint="As students will see it at the top of your page.">
        <input
          className={box}
          value={form.name}
          maxLength={80}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </Row>
      <Row label="Where you are" hint="A landmark students know, e.g. VIT Chauraha, Kothri.">
        <input
          className={box}
          value={form.place}
          maxLength={120}
          onChange={(e) => onChange({ place: e.target.value })}
        />
      </Row>
      <Row
        label="Phone number for orders"
        hint="Students tap Call on your page and in the order chat. Orders themselves arrive on your Orders screen."
      >
        <span className="flex gap-2">
          <input
            className={box}
            value={form.phone}
            inputMode="tel"
            maxLength={20}
            onChange={(e) => onChange({ phone: e.target.value })}
            placeholder="+91 98765 43210"
          />
          {digits.length >= 10 && (
            <a
              href={`tel:${digits.length === 10 ? `+91${digits}` : `+${digits}`}`}
              className="shrink-0 inline-flex items-center gap-1.5 h-12 rounded-xl border-[1.5px] border-line px-3 text-[14px] font-semibold text-ink no-underline hover:border-ink2"
            >
              <Phone size={17} /> Test
            </a>
          )}
        </span>
      </Row>
      <Row label="Delivery and parcels" hint="One line, e.g. Free delivery to hostels · Parcel available.">
        <input
          className={box}
          value={form.orderNote}
          maxLength={160}
          onChange={(e) => onChange({ orderNote: e.target.value })}
        />
      </Row>
      <Row
        label="Most orders a day"
        hint="Stop taking orders on the site after this many today. 0 means no limit. Resets at midnight."
      >
        <input
          className={`${box} max-w-[160px] tabular-nums`}
          type="number"
          inputMode="numeric"
          min={0}
          max={2000}
          value={form.dailyOrderCap ?? 0}
          onChange={(e) =>
            onChange({ dailyOrderCap: Math.max(0, Math.min(2000, Math.floor(Number(e.target.value) || 0))) })
          }
        />
      </Row>
      <Row
        label="Prices at the top of your page"
        hint="Your best-known prices, separated with ·, e.g. Mess thali ₹80 · Tiffin ₹3,600 a month."
      >
        <input
          className={box}
          value={form.prices}
          maxLength={200}
          onChange={(e) => onChange({ prices: e.target.value })}
        />
      </Row>
      <Row label="A note to students (optional)" hint="Shown above your menu, e.g. Closed on Tuesdays.">
        <input
          className={box}
          value={form.note}
          maxLength={400}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </Row>

      <fieldset className="lg:col-span-2 m-0 p-0 border-0 flex flex-col gap-3">
        <legend className="mb-3 text-[15px] font-bold text-ink">When you serve</legend>
        <ul className="m-0 p-0 list-none grid gap-3 sm:grid-cols-2">
          {MEAL_KEYS.map((k) => {
            const m = served(k);
            return (
              <li
                key={k}
                className={`flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 [box-shadow:inset_0_0_0_1.5px_var(--line)] ${m ? 'bg-surface' : ''}`}
              >
                <label className="flex items-center gap-2.5 min-w-[130px] cursor-pointer text-[15px] font-semibold text-ink">
                  <input
                    type="checkbox"
                    checked={!!m}
                    disabled={!!m && form.meals.length === 1}
                    onChange={(e) => setMeal(k, e.target.checked ? {} : null)}
                    className="w-5 h-5 accent-[var(--teal)]"
                  />
                  {MEAL_NAMES[k]}
                </label>
                {m && (
                  <span className="flex items-center gap-2 text-[14px] text-ink2">
                    <input
                      type="time"
                      value={m.start}
                      onChange={(e) => e.target.value && setMeal(k, { start: e.target.value })}
                      aria-label={`${MEAL_NAMES[k]} starts`}
                      className="h-10 rounded-lg border-[1.5px] border-line bg-bg px-2 text-[15px] text-ink"
                    />
                    to
                    <input
                      type="time"
                      value={m.end}
                      onChange={(e) => e.target.value && setMeal(k, { end: e.target.value })}
                      aria-label={`${MEAL_NAMES[k]} ends`}
                      className="h-10 rounded-lg border-[1.5px] border-line bg-bg px-2 text-[15px] text-ink"
                    />
                  </span>
                )}
                {m && m.start >= m.end && (
                  <span role="alert" className="w-full text-[13px] text-blush-text">
                    It has to end after it starts.
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
    </div>
  );
}
