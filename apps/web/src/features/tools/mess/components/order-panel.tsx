import {
  MEAL_NAMES,
  MESS_ORDER_STATUS_TEXT,
  type MessDto,
  type MessOrderDto,
  OPEN_MESS_ORDER,
  ORDER_TIMERS,
  dishesOn,
  formatClock,
  formatMobile,
  normaliseMobile,
  toMinutes,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { signal, track } from '../../../../lib/analytics';
import { ApiError, api } from '../../../../lib/api';
import { useSession } from '../../../../lib/session';
import { Button } from '../../../../shared/ui/button';
import { Minus, Plus, WhatsAppIcon } from '../../../../shared/ui/icons';
import { useLive } from '../../../chat/live';
import { ChatButton, OrderChat } from '../../../chat/order-chat';
import { WA_BUTTON, orderMessage, rupees, waLink } from '../../../restaurant/shared';
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
  photo: string;
  available: boolean;
}

interface Details {
  name: string;
  mode: 'delivery' | 'pickup';
  address: string;
  phone: string;
  note: string;
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

/** Which thali to offer: the meal on now, else the next one today, else tomorrow's first. */
function thaliFor(mess: MessDto, today: string, tomorrow: string, nowMinutes: number) {
  const meal = mess.meals.find((m) => mealState(m, nowMinutes) !== 'over');
  if (meal) return { meal, date: today, when: meal.key === 'dinner' ? 'Tonight' : 'Today' };
  const first = mess.meals[0];
  return first ? { meal: first, date: tomorrow, when: 'Tomorrow' } : null;
}

function Stepper({
  label,
  qty,
  onChange,
  disabled,
}: { label: string; qty: number; onChange: (q: number) => void; disabled?: boolean }) {
  if (!qty)
    return (
      <button
        type="button"
        onClick={() => onChange(1)}
        disabled={disabled}
        aria-label={`Add ${label}`}
        className="inline-flex items-center gap-1 h-9 shrink-0 rounded-full border-[1.5px] border-ink/80 px-3.5 text-[14px] font-bold text-ink hover:bg-ink hover:text-bg transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink"
      >
        <Plus size={15} /> Add
      </button>
    );
  return (
    <span className="inline-flex items-center shrink-0 h-9 rounded-full bg-ink text-bg">
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        aria-label={`One less ${label}`}
        className="grid place-items-center w-9 h-9 rounded-full"
      >
        <Minus size={14} />
      </button>
      <span aria-live="polite" className="w-5 text-center text-[15px] font-bold tabular-nums">
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(20, qty + 1))}
        aria-label={`One more ${label}`}
        className="grid place-items-center w-9 h-9 rounded-full"
      >
        <Plus size={14} />
      </button>
    </span>
  );
}

/** A dish's photo, or (without one) its first letter on a warm tint, so the card still looks set. */
function Picture({ src, name, className }: { src: string; name: string; className: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`relative overflow-hidden bg-marigold-soft grid place-items-center ${className}`}>
      {src && !broken ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <span aria-hidden="true" className="font-display text-[34px] font-extrabold text-marigold-text/70">
          {name.trim().charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/** One dish as a card: photo, name, note, price and Add. Sold-out dishes stay visible, greyed. */
function DishCard({
  item,
  photo,
  qty,
  onChange,
}: { item: Item; photo: string; qty: number; onChange: (q: number) => void }) {
  return (
    <li
      className={`flex gap-3.5 rounded-2xl bg-surface p-2.5 pr-3.5 [box-shadow:inset_0_0_0_1px_var(--line)] ${qty ? '[box-shadow:inset_0_0_0_2px_var(--ink)]' : ''} ${item.available ? '' : 'opacity-60'}`}
    >
      <Picture src={photo} name={item.label} className="w-[92px] h-[92px] shrink-0 rounded-xl" />
      <div className="flex-1 min-w-0 flex flex-col justify-between gap-1.5 py-0.5">
        <div className="min-w-0">
          <p className="m-0 text-[16px] font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
            {item.label}
          </p>
          {(item.detail || item.note) && (
            <p className="m-0 mt-0.5 text-[13px] leading-snug text-ink2 line-clamp-2">
              {item.detail || item.note}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[17px] font-bold tabular-nums text-ink">{rupees(item.price)}</span>
          {item.available ? (
            <Stepper label={item.label} qty={qty} onChange={onChange} />
          ) : (
            <span className="text-[13px] font-semibold uppercase tracking-[0.1em] text-blush-text">
              Sold out
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

const STEPS = ['placed', 'accepted', 'ready', 'done'] as const;
const STEP_LABEL = { placed: 'Sent', accepted: 'Accepted', ready: 'Ready', done: 'Delivered' };

/** A placed order: its code, where it's got to, and the WhatsApp button to send the slip. */
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
  // A tick every 15 s, so the 3-minute WhatsApp nudge appears on time.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (order.status !== 'placed') return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [order.status]);
  const waited = now - Date.parse(order.createdAt);
  const [nudged, setNudged] = useState(false);
  const nudge = `Hi, I placed order ${order.code} on Scholars Stack ${Math.floor(waited / 60_000)} minutes ago and it's still waiting. Please open your orders: ${window.location.origin}/orders`;
  const at = STEPS.indexOf(order.status as (typeof STEPS)[number]);
  const message = orderMessage({
    restaurant: mess.name,
    code: order.code,
    lines: order.lines.map((l) => ({
      qty: l.qty,
      label: l.detail ? l.detail.split(':')[0]! : l.name,
      price: l.price,
    })),
    total: order.total,
    mode: order.mode,
    address: order.address,
    name: order.name,
    phone: order.phone,
    note: order.note,
  });
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

      <div className="flex flex-wrap gap-2">
        <ChatButton unread={order.unread} onClick={onChat} label="Chat with restaurant" />
        {mess.phone && (
          <a
            href={`tel:${mess.phone.replace(/[^\d+]/g, '')}`}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-full border-[1.5px] border-line text-[14px] font-semibold text-ink no-underline hover:border-ink2"
          >
            📞 Call
          </a>
        )}
      </div>
      {order.status === 'placed' && waited >= ORDER_TIMERS.nudgeAfterMs && mess.phone && !nudged && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-marigold-soft px-3 py-2.5">
          <p className="m-0 text-[14px] text-marigold-text">
            <strong>Not answered yet.</strong> Send the restaurant one WhatsApp nudge with a link to their
            orders. Unanswered orders cancel by themselves at 10 minutes.
          </p>
          <a
            href={waLink(mess.phone, nudge)}
            target="_blank"
            rel="noreferrer"
            onClick={() => setNudged(true)}
            className={`${WA_BUTTON} h-10 px-4 text-[14px] self-start`}
          >
            <WhatsAppIcon size={17} /> Nudge on WhatsApp
          </a>
        </div>
      )}

      {!stopped && mess.phone && (
        <div className="flex flex-col gap-1.5">
          <a
            href={waLink(mess.phone, message)}
            target="_blank"
            rel="noreferrer"
            className={`${WA_BUTTON} h-12 text-[16px]`}
          >
            <WhatsAppIcon size={20} /> Send order on WhatsApp
          </a>
          <p className="m-0 text-[12.5px] text-ink2">
            Opens WhatsApp with your order slip typed in. Press send so they see it straight away.
          </p>
        </div>
      )}
      {order.status === 'placed' && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="self-start text-[14px] font-semibold text-blush-text underline underline-offset-4"
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

/**
 * Ordering from a restaurant for day scholars: today's thali first, then the owner's menu card
 * with photos. The order slip collects delivery or pickup, a name and a mobile number. When the
 * restaurant takes orders on the site (and the student is signed in) "Confirm order" lands on the
 * owner's screen; either way the one WhatsApp button sends the whole slip to the restaurant.
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
  /** A WhatsApp-only order just sent: the slip shows "sent" with a way to send it again. */
  const [sentByWa, setSentByWa] = useState<string | null>(null);

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
    };
    return {
      item,
      start: at.meal.start,
      serving: at.date === today && mealState(at.meal, nowMinutes) === 'now',
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
  const lines = all.filter((i) => cart[i.key] && i.available).map((i) => ({ ...i, qty: cart[i.key]! }));
  const total = lines.reduce((n, l) => n + l.qty * l.price, 0);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const setQty = (key: string, qty: number) => {
    setSentByWa(null);
    setCart((c) => {
      const next = { ...c };
      if (qty > 0) next[key] = qty;
      else delete next[key];
      return next;
    });
  };
  const set = (p: Partial<Details>) => setDetails((d) => ({ ...details, ...d, ...p }));
  const photo = (i: Item) => api.messPhotoUrl(mess.slug, i.photo);

  const open = mess.ordersOpen;
  const onSite = open && signedIn;
  const phone = normaliseMobile(details.phone);
  const problem = !lines.length
    ? 'Add something first.'
    : details.mode === 'delivery' && details.address.trim().length < 3
      ? 'Add where to deliver it.'
      : details.name.trim().length < 2
        ? 'Add your name.'
        : !phone
          ? 'Add a 10-digit mobile number.'
          : onSite && !confirmed
            ? 'Tick to confirm your number.'
            : null;
  // A student pressed Confirm and was told something's missing: counted as stuck on a form.
  useEffect(() => {
    if (tried && problem) signal('stuck_form');
  }, [tried, problem]);

  const slip = (code?: string) =>
    orderMessage({
      restaurant: mess.name,
      code,
      lines: lines.map((l) => ({ qty: l.qty, label: l.label, price: l.price })),
      total,
      mode: details.mode,
      address: details.address.trim(),
      name: details.name.trim(),
      phone: phone ?? details.phone,
      note: details.note.trim(),
    });

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
  const [chatOpen, setChatOpen] = useState(false);
  useLive(current?.topic, () => void qc.invalidateQueries({ queryKey: ['my-mess-orders'] }));
  const reply = useQuery({
    queryKey: ['reply-time', mess.slug],
    queryFn: () => api.replyTime(mess.slug),
    enabled: mess.ordersOpen,
    staleTime: 600_000,
  });

  /** WhatsApp-only: open the chat with the slip typed in. */
  const sendOnWhatsApp = () => {
    const message = slip();
    window.open(waLink(mess.phone, message), '_blank', 'noopener');
    track('mess_order_placed', { items: count, total, via: 'whatsapp' });
    setSentByWa(message);
    setTried(false);
  };

  if (!mess.phone && !mess.order.length) return null;
  const showTracker = !!current && !count;

  return (
    <section
      id="order"
      aria-labelledby="order-h"
      className="scroll-mt-24 flex flex-col gap-6 border-t-2 border-ink pt-6"
    >
      <header className="flex flex-col gap-1.5">
        <h2
          id="order-h"
          className="m-0 font-display text-[clamp(28px,4vw,38px)] leading-none font-extrabold tracking-[-0.03em] text-ink"
        >
          Order
        </h2>
        <p className="m-0 text-[15px] text-ink2">
          {[
            mess.orderNote,
            'Pay when it arrives',
            reply.data?.minutes ? `Usually replies in ${reply.data.minutes} min` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
        <div className="flex flex-col gap-8 min-w-0">
          {sections.length > 1 && (
            <nav
              aria-label="Menu sections"
              className="sticky top-0 z-10 flex gap-2 overflow-x-auto -mx-1 px-1 py-2 bg-bg/95 backdrop-blur"
            >
              {sections.map((s) => (
                <a
                  key={s.title}
                  href={`#menu-${encodeURIComponent(s.title)}`}
                  className="flex-none h-9 inline-flex items-center rounded-full border border-line px-3.5 text-[14px] font-semibold text-ink no-underline hover:border-ink2"
                >
                  {s.title}
                </a>
              ))}
            </nav>
          )}

          {thali && (
            <div className="flex flex-col gap-2.5">
              <h3 className="m-0 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-marigold-text">
                {thali.serving && (
                  <span aria-hidden="true" className="w-2 h-2 rounded-full bg-marigold animate-pulse" />
                )}
                {thali.serving ? 'Serving now' : `From ${formatClock(toMinutes(thali.start))}`}
              </h3>
              <ul className="m-0 p-0 list-none">
                <DishCard
                  item={thali.item}
                  photo={photo(thali.item)}
                  qty={cart[thali.item.key] ?? 0}
                  onChange={(q) => setQty(thali.item.key, q)}
                />
              </ul>
            </div>
          )}
          {sections.map((s) => (
            <div
              key={s.title}
              id={`menu-${encodeURIComponent(s.title)}`}
              className="flex flex-col gap-3 scroll-mt-24"
            >
              <h3 className="m-0 font-display italic text-[22px] font-semibold text-ink">{s.title}</h3>
              <ul className="m-0 p-0 list-none grid gap-3 xl:grid-cols-2">
                {s.items.map((it) => (
                  <DishCard
                    key={it.key}
                    item={it}
                    photo={photo(it)}
                    qty={cart[it.key] ?? 0}
                    onChange={(q) => setQty(it.key, q)}
                  />
                ))}
              </ul>
            </div>
          ))}
          {!mess.order.length && (
            <div className="flex flex-col gap-3 items-start">
              <p className="m-0 text-[15px] text-ink2">The menu card isn't in yet. Message them to order.</p>
              {mess.phone && (
                <a
                  href={waLink(mess.phone)}
                  target="_blank"
                  rel="noreferrer"
                  className={`${WA_BUTTON} h-11 px-5 text-[15px]`}
                >
                  <WhatsAppIcon size={19} /> WhatsApp {mess.name}
                </a>
              )}
            </div>
          )}
        </div>

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
          ) : sentByWa ? (
            <div className="flex flex-col gap-3" aria-live="polite">
              <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-teal-text">
                Order slip ready
              </p>
              <p className="m-0 font-display text-[26px] leading-tight font-extrabold text-ink">
                Press send in WhatsApp
              </p>
              <p className="m-0 text-[14px] leading-relaxed text-ink2">
                Your order is typed into the chat with {mess.name}. It's ordered once you press send there;
                they'll reply on WhatsApp.
              </p>
              <a
                href={waLink(mess.phone, sentByWa)}
                target="_blank"
                rel="noreferrer"
                className={`${WA_BUTTON} h-12 text-[16px]`}
              >
                <WhatsAppIcon size={20} /> Open WhatsApp again
              </a>
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => {
                  setSentByWa(null);
                  setCart({});
                }}
              >
                Start a new order
              </Button>
            </div>
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
                      <span className="min-w-0 text-ink">
                        <strong>{l.qty} ×</strong> {l.label}
                        <span className="block text-[12.5px] text-ink2">{rupees(l.price)} each</span>
                      </span>
                      <span className="shrink-0 font-semibold text-ink">{rupees(l.qty * l.price)}</span>
                    </li>
                  ))}
                  <li className="mt-1 flex justify-between gap-3 border-t border-dashed border-ink2/40 pt-2 text-[19px] font-bold text-ink">
                    <span>Total</span>
                    <span>{rupees(total)}</span>
                  </li>
                </ul>
              ) : (
                <p className="m-0 text-[14px] text-ink2">Tap Add on a dish to start your order.</p>
              )}

              <form
                noValidate
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  setTried(true);
                  if (problem) return;
                  if (onSite) place.mutate();
                  else if (mess.phone) sendOnWhatsApp();
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
                <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
                  Mobile number (for the restaurant to reach you)
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
                {onSite && phone && (
                  <label className="flex items-start gap-2.5 text-[14px] leading-snug text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      className="mt-0.5 w-5 h-5 shrink-0 accent-[var(--teal)]"
                    />
                    <span>
                      <strong className="tabular-nums">{formatMobile(phone)}</strong> is my number, and the
                      restaurant may call or WhatsApp it about this order.
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
                {onSite ? (
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
                        ? `Confirm order · ${rupees(total)}`
                        : 'Confirm order'}
                  </Button>
                ) : mess.phone ? (
                  <button type="submit" className={`${WA_BUTTON} w-full h-14 text-[17px]`}>
                    <WhatsAppIcon size={21} />
                    {count ? `Order on WhatsApp · ${rupees(total)}` : 'Order on WhatsApp'}
                  </button>
                ) : (
                  <p className="m-0 text-[14px] text-ink2">
                    They aren't taking orders on the site right now.
                  </p>
                )}
                <p className="m-0 text-[12.5px] leading-relaxed text-ink2">
                  {onSite
                    ? 'It goes straight to their order screen, and you can send it on WhatsApp next. Your name, number and address go only to the restaurant.'
                    : 'Opens WhatsApp with this slip typed in, to the restaurant only.'}
                  {open && !signedIn && (
                    <>
                      {' '}
                      <Link
                        to="/sign-in?next=%2Ftools%2Fmess-menu%23order"
                        className="font-semibold text-ink underline underline-offset-2"
                      >
                        Sign in
                      </Link>{' '}
                      to also track your order here.
                    </>
                  )}
                </p>
              </form>
            </>
          )}
        </aside>
      </div>

      {count > 0 && !showTracker && !sentByWa && (
        <a
          href="#order-slip"
          className="lg:hidden fixed inset-x-4 bottom-[calc(84px+env(safe-area-inset-bottom))] z-30 flex items-center justify-between rounded-2xl bg-ink px-5 h-14 text-bg no-underline shadow-[0_18px_34px_-18px_rgba(0,0,0,0.6)]"
        >
          <span className="text-[15px] font-semibold">
            {count} item{count === 1 ? '' : 's'} · {rupees(total)}
          </span>
          <span className="text-[15px] font-bold">View slip →</span>
        </a>
      )}
      {chatOpen && current && <OrderChat orderId={current.id} onClose={() => setChatOpen(false)} />}
    </section>
  );
}
