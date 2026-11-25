import {
  type AdminRestaurantStatsDto,
  MESS_ORDER_STATUS_TEXT,
  type MessOrderStatus,
  formatMobile,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { OrderChat } from '../chat/order-chat';
import { rupees } from '../restaurant/shared';
import { DeviceReceipts, PhoneReset } from './push-test';
import { Panel, StatusPill, plural } from './ui';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

const STEPS: [MessOrderStatus, string][] = [
  ['placed', 'Waiting'],
  ['accepted', 'Making'],
  ['ready', 'Ready'],
  ['done', 'Delivered'],
  ['rejected', 'Declined'],
  ['cancelled', 'Cancelled'],
];

/** One restaurant's health: is anyone hearing its orders, how fast it answers, what went wrong. */
function RestaurantCard({ r }: { r: AdminRestaurantStatsDto }) {
  const [sentAt, setSentAt] = useState(0);
  const test = useMutation({
    mutationFn: () => api.adminTestAlert(r.slug),
    onSuccess: () => setSentAt(Date.now() - 1_000),
  });
  const weekTotal = Object.values(r.week).reduce((a, b) => a + b, 0);
  return (
    <article className="flex flex-col gap-3 border-t-2 border-ink pt-3">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="m-0 text-[18px] font-bold text-ink">{r.name}</h3>
        <span className={`text-[13px] font-semibold ${r.ordersOpen ? 'text-teal-text' : 'text-ink2'}`}>
          {r.ordersOpen ? 'Taking orders' : 'Not taking orders'}
        </span>
      </header>
      <p className="m-0 text-[13.5px] text-ink2">
        Owners: {r.ownerEmails.length ? r.ownerEmails.join(', ') : 'none set (add them in Mess menus)'}
      </p>
      <dl className="m-0 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Owner devices with alerts', r.ownerDevices, r.ownerDevices === 0],
          ['Usually answers in', r.reply.minutes ? `${r.reply.minutes} min` : '—', false],
          ['Timed out (7 days)', r.autoCancelledWeek, r.autoCancelledWeek > 0],
          ['Open reports', r.openReports, r.openReports > 0],
        ].map(([label, v, bad]) => (
          <div
            key={String(label)}
            className={`rounded-2xl p-3 flex flex-col gap-1 ${bad ? 'bg-blush' : 'bg-sunk'}`}
          >
            <dt className="text-[12.5px] text-ink2">{label}</dt>
            <dd
              className={`m-0 font-display font-extrabold text-[24px] leading-none tabular-nums ${bad ? 'text-blush-text' : ''}`}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <table className="w-full max-w-[720px] text-[14px] tabular-nums border-collapse">
        <thead>
          <tr className="text-left text-[12px] uppercase tracking-[0.08em] text-ink2">
            <th className="py-1 font-semibold" />
            {STEPS.map(([, label]) => (
              <th key={label} className="py-1 font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['Today', r.today],
              ['7 days', r.week],
            ] as const
          ).map(([label, counts]) => (
            <tr key={label} className="border-t border-line">
              <th className="py-1.5 pr-3 text-left font-semibold text-ink">{label}</th>
              {STEPS.map(([s]) => (
                <td key={s} className="py-1.5">
                  {counts[s]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="m-0 text-[13px] text-ink2">
        {plural(weekTotal, 'order')} this week · {plural(r.reply.samples, 'answer')} measured ·{' '}
        {plural(r.blocks, 'student')} blocked
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
          {test.isPending ? 'Sending…' : 'Send a test alert to the owner'}
        </Button>
        {test.data && (
          <span role="status" className="text-[13.5px] text-ink">
            {test.data.devices === 0
              ? 'No owner device has alerts on. Ask the owner to open My restaurant and tap "Turn on alerts".'
              : `Delivered to ${test.data.sent} of ${plural(test.data.devices, 'device')}.`}
          </span>
        )}
        {test.error && <span className="text-[13.5px] text-blush-text">{friendly(test.error)}</span>}
      </div>
      {sentAt > 0 && r.ownerEmails.length > 0 && (
        <DeviceReceipts emails={r.ownerEmails} sentAt={sentAt} results={{}} />
      )}
    </article>
  );
}

function Workflow() {
  const q = useQuery({
    queryKey: ['admin-orders-overview'],
    queryFn: api.adminOrdersOverview,
    refetchInterval: 30_000,
  });
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError || !q.data)
    return (
      <ErrorState title="Couldn't load orders" message={friendly(q.error)} onRetry={() => q.refetch()} />
    );
  const d = q.data;
  return (
    <div className="flex flex-col gap-6">
      <ul className="m-0 p-0 list-none flex flex-col gap-1 text-[14px]">
        <li className={d.pushConfigured ? 'text-teal-text' : 'text-blush-text'}>
          {d.pushConfigured
            ? '✓ Push notifications are set up (VAPID keys on the server).'
            : '✗ Push notifications are not set up: owners and students get no notifications.'}
        </li>
        <li className={d.liveConfigured ? 'text-teal-text' : 'text-ink2'}>
          {d.liveConfigured
            ? '✓ Live updates on (Supabase Realtime): open chats and boards update instantly.'
            : 'Live updates off: pages check every few seconds instead.'}
        </li>
        <li className="text-ink2">
          New orders alert every owner device, repeat each minute on the open dashboard, alert again at 3
          minutes (and the student is told and offered Call), and cancel at 10 minutes.
        </li>
      </ul>
      {!d.restaurants.length ? (
        <p className="m-0 text-ink2">No restaurants yet.</p>
      ) : (
        d.restaurants.map((r) => <RestaurantCard key={r.slug} r={r} />)
      )}
    </div>
  );
}

function OrdersList({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const clearAll = useMutation({
    mutationFn: () => api.adminClearAllChats(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      void qc.invalidateQueries({ queryKey: ['chat'] });
    },
  });
  const q = useQuery({
    queryKey: ['admin-orders'],
    queryFn: () => api.adminOrders(),
    refetchInterval: 30_000,
  });
  const needle = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter(
    (o) =>
      !needle || [o.code, o.email, o.phone, o.name, o.messName].some((v) => v.toLowerCase().includes(needle)),
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="m-0 flex-1 min-w-[260px] text-[14px] text-ink2">
          You see every chat in full, even ones a student or owner cleared for themselves. They only ever see
          their own.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={clearAll.isPending}
          onClick={() => {
            if (
              window.confirm(
                'Delete every message in every order chat, for students and owners? This cannot be undone.',
              )
            )
              clearAll.mutate();
          }}
        >
          {clearAll.isPending ? 'Clearing…' : 'Clear all chats'}
        </Button>
        {clearAll.data && (
          <span role="status" className="text-[13.5px] text-teal-text font-semibold">
            Cleared {plural(clearAll.data.cleared, 'chat')}.
          </span>
        )}
        {clearAll.error && <span className="text-[13.5px] text-blush-text">{friendly(clearAll.error)}</span>}
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by code, email, phone, name or restaurant"
        aria-label="Search orders"
        className="h-10 max-w-[440px] rounded-lg border-[1.5px] border-line bg-surface px-3 text-[14px] outline-none focus:border-teal"
      />
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState title="Couldn't load orders" message={friendly(q.error)} onRetry={() => q.refetch()} />
      ) : !rows.length ? (
        <p className="m-0 text-ink2">No orders in the last 14 days{needle ? ' match' : ''}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[14px] border-collapse">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-[0.08em] text-ink2">
                {['Order', 'Restaurant', 'Student', 'Status', 'Owner alert', 'Chat', ''].map((h) => (
                  <th key={h} className="py-2 pr-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-t border-line align-top">
                  <td className="py-2 pr-3">
                    <strong className="font-mono">{o.code}</strong>
                    <span className="block text-[12.5px] text-ink2">{when(o.createdAt)}</span>
                    <span className="block text-[12.5px] text-ink2 tabular-nums">{rupees(o.total)}</span>
                  </td>
                  <td className="py-2 pr-3">{o.messName}</td>
                  <td className="py-2 pr-3">
                    {o.name}
                    <span className="block text-[12.5px] text-ink2">{o.email}</span>
                    <a href={`tel:+91${o.phone}`} className="block text-[12.5px] text-ink2 tabular-nums">
                      {formatMobile(o.phone)}
                    </a>
                  </td>
                  <td className="py-2 pr-3">
                    {MESS_ORDER_STATUS_TEXT[o.status]}
                    {o.endedBy === 'auto' && (
                      <span className="block text-[12.5px] text-blush-text">Timed out</span>
                    )}
                    {o.respondedAt && (
                      <span className="block text-[12.5px] text-ink2">
                        Answered in{' '}
                        {Math.max(
                          1,
                          Math.round((Date.parse(o.respondedAt) - Date.parse(o.createdAt)) / 60_000),
                        )}{' '}
                        min
                      </span>
                    )}
                  </td>
                  <td
                    className={`py-2 pr-3 text-[13px] ${/No owner|not set up/.test(o.alertNote) ? 'text-blush-text' : 'text-ink2'}`}
                  >
                    {o.alertNote || '—'}
                  </td>
                  <td className="py-2 pr-3 text-[13px] text-ink2 max-w-[220px]">
                    {o.last ? <span className="line-clamp-2">{o.last.body}</span> : '—'}
                    {o.reports > 0 && (
                      <span className="block text-blush-text font-semibold">
                        {plural(o.reports, 'report')}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <Button size="sm" variant="outline" onClick={() => onOpen(o.id)}>
                      Open chat
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Reports({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [show, setShow] = useState<'new' | 'all'>('new');
  const q = useQuery({ queryKey: ['admin-chat-reports'], queryFn: api.adminChatReports });
  const mark = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api.adminSetChatReport(id, done ? 'done' : 'new'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-chat-reports'] });
      void qc.invalidateQueries({ queryKey: ['admin-orders-overview'] });
    },
  });
  const rows = (q.data ?? []).filter((r) => show === 'all' || r.status === 'new');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1">
        {(['new', 'all'] as const).map((k) => (
          <Button key={k} size="sm" variant={show === k ? 'ink' : 'ghost'} onClick={() => setShow(k)}>
            {k === 'new' ? `New (${(q.data ?? []).filter((r) => r.status === 'new').length})` : 'All'}
          </Button>
        ))}
      </div>
      {q.isLoading ? (
        <Skeleton className="h-32" />
      ) : q.isError ? (
        <ErrorState title="Couldn't load reports" message={friendly(q.error)} onRetry={() => q.refetch()} />
      ) : !rows.length ? (
        <p className="m-0 text-ink2">{show === 'new' ? 'No new reports.' : 'No reports yet.'}</p>
      ) : (
        <ul className="m-0 p-0 list-none divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="py-3 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink2">
                <strong className="text-ink text-[15px]">
                  {r.messName} · {r.orderCode}
                </strong>
                <span>Reported by the {r.by === 'owner' ? 'restaurant' : 'student'}</span>
                <span>{when(r.createdAt)}</span>
                <StatusPill status={r.status === 'new' ? 'new' : 'archived'} />
              </div>
              <p className="m-0 text-[15px] text-ink whitespace-pre-wrap">{r.reason}</p>
              <p className="m-0 text-[13px] text-ink2">
                Student: {r.studentEmail} · {formatMobile(r.studentPhone)}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => onOpen(r.orderId)}>
                  Read the chat
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={mark.isPending}
                  onClick={() => mark.mutate({ id: r.id, done: r.status === 'new' })}
                >
                  {r.status === 'new' ? 'Mark handled' : 'Mark as new'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Blocks() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-blocks'], queryFn: api.adminBlocks });
  const unblock = useMutation({
    mutationFn: ({ slug, userId }: { slug: string; userId: string }) => api.adminUnblock(slug, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-blocks'] }),
  });
  if (q.isLoading) return <Skeleton className="h-24" />;
  if (q.isError)
    return (
      <ErrorState title="Couldn't load blocks" message={friendly(q.error)} onRetry={() => q.refetch()} />
    );
  if (!q.data?.length) return <p className="m-0 text-ink2">No restaurant has blocked anyone.</p>;
  return (
    <ul className="m-0 p-0 list-none divide-y divide-line">
      {q.data.map((b) => (
        <li key={`${b.messSlug}:${b.userId}`} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex-1 min-w-[240px] text-[14px]">
            <p className="m-0 font-semibold text-ink">
              {b.name || 'Student'} · {b.email} · {formatMobile(b.phone)}
            </p>
            <p className="m-0 text-[13px] text-ink2">
              Blocked by {b.messName} on {when(b.createdAt)}
              {b.reason ? ` · “${b.reason}”` : ''}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={unblock.isPending}
            onClick={() => unblock.mutate({ slug: b.messSlug, userId: b.userId })}
          >
            Unblock
          </Button>
        </li>
      ))}
    </ul>
  );
}

type Tab = 'workflow' | 'orders' | 'reports' | 'blocks';

/**
 * Admin › Campus › Orders & chats: how the whole ordering workflow is doing per restaurant (do the
 * owners hear new orders, how fast they answer, what timed out), every order with the student's
 * email and number, every chat in full (even ones a side cleared), reports, and blocks.
 */
export function OrdersAdminPanel() {
  const [tab, setTab] = useState<Tab>('workflow');
  const [chat, setChat] = useState<string | null>(null);
  return (
    <Panel
      title="Orders & chats"
      aside={
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['workflow', 'Workflow'],
              ['orders', 'Orders'],
              ['reports', 'Reports'],
              ['blocks', 'Blocked'],
            ] as const
          ).map(([k, label]) => (
            <Button key={k} size="sm" variant={tab === k ? 'ink' : 'ghost'} onClick={() => setTab(k)}>
              {label}
            </Button>
          ))}
        </div>
      }
    >
      {tab === 'workflow' && <Workflow />}
      {tab === 'orders' && <OrdersList onOpen={setChat} />}
      {tab === 'reports' && <Reports onOpen={setChat} />}
      {tab === 'blocks' && (
        <div className="flex flex-col gap-8">
          <Blocks />
          <PhoneReset />
        </div>
      )}
      {chat && <OrderChat orderId={chat} admin onClose={() => setChat(null)} />}
    </Panel>
  );
}
