import { DAY_KEYS, DAY_NAMES, MEAL_NAMES, type MealKey, formatSpan } from '@ss/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button } from '../../shared/ui/button';
import { Cross } from '../../shared/ui/icons';
import { field } from '../tools/core/ui';
import { MessPicker } from '../tools/mess/components/mess-picker';
import { type LocalReminders, savedTimetable } from './settings-store';
import { useReminders } from './use-reminders';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <fieldset className="m-0 p-0 border-0 flex flex-col gap-3 min-w-0">
    <legend className="p-0 mb-1 text-[16px] font-bold text-ink">{title}</legend>
    {children}
  </fieldset>
);

function Check({
  checked,
  onChange,
  children,
}: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-3 min-h-11 cursor-pointer text-[15px] text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-5 h-5 accent-[var(--teal)] shrink-0"
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`h-9 min-w-11 rounded-full px-3 text-[13px] font-semibold border-[1.5px] ${on ? 'bg-ink text-bg border-ink' : 'border-line text-ink2 hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * One sheet for everything: my mess and its meals, favourite dishes, tomorrow's classes and the
 * subjects to be reminded about, a test notification, and turning it all off. Also Toolbox ›
 * Reminders. Changes are saved with "Save"; nothing is sent until then.
 */
export function ReminderSettings({ onDone }: { onDone?: () => void }) {
  const r = useReminders();
  const [draft, setDraft] = useState<LocalReminders>(r.local);
  const [saved, setSaved] = useState<string | null>(null);
  const [favourite, setFavourite] = useState('');
  useEffect(() => setDraft(r.local), [r.local]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(r.local);

  const messes = useQuery({ queryKey: ['messes'], queryFn: api.messes, staleTime: 5 * 60_000, retry: false });
  const mess = useQuery({
    queryKey: ['mess', draft.mess.slug],
    queryFn: () => api.mess(draft.mess.slug!),
    enabled: !!draft.mess.slug,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const courses = savedTimetable();
  const set = (patch: (d: LocalReminders) => LocalReminders) => {
    setSaved(null);
    setDraft(patch);
  };
  const setMess = (p: Partial<LocalReminders['mess']>) => set((d) => ({ ...d, mess: { ...d.mess, ...p } }));
  const setClasses = (p: Partial<LocalReminders['classes']>) =>
    set((d) => ({ ...d, classes: { ...d.classes, ...p } }));
  const chosenIds = draft.classes.courseIds === 'all' ? courses.map((c) => c.id) : draft.classes.courseIds;

  const addFavourite = () => {
    const f = favourite.trim().slice(0, 40);
    if (f.length < 2 || draft.mess.favourites.some((x) => x.toLowerCase() === f.toLowerCase())) return;
    setMess({ favourites: [...draft.mess.favourites, f].slice(0, 15) });
    setFavourite('');
  };

  const off = r.state !== 'on';

  return (
    <div className="flex flex-col gap-6 max-h-[70vh] overflow-y-auto -mx-1 px-1 pb-1">
      {messes.data && (
        <Section title="My mess">
          <MessPicker
            messes={messes.data}
            value={draft.mess.slug}
            onChange={(slug) => setMess({ slug })}
            label="Picked once; change it any time"
          />
          {mess.data && (
            <>
              <div className="flex flex-col">
                {mess.data.meals.map((m) => (
                  <Check
                    key={m.key}
                    checked={draft.mess.meals.includes(m.key)}
                    onChange={() => setMess({ meals: toggle(draft.mess.meals, m.key as MealKey) })}
                  >
                    {MEAL_NAMES[m.key]}{' '}
                    <span className="text-ink2 text-[14px]">· {formatSpan(m.start, m.end)}</span>
                  </Check>
                ))}
              </div>
              <label className="flex flex-wrap items-center gap-2 text-[14px] text-ink2">
                Remind me
                <select
                  value={draft.mess.lead}
                  onChange={(e) => setMess({ lead: Number(e.target.value) })}
                  className={`${field} w-auto h-10`}
                >
                  {[15, 30, 45, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} min
                    </option>
                  ))}
                </select>
                before each meal
              </label>
              <div className="flex flex-col gap-2">
                <span className="text-[14px] text-ink2">
                  Favourite dishes: we'll tell you when they're on, even for a meal you didn't tick.
                </span>
                <div className="flex flex-wrap gap-2">
                  {draft.mess.favourites.map((f) => (
                    <span
                      key={f}
                      className="inline-flex items-center gap-1 h-9 rounded-full bg-mist pl-3 pr-1 text-[13px] font-semibold text-on-mist"
                    >
                      {f}
                      <button
                        type="button"
                        aria-label={`Remove ${f}`}
                        onClick={() => setMess({ favourites: draft.mess.favourites.filter((x) => x !== f) })}
                        className="grid place-items-center w-7 h-7 rounded-full hover:bg-surface/60"
                      >
                        <Cross size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <form
                  className="flex gap-2"
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
                    className={`${field} flex-1`}
                  />
                  <Button variant="outline" type="submit" disabled={favourite.trim().length < 2}>
                    Add
                  </Button>
                </form>
              </div>
            </>
          )}
        </Section>
      )}

      <Section title="Classes">
        <Check checked={draft.classes.nightly} onChange={(v) => setClasses({ nightly: v })}>
          Tomorrow's classes, the night before
        </Check>
        {draft.classes.nightly && (
          <label className="flex items-center gap-2 pl-8 text-[14px] text-ink2">
            at
            <input
              type="time"
              value={draft.classes.nightlyAt}
              onChange={(e) => e.target.value && setClasses({ nightlyAt: e.target.value })}
              className={`${field} w-auto h-10`}
            />
          </label>
        )}
        <Check checked={draft.classes.before} onChange={(v) => setClasses({ before: v })}>
          A nudge before each class
        </Check>
        {draft.classes.before && (
          <label className="flex items-center gap-2 pl-8 text-[14px] text-ink2">
            <select
              value={draft.classes.lead}
              onChange={(e) => setClasses({ lead: Number(e.target.value) })}
              className={`${field} w-auto h-10`}
            >
              {[5, 10, 15, 30].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </select>
            before it starts
          </label>
        )}
        {(draft.classes.nightly || draft.classes.before) && (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-[14px] text-ink2">On these days</span>
              <div className="flex flex-wrap gap-1.5">
                {DAY_KEYS.map((k, i) => (
                  <Chip
                    key={k}
                    on={draft.classes.days.includes(i)}
                    onClick={() => setClasses({ days: toggle(draft.classes.days, i) })}
                  >
                    <span aria-hidden="true">{DAY_NAMES[k].slice(0, 3)}</span>
                    <span className="sr-only">{DAY_NAMES[k]}</span>
                  </Chip>
                ))}
              </div>
            </div>
            {courses.length ? (
              <div className="flex flex-col">
                <span className="text-[14px] text-ink2">For these subjects</span>
                {courses.map((c) => (
                  <Check
                    key={c.id}
                    checked={chosenIds.includes(c.id)}
                    onChange={() => setClasses({ courseIds: toggle(chosenIds, c.id) })}
                  >
                    {c.name || c.code}
                    {c.code && c.name ? <span className="text-ink2 text-[14px]"> · {c.code}</span> : null}
                  </Check>
                ))}
              </div>
            ) : (
              <p className="m-0 text-[14px] text-ink2">
                Add your courses in the{' '}
                <Link to="/tools/timetable" className="font-semibold text-ink underline underline-offset-4">
                  Timetable maker
                </Link>{' '}
                first; class reminders follow it.
              </p>
            )}
          </>
        )}
      </Section>

      <div className="flex flex-wrap gap-2">
        {off ? (
          <Button
            variant="brand"
            disabled={!!r.busy || r.state !== 'ok'}
            onClick={async () => {
              if (await r.turnOn(() => draft)) setSaved('Reminders are on.');
            }}
          >
            {r.busy === 'on' ? 'Turning on…' : 'Turn on with these'}
          </Button>
        ) : (
          <>
            <Button
              variant="brand"
              disabled={!dirty || !!r.busy}
              onClick={async () => {
                if (await r.save(draft)) {
                  setSaved('Saved.');
                  onDone?.();
                }
              }}
            >
              {r.busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
            <Button
              variant="outline"
              disabled={!!r.busy}
              onClick={async () => {
                if (await r.test()) setSaved('Sent. It should appear in a few seconds.');
              }}
            >
              {r.busy === 'test' ? 'Sending…' : 'Send a test'}
            </Button>
          </>
        )}
      </div>
      {(saved || r.error) && (
        <p
          role="status"
          className={`m-0 text-[14px] ${r.error ? 'text-blush-text' : 'text-teal-text font-semibold'}`}
        >
          {r.error ?? saved}
        </p>
      )}

      {!off && (
        <button
          type="button"
          disabled={!!r.busy}
          onClick={async () => {
            if (await r.turnOff()) onDone?.();
          }}
          className="self-start text-[14px] font-semibold text-blush-text underline underline-offset-4"
        >
          {r.busy === 'off' ? 'Turning off…' : 'Turn off all reminders on this device'}
        </button>
      )}

      <OtherDevices />

      <p className="m-0 text-[13px] leading-relaxed text-ink2">
        We save a notification address for this device and only what you pick here (your mess, meals, and the
        names, rooms and times of the subjects you tick), not your timetable. If you're signed in, it's linked
        to your account so you can switch a device off from another one.
      </p>
    </div>
  );
}

/** Signed in: every device getting reminders, each with "Remove". */
function OtherDevices() {
  const { me } = useSession();
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ['push-devices'], queryFn: api.pushDevices, enabled: !!me });
  if (!me || !devices.data?.length) return null;
  return (
    <Section title="Devices getting reminders">
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {devices.data.map((d) => (
          <li key={d.id} className="flex items-center gap-3 rounded-xl bg-sunk px-3 py-2">
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="text-[14px] font-semibold text-ink truncate">{d.label}</span>
              <span className="text-[13px] text-ink2 truncate">{d.summary}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await api.pushRemoveDevice(d.id).catch(() => {});
                void qc.invalidateQueries({ queryKey: ['push-devices'] });
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
