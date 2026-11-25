import { MESS_ORDER_STATUS_TEXT, type MessOrderDto } from '@ss/contracts';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { rupees } from '../../../restaurant/shared';

/** Is the order slip on screen? (Then the bar would only repeat it.) */
function useSlipInView() {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    let io: IntersectionObserver | null = null;
    // The slip appears a moment after the menu loads: look for it until it's there.
    const attach = () => {
      const el = document.getElementById('order-slip');
      if (!el) return false;
      io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting && e.intersectionRatio > 0.25), {
        threshold: [0, 0.25, 0.5],
      });
      io.observe(el);
      return true;
    };
    const t = attach() ? null : window.setInterval(() => attach() && t && window.clearInterval(t), 500);
    return () => {
      if (t) window.clearInterval(t);
      io?.disconnect();
    };
  }, []);
  return inView;
}

/**
 * The cart, always within reach: a bar at the bottom of the screen (above the phone tab bar) on
 * every screen size, whenever something is in the cart or an order is on its way and the slip
 * itself is scrolled out of view. Tapping it brings the slip (or the order's progress) up.
 */
export function CartBar({
  count,
  total,
  order,
  onOpen,
  hidden = false,
}: {
  count: number;
  total: number;
  order?: MessOrderDto;
  /** Phones: open the cart screen (otherwise the bar scrolls to the slip beside the menu). */
  onOpen?: () => void;
  hidden?: boolean;
}) {
  const inView = useSlipInView();
  const show = !hidden && !inView && (!!count || !!order) && typeof document !== 'undefined';
  // While it shows, the page gets room at the bottom so the bar never covers its last lines.
  useEffect(() => {
    if (!show) return;
    document.body.style.paddingBottom = '96px';
    return () => {
      document.body.style.paddingBottom = '';
    };
  }, [show]);
  if (!show) return null;
  const go = () => {
    if (onOpen) return onOpen();
    const el = document.getElementById('order-slip');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Then the first thing to fill in, for keyboards and screen readers.
    window.setTimeout(
      () => el?.querySelector<HTMLElement>('button, input, a')?.focus({ preventScroll: true }),
      450,
    );
  };
  // In a portal: page transitions transform <Page>, which would trap position:fixed inside it.
  return createPortal(
    <div className="fixed inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[440px] bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-6 z-30 print:hidden">
      <button
        type="button"
        onClick={go}
        className={`press w-full flex items-center justify-between gap-3 rounded-2xl px-5 h-14 text-white border-0 cursor-pointer shadow-[0_18px_34px_-18px_rgba(0,0,0,0.6)] ${
          count ? 'bg-teal' : 'bg-ink'
        }`}
      >
        {count ? (
          <>
            <span className="text-[15px] font-semibold tabular-nums">
              🛒 {count} item{count === 1 ? '' : 's'} · {rupees(total)}
            </span>
            <span className="text-[15px] font-bold">{onOpen ? 'View cart →' : 'Go to cart →'}</span>
          </>
        ) : (
          <>
            <span className="min-w-0 truncate text-[15px] font-semibold">
              Order {order!.code} · {MESS_ORDER_STATUS_TEXT[order!.status]}
            </span>
            <span className="shrink-0 text-[15px] font-bold">Track →</span>
          </>
        )}
      </button>
    </div>,
    document.body,
  );
}
