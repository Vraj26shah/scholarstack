import {
  MEAL_NAMES,
  MESS_ORDER_STATUS_TEXT,
  type MessDto,
  type MessOrderDto,
  OPEN_MESS_ORDER,
  dishesOn,
  formatClock,
  formatMobile,
  normaliseMobile,
  toMinutes,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { track } from '../../../../lib/analytics';
import { ApiError, api } from '../../../../lib/api';
import { useSession } from '../../../../lib/session';
import { Button, buttonClass } from '../../../../shared/ui/button';
import { ChatBubble, Minus, Phone, Plus } from '../../../../shared/ui/icons';
import { useToolState } from '../../core/storage';
import { field } from '../../core/ui';
import { mealState } from './mess-grid';

interface Item {
  key: string;
  /** The name on the restaurant's list (what the server prices). */
  name: string;
  /** What the student sees, e.g. "Tonight's dinner thali". */
  label: string;
  note: string;
  price: number;
  detail: string;
}

interface Details {
  name: string;
  mode: 'delivery' | 'pickup';
  address: string;
  phone: string;
  note: string;
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
};
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
};

/** Which thali to offer: the meal on now, else the next one today, else tomorrow's first. */
function thaliFor(mess: MessDto, today: string, tomorrow: string, nowMinutes: number) {
  const meal = mess.meals.find((m) => mealState(m, nowMinutes) !== 'over');
  if (meal) return { meal, date: today, when: meal.key === 'dinner' ? 'Tonight' : 'Today' };
  const first = mess.meals[0];
  return first ? { meal: first, date: tomorrow, when: 'Tomorrow' } : null;
}

function Stepper({ label, qty, onChange }: { label: string; qty: number; onChange: (q: number) => void }) {
  if (!qty)
    return (
      <button
        type="button"
        onClick={() => onChange(1)}
        aria-label={`Add ${label}`}
        className="grid place-items-center w-9 h-9 shrink-0 rounded-full border-[1.5px] border-ink/70 text-ink hover:bg-ink hover:text-bg transition-colors"
      >
        <Plus size={16} />
      </button>
    );
  return (
    <span className="inline-flex items-center shrink-0 h-9 rounded-full border-[1.5px] border-ink bg-ink text-bg">
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        aria-label={`One less ${label}`}
        className="grid place-items-center w-8 h-8 rounded-full"
      >
        <Minus size={14} />
      </button>
      <span aria-live="polite" className="w-5 text-center text-[14px] font-bold tabular-nums">
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(20, qty + 1))}
        aria-label={`One more ${label}`}
        className="grid place-items-center w-8 h-8 rounded-full"
      >
        <Plus size={14} />
      </button>
    </span>
  );
}

/** One line of a printed menu: name, dotted leader, price, and the +/- control. */
function MenuLine({ item, qty, onChange }: { item: Item; qty: number; onChange: (q: number) => void }) {
  return (
    <li className="flex items-center gap-4 py-2.5">
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          <span className={`text-[16px] text-ink [overflow-wrap:anywhere] ${qty ? 'font-semibold' : ''}`}>
            {item.label}
          </span>
          <span
            aria-hidden="true"
            className="flex-1 min-w-4 border-b border-dotted border-ink2/50 translate-y-[-4px]"
          />
          <span className="text-[16px] font-semibold tabular-nums text-ink">{rupees(item.price)}</span>
        </span>
        {(item.note || item.detail) && (
          <span className="block text-[13px] leading-snug text-ink2">{item.detail || item.note}</span>
        )}
      </span>
      <Stepper label={item.label} qty={qty} onChange={onChange} />
    </li>
  );
}

const STEPS = ['placed', 'accepted', 'ready', 'done'] as const;
const STEP_LABEL = { placed: 'Sent', accepted: 'Accepted', ready: 'Ready', done: 'Delivered' };

/** A placed order: its code, where it's got to, and what to do next. */
function Tracker({
  order,
  mess,
  onCancel,
  cancelling,
}: {
  order: MessOrderDto;
  mess: MessDto;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const stopped = order.status === 'rejected' || order.status === 'cancelled';
  const at = STEPS.indexOf(order.status as (typeof STEPS)[number]);
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">Your order</p>
          <p className="m-0 font-display text-[40px] leading-none font-extrabold tracking-[-0.03em] text-ink">
            {order.code}
          </p>
          <p className="m-0 mt-1 text-[13px] text-ink2">
            Say this code if they call · {ago(order.createdAt)}
          </p>
        </div>
        <span className="text-[18px] font-bold tabular-nums text-ink">{rupees(order.total)}</span>
      </div>

      {stopped ? (
        <p className="m-0 border-l-[3px] border-blush-text pl-3 text-[15px] text-ink">
          <strong>{MESS_ORDER_STATUS_TEXT[order.status]}.</strong>
          {order.ownerNote ? ` “${order.ownerNote}”` : ''}
        </p>
      ) : (
        <>
          <ol className="m-0 p-0 list-none grid grid-cols-4 gap-1">
            {STEPS.map((s, i) => (
              <li key={s} className="flex flex-col gap-1.5">
                <span className={`h-1 rounded-full ${i <= at ? 'bg-teal' : 'bg-line'}`} />
                <span
                  className={`text-[12px] ${i === at ? 'font-bold text-ink' : i < at ? 'text-ink' : 'text-ink2'}`}
                >
                  {STEP_LABEL[s]}
                </span>
              </li>
            ))}
          </ol>
          <p className="m-0 text-[14px] text-ink">
            {MESS_ORDER_STATUS_TEXT[order.status]}
            {order.ownerNote ? ` · “${order.ownerNote}”` : ''}
          </p>
        </>
      )}

      <ul className="m-0 p-0 list-none text-[14px] leading-relaxed text-ink2">
        {order.lines.map((l) => (
          <li key={`${l.name}${l.detail}`}>
            {l.qty} × {l.detail ? l.detail.split(':')[0] : l.name}
          </li>
        ))}
        <li>
          {order.mode === 'delivery' ? `To ${order.address}` : 'Pickup'} · {formatMobile(order.phone)}
        </li>
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {mess.phone && (
          <a
            href={`tel:+${waNumber(mess.phone)}`}
            className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink underline underline-offset-4 decoration-line"
          >
            <Phone size={15} /> Call the restaurant
          </a>
        )}
        {order.status === 'placed' && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="text-[14px] font-semibold text-blush-text underline underline-offset-4"
          >
            {cancelling ? 'Cancelling…' : 'Cancel order'}
          </button>
        )}
      </div>
    </div>
  );
}

/** A small receipt edge at the bottom of the bill. */
const TORN =
  '[clip-path:polygon(0_0,100%_0,100%_calc(100%-8px),95%_100%,90%_calc(100%-8px),85%_100%,80%_calc(100%-8px),75%_100%,70%_calc(100%-8px),65%_100%,60%_calc(100%-8px),55%_100%,50%_calc(100%-8px),45%_100%,40%_calc(100%-8px),35%_100%,30%_calc(100%-8px),25%_100%,20%_calc(100%-8px),15%_100%,10%_calc(100%-8px),5%_100%,0_calc(100%-8px))]';

/**
 * Ordering from a restaurant for day scholars, like a printed menu card: the current thali first,
 * then the owner's list, each line with a dotted leader to its price. The bill takes it from there:
 * delivery or pickup, a confirmed phone number, and "Place order", which lands on the restaurant's
 * own order screen. Signing in is required: it's what makes every order a real student.
 */
export function OrderPanel({
  mess,
  today,
  tomorrow,
  nowMinutes,
}: {
  mess: MessDto;
  today: string;
  tomorrow: string;
  nowMinutes: number;
}) {
  const { status: session, me } = useSession();
  const signedIn = session === 'ready' && !!me;
  const qc = useQueryClient();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [saved, setDetails] = useToolState<Partial<Details>>('mess_order_details', {});
  // Saved by an older version of this page, a field may be missing (or not text): fill it in.
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const details: Details = {
    name: text(saved?.name),
    mode: saved?.mode === 'pickup' ? 'pickup' : 'delivery',
    address: text(saved?.address),
    phone: text(saved?.phone),
    note: text(saved?.note),
  };
  const [confirmed, setConfirmed] = useState(false);
  const [tried, setTried] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const mine = useQuery({
    queryKey: ['my-mess-orders'],
    queryFn: api.myMessOrders,
    enabled: signedIn,
    refetchInterval: (q) =>
      q.state.data?.some((o) => o.messSlug === mess.slug && OPEN_MESS_ORDER.includes(o.status))
        ? 10_000
        : false,
  });
  // The latest order here stays on the bill while it's open, and for a while after.
  const current = mine.data?.find(
    (o) =>
      o.messSlug === mess.slug &&
      o.id !== dismissed &&
      (OPEN_MESS_ORDER.includes(o.status) || Date.now() - Date.parse(o.updatedAt) < 3 * 3600_000),
  );

  const thali = useMemo(() => {
    const priced = mess.order.flatMap((s) => s.items).find((i) => /thali/i.test(i.name));
    const at = thaliFor(mess, today, tomorrow, nowMinutes);
    if (!priced || !at) return null;
    const dishes = dishesOn(mess, at.date, at.meal.key).map((d) => d.name);
    if (!dishes.length) return null;
    const item: Item = {
      key: `thali:${at.date}:${at.meal.key}`,
      name: priced.name,
      label: `${at.when}'s ${MEAL_NAMES[at.meal.key].toLowerCase()} thali`,
      note: '',
      price: priced.price,
      detail: dishes.join(', '),
    };
    return {
      item,
      start: at.meal.start,
      serving: at.date === today && mealState(at.meal, nowMinutes) === 'now',
    };
  }, [mess, today, tomorrow, nowMinutes]);

  // The plain "Mess thali" line is replaced by the line above that says what's in this one.
  const sections = useMemo(
    () =>
      mess.order
        .map((s, si) => ({
          title: s.title,
          items: s.items
            .map<Item>((it, ii) => ({
              key: `${si}:${ii}`,
              name: it.name,
              label: it.name,
              note: it.note,
              price: it.price,
              detail: '',
            }))
            .filter((it) => !(thali && /thali/i.test(it.name))),
        }))
        .filter((s) => s.items.length),
    [mess.order, thali],
  );
  const all = useMemo(
    () => [...(thali ? [thali.item] : []), ...sections.flatMap((s) => s.items)],
    [thali, sections],
  );
  const lines = all.filter((i) => cart[i.key]).map((i) => ({ ...i, qty: cart[i.key]! }));
  const total = lines.reduce((n, l) => n + l.qty * l.price, 0);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const setQty = (key: string, qty: number) =>
    setCart((c) => {
      const next = { ...c };
      if (qty > 0) next[key] = qty;
      else delete next[key];
      return next;
    });
  const set = (p: Partial<Details>) => setDetails((d) => ({ ...details, ...d, ...p }));

  const phone = normaliseMobile(details.phone);
  const problem = !lines.length
    ? 'Add something first.'
    : details.mode === 'delivery' && details.address.trim().length < 3
      ? 'Add where to deliver it.'
      : details.name.trim().length < 2
        ? 'Add your name.'
        : !phone
          ? 'Add a 10-digit mobile number.'
          : !confirmed
            ? 'Tick to confirm your number.'
            : null;

  const place = useMutation({
    mutationFn: () =>
      api.placeMessOrder(mess.slug, {
        lines: lines.map((l) => ({
          name: l.name,
          qty: l.qty,
          detail: l.key.startsWith('thali:') ? `${l.label}: ${l.detail}`.slice(0, 200) : '',
        })),
        mode: details.mode,
        address: details.mode === 'delivery' ? details.address.trim() : '',
        name: details.name.trim(),
        phone: phone ?? '',
        note: details.note.trim(),
        phoneConfirmed: true,
      }),
    onSuccess: (o) => {
      track('mess_order_placed', { items: count, total: o.total });
      setCart({});
      setTried(false);
      setDismissed(null);
      qc.setQueryData<MessOrderDto[]>(['my-mess-orders'], (old) => [o, ...(old ?? [])]);
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelMessOrder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-mess-orders'] }),
  });

  const whatsapp = `https://wa.me/${waNumber(mess.phone)}?text=${encodeURIComponent(
    [
      `Hi! An order (${mess.name}):`,
      ...lines.map((l) => `• ${l.qty} × ${l.label} = ${rupees(l.qty * l.price)}`),
      `Total: ${rupees(total)}`,
      details.mode === 'delivery' ? `Deliver to: ${details.address.trim()}` : 'Pickup',
    ].join('\n'),
  )}`;

  if (!mess.phone && !mess.order.length) return null;
  const open = mess.ordersOpen;
  const showTracker = !!current && !count;

  return (
    <section
      id="order"
      aria-labelledby="order-h"
      className="scroll-mt-24 flex flex-col gap-6 border-t-2 border-ink pt-6"
    >
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <h2
            id="order-h"
            className="m-0 font-display text-[clamp(28px,4vw,38px)] leading-none font-extrabold tracking-[-0.03em] text-ink"
          >
            Order
          </h2>
          <p className="m-0 text-[14px] text-ink2">
            {[mess.orderNote, open ? null : 'Not taking orders on the site right now']
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {mess.phone && (
          <span className="flex items-center gap-5 text-[14px]">
            <a
              href={`tel:+${waNumber(mess.phone)}`}
              className="inline-flex items-center gap-1.5 font-semibold text-ink no-underline hover:underline"
            >
              <Phone size={15} /> {mess.phone}
            </a>
            <a
              href={`https://wa.me/${waNumber(mess.phone)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-ink no-underline hover:underline"
            >
              <ChatBubble size={15} /> WhatsApp
            </a>
          </span>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        <div className="flex flex-col gap-7 min-w-0">
          {thali && (
            <div className="flex flex-col">
              <h3 className="m-0 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-marigold-text">
                {thali.serving && (
                  <span aria-hidden="true" className="w-2 h-2 rounded-full bg-marigold animate-pulse" />
                )}
                {thali.serving ? 'Serving now' : `From ${formatClock(toMinutes(thali.start))}`}
              </h3>
              <ul className="m-0 p-0 list-none">
                <MenuLine
                  item={thali.item}
                  qty={cart[thali.item.key] ?? 0}
                  onChange={(q) => setQty(thali.item.key, q)}
                />
              </ul>
            </div>
          )}
          {sections.map((s) => (
            <div key={s.title} className="flex flex-col">
              <h3 className="m-0 font-display italic text-[21px] font-semibold text-ink">{s.title}</h3>
              <ul className="m-0 p-0 list-none">
                {s.items.map((it) => (
                  <MenuLine
                    key={it.key}
                    item={it}
                    qty={cart[it.key] ?? 0}
                    onChange={(q) => setQty(it.key, q)}
                  />
                ))}
              </ul>
            </div>
          ))}
          {!mess.order.length && (
            <p className="m-0 text-[15px] text-ink2">
              The full menu card isn't in yet. Call or message them to order.
            </p>
          )}
        </div>

        <aside
          aria-label="Your bill"
          className={`lg:sticky lg:top-24 flex flex-col gap-4 bg-surface p-5 pb-9 [box-shadow:inset_0_0_0_1px_var(--line)] ${TORN} ${showTracker ? 'order-first lg:order-none' : ''}`}
        >
          {showTracker ? (
            <>
              <Tracker
                order={current}
                mess={mess}
                onCancel={() => cancel.mutate(current.id)}
                cancelling={cancel.isPending}
              />
              {!OPEN_MESS_ORDER.includes(current.status) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => setDismissed(current.id)}
                >
                  New order
                </Button>
              )}
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between border-b border-dashed border-ink2/40 pb-2">
                <h3 className="m-0 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">Bill</h3>
                <span className="text-[13px] text-ink2">
                  {count ? `${count} item${count === 1 ? '' : 's'}` : 'Nothing yet'}
                </span>
              </div>
              {lines.length ? (
                <ul className="m-0 p-0 list-none flex flex-col gap-1.5 text-[14px] tabular-nums">
                  {lines.map((l) => (
                    <li key={l.key} className="flex justify-between gap-3">
                      <span className="min-w-0 text-ink">
                        {l.qty} × {l.label}
                      </span>
                      <span className="shrink-0 text-ink">{rupees(l.qty * l.price)}</span>
                    </li>
                  ))}
                  <li className="mt-1 flex justify-between gap-3 border-t border-dashed border-ink2/40 pt-2 text-[18px] font-bold text-ink">
                    <span>Total</span>
                    <span>{rupees(total)}</span>
                  </li>
                </ul>
              ) : (
                <p className="m-0 text-[14px] text-ink2">Tap + next to a dish.</p>
              )}

              {!open ? (
                <p className="m-0 text-[14px] leading-relaxed text-ink">
                  They aren't taking orders here right now.{' '}
                  {mess.phone && lines.length > 0 && (
                    <a
                      href={whatsapp}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold underline underline-offset-4"
                    >
                      Send this list on WhatsApp
                    </a>
                  )}
                </p>
              ) : !signedIn ? (
                <div className="flex flex-col gap-2">
                  <Link
                    to="/sign-in?next=%2Ftools%2Fmess-menu%23order"
                    className={buttonClass('brand', 'md', 'w-full')}
                  >
                    Sign in to order
                  </Link>
                  <p className="m-0 text-[12.5px] text-ink2">
                    With your college email, so every order is a real student.
                  </p>
                </div>
              ) : (
                <form
                  noValidate
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setTried(true);
                    if (!problem) place.mutate();
                  }}
                >
                  <div
                    role="radiogroup"
                    aria-label="Delivery or pickup"
                    className="grid grid-cols-2 border-[1.5px] border-ink rounded-full overflow-hidden"
                  >
                    {(
                      [
                        ['delivery', 'Delivery'],
                        ['pickup', 'Pickup'],
                      ] as const
                    ).map(([k, text]) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={details.mode === k}
                        onClick={() => set({ mode: k })}
                        className={`h-9 text-[14px] font-semibold ${details.mode === k ? 'bg-ink text-bg' : 'text-ink'}`}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                  {details.mode === 'delivery' && (
                    <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
                      Deliver to
                      <input
                        className={field}
                        value={details.address}
                        maxLength={120}
                        onChange={(e) => set({ address: e.target.value })}
                        placeholder="Hostel block & room, or address"
                        aria-invalid={tried && details.address.trim().length < 3}
                      />
                    </label>
                  )}
                  <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
                    Name
                    <input
                      className={field}
                      value={details.name}
                      maxLength={60}
                      autoComplete="name"
                      onChange={(e) => set({ name: e.target.value })}
                      aria-invalid={tried && details.name.trim().length < 2}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
                    Mobile number
                    <span className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold text-ink">+91</span>
                      <input
                        className={`${field} flex-1`}
                        value={details.phone}
                        inputMode="tel"
                        autoComplete="tel-national"
                        maxLength={14}
                        onChange={(e) => {
                          set({ phone: e.target.value });
                          setConfirmed(false);
                        }}
                        placeholder="98765 43210"
                        aria-invalid={tried && !phone}
                      />
                    </span>
                  </label>
                  {phone && (
                    <label className="flex items-start gap-2.5 text-[14px] leading-snug text-ink cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        className="mt-0.5 w-5 h-5 shrink-0 accent-[var(--teal)]"
                      />
                      <span>
                        <strong className="tabular-nums">{formatMobile(phone)}</strong> is my number, and the
                        restaurant may call it about this order.
                      </span>
                    </label>
                  )}
                  <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
                    Note (optional)
                    <input
                      className={field}
                      value={details.note}
                      maxLength={160}
                      onChange={(e) => set({ note: e.target.value })}
                      placeholder="Less spicy, no onion…"
                    />
                  </label>
                  {tried && problem && (
                    <p role="alert" className="m-0 text-[14px] text-blush-text">
                      {problem}
                    </p>
                  )}
                  {place.error && (
                    <p role="alert" className="m-0 text-[14px] text-blush-text">
                      {place.error instanceof ApiError && place.error.code === 'RATE_LIMITED'
                        ? 'You just ordered. Give it a minute.'
                        : place.error.message}
                    </p>
                  )}
                  <Button type="submit" variant="brand" disabled={place.isPending} className="w-full">
                    {place.isPending ? 'Placing…' : count ? `Place order · ${rupees(total)}` : 'Place order'}
                  </Button>
                  <p className="m-0 text-[12.5px] leading-relaxed text-ink2">
                    Pay when it arrives. Your name, number and address go only to the restaurant.
                  </p>
                </form>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
