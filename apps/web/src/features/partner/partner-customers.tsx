import type { MessOrderStatus, OwnedMessDto } from '@ss/contracts';
import { formatMobile } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { ChatBubble, ChevronLeft, ChevronRight, Phone, SearchIcon } from '../../shared/ui/icons';
import { OrderChat } from '../chat/order-chat';
import { rupees } from '../restaurant/shared';
import { card } from '../student-app/app-ui';
import { type TextKey, useT } from './i18n';
import { bigButton } from './partner-app';

const dateText = (iso: string, lang: 'hi' | 'en') =>
  new Date(iso).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

const STATUS: Record<MessOrderStatus, { key: TextKey; tone: string }> = {
  placed: { key: 'statusPlaced', tone: 'bg-marigold-soft text-marigold-text' },
  accepted: { key: 'statusAccepted', tone: 'bg-mist/50 text-on-mist' },
  ready: { key: 'statusReady', tone: 'bg-mist/50 text-on-mist' },
  done: { key: 'statusDone', tone: 'bg-[#e3f4ea] text-[#14532d] dark:bg-[#123222] dark:text-[#b8f0cc]' },
  rejected: { key: 'statusRejected', tone: 'bg-blush text-blush-text' },
  cancelled: { key: 'statusCancelled', tone: 'bg-sunk text-ink2' },
};

/** Customers: everyone who ordered lately, searchable; tap one for their whole record. */
export function PartnerCustomers({ mess }: { mess: OwnedMessDto }) {
  const [params, setParams] = useSearchParams();
  const who = params.get('who');
  const open = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('who', id);
    else p.delete('who');
    setParams(p);
  };
  return who ? (
    <CustomerRecord mess={mess} userId={who} onBack={() => open(null)} />
  ) : (
    <CustomerList mess={mess} onOpen={open} />
  );
}

function CustomerList({ mess, onOpen }: { mess: OwnedMessDto; onOpen: (id: string) => void }) {
  const { t, lang } = useT();
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['owner-customers', mess.slug],
    queryFn: () => api.ownerCustomers(mess.slug),
  });
  const shown = useMemo(() => {
    const words = q.toLowerCase().trim();
    const all = list.data ?? [];
    if (!words) return all;
    const digits = words.replace(/\D/g, '');
    return all.filter(
      (c) => c.name.toLowerCase().includes(words) || (digits.length >= 3 && c.phone.includes(digits)),
    );
  }, [q, list.data]);

  if (list.isError)
    return <ErrorState title={t('offline')} message={friendly(list.error)} onRetry={() => list.refetch()} />;
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2.5 h-[52px] rounded-2xl bg-card px-4 ring-1 ring-line focus-within:ring-2 focus-within:ring-teal">
        <SearchIcon size={18} className="flex-none text-ink2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchCustomers')}
          aria-label={t('searchCustomers')}
          className="flex-1 min-w-0 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink2/70"
        />
      </label>
      {list.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[72px] rounded-2xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="m-0 py-8 text-center text-[16px] text-ink2">{t('noCustomers')}</p>
      ) : (
        <ul className={`${card} m-0 p-0 list-none overflow-hidden`}>
          {shown.map((c) => (
            <li
              key={c.userId}
              className="relative after:absolute after:left-[72px] after:right-0 after:bottom-0 after:h-px after:bg-line/70 last:after:hidden"
            >
              <button
                type="button"
                onClick={() => onOpen(c.userId)}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left active:bg-sunk"
              >
                <span className="size-11 flex-none rounded-full grid place-items-center bg-brand text-white font-display text-[18px] font-bold">
                  {(c.name || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-[16.5px] font-bold truncate">
                      {c.name || formatMobile(c.phone)}
                    </span>
                    {c.tiffin && (
                      <span className="flex-none rounded-full bg-mist/50 px-2 py-0.5 text-[11px] font-bold text-on-mist">
                        {t('tiffinTag')}
                      </span>
                    )}
                    {c.blocked && (
                      <span className="flex-none rounded-full bg-blush px-2 py-0.5 text-[11px] font-bold text-blush-text">
                        {t('blockedTag')}
                      </span>
                    )}
                  </span>
                  <span className="block text-[13px] text-ink2 truncate">
                    {c.orders} {t('ordersCount')} · {t('lastOrder')} {dateText(c.lastOrderAt, lang)}
                  </span>
                </span>
                <span className="flex-none text-right">
                  <span className="block text-[16px] font-bold tabular-nums">{rupees(c.spent)}</span>
                </span>
                <ChevronRight size={18} className="flex-none text-ink2/70" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 px-1 text-[13px] text-ink2">{t('customersHint')}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl bg-sunk px-3.5 py-3">
      <span className="text-[12.5px] font-semibold text-ink2">{label}</span>
      <span className="font-display text-[22px] font-bold leading-tight tabular-nums">{value}</span>
    </div>
  );
}

function CustomerRecord({
  mess,
  userId,
  onBack,
}: { mess: OwnedMessDto; userId: string; onBack: () => void }) {
  const { t, lang } = useT();
  const [chat, setChat] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['owner-customer', mess.slug, userId],
    queryFn: () => api.ownerCustomer(mess.slug, userId),
  });
  const back = (
    <button
      type="button"
      onClick={onBack}
      className="self-start -ml-2 inline-flex items-center gap-1 h-11 px-2 rounded-xl text-[16px] font-bold text-ink2"
    >
      <ChevronLeft size={20} /> {t('moreCustomers')}
    </button>
  );
  if (q.isLoading)
    return (
      <div className="flex flex-col gap-3">
        {back}
        <Skeleton className="h-28 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="flex flex-col gap-3">
        {back}
        <ErrorState title={t('offline')} message={friendly(q.error)} onRetry={() => q.refetch()} />
      </div>
    );
  const r = q.data;
  const c = r.customer;
  const maxMonth = Math.max(1, ...r.months.map((m) => m.spent));
  const hour = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
  return (
    <div className="flex flex-col gap-6">
      {back}
      <section className={`${card} p-5 flex flex-col gap-4`}>
        <div className="flex items-center gap-4">
          <span className="size-14 flex-none rounded-full grid place-items-center bg-brand text-white font-display text-[24px] font-bold">
            {(c.name || '?').slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block font-display text-[24px] font-bold leading-tight tracking-[-0.02em] truncate">
              {c.name}
            </span>
            <span className="block font-mono text-[14px] text-ink2">{formatMobile(c.phone)}</span>
            <span className="block text-[12.5px] text-ink2">{t('record12')}</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <a
            href={`tel:+91${c.phone}`}
            className={`${bigButton('outline')} min-h-12 text-[16px] no-underline`}
          >
            <Phone size={18} /> {t('call')}
          </a>
          <button
            type="button"
            onClick={() => setChat(c.lastOrderId)}
            className={`${bigButton('outline')} min-h-12 text-[16px]`}
          >
            <ChatBubble size={18} /> {t('chat')}
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2.5">
        <Stat label={t('spentTotal')} value={rupees(c.spent)} />
        <Stat label={t('ordersCount')} value={String(c.orders)} />
        <Stat label={t('avgOrder')} value={rupees(r.avgOrder)} />
        <Stat label={t('visits')} value={`${r.visitDays} ${t('days')}`} />
        <Stat label={t('firstOrder')} value={dateText(c.firstOrderAt, lang)} />
        <Stat label={t('lastOrder')} value={dateText(c.lastOrderAt, lang)} />
      </section>

      <section className="flex flex-wrap gap-2 text-[14px]">
        <span className="rounded-full bg-[#e3f4ea] text-[#14532d] dark:bg-[#123222] dark:text-[#b8f0cc] px-3 py-1 font-semibold">
          {t('completedOrders')}: {r.completed}
        </span>
        <span className="rounded-full bg-sunk px-3 py-1 font-semibold text-ink2">
          {t('cancelledByThem')}: {r.cancelledByThem}
        </span>
        <span className="rounded-full bg-sunk px-3 py-1 font-semibold text-ink2">
          {t('declinedByYou')}: {r.declinedByYou}
        </span>
        {(r.noShows ?? 0) + (r.noShowsEverywhere ?? 0) > 0 && (
          <span className="rounded-full bg-blush px-3 py-1 font-semibold text-blush-text">
            {t('notCollectedHere')}: {r.noShows ?? 0} · {t('everywhere')}: {r.noShowsEverywhere ?? 0}
          </span>
        )}
        {r.unanswered > 0 && (
          <span className="rounded-full bg-blush px-3 py-1 font-semibold text-blush-text">
            {t('unanswered')}: {r.unanswered}
          </span>
        )}
        <span className="rounded-full bg-sunk px-3 py-1 font-semibold text-ink2">
          {t('delivery')} {r.modes.delivery} · {t('pickup')} {r.modes.pickup}
        </span>
        {r.usualHour >= 0 && (
          <span className="rounded-full bg-sunk px-3 py-1 font-semibold text-ink2">
            {t('usualTime')} {hour(r.usualHour)}
          </span>
        )}
      </section>

      {r.favourites.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[15px] font-extrabold uppercase tracking-[0.08em] text-ink2">
            {t('favourites')}
          </h3>
          <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
            {r.favourites.map((f) => (
              <li key={f.name} className="rounded-full bg-card ring-1 ring-line px-3.5 py-1.5 text-[15px]">
                <span className="font-semibold">{f.name}</span> <span className="text-ink2">× {f.qty}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.months.length > 1 && (
        <section className="flex flex-col gap-2.5">
          <h3 className="m-0 text-[15px] font-extrabold uppercase tracking-[0.08em] text-ink2">
            {t('monthly')}
          </h3>
          <div className={`${card} p-4 flex items-end gap-2 h-[150px]`}>
            {r.months.map((m) => (
              <div
                key={m.month}
                className="flex-1 min-w-0 flex flex-col items-center gap-1 h-full justify-end"
              >
                <span className="text-[10.5px] text-ink2 tabular-nums">{m.spent ? rupees(m.spent) : ''}</span>
                <span
                  className="w-full max-w-[36px] rounded-t-lg bg-teal"
                  style={{ height: `${Math.max(4, (m.spent / maxMonth) * 90)}px` }}
                />
                <span className="text-[11px] text-ink2">
                  {new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
                    month: 'short',
                    timeZone: 'UTC',
                  })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2.5">
        <h3 className="m-0 text-[15px] font-extrabold uppercase tracking-[0.08em] text-ink2">
          {t('orderHistory')} · {r.history.length}
        </h3>
        <ul className={`${card} m-0 p-0 list-none overflow-hidden`}>
          {r.history.map((h) => (
            <li
              key={h.id}
              className="relative px-4 py-3.5 after:absolute after:left-4 after:right-0 after:bottom-0 after:h-px after:bg-line/70 last:after:hidden"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 font-mono text-[12.5px] text-ink2">
                    #{h.code} · {dateText(h.createdAt, lang)} ·{' '}
                    {h.mode === 'delivery' ? t('delivery') : t('pickup')}
                  </p>
                  <p className="m-0 mt-0.5 text-[15px] leading-snug [overflow-wrap:anywhere]">{h.items}</p>
                  {h.offer && <p className="m-0 text-[12.5px] text-teal-text">{h.offer}</p>}
                </div>
                <div className="flex-none flex flex-col items-end gap-1">
                  <span className="text-[16px] font-bold tabular-nums">{rupees(h.total)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${STATUS[h.status].tone}`}
                  >
                    {t(STATUS[h.status].key)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {chat && <OrderChat orderId={chat} asOwner onClose={() => setChat(null)} />}
    </div>
  );
}
