import {
  DAY_NAMES,
  MEAL_KEYS,
  MEAL_NAMES,
  type MealKey,
  type MessDto,
  type MessInput,
  type MessKind,
  type MessMeal,
  type MessWeek,
  campusClock,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { MenuCardEditor } from '../restaurant/menu-card-editor';
import { WeekChartEditor } from '../restaurant/week-chart-editor';
import { PersonTest } from './push-test';
import { Field, Panel, StatusPill, U, input, plural } from './ui';

// ── Helpers ──────────────────────────────────────────────────────────────────

const emptyWeek = (label = ''): MessWeek => ({
  label,
  days: { mon: {}, tue: {}, wed: {}, thu: {}, fri: {}, sat: {}, sun: {} },
});

const DEFAULT_MEALS: Record<MessKind, MessMeal[]> = {
  hostel: [
    { key: 'breakfast', start: '07:30', end: '09:30', extras: '' },
    { key: 'lunch', start: '12:15', end: '14:30', extras: '' },
    { key: 'snacks', start: '16:30', end: '17:30', extras: '' },
    { key: 'dinner', start: '19:30', end: '21:30', extras: '' },
  ],
  restaurant: [
    { key: 'lunch', start: '12:00', end: '15:00', extras: '' },
    { key: 'dinner', start: '19:00', end: '22:00', extras: '' },
  ],
};

const newMess = (): MessInput => ({
  slug: '',
  name: '',
  kind: 'hostel',
  place: '',
  source: 'notice',
  note: '',
  prices: '',
  phone: '',
  orderNote: '',
  order: [],
  ownerEmails: [],
  ordersOpen: false,
  dailyOrderCap: 0,
  meals: DEFAULT_MEALS.hostel,
  weeks: [emptyWeek('Week 1')],
  cycleStart: campusClock(new Date()).date,
  published: false,
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

const toInput = ({ updatedAt: _u, sort: _s, ...m }: MessDto): MessInput => m;

// ── Menus ────────────────────────────────────────────────────────────────────

/** Admin › Campus › Mess menus: every mess and restaurant, its times and its week. */
export function MessMenusPanel() {
  const q = useQuery({ queryKey: ['admin-messes'], queryFn: api.adminMesses });
  const [editing, setEditing] = useState<{ form: MessInput; isNew: boolean } | null>(null);
  const features = useQuery({ queryKey: ['admin-features'], queryFn: api.adminFeatures });
  const status = (key: string) => features.data?.find((f) => f.key === key)?.status;

  if (editing)
    return (
      <MessEditor
        key={editing.form.slug || 'new'}
        initial={editing.form}
        isNew={editing.isNew}
        onClose={() => setEditing(null)}
      />
    );

  return (
    <Panel
      title="Mess menus"
      aside={
        <Button variant="brand" onClick={() => setEditing({ form: newMess(), isNew: true })}>
          Add a mess or restaurant
        </Button>
      }
    >
      <LaunchNote live={status('mess-menu') === 'live'} what="The mess menu" />
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState title="Couldn't load the menus" message={friendly(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <p className="m-0 text-ink2">No messes yet. Add the first one.</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line">
          {q.data.map((m) => (
            <li key={m.slug} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex-1 min-w-[200px] flex flex-col">
                <span className="font-semibold text-ink">{m.name}</span>
                <span className="text-[13px] text-ink2">
                  {m.kind === 'hostel' ? 'Hostel mess' : 'Restaurant for day scholars'} ·{' '}
                  {m.source === 'owner' ? "owner's menu" : 'from the notice board'} ·{' '}
                  {plural(m.weeks.length, 'week')} · updated{' '}
                  {new Date(m.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
              </span>
              <StatusPill status={m.published ? 'live' : 'draft'} />
              <Link
                to={`/tools/mess-menu?mess=${m.slug}`}
                className="text-[14px] font-semibold text-ink2 hover:text-ink"
              >
                View
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing({ form: toInput(m), isNew: false })}
              >
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function LaunchNote({ live, what, detail }: { live: boolean; what: string; detail?: string }) {
  return (
    <p
      className={`m-0 rounded-xl px-4 py-3 text-[14px] ${live ? 'bg-mist/50 text-ink' : 'bg-marigold-soft text-marigold-text'}`}
    >
      {live ? (
        <>
          <strong>{what} is live.</strong> Students see published menus.
        </>
      ) : (
        <>
          <strong>Students can't see {what.toLowerCase()} yet</strong>: it shows "Coming soon". You can use it
          on the live site to test. Press <strong>Launch</strong> in Emails › Emails & tools when it's ready.
        </>
      )}
      {detail && <span className="block mt-1">{detail}</span>}
    </p>
  );
}

function MessEditor({
  initial,
  isNew,
  onClose,
}: { initial: MessInput; isNew: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<MessInput>(initial);
  const [done, setDone] = useState<string | null>(null);
  const [ownerDraft, setOwnerDraft] = useState('');
  const [cardTouched, setCardTouched] = useState(false);
  // Open with the restaurant's current menu card (its owner may have just changed it).
  useEffect(() => {
    if (isNew || initial.kind !== 'restaurant') return;
    let live = true;
    void api.ownerMess(initial.slug).then(
      (m) => live && setForm((f) => ({ ...f, order: m.order })),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [isNew, initial.kind, initial.slug]);
  const ownerOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerDraft.trim());
  const addOwner = () => {
    const email = ownerDraft.trim().toLowerCase();
    if (!ownerOk || form.ownerEmails.includes(email) || form.ownerEmails.length >= 5) return;
    set({ ownerEmails: [...form.ownerEmails, email] });
    setOwnerDraft('');
  };
  const set = (patch: Partial<MessInput>) => {
    setDone(null);
    setForm((f) => ({ ...f, ...patch }));
  };

  const served = (k: MealKey) => form.meals.find((m) => m.key === k);
  const setMeal = (k: MealKey, patch: Partial<MessMeal> | null) => {
    const others = form.meals.filter((m) => m.key !== k);
    const current = served(k) ?? { key: k, start: '12:00', end: '14:00', extras: '' };
    const meals = patch === null ? others : [...others, { ...current, ...patch }];
    set({ meals: meals.sort((a, b) => MEAL_KEYS.indexOf(a.key) - MEAL_KEYS.indexOf(b.key)) });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return api.adminCreateMess(form);
      // The owner may have changed their menu card meanwhile: unless it was edited here, save the
      // card exactly as it is on the server now, never this screen's older copy.
      const order =
        initial.kind === 'restaurant' && !cardTouched
          ? await api.ownerMess(initial.slug).then(
              (m) => m.order,
              () => form.order,
            )
          : form.order;
      return api.adminSaveMess(initial.slug, { ...form, order });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-messes'] });
      void qc.invalidateQueries({ queryKey: ['messes'] });
      void qc.invalidateQueries({ queryKey: ['mess'] });
      setCardTouched(false);
      setDone('Saved. Students see it now.');
    },
  });
  const remove = useMutation({
    mutationFn: () => api.adminDeleteMess(initial.slug),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-messes'] });
      void qc.invalidateQueries({ queryKey: ['messes'] });
      onClose();
    },
  });

  return (
    <Panel
      title={isNew ? 'New mess or restaurant' : form.name}
      aside={
        <Button variant="ghost" onClick={onClose}>
          Back to all menus
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 max-w-[900px]">
        <Field label="Name students see">
          <input
            className={input}
            value={form.name}
            maxLength={80}
            onChange={(e) =>
              set({ name: e.target.value, ...(isNew ? { slug: slugify(e.target.value) } : {}) })
            }
            placeholder="Safal hostel mess"
          />
        </Field>
        <Field label={isNew ? 'Short name in links' : 'Short name in links (fixed)'}>
          <input
            className={input}
            value={form.slug}
            disabled={!isNew}
            onChange={(e) => set({ slug: slugify(e.target.value) })}
          />
        </Field>
        <Field label="Who it's for">
          <select
            className={input}
            value={form.kind}
            onChange={(e) => {
              const kind = e.target.value as MessKind;
              set({
                kind,
                meals: DEFAULT_MEALS[kind],
                source: kind === 'restaurant' ? 'owner' : form.source,
              });
            }}
          >
            <option value="hostel">Hostellers: hostel mess (4 meals)</option>
            <option value="restaurant">Day scholars: restaurant (lunch & dinner)</option>
          </select>
        </Field>
        <Field label="Where the menu came from">
          <select
            className={input}
            value={form.source}
            onChange={(e) => set({ source: e.target.value as MessInput['source'] })}
          >
            <option value="notice">Typed from the notice board</option>
            <option value="owner">As given by the owner</option>
          </select>
        </Field>
        <Field label="Place">
          <input
            className={input}
            value={form.place}
            maxLength={120}
            onChange={(e) => set({ place: e.target.value })}
          />
        </Field>
        <Field label="Week 1 starts on (a rotating menu counts from here)">
          <input
            className={input}
            type="date"
            value={form.cycleStart}
            onChange={(e) => e.target.value && set({ cycleStart: e.target.value })}
          />
        </Field>
        {form.source === 'owner' && (
          <Field label="Prices, exactly as the owner gave them (separate with ·)" className="sm:col-span-2">
            <input
              className={input}
              value={form.prices}
              maxLength={200}
              onChange={(e) => set({ prices: e.target.value })}
              placeholder="Mess thali ₹80 · Tiffin ₹3,600 a month"
            />
          </Field>
        )}
        {form.kind === 'restaurant' && (
          <>
            <Field label="Owner's mobile (orders, WhatsApp, and the Call button in chats)">
              <input
                className={input}
                value={form.phone}
                inputMode="tel"
                maxLength={20}
                onChange={(e) => set({ phone: e.target.value })}
                placeholder="+91 85179 03810"
              />
            </Field>
            <label className="flex items-center gap-2 self-end h-11 text-[15px] font-semibold">
              <input
                type="checkbox"
                className="w-5 h-5 accent-[var(--teal)]"
                checked={form.ordersOpen}
                onChange={(e) => set({ ordersOpen: e.target.checked })}
              />
              Taking orders on the site (the owner can switch this too)
            </label>
            <Field label="Delivery and parcels">
              <input
                className={input}
                value={form.orderNote}
                maxLength={160}
                onChange={(e) => set({ orderNote: e.target.value })}
                placeholder="Free home delivery · Parcel available"
              />
            </Field>

            <section
              aria-label="Restaurant owners"
              className="sm:col-span-2 rounded-2xl bg-sunk p-4 sm:p-5 flex flex-col gap-3"
            >
              <div className="flex flex-col gap-1">
                <h3 className="m-0 text-[18px] font-bold text-ink">Restaurant owners</h3>
                <p className="m-0 text-[14px] leading-relaxed text-ink2 max-w-[720px]">
                  Add the email the owner will sign in with (Gmail or any address). They sign in at{' '}
                  <strong className="text-ink">{window.location.host}/sign-in</strong> and land on{' '}
                  <strong className="text-ink">My restaurant</strong>: their orders, menu card with photos,
                  weekly menu and timings, <U>for this restaurant only</U>. They never see the admin pages,
                  other restaurants or any student's details except the orders sent to them.
                </p>
              </div>
              {form.ownerEmails.length > 0 ? (
                <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
                  {form.ownerEmails.map((email) => (
                    <li
                      key={email}
                      className="inline-flex items-center gap-2 h-9 rounded-full bg-surface pl-3.5 pr-1.5 text-[14px] font-semibold text-ink [box-shadow:inset_0_0_0_1px_var(--line)]"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => set({ ownerEmails: form.ownerEmails.filter((e) => e !== email) })}
                        aria-label={`Remove ${email}`}
                        className="grid place-items-center w-7 h-7 rounded-full text-ink2 hover:bg-sunk hover:text-blush-text"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-[14px] font-semibold text-marigold-text">
                  No owner yet: nobody can take orders or edit this menu but admins.
                </p>
              )}
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addOwner();
                }}
              >
                <input
                  className={`${input} flex-1 min-w-[220px] max-w-[360px]`}
                  value={ownerDraft}
                  inputMode="email"
                  autoComplete="off"
                  onChange={(e) => setOwnerDraft(e.target.value)}
                  placeholder="owner@gmail.com"
                  aria-label="Owner's email"
                />
                <Button type="submit" variant="outline" disabled={!ownerOk || form.ownerEmails.length >= 5}>
                  Add owner
                </Button>
              </form>
              <p className="m-0 text-[13px] text-ink2">
                Press <strong>Save</strong> below after adding or removing an owner. Removing one stops their
                access within a minute.
              </p>
            </section>

            <Field label="Most orders a day (0 = no limit)">
              <input
                className={`${input} tabular-nums`}
                type="number"
                min={0}
                max={2000}
                value={form.dailyOrderCap ?? 0}
                onChange={(e) =>
                  set({ dailyOrderCap: Math.max(0, Math.min(2000, Math.floor(Number(e.target.value) || 0))) })
                }
              />
            </Field>
          </>
        )}
        <Field label="Note above the menu" className="sm:col-span-2">
          <textarea
            className={`${input} h-auto py-2`}
            rows={2}
            maxLength={400}
            value={form.note}
            onChange={(e) => set({ note: e.target.value })}
          />
        </Field>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-[18px] font-bold">Meals and times</h3>
        <p className="m-0 text-[14px] text-ink2">
          Reminders go out before the start time. "Also served" shows under every one of that meal.
        </p>
        <div className="flex flex-col gap-2 max-w-[900px]">
          {MEAL_KEYS.map((k) => {
            const m = served(k);
            return (
              <div key={k} className="grid gap-2 items-center sm:grid-cols-[150px_110px_110px_1fr]">
                <label className="flex items-center gap-2 font-semibold text-[15px]">
                  <input
                    type="checkbox"
                    className="w-5 h-5 accent-[var(--teal)]"
                    checked={!!m}
                    onChange={(e) => setMeal(k, e.target.checked ? {} : null)}
                  />
                  {MEAL_NAMES[k]}
                </label>
                {m && (
                  <>
                    <input
                      aria-label={`${MEAL_NAMES[k]} starts`}
                      type="time"
                      className={input}
                      value={m.start}
                      onChange={(e) => e.target.value && setMeal(k, { start: e.target.value })}
                    />
                    <input
                      aria-label={`${MEAL_NAMES[k]} ends`}
                      type="time"
                      className={input}
                      value={m.end}
                      onChange={(e) => e.target.value && setMeal(k, { end: e.target.value })}
                    />
                    <input
                      aria-label={`Also served at ${MEAL_NAMES[k]}`}
                      className={input}
                      placeholder="Also served: roti, rice, pickle"
                      maxLength={200}
                      value={m.extras}
                      onChange={(e) => setMeal(k, { extras: e.target.value })}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {form.kind === 'restaurant' && !isNew && (
        <section className="flex flex-col gap-3" aria-label="Menu card">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="m-0 text-[18px] font-bold">Menu card: what students can order</h3>
            <Link
              to={`/orders?mess=${initial.slug}`}
              className="text-[14px] font-semibold text-ink2 underline underline-offset-2 hover:text-ink"
            >
              Open the restaurant's dashboard (orders)
            </Link>
          </div>
          <p className="m-0 text-[14px] text-ink2 max-w-[760px]">
            Categories (Snacks, Sandwiches, Main course…), dishes, prices, photos and sold-out, the same
            editor the owner uses. {cardTouched ? 'Your changes are saved with Save below.' : ''}
          </p>
          <MenuCardEditor
            slug={initial.slug}
            order={form.order}
            onChange={(order) => {
              setCardTouched(true);
              set({ order });
            }}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="m-0 text-[18px] font-bold">The week's menu</h3>
        <WeekChartEditor meals={form.meals} weeks={form.weeks} cycleStart={form.cycleStart} onChange={set} />
      </section>

      <label className="flex items-start gap-3 max-w-[700px] text-[15px]">
        <input
          type="checkbox"
          className="mt-1 w-5 h-5 accent-[var(--teal)]"
          checked={form.published}
          onChange={(e) => set({ published: e.target.checked })}
        />
        <span>
          <strong>Published</strong>
          <span className="block text-[14px] text-ink2">
            Students see this menu once the mess menu tool is launched. Unpublished menus are for admins only.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="brand"
          disabled={save.isPending || form.name.trim().length < 2 || form.slug.length < 3}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : isNew ? 'Add it' : 'Save'}
        </Button>
        {!isNew && (
          <Link
            to={`/tools/mess-menu?mess=${initial.slug}`}
            className="text-[14px] font-semibold text-ink2 hover:text-ink"
          >
            View it as students do
          </Link>
        )}
        <span className="flex-1" />
        {!isNew && (
          <Button
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete ${initial.name}? Its menu and the reports about it go too.`))
                remove.mutate();
            }}
          >
            Delete
          </Button>
        )}
      </div>
      {(done || save.error || remove.error) && (
        <p
          role="status"
          className={`m-0 text-[14px] ${done ? 'text-teal-text font-semibold' : 'text-blush-text'}`}
        >
          {done ?? friendly(save.error ?? remove.error)}
        </p>
      )}
    </Panel>
  );
}

// ── Reports ──────────────────────────────────────────────────────────────────

/** Admin › Campus › Menu reports: "Something changed? Tell us" from students. */
export function MessReportsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-mess-reports'], queryFn: api.adminMessReports });
  const [show, setShow] = useState<'new' | 'all'>('new');
  const mark = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api.adminSetMessReport(id, done ? 'done' : 'new'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-mess-reports'] }),
  });
  const rows = (q.data ?? []).filter((r) => show === 'all' || r.status === 'new');
  return (
    <Panel
      title="Menu reports"
      aside={
        <div className="flex gap-1">
          {(['new', 'all'] as const).map((k) => (
            <Button key={k} size="sm" variant={show === k ? 'ink' : 'ghost'} onClick={() => setShow(k)}>
              {k === 'new' ? `New (${(q.data ?? []).filter((r) => r.status === 'new').length})` : 'All'}
            </Button>
          ))}
        </div>
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState
          title="Couldn't load the reports"
          message={friendly(q.error)}
          onRetry={() => q.refetch()}
        />
      ) : !rows.length ? (
        <p className="m-0 text-ink2">
          {show === 'new' ? 'Nothing new. Menus match what students see.' : 'No reports yet.'}
        </p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="py-4 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink2">
                <strong className="text-ink text-[15px]">{r.messName}</strong>
                {r.day && <span>{DAY_NAMES[r.day]}</span>}
                {r.meal && <span>{MEAL_NAMES[r.meal]}</span>}
                <span>
                  {new Date(r.createdAt).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                <StatusPill status={r.status === 'new' ? 'new' : 'archived'} />
              </div>
              <p className="m-0 text-[15px] text-ink whitespace-pre-wrap">{r.message}</p>
              {r.contact && <p className="m-0 text-[13px] text-ink2">Reply to: {r.contact}</p>}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mark.isPending}
                  onClick={() => mark.mutate({ id: r.id, done: r.status === 'new' })}
                >
                  {r.status === 'new' ? 'Mark fixed' : 'Mark as new'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Reminders ────────────────────────────────────────────────────────────────

/** Admin › Campus › Reminders: who gets them, and "send what's due now" for testing. */
export function RemindersAdminPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-push'], queryFn: api.adminPushStats });
  const features = useQuery({ queryKey: ['admin-features'], queryFn: api.adminFeatures });
  const run = useMutation({
    mutationFn: api.adminPushRun,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-push'] }),
  });
  const s = q.data;
  return (
    <Panel
      title="Reminders"
      aside={
        <Link to="/tools/mess-menu#reminders" className="text-[14px] font-semibold text-ink2 hover:text-ink">
          Turn them on for this device
        </Link>
      }
    >
      <LaunchNote
        live={features.data?.find((f) => f.key === 'mess-menu')?.status === 'live'}
        what="Reminders"
        detail="Meal reminders are in the Mess menu, class reminders in the Timetable maker. They launch with the Mess menu."
      />
      {q.isLoading ? (
        <Skeleton className="h-32" />
      ) : q.isError || !s ? (
        <ErrorState title="Couldn't load reminders" message={friendly(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <>
          {!s.configured && (
            <p className="m-0 rounded-xl bg-blush px-4 py-3 text-[14px] text-blush-text">
              <strong>Not set up:</strong> the server has no push keys. Run <code>pnpm ops push:keys</code>,
              add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to the Worker secrets (and GitHub
              secrets for deploys), then deploy.
            </p>
          )}
          <dl className="m-0 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-[760px]">
            {[
              ['Devices', s.devices],
              ['Meal reminders', s.withMeals],
              ['Class reminders', s.withClasses],
              ['Sent today', s.sentToday],
            ].map(([label, n]) => (
              <div key={label} className="rounded-2xl bg-sunk p-4 flex flex-col gap-1">
                <dt className="text-[13px] text-ink2">{label}</dt>
                <dd className="m-0 font-display font-extrabold text-[30px] leading-none tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>
          {s.byMess.length > 0 && (
            <p className="m-0 text-[14px] text-ink2">
              {s.byMess.map((m) => `${m.name}: ${plural(m.devices, 'device')}`).join(' · ')}
            </p>
          )}
          <div className="flex flex-col gap-2 max-w-[700px]">
            <p className="m-0 text-[14px] text-ink2">
              Every five minutes the server sends what's due: meals from their lead time until they start,
              classes the same way, and tomorrow's list at each device's chosen time. Use this to send what's
              due right now.
            </p>
            <Button
              variant="outline"
              className="self-start"
              disabled={run.isPending || !s.configured}
              onClick={() => run.mutate()}
            >
              {run.isPending ? 'Sending…' : "Send what's due now"}
            </Button>
            {run.data && (
              <p role="status" className="m-0 text-[14px] text-ink">
                Checked {plural(run.data.checked, 'device')}: sent {run.data.sent}
                {run.data.deferred ? `, ${run.data.deferred} left for the next run` : ''}
                {run.data.gone ? `, ${run.data.gone} switched off by their browser (removed)` : ''}
                {run.data.failed ? `, ${run.data.failed} failed (retried next run)` : ''}.
              </p>
            )}
            {run.error && <p className="m-0 text-[14px] text-blush-text">{friendly(run.error)}</p>}
          </div>
          {s.configured && <PersonTest />}
        </>
      )}
    </Panel>
  );
}
