import type { MessOrderDto, MessOrderStatus, OwnedMessDto } from '@ss/contracts';
import { formatMobile } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { nativePush } from '../../lib/native-push';
import { Skeleton } from '../../shared/ui/feedback';
import { Bowl, ChatBubble, Phone } from '../../shared/ui/icons';
import { useAccountAlerts } from '../chat/alerts';
import { useLive, usePushWhileOpen } from '../chat/live';
import { OrderChat } from '../chat/order-chat';
import { trustText } from '../orders/pay-first';
import { rupees } from '../restaurant/shared';
import { type TextKey, useT } from './i18n';
import { bigButton } from './partner-app';

/** Two rising notes and a buzz: the new-order bell (needs one tap on the page first). */
function bell() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320, 880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.2;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.start(t);
      o.stop(t + 0.4);
    });
    navigator.vibrate?.([200, 80, 200, 80, 200]);
  } catch {
    // no sound available: the card still shows
  }
}

const REASONS: TextKey[] = ['reasonSoldOut', 'reasonBusy', 'reasonClosed', 'reasonFar'];
/** Armed once per app start (tab switches and the PIN lock keep it). */
let bellArmed = false;

export function PartnerOrders({ mess }: { mess: OwnedMessDto }) {
  const { t } = useT();
  const qc = useQueryClient();
  const live = useLive(mess.topic, () => qc.invalidateQueries({ queryKey: ['partner-orders', mess.slug] }));
  usePushWhileOpen(() => qc.invalidateQueries({ queryKey: ['partner-orders', mess.slug] }));
  const q = useQuery({
    queryKey: ['partner-orders', mess.slug],
    queryFn: () => api.ownerOrders(mess.slug),
    // Live updates when available; otherwise ask every few seconds.
    refetchInterval: live ? 30_000 : 5_000,
  });
  const [chat, setChat] = useState<string | null>(null);
  // Phones only let a page make sound after a tap: the first tap anywhere arms the bell, once
  // per app start. In the app with notifications on, Android rings by itself, so no banner.
  const [armed, setArmed] = useState(bellArmed);
  const alerts = useAccountAlerts();
  useEffect(() => {
    if (armed) return;
    const arm = () => {
      bellArmed = true;
      setArmed(true);
    };
    document.addEventListener('pointerdown', arm, { once: true });
    return () => document.removeEventListener('pointerdown', arm);
  }, [armed]);
  const appRings = nativePush() && alerts.checked && alerts.on;

  // Ring for every order that wasn't there a moment ago.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!q.data) return;
    const placed = q.data.filter((o) => o.status === 'placed').map((o) => o.id);
    if (seen.current && placed.some((id) => !seen.current!.has(id))) bell();
    seen.current = new Set(placed);
  }, [q.data]);
  // Keep ringing every minute while an order waits (like the website's dashboard).
  const waiting = q.data?.some((o) => o.status === 'placed') ?? false;
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(bell, 60_000);
    return () => window.clearInterval(id);
  }, [waiting]);

  if (q.isLoading)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-44 rounded-3xl" />
        <Skeleton className="h-44 rounded-3xl" />
      </div>
    );
  const orders = q.data ?? [];
  const groups: { title: TextKey; status: MessOrderStatus }[] = [
    { title: 'newOrders', status: 'placed' },
    { title: 'inKitchen', status: 'accepted' },
    { title: 'readyList', status: 'ready' },
  ];
  const open = orders.filter((o) => ['placed', 'accepted', 'ready'].includes(o.status));

  return (
    <div className="flex flex-col gap-6">
      {!armed && !appRings && (
        <button
          type="button"
          onClick={() => {
            bellArmed = true;
            setArmed(true);
            bell();
          }}
          className="rounded-2xl bg-marigold-soft text-marigold-text px-4 py-3 text-[16px] font-bold text-left"
        >
          🔔 {t('tapToHear')}
        </button>
      )}
      {open.length === 0 && (
        <div className="flex flex-col items-center text-center gap-4 pt-10 pb-6 px-4">
          <span className="relative grid place-items-center size-24 rounded-full bg-brand/[0.07] text-brand dark:bg-white/10 dark:text-mist">
            <span className="absolute inset-0 rounded-full ring-1 ring-brand/10 dark:ring-white/10 scale-125" />
            <Bowl size={40} />
          </span>
          <p className="m-0 font-display font-bold text-[24px] leading-tight tracking-[-0.02em]">
            {t('noOrdersTitle')}
          </p>
          <p className="m-0 max-w-[300px] text-[16px] leading-relaxed text-ink2">{t('noOrders')}</p>
        </div>
      )}
      {groups.map((g) => {
        const list = orders.filter((o) => o.status === g.status);
        if (!list.length) return null;
        return (
          <section key={g.status} className="flex flex-col gap-3">
            <h2 className="m-0 text-[15px] font-extrabold uppercase tracking-[0.08em] text-ink2">
              {t(g.title)} · {list.length}
            </h2>
            {list.map((o) => (
              <OrderCard key={o.id} order={o} slug={mess.slug} onChat={() => setChat(o.id)} />
            ))}
          </section>
        );
      })}
      {chat && <OrderChat orderId={chat} asOwner onClose={() => setChat(null)} />}
    </div>
  );
}

function OrderCard({ order: o, slug, onChat }: { order: MessOrderDto; slug: string; onChat: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const m = useMutation({
    mutationFn: ({ status, note }: { status: MessOrderStatus; note?: string }) =>
      api.ownerSetOrder(o.id, status, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-orders', slug] });
      qc.invalidateQueries({ queryKey: ['owned-messes'] });
    },
  });
  const done = () => {
    qc.invalidateQueries({ queryKey: ['partner-orders', slug] });
  };
  const paid = useMutation({ mutationFn: () => api.ownerConfirmPaid(o.id), onSuccess: done });
  const missed = useMutation({ mutationFn: () => api.ownerNoShow(o.id), onSuccess: done });
  const [askMissed, setAskMissed] = useState(false);
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(o.createdAt)) / 60_000));
  const isNew = o.status === 'placed';
  const waitingPay = isNew && (o.payment === 'due' || o.payment === 'claimed');
  const trust = trustText(o.trust, {
    fresh: t('newCustomer'),
    orders: t('pastOrders'),
    missed: t('notCollected'),
  });
  const err = m.error ?? paid.error ?? missed.error;
  return (
    <article
      className={`rounded-3xl bg-surface p-5 flex flex-col gap-4 shadow-[0_18px_34px_-26px_var(--shadow),0_0_0_1px_var(--line)] ${isNew ? 'ring-2 ring-marigold' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-mono text-[14px] text-ink2">
            #{o.code} · {mins === 0 ? t('justNow') : `${mins} ${t('minsAgo')}`}
          </p>
          <p className="m-0 text-[20px] font-extrabold leading-tight [overflow-wrap:anywhere]">{o.name}</p>
          <p className="m-0 text-[15px] font-semibold text-ink2">
            {o.mode === 'delivery' ? `${t('delivery')} · ${o.address}` : t('pickup')}
          </p>
          <p className="m-0 font-mono text-[15px] text-ink2">{formatMobile(o.phone)}</p>
          {trust && (
            <p
              className={`m-0 text-[15px] ${trust.bad ? 'font-bold text-blush-text' : 'font-semibold text-ink2'}`}
            >
              {trust.text}
            </p>
          )}
        </div>
        <p className="m-0 flex-none font-display font-extrabold text-[26px] tabular-nums">
          {rupees(o.total)}
        </p>
      </div>
      <ul className="m-0 p-0 list-none flex flex-col gap-1.5 border-y border-dashed border-line py-3">
        {o.lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines have no id and never reorder
          <li key={i} className="flex justify-between gap-3 text-[18px]">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-extrabold">{l.qty} ×</span> {l.name}
              {l.detail && <span className="text-ink2"> · {l.detail}</span>}
            </span>
          </li>
        ))}
        {o.note && <li className="text-[16px] text-marigold-text font-semibold">“{o.note}”</li>}
      </ul>
      {isNew && o.payment === 'due' && (
        <p className="m-0 rounded-2xl bg-sunk px-4 py-3 text-[17px] font-bold">{t('payDue')}</p>
      )}
      {isNew && o.payment === 'claimed' && (
        <div className="flex flex-col gap-2.5 rounded-2xl bg-marigold-soft px-4 py-3 text-marigold-text">
          <p className="m-0 text-[17px] font-bold">{t('payClaimed')}</p>
          <p className="m-0 text-[14px]">{t('payNoScreenshot')}</p>
          <button
            type="button"
            disabled={paid.isPending}
            onClick={() => paid.mutate()}
            className={bigButton('accept')}
          >
            ✓ {t('payReceived')}
          </button>
        </div>
      )}
      {o.payment === 'paid' && <p className="m-0 text-[16px] font-bold text-teal-text">{t('paidDone')}</p>}
      {isNew && !rejecting && (
        <>
          <div className="grid grid-cols-[1.4fr_1fr] gap-3">
            <button
              type="button"
              disabled={m.isPending || waitingPay}
              onClick={() => m.mutate({ status: 'accepted' })}
              className={`${bigButton('accept')} disabled:opacity-40`}
            >
              ✓ {t('accept')}
            </button>
            <button
              type="button"
              disabled={m.isPending}
              onClick={() => setRejecting(true)}
              className={bigButton('reject')}
            >
              {t('reject')}
            </button>
          </div>
          {!waitingPay && <p className="m-0 -mt-1 text-[13px] text-ink2">{t('autoCancel')}</p>}
        </>
      )}
      {rejecting && (
        <div className="flex flex-col gap-2.5">
          <p className="m-0 text-[17px] font-bold">{t('rejectWhy')}</p>
          {(o.payment === 'paid' || o.payment === 'claimed') && (
            <p className="m-0 text-[15px] font-bold text-blush-text">{t('refundPaid')}</p>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                disabled={m.isPending}
                onClick={() => m.mutate({ status: 'rejected', note: t(r) })}
                className={`${bigButton('outline')} text-[16px] min-h-12`}
              >
                {t(r)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRejecting(false)}
            className={`${bigButton('ghost')} min-h-11 text-[16px]`}
          >
            {t('cancel')}
          </button>
        </div>
      )}
      {o.status === 'accepted' && (
        <button
          type="button"
          disabled={m.isPending}
          onClick={() => m.mutate({ status: 'ready' })}
          className={bigButton('brand')}
        >
          {t('markReady')}
        </button>
      )}
      {o.status === 'ready' && (
        <button
          type="button"
          disabled={m.isPending}
          onClick={() => m.mutate({ status: 'done' })}
          className={bigButton('accept')}
        >
          ✓ {t('markDone')}
        </button>
      )}
      {(o.status === 'accepted' || o.status === 'ready') && !o.tiffin && !askMissed && (
        <button
          type="button"
          onClick={() => setAskMissed(true)}
          className={`${bigButton('ghost')} min-h-11 text-[16px]`}
        >
          {t('noShow')}
        </button>
      )}
      {askMissed && (
        <div className="flex flex-col gap-2.5 rounded-2xl bg-sunk px-4 py-3">
          <p className="m-0 text-[16px] font-semibold">{t('noShowSure')}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={missed.isPending}
              onClick={() => missed.mutate()}
              className={`${bigButton('reject')} min-h-12 text-[16px]`}
            >
              {t('noShowYes')}
            </button>
            <button
              type="button"
              onClick={() => setAskMissed(false)}
              className={`${bigButton('outline')} min-h-12 text-[16px]`}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
      {err && (
        <p role="alert" className="m-0 text-[15px] font-semibold text-blush-text">
          {(err as Error).message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <a href={`tel:+91${o.phone}`} className={`${bigButton('outline')} min-h-12 text-[16px] no-underline`}>
          <Phone size={18} /> {t('call')}
        </a>
        <button
          type="button"
          onClick={onChat}
          className={`${bigButton('outline')} min-h-12 text-[16px] relative`}
        >
          <ChatBubble size={18} /> {t('chat')}
          {o.unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-6 h-6 px-1.5 rounded-full bg-blush-text text-white text-[12px] grid place-items-center">
              {o.unread}
            </span>
          )}
        </button>
      </div>
    </article>
  );
}
