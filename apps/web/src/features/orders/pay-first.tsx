import {
  MESS_ORDER_STATUS_TEXT,
  type MessOrderDto,
  NO_SHOW,
  type OrderStandingDto,
  PAY_FIRST_WINDOW_MS,
  upiPayLink,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { rupees } from '../restaurant/shared';

/** An order's status in words, with "Not collected" for one the restaurant marked as a no-show. */
export const orderStatusText = (o: Pick<MessOrderDto, 'status' | 'noShow' | 'payment'>) =>
  o.noShow
    ? 'Not collected'
    : o.status === 'placed' && o.payment === 'due'
      ? 'Waiting for your UPI payment'
      : MESS_ORDER_STATUS_TEXT[o.status];

/** The student's no-show standing (for the cart and their orders). */
export function useOrderStanding(enabled = true) {
  return useQuery<OrderStandingDto>({
    queryKey: ['order-standing'],
    queryFn: api.orderStanding,
    enabled,
    staleTime: 60_000,
  });
}

/** One line under the cart: what no-shows mean now (nothing when there are none). */
export function StandingNote({ standing }: { standing: OrderStandingDto | undefined }) {
  if (!standing?.noShows) return null;
  const paused = standing.pausedUntil
    ? new Date(standing.pausedUntil).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        timeZone: 'Asia/Kolkata',
      })
    : '';
  return (
    <p className="m-0 rounded-xl bg-blush/40 px-3 py-2.5 text-[13.5px] text-blush-text" role="note">
      {paused
        ? `You didn't collect ${standing.noShows} orders, so ordering is paused until ${paused}.`
        : standing.payFirst
          ? `You didn't collect ${standing.noShows} orders, so you pay first by UPI for now.`
          : `You didn't collect 1 order. After ${NO_SHOW.payFirstAt} you'll have to pay first.`}
    </p>
  );
}

const isPhone = () =>
  typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent ?? '');

/**
 * A pay-first order: pay the restaurant straight by UPI (any UPI app), then say so. The restaurant
 * checks its own UPI app and accepts; the money never passes through Scholars Stack.
 */
export function PayFirstBox({ order }: { order: MessOrderDto }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const claim = useMutation({
    mutationFn: () => api.claimMessOrderPaid(order.id),
    onSuccess: (o) => {
      qc.setQueryData<MessOrderDto[]>(['my-mess-orders'], (list) =>
        list?.map((x) => (x.id === o.id ? o : x)),
      );
      void qc.invalidateQueries({ queryKey: ['my-mess-orders'] });
    },
  });
  if (!order.payment || order.status !== 'placed') {
    return order.payment === 'paid' ? (
      <p className="m-0 text-[13.5px] font-semibold text-teal-text">Paid by UPI ✓</p>
    ) : null;
  }
  if (order.payment === 'paid')
    return (
      <p className="m-0 rounded-xl bg-teal/10 px-3 py-2.5 text-[14px] text-teal-text">
        <strong>Payment received ✓</strong> The restaurant will accept your order now.
      </p>
    );
  if (order.payment === 'claimed')
    return (
      <p className="m-0 rounded-xl bg-sunk px-3 py-2.5 text-[14px] text-ink">
        <strong>Checking your payment.</strong> The restaurant is looking at their UPI app. To cancel now,
        call them so they can return your money.
      </p>
    );
  const left = Math.max(
    1,
    Math.ceil((PAY_FIRST_WINDOW_MS - (Date.now() - Date.parse(order.createdAt))) / 60_000),
  );
  const link = upiPayLink(order.upiId, order.messName, order.total, `Order ${order.code}`);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(order.upiId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the ID is on screen to type.
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-xl border-[1.5px] border-marigold bg-marigold-soft px-3.5 py-3.5">
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[16px] font-bold text-ink">Pay {rupees(order.total)} first</p>
        <p className="m-0 text-[13.5px] leading-snug text-ink2">
          {order.messName} makes this order once your payment arrives. You pay them straight by UPI, with no
          extra charge. Not paid in {left} min, it cancels by itself.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isPhone() && (
          <a
            href={link}
            className="inline-flex items-center h-11 px-5 rounded-full bg-ink text-bg text-[15px] font-bold no-underline"
          >
            Pay {rupees(order.total)} by UPI
          </a>
        )}
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-2 h-11 px-4 rounded-full border-[1.5px] border-line bg-surface text-[14px] font-semibold text-ink cursor-pointer"
          aria-label={`Copy UPI ID ${order.upiId}`}
        >
          <span className="font-mono">{order.upiId}</span>
          <span className="text-ink2">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => claim.mutate()}
          disabled={claim.isPending}
          className="self-start inline-flex items-center h-11 px-5 rounded-full border-0 bg-teal text-white text-[15px] font-bold cursor-pointer disabled:opacity-60"
        >
          {claim.isPending ? 'Telling the restaurant…' : "I've paid"}
        </button>
        <p className="m-0 text-[12.5px] text-ink2">
          Tap it only after the payment went through. The restaurant checks it in their UPI app.
        </p>
        {claim.isError && (
          <p className="m-0 text-[13px] text-blush-text" role="alert">
            {friendly(claim.error)}
          </p>
        )}
      </div>
    </div>
  );
}

/** For the owner: this student's record across restaurants ("New customer", "12 orders · 1 not collected"). */
export function trustText(
  trust: MessOrderDto['trust'],
  words = { fresh: 'New customer', orders: 'orders', missed: 'not collected' },
) {
  if (!trust) return null;
  if (!trust.orders && !trust.noShows) return { text: words.fresh, bad: false };
  return {
    text: `${trust.orders} ${words.orders}${trust.noShows ? ` · ${trust.noShows} ${words.missed}` : ''}`,
    bad: trust.noShows > 0,
  };
}
