import type { MessDto } from '@ss/contracts';
import type { ReactNode } from 'react';
import { buttonClass } from '../../../../shared/ui/button';
import { KIND_LABEL } from './mess-picker';

/**
 * Who serves it, the owner's prices, and one honest line about how far to trust the menu, with a
 * way to tell us when it's wrong.
 */
export function MessAbout({
  mess,
  onReport,
  picker,
}: {
  mess: MessDto;
  onReport: () => void /** The "Change mess" control, under the name. */;
  picker?: ReactNode;
}) {
  const owner = mess.source === 'owner';
  const restaurant = mess.kind === 'restaurant';
  const hasCard = mess.order.some((s) => s.items.length > 0);
  const canOrder = restaurant && (!!mess.phone || hasCard);
  const cta = !restaurant
    ? ''
    : mess.ordersOpen && hasCard
      ? 'Order now'
      : hasCard
        ? 'Menu & prices'
        : 'Call to order';
  return (
    <div className="flex flex-col gap-3 max-w-[820px]">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display font-extrabold text-[clamp(26px,4vw,34px)] leading-none tracking-[-0.04em]">
          {mess.name}
        </h2>
        <p className="m-0 text-[15px] text-ink2">
          {KIND_LABEL[mess.kind]}
          {mess.place ? ` · ${mess.place}` : ''}
        </p>
      </div>
      {picker}

      {(mess.prices || canOrder) && (
        <p className="m-0 flex flex-wrap items-center gap-x-5 gap-y-2">
          {mess.prices
            .split('·')
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p) => (
              <span key={p} className="text-[17px] font-semibold text-ink">
                {p}
              </span>
            ))}
          {canOrder && (
            <a href="#order" className={buttonClass('brand', 'sm')}>
              {cta}
            </a>
          )}
        </p>
      )}

      <p role="note" className="m-0 border-l-4 border-marigold pl-3 text-[14px] leading-relaxed text-ink2">
        {owner ? (
          <>
            <strong className="text-ink">Menu as given by the owner.</strong> Dishes and prices can change.
          </>
        ) : (
          <>
            <strong className="text-ink">This may not be exactly what's served.</strong> It's typed from the
            notice board; <span className="font-semibold text-marigold-text">dishes marked ?</span> were hard
            to read.
          </>
        )}{' '}
        <button
          type="button"
          onClick={onReport}
          className="font-semibold text-ink underline underline-offset-4 decoration-line hover:decoration-ink"
        >
          Something changed? Tell us
        </button>
      </p>
    </div>
  );
}
