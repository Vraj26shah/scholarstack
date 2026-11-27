import {
  MEAL_NAMES,
  type MessDto,
  type MessOrderDto,
  OPEN_MESS_ORDER,
  ORDER_TIMERS,
  TIFFIN_DAYS,
  TIFFIN_PLANS,
  TIFFIN_PLAN_TEXT,
  TIFFIN_START_WITHIN_DAYS,
  type TiffinPlan,
  dishesOn,
  formatClock,
  formatMobile,
  isTiffinItem,
  normaliseMobile,
  tiffinEnds,
  toMinutes,
} from '@ss/contracts';
import { COMBO_PREFIX, bestDiscount, offerLive } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { signal, track } from '../../../../lib/analytics';
import { ApiError, api } from '../../../../lib/api';
import { mobileHint, tidyMobile } from '../../../../lib/mobile';
import { useSession } from '../../../../lib/session';
import { Button, buttonClass } from '../../../../shared/ui/button';
import { Minus, Phone, Plus, SearchIcon } from '../../../../shared/ui/icons';
import { jumpTo } from '../../../../shared/ui/jump';
import { askToSignIn } from '../../../auth/sign-in-prompt';
import { useLive } from '../../../chat/live';
import { ChatButton, OrderChat } from '../../../chat/order-chat';
import { PayFirstBox, StandingNote, orderStatusText, useOrderStanding } from '../../../orders/pay-first';
import { rupees } from '../../../restaurant/shared';
import { useToolState } from '../../core/storage';
import { field } from '../../core/ui';
import { CartBar } from './cart-bar';
import { mealState } from './mess-grid';
import { PhoneCheck, usePhoneStatus } from './phone-check';

interface Item {
  key: string;
  /** The name on the restaurant's list (what the server prices). */
  name: string;
  /** What the student sees, e.g. "Tonight's dinner thali". */
  label: string;
  note: string;
  price: number;
  detail: string;
  photo: string;
  available: boolean;
  /** A monthly tiffin plan: ordered alone, with a meal plan and a first day. */
  tiffin: boolean;
}

interface Details {
  name: string;
  mode: 'delivery' | 'pickup';
  address: string;
  phone: string;
  note: string;
  /** The number last ticked as "my number" on this device. */
  confirmedPhone: string;
}

const CART_MAX_AGE_MS = 24 * 3600_000;
/** A saved cart, as { itemKey: qty }; anything unreadable or older than a day is an empty cart. */
/** Below the laptop layout (1024px): the cart is its own screen. */
function useIsPhone() {
  const query = '(max-width: 1023px)';
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const change = () => setOn(m.matches);
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, []);
  return on;
}

export function readCart(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const { items, at } = raw as { items?: unknown; at?: unknown };
  if (typeof at !== 'number' || Date.now() - at > CART_MAX_AGE_MS) return {};
  if (!items || typeof items !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(items as Record<string, unknown>))
    if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 20) out[k] = v;
  return out;
}

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
};
const slipTime = () =>
  new Date().toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
/** A dialable number from what the owner typed ("+91 85179 03810" → "+918517903810"). */
const telOf = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 ? `+91${d}` : d ? `+${d}` : '';
};
const sectionId = (title: string) => `menu-${encodeURIComponent(title)}`;

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
        className="inline-flex items-center justify-center gap-1 h-9 min-w-[92px] shrink-0 rounded-lg border-[1.5px] border-teal bg-surface px-3 text-[14px] font-extrabold uppercase tracking-[0.04em] text-teal-text shadow-[0_6px_14px_-8px_rgba(0,0,0,0.35)] hover:bg-teal hover:text-white transition-colors"
      >
        Add <Plus size={14} />
      </button>
    );
  return (
    <span className="inline-flex items-center justify-between h-9 min-w-[92px] shrink-0 rounded-lg bg-teal text-white shadow-[0_6px_14px_-8px_rgba(0,0,0,0.35)]">
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        aria-label={`One less ${label}`}
        className="grid place-items-center w-8 h-9 rounded-lg border-0 bg-transparent text-white cursor-pointer"
      >
        <Minus size={14} />
      </button>
      <span aria-live="polite" className="w-6 text-center text-[15px] font-bold tabular-nums">
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(20, qty + 1))}
        aria-label={`One more ${label}`}
        className="grid place-items-center w-8 h-9 rounded-lg border-0 bg-transparent text-white cursor-pointer"
      >
        <Plus size={14} />
      </button>
    </span>
  );
}

/**
 * One dish on the menu card, the way food apps lay it out: name, price and description on the left,
 * the photo on the right with the Add button sitting on it. No photo: no stand-in picture, just Add.
 * Sold-out dishes stay listed, greyed. `readOnly`: the restaurant isn't taking orders on the site.
 */
function DishRow({
  item,
  photo,
  qty,
  onChange,
  readOnly,
  featured,
}: {
  item: Item;
  photo: string;
  qty: number;
  onChange: (q: number) => void;
  readOnly?: boolean;
  featured?: string;
}) {
  const [broken, setBroken] = useState(false);
  const hasPhoto = !!photo && !broken;
  const control = !item.available ? (
    <span className="inline-flex h-9 items-center rounded-lg bg-sunk px-3 text-[12px] font-bold uppercase tracking-[0.08em] text-ink2">
      Sold out
    </span>
  ) : readOnly ? null : (
    <Stepper label={item.label} qty={qty} onChange={onChange} />
  );
  return (
    <li
      aria-label={item.label}
      className={`flex gap-4 py-5 ${item.available ? '' : 'opacity-60'} ${featured ? 'rounded-2xl bg-marigold-soft/60 px-4 -mx-4' : ''}`}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {featured && (
          <span className="self-start text-[11px] font-bold uppercase tracking-[0.12em] text-marigold-text">
            {featured}
          </span>
        )}
        <p className="m-0 text-[16.5px] font-bold leading-snug text-ink [overflow-wrap:anywhere]">
          {item.label}
        </p>
        <p className="m-0 text-[15px] font-semibold tabular-nums text-ink">
          {rupees(item.price)}
          {item.tiffin && (
            <span className="ml-2 text-[12.5px] font-semibold text-marigold-text">Monthly plan</span>
          )}
        </p>
        {(item.detail || item.note) && (
          <p className="m-0 text-[13.5px] leading-snug text-ink2 line-clamp-2">{item.detail || item.note}</p>
        )}
      </div>
      {hasPhoto ? (
        <div className="relative shrink-0 w-[118px] sm:w-[140px] pb-4">
          <img
            src={photo}
            alt={item.label}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="block w-full aspect-[7/6] rounded-xl object-cover bg-sunk"
          />
          {control && <span className="absolute inset-x-0 -bottom-0.5 flex justify-center">{control}</span>}
        </div>
      ) : (
        control && <div className="shrink-0 self-center">{control}</div>
      )}
    </li>
  );
}

const STEPS = ['placed', 'accepted', 'ready', 'done'] as const;
const STEP_LABEL = { placed: 'Sent', accepted: 'Accepted', ready: 'Ready', done: 'Delivered' };

/** A placed order: its code, where it's got to, and the chat and Call buttons. */
function Tracker({
  order,
  mess,
  onCancel,
  cancelling,
  onChat,
}: {
  order: MessOrderDto;
  mess: MessDto;
  onCancel: () => void;
  cancelling: boolean;
  onChat: () => void;
}) {
  const stopped = order.status === 'rejected' || order.status === 'cancelled';
  const at = STEPS.indexOf(order.status as (typeof STEPS)[number]);
  const tiffinOn = !!order.tiffin && order.status === 'done';
  // A tick every 15 s, so "not answered yet" appears on time.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (order.status !== 'placed') return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [order.status]);
  const waited = now - Date.parse(order.createdAt);
  const cancelsIn = Math.max(1, Math.ceil((ORDER_TIMERS.autoCancelAfterMs - waited) / 60_000));
  const tel = telOf(mess.phone);

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
        <span className="flex flex-col items-end text-[18px] font-bold tabular-nums text-ink">
          {rupees(order.total)}
          {order.discount > 0 && (
            <span className="text-[12.5px] font-semibold text-teal-text">
              saved {rupees(order.discount)} · {order.offer}
            </span>
          )}
        </span>
      </div>

      {tiffinOn && order.tiffin && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-sunk px-3.5 py-3 text-[14px] text-ink">
          <p className="m-0 font-semibold">Tiffin on · till {order.tiffin.endsOn}</p>
          <p className="m-0 text-ink2">
            {order.tiffin.delivered ?? 0} meal{(order.tiffin.delivered ?? 0) === 1 ? '' : 's'} delivered
            {order.tiffin.missed ? ` · ${order.tiffin.missed} missed` : ''}
          </p>
          {(order.tiffin.makeups ?? []).map((m) => (
            <p key={`${m.day}-${m.meal}`} className="m-0 text-marigold-text">
              Missed {m.meal} on {m.day}: you can still get it until {m.until}. Ask the restaurant in the
              chat.
            </p>
          ))}
        </div>
      )}
      {tiffinOn ? null : stopped ? (
        <p className="m-0 border-l-[3px] border-blush-text pl-3 text-[15px] text-ink">
          <strong>{orderStatusText(order)}.</strong>
          {order.ownerNote && !order.noShow ? ` “${order.ownerNote}”` : ''}
          {order.noShow && " The restaurant says you didn't collect it."}
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
            {orderStatusText(order)}
            {order.ownerNote ? ` · “${order.ownerNote}”` : ''}
          </p>
        </>
      )}

      {order.tiffin && (
        <p className="m-0 rounded-xl bg-marigold-soft px-3 py-2.5 text-[14px] text-marigold-text">
          <strong>
            Tiffin · {TIFFIN_PLAN_TEXT[order.tiffin.plan]} · {order.tiffin.startsOn} to {order.tiffin.endsOn}
          </strong>
          {order.status === 'done'
            ? ' · On'
            : order.status === 'placed'
              ? ' · Waiting for the restaurant'
              : ''}
        </p>
      )}
      <PayFirstBox order={order} />
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

      <div className="flex flex-wrap gap-2">
        <ChatButton unread={order.unread} onClick={onChat} label="Chat with restaurant" />
        {tel && (
          <a
            href={`tel:${tel}`}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-full border-[1.5px] border-line text-[14px] font-semibold text-ink no-underline hover:border-ink2"
          >
            <Phone size={16} /> Call
          </a>
        )}
      </div>
      {order.status === 'placed' && order.payment !== 'due' && waited >= ORDER_TIMERS.nudgeAfterMs && (
        <p className="m-0 rounded-xl bg-marigold-soft px-3 py-2.5 text-[14px] text-marigold-text">
          <strong>Not answered yet.</strong> We've alerted the restaurant again.
          {tel ? ' Call them if it is urgent.' : ''} If nobody answers, the order cancels by itself in{' '}
          {cancelsIn} min.
        </p>
      )}
      {order.status === 'placed' && order.payment !== 'claimed' && order.payment !== 'paid' && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="self-start border-0 bg-transparent p-0 text-[14px] font-semibold text-blush-text underline underline-offset-4 cursor-pointer"
        >
          {cancelling ? 'Cancelling…' : 'Cancel order'}
        </button>
      )}
    </div>
  );
}

/** The paper edge at the bottom of the slip. */
const TORN =
  '[clip-path:polygon(0_0,100%_0,100%_calc(100%-8px),95%_100%,90%_calc(100%-8px),85%_100%,80%_calc(100%-8px),75%_100%,70%_calc(100%-8px),65%_100%,60%_calc(100%-8px),55%_100%,50%_calc(100%-8px),45%_100%,40%_calc(100%-8px),35%_100%,30%_calc(100%-8px),25%_100%,20%_calc(100%-8px),15%_100%,10%_calc(100%-8px),5%_100%,0_calc(100%-8px))]';

/** A restaurant that only shares its weekly menu here: who to call, nothing to order. */
function MenuOnly({ mess }: { mess: MessDto }) {
  const tel = telOf(mess.phone);
  if (!tel) return null;
  return (
    <section
      id="order"
      aria-label="Ordering"
      className="scroll-mt-24 flex flex-wrap items-center justify-between gap-4 border-t-2 border-ink pt-6"
    >
      <div className="flex flex-col gap-1 max-w-[620px]">
        <h2 className="m-0 font-display text-[26px] leading-none font-extrabold tracking-[-0.03em] text-ink">
          Ordering
        </h2>
        <p className="m-0 text-[15px] text-ink2">
          {mess.name} shares its weekly menu here but doesn't take orders on the site. Call them to order
          {mess.orderNote ? ` · ${mess.orderNote}` : ''}.
        </p>
      </div>
      <a href={`tel:${tel}`} className={buttonClass('brand', 'md')}>
        <Phone size={18} /> Call {formatMobile(tel.replace(/^\+91/, ''))}
      </a>
    </section>
  );
}

/**
 * Ordering from a restaurant for day scholars, in three shapes:
 * - taking orders on the site: the menu card by category (photos, search, Add), an order slip, and
 *   the order's own chat once placed (no WhatsApp);
 * - a menu card but not taking orders right now: the card to read, with prices, and Call;
 * - only a weekly menu: nothing to order, just Call (see MenuOnly).
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
  // The cart is kept on this device per restaurant, so it survives a reload, switching mess and
  // the trip to the sign-in page and back. Old or odd saved shapes are read field by field.
  const [carts, setCarts] = useToolState<Record<string, unknown>>('mess_carts', {});
  const cart = useMemo(() => readCart(carts?.[mess.slug]), [carts, mess.slug]);
  const setCart = (next: Record<string, number> | ((c: Record<string, number>) => Record<string, number>)) =>
    setCarts((all) => {
      const safe = all && typeof all === 'object' ? all : {};
      const items = typeof next === 'function' ? next(readCart(safe[mess.slug])) : next;
      const out: Record<string, unknown> = {};
      // Keep other restaurants' carts from the last day only.
      for (const [k, v] of Object.entries(safe))
        if (k !== mess.slug && Object.keys(readCart(v)).length) out[k] = v;
      if (Object.keys(items).length) out[mess.slug] = { items, at: Date.now() };
      return out;
    });
  const [saved, setDetails] = useToolState<Partial<Details>>('mess_order_details', {});
  // Saved by an older version of this page, a field may be missing (or not text): fill it in.
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const details: Details = {
    name: text(saved?.name),
    mode: saved?.mode === 'pickup' ? 'pickup' : 'delivery',
    address: text(saved?.address),
    phone: text(saved?.phone),
    note: text(saved?.note),
    confirmedPhone: text(saved?.confirmedPhone),
  };
  const [confirmedNow, setConfirmed] = useState(false);
  const confirmed =
    confirmedNow || (!!details.confirmedPhone && details.confirmedPhone === normaliseMobile(details.phone));
  const [tried, setTried] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const isPhone = useIsPhone();
  const [cartOpen, setCartOpen] = useState(
    () => typeof window !== 'undefined' && window.location.hash === '#order-slip',
  );
  // The cart screen covers the page: the page behind it doesn't scroll, and Escape closes it.
  useEffect(() => {
    if (!isPhone || !cartOpen) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setCartOpen(false);
    window.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener('keydown', key);
    };
  }, [isPhone, cartOpen]);
  // With SMS codes set up, the number is checked once and then fixed; otherwise a tick box.
  const phoneStatus = usePhoneStatus(signedIn);
  const otp = !!phoneStatus.data?.available;
  const standing = useOrderStanding(signedIn);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const mine = useQuery({
    queryKey: ['my-mess-orders'],
    queryFn: api.myMessOrders,
    enabled: signedIn,
    refetchInterval: (q) =>
      q.state.data?.some((o) => o.messSlug === mess.slug && OPEN_MESS_ORDER.includes(o.status))
        ? 10_000
        : false,
  });
  // The latest order here stays on the slip while it's open, and for a while after.
  const current = mine.data?.find(
    (o) =>
      o.messSlug === mess.slug &&
      o.id !== dismissed &&
      (OPEN_MESS_ORDER.includes(o.status) || Date.now() - Date.parse(o.updatedAt) < 3 * 3600_000),
  );
  useLive(current?.topic, () => void qc.invalidateQueries({ queryKey: ['my-mess-orders'] }));
  const reply = useQuery({
    queryKey: ['reply-time', mess.slug],
    queryFn: () => api.replyTime(mess.slug),
    enabled: mess.ordersOpen,
    staleTime: 600_000,
  });

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
      photo: priced.photo ?? '',
      available: priced.available !== false,
      tiffin: false,
    };
    return {
      item,
      label:
        at.date === today && mealState(at.meal, nowMinutes) === 'now'
          ? 'Serving now'
          : `From ${formatClock(toMinutes(at.meal.start))}`,
    };
  }, [mess, today, tomorrow, nowMinutes]);

  // The plain "Mess thali" line is replaced by the card above that says what's in this one.
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
              note: it.note ?? '',
              price: it.price,
              detail: '',
              photo: it.photo ?? '',
              available: it.available !== false,
              tiffin: isTiffinItem(it),
            }))
            .filter((it) => !(thali && /thali/i.test(it.name))),
        }))
        .filter((s) => s.items.length),
    [mess.order, thali],
  );
  // The owner's combos running today, as dishes of their own (the server prices them by id).
  const liveOffers = useMemo(
    () => (mess.offers ?? []).filter((o) => offerLive(o, today)),
    [mess.offers, today],
  );
  const comboSection = useMemo(() => {
    const menu = new Map(mess.order.flatMap((s) => s.items).map((i) => [i.name.toLowerCase(), i]));
    const items = liveOffers
      .filter((o) => o.kind === 'combo' && o.items.length >= 2 && o.price > 0)
      .map<Item>((o) => {
        const full = o.items.reduce((n, i) => n + i.qty * (menu.get(i.name.toLowerCase())?.price ?? 0), 0);
        const what = o.items.map((i) => `${i.qty}× ${i.name}`).join(' + ');
        return {
          key: `${COMBO_PREFIX}${o.id}`,
          name: `${COMBO_PREFIX}${o.id}`,
          label: o.title,
          note: full > o.price ? `${what} · save ${rupees(full - o.price)}` : what,
          price: o.price,
          detail: what,
          photo: '',
          available: o.items.every((i) => menu.get(i.name.toLowerCase())?.available !== false),
          tiffin: false,
        };
      });
    return items.length ? [{ title: 'Combos', items }] : [];
  }, [liveOffers, mess.order]);
  const q = query.trim().toLowerCase();
  const shown = q
    ? sections
        .map((s) => ({
          ...s,
          items: s.items.filter((i) => `${i.label} ${i.note}`.toLowerCase().includes(q)),
        }))
        .filter((s) => s.items.length)
    : sections;
  const all = useMemo(
    () => [
      ...(thali ? [thali.item] : []),
      ...comboSection.flatMap((s) => s.items),
      ...sections.flatMap((s) => s.items),
    ],
    [thali, sections, comboSection],
  );

  // Which category is on screen (for the rail).
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const els = sections
      .map((s) => document.getElementById(sectionId(s.title)))
      .filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveSection(decodeURIComponent(top.target.id.slice(5)));
      },
      { rootMargin: '-90px 0px -60% 0px' },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [sections]);

  const lines = all.filter((i) => cart[i.key] && i.available).map((i) => ({ ...i, qty: cart[i.key]! }));
  const total = lines.reduce((n, l) => n + l.qty * l.price, 0);
  const comboTotal = lines
    .filter((l) => l.name.startsWith(COMBO_PREFIX))
    .reduce((n, l) => n + l.qty * l.price, 0);
  const [promo, setPromo] = useState('');
  const [promoDraft, setPromoDraft] = useState('');
  const firstOrder = !(mine.data ?? []).some(
    (o) => o.messSlug === mess.slug && !['cancelled', 'rejected'].includes(o.status),
  );
  const dishTotal = lines.some((l) => l.tiffin) ? 0 : total - comboTotal;
  const withCode = bestDiscount(liveOffers, dishTotal, { date: today, code: promo, firstOrder });
  // A code that doesn't work here is shown as such, and the best automatic deal still applies.
  const deal = withCode.codeProblem
    ? bestDiscount(liveOffers, dishTotal, { date: today, firstOrder })
    : withCode;
  const sendCode = promo && !withCode.codeProblem ? promo : '';
  const discount = deal.saving;
  const payable = Math.max(0, total - discount);
  const hasCodes = liveOffers.some((o) => o.kind === 'code');
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const byKey = useMemo(() => new Map(all.map((i) => [i.key, i])), [all]);
  const setQty = (key: string, qty: number) =>
    setCart((c) => {
      const item = byKey.get(key);
      // A tiffin plan is ordered on its own (and only one), so adding one clears the rest and
      // adding a dish clears a plan.
      let next: Record<string, number> = { ...c };
      if (qty > 0 && item?.tiffin) next = {};
      if (qty > 0 && item && !item.tiffin)
        for (const k of Object.keys(next)) if (byKey.get(k)?.tiffin) delete next[k];
      if (qty > 0) next[key] = item?.tiffin ? 1 : qty;
      else delete next[key];
      return next;
    });
  const tiffinLine = all.find((i) => i.tiffin && cart[i.key]);
  // Paid first by UPI: big orders (the owner's limit), tiffin plans, students with no-shows.
  const payFirst =
    !!mess.upiId &&
    (!!standing.data?.payFirst || !!tiffinLine || (mess.prepayAbove > 0 && payable > mess.prepayAbove));
  const todayIso = today;
  const lastStart = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + TIFFIN_START_WITHIN_DAYS);
    return d.toISOString().slice(0, 10);
  })();
  const [plan, setPlan] = useState<TiffinPlan>('both');
  const [startsOn, setStartsOn] = useState(tomorrow);
  const set = (p: Partial<Details>) => setDetails((d) => ({ ...details, ...d, ...p }));
  const photo = (i: Item) => api.messPhotoUrl(mess.slug, i.photo);

  const hasCard = all.length > 0;
  const taking = mess.ordersOpen && hasCard;
  const tel = telOf(mess.phone);
  const phone = otp ? (phoneStatus.data?.phone ?? null) : normaliseMobile(details.phone);
  const hint = mobileHint(details.phone);
  const problem = !lines.length
    ? 'Add something first.'
    : tiffinLine && (startsOn < todayIso || startsOn > lastStart)
      ? 'Pick a first day for the tiffin within the next two weeks.'
      : details.mode === 'delivery' && details.address.trim().length < 3
        ? 'Add where to deliver it.'
        : details.name.trim().length < 2
          ? 'Add your name.'
          : !phone
            ? otp
              ? 'Verify your mobile number with the code we text you.'
              : 'Add a 10-digit mobile number.'
            : !otp && !confirmed
              ? 'Tick to confirm your number.'
              : null;
  // A student pressed Confirm and was told something's missing: counted as stuck on a form.
  useEffect(() => {
    if (tried && problem) signal('stuck_form');
  }, [tried, problem]);

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
        promoCode: sendCode,
        ...(tiffinLine ? { tiffin: { plan, startsOn } } : {}),
      }),
    onError: () => void qc.invalidateQueries({ queryKey: ['my-phone'] }),
    onSuccess: (o) => {
      if (!otp && phone) set({ confirmedPhone: phone });
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

  if (!hasCard) return <MenuOnly mess={mess} />;
  // Phones: the order slip is a cart screen of its own (like food apps), opened from the cart bar.
  // Laptops: it stays beside the menu.
  const slipWrap = (el: ReactElement) =>
    !isPhone
      ? el
      : cartOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Your cart"
              className="fixed inset-0 z-50 flex flex-col bg-bg"
            >
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 pt-[calc(12px+env(safe-area-inset-top))]">
                <div className="min-w-0">
                  <p className="m-0 text-[17px] font-bold text-ink">
                    {showTracker ? 'Your order' : 'Your cart'}
                  </p>
                  <p className="m-0 truncate text-[13px] text-ink2">{mess.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  aria-label="Back to the menu"
                  className="press h-10 rounded-full border-[1.5px] border-line bg-surface px-4 text-[14px] font-semibold text-ink cursor-pointer"
                >
                  {showTracker ? 'Done' : '+ Add more'}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
                {el}
              </div>
            </div>,
            document.body,
          )
        : null;
  const showTracker = !!current && !count;
  const readOnly = !taking;

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
            {taking ? 'Order' : 'Menu & prices'}
          </h2>
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-ink2">
            {taking ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-teal-text">
                <span aria-hidden="true" className="w-2 h-2 rounded-full bg-teal" /> Taking orders now
              </span>
            ) : (
              <span className="font-semibold text-marigold-text">
                Not taking orders on the site right now
              </span>
            )}
            {[
              mess.orderNote,
              taking ? 'Pay when it arrives' : '',
              taking && reply.data?.minutes ? `Usually replies in ${reply.data.minutes} min` : '',
            ]
              .filter(Boolean)
              .map((t) => (
                <span key={t}>· {t}</span>
              ))}
          </p>
        </div>
        {readOnly && tel && (
          <a href={`tel:${tel}`} className={buttonClass('brand', 'md')}>
            <Phone size={18} /> Call to order
          </a>
        )}
      </header>

      {taking && liveOffers.some((o) => o.kind !== 'combo') && (
        <ul
          aria-label="Offers"
          className="m-0 p-0 list-none flex gap-3 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap [scrollbar-width:none]"
        >
          {liveOffers
            .filter((o) => o.kind !== 'combo' && (!o.firstOrderOnly || firstOrder))
            .map((o) => (
              <li
                key={o.id}
                className="flex-none w-[260px] sm:w-auto sm:max-w-[320px] flex flex-col gap-1 rounded-2xl border-[1.5px] border-dashed border-teal/60 bg-mist/30 px-4 py-3"
              >
                <span className="text-[15px] font-bold text-ink">🏷️ {o.title}</span>
                <span className="text-[13px] text-ink2">
                  {o.kind === 'deal'
                    ? `Applied by itself${o.minTotal ? ` on orders of ${rupees(o.minTotal)}+` : ''}`
                    : `Code ${o.code}${o.minTotal ? ` · orders of ${rupees(o.minTotal)}+` : ''}${o.firstOrderOnly ? ' · first order' : ''}`}
                </span>
                {o.kind === 'code' && promo !== o.code && (
                  <button
                    type="button"
                    onClick={() => {
                      setPromo(o.code);
                      setPromoDraft(o.code);
                    }}
                    className="self-start mt-1 border-0 bg-transparent p-0 text-[13.5px] font-semibold text-teal-text underline underline-offset-4 cursor-pointer"
                  >
                    Use {o.code}
                  </button>
                )}
                {o.kind === 'code' && promo === o.code && (
                  <span className="mt-1 text-[13px] font-semibold text-teal-text">
                    ✓ Applied to your order
                  </span>
                )}
              </li>
            ))}
        </ul>
      )}

      <div
        className={`grid gap-8 items-start ${readOnly ? 'lg:grid-cols-[190px_minmax(0,1fr)]' : 'lg:grid-cols-[190px_minmax(0,1fr)_360px]'}`}
      >
        {/* Category rail (desktop) */}
        <nav aria-label="Menu categories" className="hidden lg:flex flex-col gap-0.5 sticky top-24">
          {thali && (
            <button
              type="button"
              onClick={jumpTo('menu-today')}
              className="rounded-lg px-3 py-2 text-[14px] font-semibold text-marigold-text no-underline hover:bg-sunk text-left border-0 bg-transparent cursor-pointer"
            >
              Today's thali
            </button>
          )}
          {sections.map((s) => (
            <a
              key={s.title}
              href={`#${sectionId(s.title)}`}
              onClick={jumpTo(sectionId(s.title))}
              aria-current={activeSection === s.title ? 'true' : undefined}
              className={`flex items-baseline justify-between gap-2 rounded-lg px-3 py-2 text-[14px] no-underline border-l-[3px] ${
                activeSection === s.title
                  ? 'border-teal bg-mist/40 font-bold text-ink'
                  : 'border-transparent font-semibold text-ink2 hover:text-ink hover:bg-sunk'
              }`}
            >
              <span className="truncate">{s.title}</span>
              <span className="text-[12px] font-normal tabular-nums">{s.items.length}</span>
            </a>
          ))}
        </nav>

        <div className="flex flex-col min-w-0">
          {/* Search, and the categories as chips on phones */}
          <div className="sticky top-0 z-20 -mx-4 px-4 sm:mx-0 sm:px-0 pt-1 pb-3 bg-bg/95 backdrop-blur flex flex-col gap-2.5">
            <label className="relative block">
              <span className="sr-only">Search the menu</span>
              <span aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink2">
                <SearchIcon size={17} />
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${all.length} dishes`}
                className={`${field} h-11 pl-10`}
              />
            </label>
            {sections.length > 1 && (
              <div className="lg:hidden flex gap-2 overflow-x-auto -mx-1 px-1">
                {sections.map((s) => (
                  <a
                    key={s.title}
                    href={`#${sectionId(s.title)}`}
                    onClick={jumpTo(sectionId(s.title))}
                    className={`flex-none h-9 inline-flex items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-semibold no-underline ${
                      activeSection === s.title ? 'bg-ink text-bg' : 'border border-line text-ink'
                    }`}
                  >
                    {s.title}
                    <span className="text-[11.5px] opacity-70 tabular-nums">{s.items.length}</span>
                  </a>
                ))}
              </div>
            )}
          </div>

          {thali && !q && (
            <ul id="menu-today" className="m-0 p-0 list-none scroll-mt-28">
              <DishRow
                item={thali.item}
                photo={photo(thali.item)}
                qty={cart[thali.item.key] ?? 0}
                onChange={(n) => setQty(thali.item.key, n)}
                readOnly={readOnly}
                featured={thali.label}
              />
            </ul>
          )}
          {[...(q ? [] : comboSection), ...shown].map((s) => (
            <section key={s.title} id={sectionId(s.title)} aria-label={s.title} className="scroll-mt-28 pt-4">
              <h3 className="m-0 flex items-baseline justify-between gap-3 border-b-2 border-ink pb-2 font-display text-[22px] font-bold tracking-[-0.01em] text-ink">
                {s.title}
                <span className="font-sans text-[13px] font-normal text-ink2">
                  {s.items.length} item{s.items.length === 1 ? '' : 's'}
                </span>
              </h3>
              <ul className="m-0 p-0 list-none divide-y divide-dashed divide-line">
                {s.items.map((it) => (
                  <DishRow
                    key={it.key}
                    item={it}
                    photo={photo(it)}
                    qty={cart[it.key] ?? 0}
                    onChange={(n) => setQty(it.key, n)}
                    readOnly={readOnly}
                  />
                ))}
              </ul>
            </section>
          ))}
          {q && !shown.length && (
            <p className="m-0 py-8 text-[15px] text-ink2">Nothing called “{query.trim()}” on the menu.</p>
          )}
        </div>

        {!readOnly &&
          slipWrap(
            <aside
              id="order-slip"
              aria-label="Order slip"
              className={`scroll-mt-24 lg:sticky lg:top-24 flex flex-col gap-4 bg-surface p-5 pb-9 [box-shadow:inset_0_0_0_1px_var(--line)] ${TORN} ${showTracker ? 'order-first lg:order-none' : ''}`}
            >
              {showTracker ? (
                <>
                  <Tracker
                    order={current}
                    mess={mess}
                    onCancel={() => cancel.mutate(current.id)}
                    cancelling={cancel.isPending}
                    onChat={() => setChatOpen(true)}
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
                  <div className="flex flex-col gap-0.5 border-b border-dashed border-ink2/40 pb-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="m-0 text-[13px] font-semibold uppercase tracking-[0.14em] text-ink">
                        Order slip
                      </h3>
                      <span className="text-[13px] text-ink2">
                        {count ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
                      </span>
                    </div>
                    <p className="m-0 font-display text-[19px] font-bold text-ink">{mess.name}</p>
                    <p className="m-0 text-[12.5px] text-ink2">{slipTime()}</p>
                  </div>
                  {lines.length ? (
                    <ul className="m-0 p-0 list-none flex flex-col gap-2 text-[14px] tabular-nums">
                      {lines.map((l) => (
                        <li key={l.key} className="flex items-center justify-between gap-3">
                          <span className="min-w-0 flex-1 text-ink">
                            {l.label}
                            <span className="block text-[12.5px] text-ink2">{rupees(l.price)} each</span>
                          </span>
                          {/* Change the amount right in the cart, like food apps. */}
                          <span className="shrink-0 inline-flex items-center rounded-lg border-[1.5px] border-teal text-teal-text">
                            <button
                              type="button"
                              aria-label={`Remove one ${l.label} from the cart`}
                              onClick={() => setQty(l.key, l.qty - 1)}
                              className="grid place-items-center w-9 h-9 border-0 bg-transparent text-current cursor-pointer"
                            >
                              <Minus size={15} />
                            </button>
                            <span
                              className="min-w-[18px] text-center font-bold"
                              aria-label={`${l.qty} in cart`}
                            >
                              {l.qty}
                            </span>
                            <button
                              type="button"
                              aria-label={`Add one more ${l.label} to the cart`}
                              disabled={l.tiffin || l.qty >= 20}
                              onClick={() => setQty(l.key, l.qty + 1)}
                              className="grid place-items-center w-9 h-9 border-0 bg-transparent text-current cursor-pointer disabled:opacity-40"
                            >
                              <Plus size={15} />
                            </button>
                          </span>
                          <span className="shrink-0 w-[64px] text-right font-semibold text-ink">
                            {rupees(l.qty * l.price)}
                          </span>
                        </li>
                      ))}
                      {discount > 0 && deal.offer && (
                        <li className="flex items-center justify-between gap-3 text-teal-text">
                          <span className="min-w-0">
                            🏷️ {deal.offer.kind === 'code' ? `Code ${deal.offer.code}` : deal.offer.title}
                          </span>
                          <span className="shrink-0 font-semibold">−{rupees(discount)}</span>
                        </li>
                      )}
                      <li className="mt-1 flex justify-between gap-3 border-t border-dashed border-ink2/40 pt-2 text-[19px] font-bold text-ink">
                        <span>Total</span>
                        <span>{rupees(payable)}</span>
                      </li>
                      {hasCodes && !lines.some((l) => l.tiffin) && (
                        <li className="list-none pt-1">
                          {promo && !withCode.codeProblem ? (
                            <span className="inline-flex items-center gap-2 text-[13.5px] text-ink">
                              Code <strong className="tracking-[0.08em]">{promo}</strong> applied
                              <button
                                type="button"
                                onClick={() => {
                                  setPromo('');
                                  setPromoDraft('');
                                }}
                                className="border-0 bg-transparent p-0 text-[13px] font-semibold text-ink2 underline underline-offset-2 cursor-pointer"
                              >
                                Remove
                              </button>
                            </span>
                          ) : (
                            <form
                              className="flex gap-2"
                              onSubmit={(e) => {
                                e.preventDefault();
                                setPromo(promoDraft.trim().toUpperCase());
                              }}
                            >
                              <input
                                value={promoDraft}
                                onChange={(e) =>
                                  setPromoDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                                }
                                maxLength={15}
                                placeholder="Promo code"
                                aria-label="Promo code"
                                className={`${field} h-10 flex-1 uppercase tracking-[0.08em]`}
                              />
                              <Button type="submit" variant="outline" size="sm" disabled={!promoDraft.trim()}>
                                Apply
                              </Button>
                            </form>
                          )}
                          {promo && withCode.codeProblem && (
                            <p role="alert" className="m-0 mt-1 text-[13px] text-blush-text">
                              {withCode.codeProblem}
                            </p>
                          )}
                        </li>
                      )}
                    </ul>
                  ) : (
                    <p className="m-0 text-[14px] text-ink2">Tap Add on a dish to start your order.</p>
                  )}

                  {tiffinLine && (
                    <fieldset className="m-0 p-0 border-0 flex flex-col gap-2.5 rounded-xl bg-marigold-soft/60 p-3.5">
                      <legend className="sr-only">Tiffin plan</legend>
                      <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.1em] text-marigold-text">
                        Tiffin plan · {TIFFIN_DAYS} days
                      </p>
                      <div role="radiogroup" aria-label="Meals" className="grid grid-cols-3 gap-1.5">
                        {TIFFIN_PLANS.map((k) => (
                          <button
                            key={k}
                            type="button"
                            role="radio"
                            aria-checked={plan === k}
                            onClick={() => setPlan(k)}
                            className={`h-10 rounded-lg text-[13.5px] font-semibold border-[1.5px] ${plan === k ? 'bg-ink text-bg border-ink' : 'border-line bg-surface text-ink'}`}
                          >
                            {TIFFIN_PLAN_TEXT[k]}
                          </button>
                        ))}
                      </div>
                      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
                        First day
                        <input
                          type="date"
                          className={field}
                          value={startsOn}
                          min={todayIso}
                          max={lastStart}
                          onChange={(e) => e.target.value && setStartsOn(e.target.value)}
                        />
                      </label>
                      <p className="m-0 text-[12.5px] text-ink2">
                        Runs {startsOn} to {tiffinEnds(startsOn)}. It starts once the restaurant accepts it.
                      </p>
                    </fieldset>
                  )}

                  {!signedIn ? (
                    <div className="flex flex-col gap-2">
                      <Button
                        variant="brand"
                        size="lg"
                        className="w-full"
                        disabled={!count}
                        onClick={() => {
                          setCartOpen(false);
                          askToSignIn({
                            title: 'Sign in to place your order',
                            body: 'Your order slip stays just as it is. Sign in with your college email and you come straight back to it, so the restaurant knows the order is real.',
                            next: `/tools/mess-menu?mess=${encodeURIComponent(mess.slug)}#order-slip`,
                          });
                        }}
                      >
                        {count ? `Place order · ${rupees(payable)}` : 'Add a dish to order'}
                      </Button>
                      <p className="m-0 text-[12.5px] leading-relaxed text-ink2">
                        Ordering needs you signed in, so you can track it and chat with the restaurant here.
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
                        ).map(([k, label]) => (
                          <button
                            key={k}
                            type="button"
                            role="radio"
                            aria-checked={details.mode === k}
                            onClick={() => set({ mode: k })}
                            className={`h-10 text-[14px] font-semibold ${details.mode === k ? 'bg-ink text-bg' : 'text-ink'}`}
                          >
                            {label}
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
                      {!phoneStatus.data ? (
                        <p className="m-0 text-[13px] text-ink2">Loading your number…</p>
                      ) : otp ? (
                        <PhoneCheck
                          status={phoneStatus.data}
                          draft={details.phone}
                          onDraft={(v) => set({ phone: v })}
                          tried={tried}
                        />
                      ) : (
                        <>
                          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
                            Mobile number (for the restaurant to reach you)
                            <span className="flex items-center gap-2">
                              <span className="text-[15px] font-semibold text-ink">+91</span>
                              <input
                                className={`${field} flex-1`}
                                value={details.phone}
                                inputMode="tel"
                                autoComplete="tel-national"
                                maxLength={20}
                                onChange={(e) => {
                                  set({ phone: tidyMobile(e.target.value) });
                                  setConfirmed(false);
                                }}
                                placeholder="98765 43210"
                                aria-invalid={tried && !phone}
                                aria-describedby="mobile-hint"
                              />
                            </span>
                            {hint && (
                              <span
                                id="mobile-hint"
                                className={`text-[12.5px] font-normal ${hint.ok ? 'text-teal-text' : 'text-ink2'}`}
                              >
                                {hint.ok ? `✓ ${hint.text}` : hint.text}
                              </span>
                            )}
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
                                <strong className="tabular-nums">{formatMobile(phone)}</strong> is my number,
                                and the restaurant may call it about this order.
                              </span>
                            </label>
                          )}
                        </>
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
                      <StandingNote standing={standing.data} />
                      {payFirst && (
                        <p className="m-0 rounded-xl bg-marigold-soft px-3 py-2.5 text-[13.5px] leading-snug text-marigold-text">
                          <strong>Pay first by UPI.</strong> After you confirm, pay {rupees(payable)} straight
                          to {mess.name} from any UPI app. They make it once the money arrives.
                        </p>
                      )}
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
                      <Button
                        type="submit"
                        variant="brand"
                        size="lg"
                        disabled={place.isPending}
                        className="w-full"
                      >
                        {place.isPending
                          ? 'Sending…'
                          : count
                            ? `${payFirst ? 'Confirm and pay' : 'Confirm order'} · ${rupees(payable)}`
                            : 'Confirm order'}
                      </Button>
                      <p className="m-0 text-[12.5px] leading-relaxed text-ink2">
                        It goes straight to the restaurant's order screen and rings there. Track it and chat
                        with them here. Your name, number and address go only to the restaurant.
                      </p>
                    </form>
                  )}
                </>
              )}
            </aside>,
          )}
      </div>

      {!readOnly && (
        <CartBar
          hidden={cartOpen}
          onOpen={isPhone ? () => setCartOpen(true) : undefined}
          count={count}
          total={payable}
          order={showTracker || (current && OPEN_MESS_ORDER.includes(current.status)) ? current : undefined}
        />
      )}
      {chatOpen && current && <OrderChat orderId={current.id} onClose={() => setChatOpen(false)} />}
    </section>
  );
}
