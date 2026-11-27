import { type MessOrderDto, OPEN_MESS_ORDER, TIFFIN_PLAN_TEXT } from '@ss/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { useFoodLive } from '../../lib/food-live';
import { Page } from '../../shared/ui/chrome';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { useLive, usePushWhileOpen } from '../chat/live';
import { ChatButton, OrderChat } from '../chat/order-chat';
import { rupees } from '../restaurant/shared';
import { PayFirstBox, orderStatusText } from './pay-first';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

/** Keeps one order's live channel open so its row updates the moment anything changes. */
function LiveRow({ order, onChange }: { order: MessOrderDto; onChange: () => void }) {
  useLive(OPEN_MESS_ORDER.includes(order.status) || order.unread ? order.topic : '', onChange);
  return null;
}

export function useMyOrders() {
  return useQuery({
    queryKey: ['my-mess-orders'],
    queryFn: api.myMessOrders,
    refetchInterval: (q) => (q.state.data?.some((o) => OPEN_MESS_ORDER.includes(o.status)) ? 10_000 : 60_000),
  });
}

/**
 * /my-orders: a student's orders from restaurants, newest first, each with its chat (unread
 * counts like a messaging app). Notifications for replies open the chat here.
 */
export function MyOrdersPage() {
  const qc = useQueryClient();
  const q = useMyOrders();
  const [params, setParams] = useSearchParams();
  const chatId = params.get('chat');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['my-mess-orders'] });
  usePushWhileOpen(refresh);
  const unread = q.data?.reduce((n, o) => n + o.unread, 0) ?? 0;
  const food = useFoodLive();
  useEffect(() => {
    document.title = unread ? `(${unread}) My orders · Scholars Stack` : 'My orders · Scholars Stack';
  }, [unread]);

  return (
    <Page wide>
      <div className="flex flex-col gap-6 pt-2 max-w-[860px]">
        <header className="flex flex-col gap-1 border-b border-line pb-4">
          <h1 className="m-0 font-display text-[clamp(30px,5vw,44px)] font-extrabold tracking-[-0.04em] text-ink">
            My orders
          </h1>
          <p className="m-0 text-[15px] text-ink2">
            Your restaurant orders and your chats with each restaurant.{' '}
            <Link to="/tools/mess-menu" className="text-ink underline underline-offset-2">
              Order food
            </Link>
          </p>
        </header>
        {!food ? (
          <p className="m-0 text-[16px] text-ink">
            Food ordering isn't open yet. It will appear here as soon as restaurants are set up.
          </p>
        ) : q.isLoading ? (
          <Skeleton className="h-48" />
        ) : q.isError ? (
          <ErrorState
            title="Couldn't load your orders"
            message={friendly(q.error)}
            onRetry={() => q.refetch()}
          />
        ) : !q.data?.length ? (
          <p className="m-0 text-[16px] text-ink">
            No orders yet. Pick a restaurant in the{' '}
            <Link to="/tools/mess-menu" className="text-ink underline underline-offset-2">
              Mess menu
            </Link>{' '}
            to order.
          </p>
        ) : (
          <ul className="m-0 p-0 list-none divide-y divide-line">
            {q.data.map((o) => {
              const open = OPEN_MESS_ORDER.includes(o.status);
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4">
                  <LiveRow order={o} onChange={refresh} />
                  <div className="flex-1 min-w-[220px] flex flex-col gap-0.5">
                    <p className="m-0 flex flex-wrap items-baseline gap-x-3 text-ink">
                      <strong className="text-[17px]">{o.messName}</strong>
                      <span className="font-mono text-[14px] text-ink2">{o.code}</span>
                    </p>
                    <p className={`m-0 text-[14px] ${open ? 'text-teal-text font-semibold' : 'text-ink2'}`}>
                      {orderStatusText(o)}
                      {o.ownerNote && !o.noShow ? ` · “${o.ownerNote}”` : ''}
                    </p>
                    {o.tiffin && (
                      <p className="m-0 text-[13.5px] font-semibold text-marigold-text">
                        Tiffin · {TIFFIN_PLAN_TEXT[o.tiffin.plan]} · {o.tiffin.startsOn} to {o.tiffin.endsOn}
                        {o.status === 'done' ? ' · On' : ''}
                      </p>
                    )}
                    <p className="m-0 text-[13.5px] text-ink2">
                      {when(o.createdAt)} · {o.lines.reduce((n, l) => n + l.qty, 0)} items · {rupees(o.total)}
                    </p>
                    {o.last && (
                      <p
                        className={`m-0 truncate text-[14px] ${o.unread ? 'text-ink font-semibold' : 'text-ink2'}`}
                      >
                        {o.last.sender === 'student'
                          ? 'You: '
                          : o.last.sender === 'owner'
                            ? `${o.messName}: `
                            : ''}
                        {o.last.body}
                      </p>
                    )}
                  </div>
                  {o.payment && o.status === 'placed' && (
                    <div className="basis-full">
                      <PayFirstBox order={o} />
                    </div>
                  )}
                  <ChatButton
                    unread={o.unread}
                    onClick={() => setParams({ chat: o.id }, { replace: true })}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {chatId && <OrderChat orderId={chatId} onClose={() => setParams({}, { replace: true })} />}
    </Page>
  );
}
