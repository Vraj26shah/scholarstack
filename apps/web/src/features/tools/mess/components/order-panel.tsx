import { MEAL_NAMES, type MealKey, type MessDto, dishesOn, formatClock, toMinutes } from '@ss/contracts';
import { useMemo, useState } from 'react';
import { track } from '../../../../lib/analytics';
import { buttonClass } from '../../../../shared/ui/button';
import { ChatBubble, Minus, Phone, Plus } from '../../../../shared/ui/icons';
import { useToolState } from '../../core/storage';
import { field } from '../../core/ui';
import { mealState } from './mess-grid';

interface Item {
  key: string;
  name: string;
  note: string;
  price: number;
  /** "Today's dinner thali": the dishes it comes with. */
  dishes?: string;
}

interface Details {
  name: string;
  mode: 'delivery' | 'pickup';
  address: string;
  note: string;
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const digits = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
};

/** Which thali to offer: the meal on now, else the next one today, else tomorrow's first. */
function thaliMeal(mess: MessDto, today: string, tomorrow: string, nowMinutes: number) {
  const now = mess.meals.find((m) => mealState(m, nowMinutes) !== 'over');
  if (now) return { meal: now, date: today, when: 'today' };
  const first = mess.meals[0];
  return first ? { meal: first, date: tomorrow, when: 'tomorrow' } : null;
}

function Stepper({ item, qty, onChange }: { item: Item; qty: number; onChange: (qty: number) => void }) {
  if (!qty)
    return (
      <button
        type="button"
        onClick={() => onChange(1)}
        aria-label={`Add ${item.name}`}
        className="inline-flex items-center gap-1.5 h-9 rounded-full border-[1.5px] border-line px-3.5 text-[14px] font-semibold text-ink hover:border-ink2"
      >
        <Plus size={14} /> Add
      </button>
    );
  return (
    <span className="inline-flex items-center h-9 rounded-full bg-ink text-bg">
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        aria-label={`One less ${item.name}`}
        className="grid place-items-center w-9 h-9 rounded-full hover:bg-white/10"
      >
        <Minus size={14} />
      </button>
      <span aria-live="polite" className="min-w-6 text-center text-[14px] font-bold tabular-nums">
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(20, qty + 1))}
        aria-label={`One more ${item.name}`}
        className="grid place-items-center w-9 h-9 rounded-full hover:bg-white/10"
      >
        <Plus size={14} />
      </button>
    </span>
  );
}

/**
 * Order from a restaurant for day scholars: today's thali first (with what's in it), then
 * everything else the owner sells, at the owner's prices. "Send on WhatsApp" opens a chat with the
 * restaurant with the order written out; we never take payment or keep the order.
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
  const [cart, setCart] = useState<Record<string, number>>({});
  const [details, setDetails] = useToolState<Details>('mess_order_details', {
    name: '',
    mode: 'delivery',
    address: '',
    note: '',
  });
  const [tried, setTried] = useState(false);
  const phone = digits(mess.phone);

  const thali = useMemo(() => {
    const priced = mess.order.flatMap((s) => s.items).find((i) => /thali/i.test(i.name));
    const at = thaliMeal(mess, today, tomorrow, nowMinutes);
    if (!priced || !at) return null;
    const dishes = dishesOn(mess, at.date, at.meal.key).map((d) => d.name);
    if (!dishes.length) return null;
    const label = `${at.when === 'today' ? "Today's" : "Tomorrow's"} ${MEAL_NAMES[at.meal.key].toLowerCase()} thali`;
    const item: Item = {
      key: `thali:${at.date}:${at.meal.key}`,
      name: label,
      note: '',
      price: priced.price,
      dishes: dishes.join(', '),
    };
    return {
      item,
      meal: at.meal.key as MealKey,
      start: at.meal.start,
      served: mealState(at.meal, nowMinutes),
    };
  }, [mess, today, tomorrow, nowMinutes]);

  // The plain "Mess thali" line is replaced by the card above that says what's in today's.
  const sections = useMemo(
    () =>
      mess.order
        .map((s, si) => ({
          title: s.title,
          items: s.items
            .map<Item>((it, ii) => ({ key: `${si}:${ii}`, ...it }))
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
  const set = (p: Partial<Details>) => setDetails((d) => ({ ...d, ...p }));

  const missing = !lines.length
    ? 'Add something to your order first.'
    : details.mode === 'delivery' && details.address.trim().length < 3
      ? 'Where should they deliver? Add your hostel/room or address.'
      : null;

  const message = [
    `Hi! An order from Scholars Stack (${mess.name}):`,
    ...lines.map(
      (l) => `• ${l.qty} × ${l.name}${l.dishes ? ` (${l.dishes})` : ''} = ${rupees(l.qty * l.price)}`,
    ),
    `Total: ${rupees(total)} (as per your menu card)`,
    details.mode === 'delivery' ? `Deliver to: ${details.address.trim()}` : 'Pickup: I will collect a parcel',
    details.name.trim() ? `Name: ${details.name.trim()}` : '',
    details.note.trim() ? `Note: ${details.note.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const whatsapp = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  if (!phone && !mess.order.length) return null;

  return (
    <section id="order" aria-labelledby="order-h" className="scroll-mt-24 flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="order-h" className="m-0 text-[22px] font-bold text-ink">
            Order from {mess.name}
          </h2>
          <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-[14px] text-ink2">
            {mess.orderNote
              .split('·')
              .map((x) => x.trim())
              .filter(Boolean)
              .map((x) => (
                <span key={x} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-teal" />
                  {x}
                </span>
              ))}
          </p>
        </div>
        {phone && (
          <a href={`tel:+${phone}`} className={buttonClass('outline', 'sm')}>
            <Phone size={16} /> Call {mess.phone}
          </a>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
        <div className="flex flex-col gap-4 min-w-0">
          {thali && (
            <div className="rounded-[18px] bg-card p-4 sm:p-5 flex flex-wrap items-center gap-4 shadow-[0_18px_34px_-26px_var(--shadow),0_0_0_2px_var(--marigold)]">
              <div className="flex-1 min-w-[220px] flex flex-col gap-1">
                <span className="self-start rounded-md bg-marigold-soft px-2 py-0.5 text-[12px] font-semibold text-marigold-text">
                  {thali.served === 'now' ? 'Serving now' : `From ${formatClock(toMinutes(thali.start))}`}
                </span>
                <p className="m-0 text-[18px] font-bold text-ink">
                  {thali.item.name} <span className="text-marigold-text">{rupees(thali.item.price)}</span>
                </p>
                <p className="m-0 text-[14px] text-ink2">{thali.item.dishes}</p>
              </div>
              <Stepper
                item={thali.item}
                qty={cart[thali.item.key] ?? 0}
                onChange={(q) => setQty(thali.item.key, q)}
              />
            </div>
          )}

          {sections.map((s) => (
            <div key={s.title} className="flex flex-col gap-1">
              <h3 className="m-0 text-[13px] font-semibold uppercase tracking-wide text-ink2">{s.title}</h3>
              <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line">
                {s.items.map((it) => (
                  <li key={it.key} className="flex items-center gap-3 py-3">
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">
                        {it.name}
                      </span>
                      {it.note && <span className="text-[13px] text-ink2">{it.note}</span>}
                    </span>
                    <span className="shrink-0 text-[15px] font-bold tabular-nums text-ink">
                      {rupees(it.price)}
                    </span>
                    <Stepper item={it} qty={cart[it.key] ?? 0} onChange={(q) => setQty(it.key, q)} />
                  </li>
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
          aria-label="Your order"
          className="lg:sticky lg:top-24 rounded-[18px] bg-card p-5 flex flex-col gap-4 shadow-[0_18px_34px_-26px_var(--shadow),0_0_0_1px_var(--line)]"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="m-0 text-[18px] font-bold text-ink">Your order</h3>
            <span className="text-[14px] text-ink2">
              {count ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            </span>
          </div>
          {lines.length ? (
            <ul className="m-0 p-0 list-none flex flex-col gap-2 text-[14px]">
              {lines.map((l) => (
                <li key={l.key} className="flex items-start justify-between gap-3">
                  <span className="min-w-0 text-ink">
                    {l.qty} × {l.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink">{rupees(l.qty * l.price)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3 border-t border-line pt-2 text-[16px] font-bold text-ink">
                <span>Total</span>
                <span className="tabular-nums">{rupees(total)}</span>
              </li>
            </ul>
          ) : (
            <p className="m-0 text-[14px] text-ink2">Tap Add on anything to start.</p>
          )}

          <div
            role="radiogroup"
            aria-label="Delivery or pickup"
            className="grid grid-cols-2 gap-1 rounded-full bg-sunk p-1"
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
                className={`h-9 rounded-full text-[14px] font-semibold ${details.mode === k ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-ink2'}`}
              >
                {text}
              </button>
            ))}
          </div>
          {details.mode === 'delivery' && (
            <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-ink2">
              Deliver to
              <input
                className={field}
                value={details.address}
                maxLength={120}
                onChange={(e) => set({ address: e.target.value })}
                placeholder="Hostel block & room, or your address"
                aria-invalid={tried && details.address.trim().length < 3}
              />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-ink2">
            Your name (optional)
            <input
              className={field}
              value={details.name}
              maxLength={60}
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-ink2">
            Note for the kitchen (optional)
            <input
              className={field}
              value={details.note}
              maxLength={120}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="Less spicy, no onion…"
            />
          </label>

          {tried && missing && (
            <p role="alert" className="m-0 text-[14px] text-blush-text">
              {missing}
            </p>
          )}
          {phone && missing ? (
            // Not ready yet: a tap says what's missing instead of opening an empty chat.
            <button
              type="button"
              onClick={() => setTried(true)}
              className={buttonClass('brand', 'md', 'w-full opacity-70')}
            >
              <ChatBubble size={18} /> Send order on WhatsApp
            </button>
          ) : phone ? (
            <a
              href={whatsapp}
              target="_blank"
              rel="noreferrer"
              onClick={() => track('mess_order_sent', { items: count, total })}
              className={buttonClass('brand', 'md', 'w-full')}
            >
              <ChatBubble size={18} /> Send order on WhatsApp
            </a>
          ) : null}
          <p className="m-0 text-[12.5px] leading-relaxed text-ink2">
            Opens WhatsApp with your order filled in. You pay the restaurant directly; we don't see or keep
            your order.
          </p>
        </aside>
      </div>
    </section>
  );
}
