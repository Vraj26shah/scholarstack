import { DAY_KEYS, DAY_NAMES, type DayKey, MEAL_NAMES, type MealKey, type MessDto } from '@ss/contracts';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { Button } from '../../../../shared/ui/button';
import { Labelled, field } from '../../core/ui';

/**
 * "Something changed? Tell us": a dish swapped, a new price, a meal at another time. It goes to
 * the admin (Admin › Campus), who fixes the menu for everyone. A contact is optional.
 */
export function ReportForm({ mess, day }: { mess: MessDto; day: DayKey }) {
  const [form, setForm] = useState<{
    day: DayKey | '';
    meal: MealKey | '';
    message: string;
    contact: string;
  }>({
    day,
    meal: '',
    message: '',
    contact: '',
  });
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  // Follows the day being looked at, until the student picks one here.
  const [dayTouched, setDayTouched] = useState(false);
  useEffect(() => {
    if (!dayTouched) setForm((f) => ({ ...f, day }));
  }, [day, dayTouched]);
  const [error, setError] = useState<string | null>(null);

  if (state === 'sent')
    return (
      <div role="status" className="flex flex-col items-start gap-2">
        <p className="m-0 text-[16px] font-semibold text-teal-text">Thanks, we've got it.</p>
        <p className="m-0 text-[15px] text-ink2">We'll check it and update the menu for everyone.</p>
        <Button
          variant="ghost"
          onClick={() => {
            setForm((f) => ({ ...f, message: '' }));
            setState('idle');
          }}
        >
          Tell us something else
        </Button>
      </div>
    );

  return (
    <form
      className="flex flex-col gap-4 max-w-[640px]"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setState('sending');
        try {
          await api.reportMess({
            slug: mess.slug,
            day: form.day || undefined,
            meal: form.meal || undefined,
            message: form.message.trim(),
            contact: form.contact.trim(),
          });
          setState('sent');
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Couldn't send it. Try again in a minute.");
          setState('idle');
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Day">
          <select
            value={form.day}
            onChange={(e) => {
              setDayTouched(true);
              setForm({ ...form, day: e.target.value as DayKey | '' });
            }}
            className={field}
          >
            <option value="">Not about one day</option>
            {DAY_KEYS.map((k) => (
              <option key={k} value={k}>
                {DAY_NAMES[k]}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Meal">
          <select
            value={form.meal}
            onChange={(e) => setForm({ ...form, meal: e.target.value as MealKey | '' })}
            className={field}
          >
            <option value="">Not about one meal</option>
            {mess.meals.map((m) => (
              <option key={m.key} value={m.key}>
                {MEAL_NAMES[m.key]}
              </option>
            ))}
          </select>
        </Labelled>
      </div>
      <Labelled label="What's different?">
        <textarea
          required
          minLength={5}
          maxLength={600}
          rows={3}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          placeholder={
            mess.source === 'owner'
              ? 'e.g. The thali is ₹90 now, and Friday dinner has papad, not picadi.'
              : 'e.g. Tuesday lunch had chole, not rajma. High tea is at 5 pm.'
          }
          className={`${field} h-auto py-2.5 leading-relaxed`}
        />
      </Labelled>
      <Labelled label="Your email or phone (optional, only if you'd like a reply)">
        <input
          maxLength={120}
          value={form.contact}
          onChange={(e) => setForm({ ...form, contact: e.target.value })}
          autoComplete="email"
          className={field}
        />
      </Labelled>
      {error && (
        <p role="alert" className="m-0 text-[14px] text-blush-text">
          {error}
        </p>
      )}
      <Button
        type="submit"
        variant="brand"
        className="self-start"
        disabled={state === 'sending' || form.message.trim().length < 5}
      >
        {state === 'sending' ? 'Sending…' : 'Send'}
      </Button>
    </form>
  );
}
