import { type MessOrderDto, type MessOrderStatus, type OwnedMessDto, formatMobile } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { ChatBubble, Phone } from '../../shared/ui/icons';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
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

/** One kitchen ticket: what, for whom, and the next step. */
function Ticket({ order, fresh }: { order: MessOrderDto; fresh: boolean }) {
  const qc = useQueryClient();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const move = useMutation({
    mutationFn: ({ status, note }: { status: MessOrderStatus; note?: string }) =>
      api.ownerSetOrder(order.id, status, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-orders', order.messSlug] }),
  });
  const wa = `https://wa.me/91${order.phone}?text=${encodeURIComponent(`Hi ${order.name}, about your order ${order.code}: `)}`;
  const late = order.status === 'placed' && minsAgo(order.createdAt) >= 5;

  return (
    <article
      aria-label={`Order ${order.code}`}
      className={`flex flex-col gap-3 bg-surface p-4 [box-shadow:inset_0_0_0_1px_var(--line)] ${fresh ? 'animate-[pulse_1.2s_ease-in-out_3]' : ''} ${late ? '[box-shadow:inset_0_0_0_2px_var(--marigold)]' : ''}`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[28px] leading-none font-extrabold tracking-[-0.02em] text-ink">
          {order.code}
        </span>
        <span className="text-[13px] text-ink2 tabular-nums">
          {clock(order.createdAt)} · {minsAgo(order.createdAt)} min
        </span>
      </header>
      <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink">
        {order.mode === 'delivery' ? 'Delivery' : 'Pickup'}
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
      <div className="text-[14px] leading-relaxed text-ink">
        <p className="m-0 font-semibold">{order.name}</p>
        {order.mode === 'delivery' && <p className="m-0">{order.address}</p>}
        <p className="m-0 flex flex-wrap gap-x-4">
          <a
            href={`tel:+91${order.phone}`}
            className="inline-flex items-center gap-1 font-semibold text-ink tabular-nums"
          >
            <Phone size={14} /> {formatMobile(order.phone)}
          </a>
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-ink"
          >
            <ChatBubble size={14} /> WhatsApp
          </a>
        </p>
      </div>

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
              Accept
            </Button>
            <Button variant="outline" disabled={move.isPending} onClick={() => setDeclining(true)}>
              Decline
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
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

function Board({ mess }: { mess: OwnedMessDto }) {
  const qc = useQueryClient();
  const orders = useQuery({
    queryKey: ['owner-orders', mess.slug],
    queryFn: () => api.ownerOrders(mess.slug),
    refetchInterval: 8_000,
    refetchIntervalInBackground: true,
  });
  const setOpen = useMutation({
    mutationFn: (open: boolean) => api.ownerSetOpen(mess.slug, open),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owned-messes'] }),
  });
  const [sound, setSound] = useState(false);

  // New orders: a chime, the tab title, and a short highlight on the ticket.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const placed = orders.data?.filter((o) => o.status === 'placed') ?? [];
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
  useEffect(() => {
    const base = 'Orders · Scholars Stack';
    document.title = placed.length
      ? `(${placed.length}) New order${placed.length === 1 ? '' : 's'} · ${base}`
      : base;
  }, [placed.length]);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const todays = (orders.data ?? []).filter(
    (o) => new Date(o.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === today,
  );
  const counted = todays.filter((o) => o.status !== 'rejected' && o.status !== 'cancelled');
  const finished = (orders.data ?? []).filter((o) => ['done', 'rejected', 'cancelled'].includes(o.status));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-y border-line py-4">
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
              {mess.ordersOpen
                ? 'Students can order on the site.'
                : 'Students see your number to call instead.'}
            </span>
          </span>
        </label>
        <dl className="m-0 flex gap-8">
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">Today</dt>
            <dd className="m-0 text-[22px] font-bold tabular-nums text-ink">
              {counted.length} order{counted.length === 1 ? '' : 's'}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">Takings</dt>
            <dd className="m-0 text-[22px] font-bold tabular-nums text-ink">
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
              if (e.target.checked) chime();
            }}
            className="w-5 h-5 accent-[var(--teal)]"
          />
          Sound on new orders
        </label>
      </div>

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
                  list.map((o) => <Ticket key={o.id} order={o} fresh={fresh.has(o.id)} />)
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
                  {o.name} · {o.lines.reduce((n, l) => n + l.qty, 0)} items
                </span>
                <span className={o.status === 'done' ? 'text-teal-text font-semibold' : 'text-blush-text'}>
                  {o.status === 'done'
                    ? 'Delivered'
                    : o.status === 'rejected'
                      ? `Declined: ${o.ownerNote}`
                      : 'Cancelled by student'}
                </span>
                <span className="font-semibold tabular-nums text-ink">{rupees(o.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** /orders: the restaurant owner's screen. Keep it open on the counter phone or laptop. */
export function OrdersPage() {
  const owned = useQuery({ queryKey: ['owned-messes'], queryFn: api.ownedMesses });
  const [slug, setSlug] = useState<string | null>(null);
  const mess = owned.data?.find((m) => m.slug === slug) ?? owned.data?.[0];

  return (
    <main className="mx-auto max-w-[1280px] px-4 sm:px-9 pb-20 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="m-0 font-mono text-[13px] tracking-[0.14em] text-teal-text">ORDERS</p>
        {owned.data && owned.data.length > 1 ? (
          <select
            value={mess?.slug}
            onChange={(e) => setSlug(e.target.value)}
            aria-label="Restaurant"
            className="self-start bg-transparent font-display text-[clamp(30px,5vw,48px)] font-extrabold tracking-[-0.04em] text-ink outline-none"
          >
            {owned.data.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name}
              </option>
            ))}
          </select>
        ) : (
          <h1 className="m-0 font-display text-[clamp(30px,5vw,48px)] leading-[1.05] font-extrabold tracking-[-0.04em] text-ink">
            {mess?.name ?? 'Orders'}
          </h1>
        )}
        <p className="m-0 text-[15px] text-ink2">Keep this page open. New orders appear within seconds.</p>
      </div>
      {owned.isLoading ? (
        <Skeleton className="h-40" />
      ) : owned.isError ? (
        <ErrorState
          title="Couldn't load your restaurant"
          message={friendly(owned.error)}
          onRetry={() => owned.refetch()}
        />
      ) : !mess ? (
        <p className="m-0 text-[16px] text-ink">
          This account doesn't run a restaurant on Scholars Stack. If you should, ask the site admin to add
          your email to your restaurant.
        </p>
      ) : (
        <Board key={mess.slug} mess={mess} />
      )}
    </main>
  );
}
