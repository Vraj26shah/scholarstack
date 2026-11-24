import {
  type MessBlockDto,
  type MessDto,
  type MessOrderDto,
  type MessOrderStatus,
  ORDER_TIMERS,
  type OwnedMessDto,
  type OwnerMessInput,
  TIFFIN_PLAN_TEXT,
  type TiffinRowDto,
  formatMobile,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { Bell, Phone } from '../../shared/ui/icons';
import { useAccountAlerts } from '../chat/alerts';
import { useLive, usePushWhileOpen } from '../chat/live';
import { ChatButton, OrderChat } from '../chat/order-chat';
import { DetailsEditor } from '../restaurant/details-editor';
import { MenuCardEditor, menuCardProblems } from '../restaurant/menu-card-editor';
import { rupees } from '../restaurant/shared';
import { WeekChartEditor } from '../restaurant/week-chart-editor';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const minsAgo = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));

/** A short two-note chime, made in the browser (no file to load). Needs one tap on the page first. */
function chime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.start(t);
      o.stop(t + 0.4);
    });
    navigator.vibrate?.([120, 60, 120]);
  } catch {
    // no sound in this browser
  }
}

const COLUMNS: { status: MessOrderStatus; title: string; empty: string }[] = [
  { status: 'placed', title: 'New', empty: 'New orders appear here by themselves.' },
  { status: 'accepted', title: 'Making', empty: 'Accepted orders wait here.' },
  { status: 'ready', title: 'Ready', empty: 'Mark an order ready when it leaves the kitchen.' },
];

const DECLINE = ['Sold out', 'Closed now', 'Too far to deliver'];
const ACCEPT = ['Ready in 15 min', 'Ready in 30 min'];

/** One kitchen ticket: what, for whom, the student's number, and the next step. */
function Ticket({ order, fresh, onChat }: { order: MessOrderDto; fresh: boolean; onChat: () => void }) {
  const qc = useQueryClient();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const move = useMutation({
    mutationFn: ({ status, note }: { status: MessOrderStatus; note?: string }) =>
      api.ownerSetOrder(order.id, status, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-orders', order.messSlug] }),
  });
  const late = order.status === 'placed' && minsAgo(order.createdAt) >= 3;
  const cancelsIn = Math.max(
    0,
    Math.ceil((Date.parse(order.createdAt) + ORDER_TIMERS.autoCancelAfterMs - Date.now()) / 60_000),
  );

  return (
    <article
      aria-label={`Order ${order.code}`}
      className={`flex flex-col gap-3 rounded-2xl bg-surface p-4 [box-shadow:inset_0_0_0_1px_var(--line)] ${fresh ? 'animate-[pulse_1.2s_ease-in-out_3]' : ''} ${late ? '[box-shadow:inset_0_0_0_2px_var(--marigold)]' : ''}`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[28px] leading-none font-extrabold tracking-[-0.02em] text-ink">
          {order.code}
        </span>
        <span className="text-[13px] text-ink2 tabular-nums">
          {clock(order.createdAt)} · {minsAgo(order.createdAt)} min
        </span>
      </header>
      {order.tiffin && (
        <p className="m-0 rounded-lg bg-marigold-soft px-3 py-2 text-[13.5px] font-semibold text-marigold-text">
          Tiffin plan · {TIFFIN_PLAN_TEXT[order.tiffin.plan]} · {order.tiffin.startsOn} to{' '}
          {order.tiffin.endsOn}
        </p>
      )}
      <p className="m-0 flex flex-wrap gap-x-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink">
        {order.mode === 'delivery' ? 'Delivery' : 'Pickup'}
        {order.status === 'placed' && (
          <span className={late ? 'text-marigold-text' : 'text-ink2'}>
            Answer within {cancelsIn} min or it cancels
          </span>
        )}
      </p>
      <ul className="m-0 p-0 list-none flex flex-col gap-1 text-[15px] text-ink">
        {order.lines.map((l) => (
          <li key={`${l.name}${l.detail}`} className="flex justify-between gap-3">
            <span className="min-w-0">
              <strong className="tabular-nums">{l.qty} ×</strong> {l.detail ? l.detail.split(':')[0] : l.name}
              {l.detail && (
                <span className="block text-[13px] text-ink2">
                  {l.detail.split(':').slice(1).join(':').trim()}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums text-ink2">{rupees(l.qty * l.price)}</span>
          </li>
        ))}
      </ul>
      {order.note && (
        <p className="m-0 border-l-[3px] border-marigold pl-2 text-[14px] text-ink">“{order.note}”</p>
      )}
      <div className="flex justify-between border-t border-dashed border-ink2/40 pt-2 text-[16px] font-bold text-ink">
        <span>Total</span>
        <span className="tabular-nums">{rupees(order.total)}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-[14px] leading-relaxed text-ink min-w-0">
          <p className="m-0 font-semibold">{order.name}</p>
          {order.mode === 'delivery' && <p className="m-0">{order.address}</p>}
          <a href={`tel:+91${order.phone}`} className="font-semibold text-ink tabular-nums no-underline">
            {formatMobile(order.phone)}
          </a>
        </div>
        <div className="flex items-center gap-3">
          <ChatButton unread={order.unread} onClick={onChat} />
          <a
            href={`tel:+91${order.phone}`}
            aria-label={`Call ${order.name}`}
            className="grid place-items-center w-10 h-10 rounded-full border-[1.5px] border-line text-ink no-underline hover:border-ink2"
          >
            <Phone size={17} />
          </a>
        </div>
      </div>
      {order.last && order.last.sender !== 'system' && (
        <button
          type="button"
          onClick={onChat}
          className="text-left border-0 bg-sunk rounded-lg px-3 py-2 text-[13.5px] text-ink truncate cursor-pointer"
        >
          <strong>{order.last.sender === 'owner' ? 'You' : order.name}:</strong> {order.last.body}
        </button>
      )}

      {move.error && (
        <p role="alert" className="m-0 text-[13px] text-blush-text">
          {friendly(move.error)}
        </p>
      )}
      {order.status === 'placed' && !declining && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={move.isPending}
              onClick={() => move.mutate({ status: 'accepted' })}
            >
              {order.tiffin ? 'Accept tiffin plan' : 'Accept'}
            </Button>
            <Button variant="outline" disabled={move.isPending} onClick={() => setDeclining(true)}>
              Decline
            </Button>
          </div>
          <div className={`flex flex-wrap gap-1.5 ${order.tiffin ? 'hidden' : ''}`}>
            {ACCEPT.map((n) => (
              <button
                key={n}
                type="button"
                disabled={move.isPending}
                onClick={() => move.mutate({ status: 'accepted', note: n })}
                className="h-8 rounded-full border border-line px-3 text-[13px] font-semibold text-ink2 hover:text-ink hover:border-ink2"
              >
                Accept · {n.replace('Ready in ', '')}
              </button>
            ))}
          </div>
        </div>
      )}
      {order.status === 'placed' && declining && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length >= 3) move.mutate({ status: 'rejected', note: reason.trim() });
          }}
        >
          <span className="text-[13px] font-semibold text-ink2">Tell the student why</span>
          <div className="flex flex-wrap gap-1.5">
            {DECLINE.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={reason === r}
                onClick={() => setReason(r)}
                className={`h-8 rounded-full border px-3 text-[13px] font-semibold ${reason === r ? 'border-ink bg-ink text-bg' : 'border-line text-ink2'}`}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={120}
            placeholder="Or type a reason"
            aria-label="Reason"
            className="h-10 rounded-lg border-[1.5px] border-line bg-surface px-3 text-[14px] outline-none focus:border-teal"
          />
          <div className="flex gap-2">
            <Button type="submit" variant="ink" disabled={reason.trim().length < 3 || move.isPending}>
              Decline order
            </Button>
            <Button variant="ghost" onClick={() => setDeclining(false)}>
              Back
            </Button>
          </div>
        </form>
      )}
      {order.status === 'accepted' && (
        <Button
          disabled={move.isPending}
          onClick={() => move.mutate({ status: 'ready', note: order.ownerNote })}
        >
          {order.mode === 'delivery' ? 'Ready · out for delivery' : 'Ready for pickup'}
        </Button>
      )}
      {order.status === 'ready' && (
        <Button
          variant="ink"
          disabled={move.isPending}
          onClick={() => move.mutate({ status: 'done', note: order.ownerNote })}
        >
          {order.mode === 'delivery' ? 'Delivered' : 'Picked up'}
        </Button>
      )}
    </article>
  );
}

/** The live order board: new → making → ready, with today's count and takings. */
/** "Alerts on this phone": push notifications for new orders and messages, even with the page closed. */
function AlertsCard() {
  const a = useAccountAlerts();
  if (!a.configured || a.support === 'unsupported') return null;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3 text-[14.5px] ${a.on ? 'bg-sunk text-ink' : 'bg-marigold-soft text-marigold-text'}`}
    >
      <Bell size={18} />
      <span className="flex-1 min-w-[220px]">
        {a.on ? (
          <>
            <strong>Alerts are on for this device.</strong> New orders and messages reach you even when this
            page is closed.
          </>
        ) : a.support === 'ios-install' ? (
          <>
            <strong>On iPhone:</strong> tap Share › Add to Home Screen, open the site from there, then turn
            alerts on.
          </>
        ) : a.support === 'blocked' ? (
          <>
            <strong>Notifications are blocked</strong> for this site. Allow them in your browser's site
            settings to hear new orders.
          </>
        ) : (
          <>
            <strong>Turn on alerts on this phone</strong> so you never miss an order, even with the page
            closed.
          </>
        )}
      </span>
      {!a.on && a.support === 'ok' && (
        <Button size="sm" variant="ink" disabled={a.busy} onClick={() => void a.enable()}>
          {a.busy ? 'Turning on…' : 'Turn on alerts'}
        </Button>
      )}
      {a.error && <span className="basis-full text-blush-text">{a.error}</span>}
    </div>
  );
}

function Board({
  mess,
  orders,
  onChat,
}: {
  mess: OwnedMessDto;
  orders: ReturnType<typeof useOwnerOrders>;
  onChat: (id: string) => void;
}) {
  const [sound, setSound] = useState(() => localStorage.getItem('ss_owner_sound') === '1');
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!orders.data) return;
    const ids = new Set(orders.data.map((o) => o.id));
    if (seen.current) {
      const added = orders.data
        .filter((o) => o.status === 'placed' && !seen.current!.has(o.id))
        .map((o) => o.id);
      if (added.length) {
        setFresh(new Set(added));
        if (sound) chime();
      }
    }
    seen.current = ids;
  }, [orders.data, sound]);

  // Until every new order is accepted or declined: the alarm again every minute.
  const waiting = (orders.data ?? []).some((o) => o.status === 'placed');
  useEffect(() => {
    if (!sound || !waiting) return;
    const t = setInterval(chime, ORDER_TIMERS.alarmEveryMs);
    return () => clearInterval(t);
  }, [sound, waiting]);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const todays = (orders.data ?? []).filter(
    (o) => new Date(o.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === today,
  );
  const counted = todays.filter((o) => o.status !== 'rejected' && o.status !== 'cancelled');
  const finished = (orders.data ?? []).filter((o) => ['done', 'rejected', 'cancelled'].includes(o.status));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
        <dl className="m-0 flex gap-10">
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">Orders today</dt>
            <dd className="m-0 font-display text-[34px] leading-none font-extrabold tabular-nums text-ink">
              {counted.length}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">Takings today</dt>
            <dd className="m-0 font-display text-[34px] leading-none font-extrabold tabular-nums text-ink">
              {rupees(counted.reduce((n, o) => n + o.total, 0))}
            </dd>
          </div>
        </dl>
        <label className="flex items-center gap-2 text-[14px] text-ink cursor-pointer sm:ml-auto">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              localStorage.setItem('ss_owner_sound', e.target.checked ? '1' : '0');
              if (e.target.checked) chime();
            }}
            className="w-5 h-5 accent-[var(--teal)]"
          />
          Sound on new orders (repeats every minute until answered)
        </label>
      </div>
      <AlertsCard />
      {!mess.ordersOpen && (
        <p className="m-0 rounded-2xl bg-marigold-soft px-4 py-3 text-[15px] text-marigold-text">
          <strong>You're not taking orders on the site.</strong> Students see your menu and prices and can
          call you. Switch on <em>Taking orders</em> above to get orders here, with chat.
        </p>
      )}

      {orders.isLoading ? (
        <Skeleton className="h-64" />
      ) : orders.isError ? (
        <ErrorState
          title="Couldn't load orders"
          message={friendly(orders.error)}
          onRetry={() => orders.refetch()}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3 items-start">
          {COLUMNS.map((col) => {
            const list = (orders.data ?? [])
              .filter((o) => o.status === col.status)
              .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
            return (
              <section
                key={col.status}
                aria-labelledby={`col-${col.status}`}
                className="flex flex-col gap-3 min-w-0"
              >
                <h2
                  id={`col-${col.status}`}
                  className="m-0 flex items-baseline gap-2 border-b-2 border-ink pb-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink"
                >
                  {col.title}
                  <span className="tabular-nums text-ink2">{list.length}</span>
                </h2>
                {list.length ? (
                  list.map((o) => (
                    <Ticket key={o.id} order={o} fresh={fresh.has(o.id)} onChat={() => onChat(o.id)} />
                  ))
                ) : (
                  <p className="m-0 text-[14px] text-ink2">{col.empty}</p>
                )}
              </section>
            );
          })}
        </div>
      )}

      {finished.length > 0 && (
        <section aria-labelledby="done-h" className="flex flex-col gap-2">
          <h2 id="done-h" className="m-0 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink2">
            Earlier today
          </h2>
          <ul className="m-0 p-0 list-none divide-y divide-line">
            {finished.map((o) => (
              <li key={o.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2 text-[14px]">
                <span className="font-bold text-ink w-14">{o.code}</span>
                <span className="text-ink2 tabular-nums">{clock(o.createdAt)}</span>
                <span className="flex-1 min-w-[160px] text-ink">
                  {o.name} · {formatMobile(o.phone)} · {o.lines.reduce((n, l) => n + l.qty, 0)} items
                </span>
                <span className={o.status === 'done' ? 'text-teal-text font-semibold' : 'text-blush-text'}>
                  {o.status === 'done'
                    ? 'Delivered'
                    : o.status === 'rejected'
                      ? `Declined: ${o.ownerNote}`
                      : o.endedBy === 'auto'
                        ? 'Cancelled: not answered in 10 min'
                        : 'Cancelled by student'}
                </span>
                <span className="font-semibold tabular-nums text-ink">{rupees(o.total)}</span>
                <ChatButton unread={o.unread} onClick={() => onChat(o.id)} className="h-8 px-3 text-[13px]" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function useOwnerOrders(slug: string, topic = '') {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['owner-orders', slug] });
    void qc.invalidateQueries({ queryKey: ['owned-messes'] });
  };
  const live = useLive(topic, refresh);
  usePushWhileOpen(refresh);
  return useQuery({
    queryKey: ['owner-orders', slug],
    queryFn: () => api.ownerOrders(slug),
    enabled: !!slug,
    // Live updates arrive at once; the slow check is a safety net (and runs the 3/10-minute timers).
    refetchInterval: live ? 30_000 : 8_000,
    refetchIntervalInBackground: true,
  });
}

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const shiftDay = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** One person on the delivery sheet: where it goes, who, their number, chat. */
function TiffinRow({ r, onChat }: { r: TiffinRowDto; onChat: (id: string) => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
      <div className="flex-1 min-w-[200px]">
        <p className="m-0 text-[15px] font-semibold text-ink">
          {r.mode === 'delivery' ? r.address || 'Delivery' : 'Pickup at the counter'}
        </p>
        <p className="m-0 text-[13.5px] text-ink2">
          {r.name} · <span className="tabular-nums">{formatMobile(r.phone)}</span> ·{' '}
          {TIFFIN_PLAN_TEXT[r.plan]} · till {dayLabel(r.endsOn)}
          {r.note ? ` · “${r.note}”` : ''}
        </p>
      </div>
      <a
        href={`tel:+91${r.phone}`}
        aria-label={`Call ${r.name}`}
        className="grid place-items-center w-9 h-9 rounded-full border-[1.5px] border-line text-ink no-underline hover:border-ink2"
      >
        <Phone size={16} />
      </a>
      <ChatButton unread={r.unread} onClick={() => onChat(r.orderId)} className="h-9 px-3 text-[13px]" />
    </li>
  );
}

/**
 * The tiffin sheet: for any day, who gets lunch and who gets dinner (by address, so a delivery
 * round is easy), plans ending soon, and how many wait to be accepted. Prints cleanly.
 */
function TiffinSheet({ mess, onChat }: { mess: OwnedMessDto; onChat: (id: string) => void }) {
  const [date, setDate] = useState<string | undefined>(undefined);
  const q = useQuery({
    queryKey: ['owner-tiffin', mess.slug, date ?? 'today'],
    queryFn: () => api.ownerTiffin(mess.slug, date),
    refetchInterval: 60_000,
  });
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError || !q.data)
    return (
      <ErrorState
        title="Couldn't load the tiffin sheet"
        message={friendly(q.error)}
        onRetry={() => q.refetch()}
      />
    );
  const s = q.data;
  const list = (title: string, rows: TiffinRowDto[], empty: string) => (
    <section aria-label={title} className="flex flex-col min-w-0">
      <h2 className="m-0 flex items-baseline gap-2 border-b-2 border-ink pb-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">
        {title} <span className="tabular-nums text-ink2">{rows.length}</span>
      </h2>
      {rows.length ? (
        <ul className="m-0 p-0 list-none divide-y divide-line">
          {rows.map((r) => (
            <TiffinRow key={r.orderId} r={r} onChat={onChat} />
          ))}
        </ul>
      ) : (
        <p className="m-0 py-3 text-[14px] text-ink2">{empty}</p>
      )}
    </section>
  );
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-1 print:hidden">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDate(shiftDay(s.date, -1))}
            aria-label="Day before"
          >
            ←
          </Button>
          <input
            type="date"
            value={s.date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Day"
            className="h-10 rounded-lg border-[1.5px] border-line bg-surface px-3 text-[14px] outline-none focus:border-teal"
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDate(shiftDay(s.date, 1))}
            aria-label="Day after"
          >
            →
          </Button>
        </div>
        <p className="m-0 font-display text-[24px] font-bold text-ink">{dayLabel(s.date)}</p>
        <dl className="m-0 flex gap-8 sm:ml-auto">
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">Active plans</dt>
            <dd className="m-0 font-display text-[30px] leading-none font-extrabold tabular-nums">
              {s.active}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">To accept</dt>
            <dd
              className={`m-0 font-display text-[30px] leading-none font-extrabold tabular-nums ${s.waiting ? 'text-marigold-text' : ''}`}
            >
              {s.waiting}
            </dd>
          </div>
        </dl>
        <Button size="sm" variant="outline" className="print:hidden" onClick={() => window.print()}>
          Print the list
        </Button>
      </div>
      {s.waiting > 0 && (
        <p className="m-0 rounded-2xl bg-marigold-soft px-4 py-3 text-[15px] text-marigold-text">
          <strong>
            {s.waiting} new tiffin plan{s.waiting === 1 ? '' : 's'}
          </strong>{' '}
          waiting on the Orders tab. Accept to start {s.waiting === 1 ? 'it' : 'them'}.
        </p>
      )}
      <div className="grid gap-8 lg:grid-cols-2 items-start">
        {list('Lunch', s.lunch, 'No lunch tiffins on this day.')}
        {list('Dinner', s.dinner, 'No dinner tiffins on this day.')}
      </div>
      {s.ending.length > 0 && list('Ending in the next 3 days', s.ending, '')}
      {!s.active && !s.waiting && (
        <p className="m-0 text-[15px] text-ink2 max-w-[640px]">
          No tiffin plans yet. Mark your tiffin dish as <strong>Monthly tiffin plan</strong> in the Menu card;
          students then pick lunch, dinner or both and a first day, and plans you accept show up here every
          day.
        </p>
      )}
    </div>
  );
}

/** Everyone who ordered in the last 90 days: who they are, how often, and a way to reach them. */
function Customers({ mess, onChat }: { mess: OwnedMessDto; onChat: (id: string) => void }) {
  const q = useQuery({
    queryKey: ['owner-customers', mess.slug],
    queryFn: () => api.ownerCustomers(mess.slug),
  });
  const [search, setSearch] = useState('');
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError)
    return (
      <ErrorState
        title="Couldn't load your customers"
        message={friendly(q.error)}
        onRetry={() => q.refetch()}
      />
    );
  const n = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((c) => !n || c.name.toLowerCase().includes(n) || c.phone.includes(n));
  const repeat = (q.data ?? []).filter((c) => c.orders > 1).length;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
        <dl className="m-0 flex gap-10">
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">
              Customers (90 days)
            </dt>
            <dd className="m-0 font-display text-[34px] leading-none font-extrabold tabular-nums">
              {q.data?.length ?? 0}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">Came back</dt>
            <dd className="m-0 font-display text-[34px] leading-none font-extrabold tabular-nums">
              {repeat}
            </dd>
          </div>
        </dl>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or number"
          aria-label="Search customers"
          className="sm:ml-auto h-10 w-full sm:w-[260px] rounded-lg border-[1.5px] border-line bg-surface px-3 text-[14px] outline-none focus:border-teal"
        />
      </div>
      {!rows.length ? (
        <p className="m-0 text-[15px] text-ink2">
          {q.data?.length ? 'Nobody matches.' : 'Customers appear here after their first order.'}
        </p>
      ) : (
        <ul className="m-0 p-0 list-none divide-y divide-line">
          {rows.map((c) => (
            <li key={c.userId} className="flex flex-wrap items-center gap-x-5 gap-y-1.5 py-3.5">
              <div className="flex-1 min-w-[220px]">
                <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[16px] font-semibold text-ink">
                  {c.name || 'Student'}
                  {c.blocked && (
                    <span className="rounded-full bg-blush px-2 py-0.5 text-[11.5px] font-bold uppercase text-blush-text">
                      Blocked
                    </span>
                  )}
                  {c.tiffin && (
                    <span className="rounded-full bg-marigold-soft px-2 py-0.5 text-[11.5px] font-bold text-marigold-text">
                      Tiffin · {TIFFIN_PLAN_TEXT[c.tiffin.plan]} till {dayLabel(c.tiffin.endsOn)}
                    </span>
                  )}
                </p>
                <p className="m-0 text-[13.5px] text-ink2">
                  <span className="tabular-nums">{formatMobile(c.phone)}</span> · {c.orders} order
                  {c.orders === 1 ? '' : 's'} · {rupees(c.spent)} · last {clock(c.lastOrderAt)},{' '}
                  {new Date(c.lastOrderAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </p>
              </div>
              <a
                href={`tel:+91${c.phone}`}
                aria-label={`Call ${c.name}`}
                className="grid place-items-center w-9 h-9 rounded-full border-[1.5px] border-line text-ink no-underline hover:border-ink2"
              >
                <Phone size={16} />
              </a>
              <ChatButton unread={0} onClick={() => onChat(c.lastOrderId)} className="h-9 px-3 text-[13px]" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Students this restaurant blocked, with Unblock. */
function BlockedList({ mess }: { mess: OwnedMessDto }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-blocks', mess.slug], queryFn: () => api.ownerBlocks(mess.slug) });
  const unblock = useMutation({
    mutationFn: (b: MessBlockDto) => api.ownerUnblock(mess.slug, b.userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-blocks', mess.slug] }),
  });
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (q.isError)
    return (
      <ErrorState
        title="Couldn't load blocked students"
        message={friendly(q.error)}
        onRetry={() => q.refetch()}
      />
    );
  return (
    <div className="flex flex-col gap-3 max-w-[760px]">
      <p className="m-0 text-[15px] text-ink2">
        Blocked students can't order from you or message you. Block someone from the ⋮ menu in their order's
        chat.
      </p>
      {!q.data?.length ? (
        <p className="m-0 text-[15px] text-ink">Nobody is blocked.</p>
      ) : (
        <ul className="m-0 p-0 list-none divide-y divide-line">
          {q.data.map((b) => (
            <li key={b.userId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <div className="flex-1 min-w-[200px]">
                <p className="m-0 font-semibold text-ink">
                  {b.name || 'Student'} · {formatMobile(b.phone)}
                </p>
                <p className="m-0 text-[13px] text-ink2">
                  Blocked{' '}
                  {new Date(b.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  {b.reason ? ` · ${b.reason}` : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={unblock.isPending}
                onClick={() => unblock.mutate(b)}
              >
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
      {unblock.error && <p className="m-0 text-[13px] text-blush-text">{friendly(unblock.error)}</p>}
    </div>
  );
}

/** The "Taking orders" switch, in the dashboard's header so it's always in reach. */
function OpenSwitch({ mess }: { mess: OwnedMessDto }) {
  const qc = useQueryClient();
  const setOpen = useMutation({
    mutationFn: (open: boolean) => api.ownerSetOpen(mess.slug, open),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owned-messes'] }),
  });
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        role="switch"
        aria-checked={mess.ordersOpen}
        checked={mess.ordersOpen}
        disabled={setOpen.isPending}
        onChange={(e) => setOpen.mutate(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`relative w-14 h-8 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-teal ${mess.ordersOpen ? 'bg-teal' : 'bg-line'}`}
      >
        <span
          className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-[left] ${mess.ordersOpen ? 'left-7' : 'left-1'}`}
        />
      </span>
      <span className="flex flex-col">
        <span className="text-[16px] font-bold text-ink">
          {mess.ordersOpen ? 'Taking orders' : 'Not taking orders'}
        </span>
        <span className="text-[13px] text-ink2">
          {mess.ordersOpen ? 'Students can order on your page.' : 'Students see your menu and can call you.'}
        </span>
      </span>
    </label>
  );
}

type Tab = 'orders' | 'tiffin' | 'customers' | 'menu' | 'week' | 'details' | 'blocked';
const TABS: [Tab, string][] = [
  ['orders', 'Orders'],
  ['tiffin', 'Tiffin'],
  ['customers', 'Customers'],
  ['menu', 'Menu card'],
  ['week', 'Weekly menu'],
  ['details', 'Details & timings'],
  ['blocked', 'Blocked'],
];

const toForm = (m: MessDto): OwnerMessInput => ({
  name: m.name,
  place: m.place,
  note: m.note,
  prices: m.prices,
  phone: m.phone,
  orderNote: m.orderNote,
  order: m.order,
  meals: m.meals,
  weeks: m.weeks,
  cycleStart: m.cycleStart,
  dailyOrderCap: m.dailyOrderCap ?? 0,
});

/**
 * The owner's editing tabs share one draft: change anything, then "Save changes" once. Saved
 * changes show on the restaurant's page straight away.
 */
function Editors({
  tab,
  mess,
}: { tab: Exclude<Tab, 'orders' | 'blocked' | 'tiffin' | 'customers'>; mess: OwnedMessDto }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-mess', mess.slug], queryFn: () => api.ownerMess(mess.slug) });
  const [draft, setDraft] = useState<OwnerMessInput | null>(null);
  const [saved, setSaved] = useState(false);
  const base = useMemo(() => (q.data ? toForm(q.data) : null), [q.data]);
  const form = draft ?? base;
  const dirty = !!draft && !!base && JSON.stringify(draft) !== JSON.stringify(base);
  const set = (patch: Partial<OwnerMessInput>) => {
    setSaved(false);
    setDraft((d) => ({ ...(d ?? base!), ...patch }));
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const problems = form
    ? [
        ...menuCardProblems(form.order),
        ...(form.name.trim().length < 2 ? ['Give your restaurant a name (Details).'] : []),
        ...(form.meals.some((m) => m.start >= m.end) ? ['A meal ends before it starts (Details).'] : []),
        ...(form.phone && !/^\+?\d[\d ]{6,17}$/.test(form.phone.trim())
          ? ['The phone number should be digits only, e.g. +91 98765 43210 (Details).']
          : []),
      ]
    : [];

  const save = useMutation({
    mutationFn: () => api.ownerSaveMess(mess.slug, { ...form!, phone: form!.phone.trim() }),
    onSuccess: (m) => {
      qc.setQueryData(['owner-mess', mess.slug], m);
      setDraft(null);
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ['mess', mess.slug] });
      void qc.invalidateQueries({ queryKey: ['messes'] });
      void qc.invalidateQueries({ queryKey: ['owned-messes'] });
    },
  });

  if (q.isLoading) return <Skeleton className="h-80" />;
  if (q.isError || !form)
    return (
      <ErrorState title="Couldn't load your menu" message={friendly(q.error)} onRetry={() => q.refetch()} />
    );

  return (
    <div className="flex flex-col gap-6 pb-28">
      {tab === 'menu' && (
        <MenuCardEditor slug={mess.slug} order={form.order} onChange={(order) => set({ order })} />
      )}
      {tab === 'week' && (
        <WeekChartEditor meals={form.meals} weeks={form.weeks} cycleStart={form.cycleStart} onChange={set} />
      )}
      {tab === 'details' && <DetailsEditor form={form} onChange={set} />}

      {(dirty || saved || save.error) && (
        <div
          role="region"
          aria-label="Save"
          className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] md:bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur px-5 sm:px-9 py-3"
        >
          <div className="mx-auto max-w-[1280px] flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="m-0 flex-1 min-w-[200px] text-[14px]" aria-live="polite">
              {save.error ? (
                <span className="text-blush-text">{friendly(save.error)}</span>
              ) : problems.length && dirty ? (
                <span className="text-blush-text">{problems[0]}</span>
              ) : dirty ? (
                <span className="text-ink">
                  <strong>Unsaved changes.</strong> Students see them once you save.
                </span>
              ) : (
                <span className="text-teal-text font-semibold">
                  Saved. Your page shows it now.{' '}
                  <Link
                    to={`/tools/mess-menu?mess=${mess.slug}`}
                    className="text-ink underline underline-offset-2"
                  >
                    See it
                  </Link>
                </span>
              )}
            </p>
            {dirty && (
              <>
                <Button variant="ghost" onClick={() => setDraft(null)} disabled={save.isPending}>
                  Undo changes
                </Button>
                <Button
                  variant="brand"
                  onClick={() => save.mutate()}
                  disabled={save.isPending || problems.length > 0}
                >
                  {save.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * /orders: the restaurant owner's own dashboard. Orders come in live; the menu card (with photos),
 * the weekly menu and the details are edited here and show on their page as soon as they save.
 * Owners only ever see their own restaurant; nothing of the admin's.
 */
export function OrdersPage() {
  const owned = useQuery({ queryKey: ['owned-messes'], queryFn: api.ownedMesses });
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = TABS.some(([k]) => k === tabParam) ? (tabParam as Tab) : 'orders';
  const pickSlug = params.get('mess');
  const mess = owned.data?.find((m) => m.slug === pickSlug) ?? owned.data?.[0];
  const chatId = params.get('chat');
  const go = (next: { tab?: Tab; mess?: string; chat?: string | null }) =>
    setParams(
      {
        ...((next.mess ?? mess?.slug) ? { mess: next.mess ?? mess!.slug } : {}),
        ...((next.tab ?? tab) !== 'orders' ? { tab: next.tab ?? tab } : {}),
        ...((next.chat === undefined ? chatId : next.chat) ? { chat: (next.chat ?? chatId)! } : {}),
      },
      { replace: true },
    );

  const orders = useOwnerOrders(mess?.slug ?? '', mess?.topic);
  const placed = orders.data?.filter((o) => o.status === 'placed').length ?? 0;
  const unread = orders.data?.reduce((n, o) => n + o.unread, 0) ?? 0;
  useEffect(() => {
    const base = `${mess?.name ?? 'My restaurant'} · Scholars Stack`;
    const parts = [placed && `${placed} new`, unread && `${unread} unread`].filter(Boolean);
    document.title = parts.length ? `(${parts.join(', ')}) ${base}` : base;
  }, [placed, unread, mess?.name]);

  return (
    <Page wide>
      <div className="flex flex-col gap-6 pt-2">
        {owned.isLoading ? (
          <Skeleton className="h-40" />
        ) : owned.isError ? (
          <ErrorState
            title="Couldn't load your restaurant"
            message={friendly(owned.error)}
            onRetry={() => owned.refetch()}
          />
        ) : !mess ? (
          <div className="flex flex-col gap-2 max-w-[640px]">
            <h1 className="m-0 font-display text-[40px] font-extrabold tracking-[-0.04em] text-ink">
              My restaurant
            </h1>
            <p className="m-0 text-[16px] text-ink">
              This account doesn't run a restaurant on Scholars Stack. If it should, ask the site admin to add
              this email to your restaurant, then sign in again.
            </p>
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-line pb-5">
              <div className="flex flex-col gap-1 min-w-0">
                <p className="m-0 font-mono text-[13px] tracking-[0.14em] text-teal-text">YOUR RESTAURANT</p>
                {owned.data && owned.data.length > 1 ? (
                  <select
                    value={mess.slug}
                    onChange={(e) => go({ mess: e.target.value })}
                    aria-label="Restaurant"
                    className="self-start max-w-full bg-transparent font-display text-[clamp(30px,5vw,48px)] font-extrabold tracking-[-0.04em] text-ink outline-none"
                  >
                    {owned.data.map((m) => (
                      <option key={m.slug} value={m.slug}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <h1 className="m-0 font-display text-[clamp(30px,5vw,48px)] leading-[1.05] font-extrabold tracking-[-0.04em] text-ink">
                    {mess.name}
                  </h1>
                )}
                <Link
                  to={`/tools/mess-menu?mess=${mess.slug}`}
                  className="self-start text-[15px] font-semibold text-ink2 underline underline-offset-4 decoration-line hover:text-ink"
                >
                  View my page as students see it ↗
                </Link>
              </div>
              <OpenSwitch mess={mess} />
            </header>

            <div
              role="tablist"
              aria-label="Dashboard"
              className="flex gap-1 overflow-x-auto -mx-1 px-1 border-b border-line"
            >
              {TABS.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => go({ tab: k })}
                  className={`flex-none h-11 px-4 text-[15px] font-semibold border-0 border-b-[3px] -mb-px bg-transparent cursor-pointer whitespace-nowrap ${
                    tab === k ? 'border-teal text-ink' : 'border-transparent text-ink2 hover:text-ink'
                  }`}
                >
                  {label}
                  {k === 'orders' && placed > 0 && (
                    <span className="ml-2 rounded-full bg-marigold px-2 py-0.5 text-[12px] text-on-marigold tabular-nums">
                      {placed} new
                    </span>
                  )}
                  {k === 'orders' && unread > 0 && (
                    <span className="ml-1.5 rounded-full bg-[#25d366] px-2 py-0.5 text-[12px] text-white tabular-nums">
                      💬 {unread}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {tab === 'orders' ? (
              <Board key={mess.slug} mess={mess} orders={orders} onChat={(id) => go({ chat: id })} />
            ) : tab === 'blocked' ? (
              <BlockedList key={mess.slug} mess={mess} />
            ) : tab === 'tiffin' ? (
              <TiffinSheet key={mess.slug} mess={mess} onChat={(id) => go({ chat: id })} />
            ) : tab === 'customers' ? (
              <Customers key={mess.slug} mess={mess} onChat={(id) => go({ chat: id })} />
            ) : (
              <Editors key={mess.slug} tab={tab} mess={mess} />
            )}
            {chatId && <OrderChat orderId={chatId} asOwner onClose={() => go({ chat: null })} />}
          </>
        )}
      </div>
    </Page>
  );
}
