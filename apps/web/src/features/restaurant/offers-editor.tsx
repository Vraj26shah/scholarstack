import { type MessOffer, type MessOfferKind, type MessOrderSection, offerProblem } from '@ss/contracts';
import { useState } from 'react';
import { Button } from '../../shared/ui/button';
import { rupees } from './shared';

const KIND_TEXT: Record<MessOfferKind, { name: string; what: string }> = {
  code: {
    name: 'Promo code',
    what: 'Students type a code at checkout, e.g. WELCOME20 for 20% off a first order.',
  },
  deal: {
    name: 'Automatic deal',
    what: 'Applied by itself when the order is big enough, e.g. ₹30 off above ₹299.',
  },
  combo: { name: 'Combo', what: 'Dishes together for one price, e.g. paneer + 3 rotis + lassi for ₹199.' },
};

const blank = (kind: MessOfferKind): MessOffer => ({
  id: Math.random().toString(36).slice(2, 10),
  kind,
  title: '',
  active: true,
  code: '',
  percentOff: kind === 'combo' ? 0 : 10,
  flatOff: 0,
  minTotal: 0,
  maxOff: 0,
  firstOrderOnly: false,
  items: [],
  price: 0,
  startsOn: '',
  endsOn: '',
});

const field =
  'h-10 w-full rounded-lg border-[1.5px] border-line bg-surface px-3 text-[14.5px] text-ink outline-none focus:border-teal';
const num = (v: string) => Math.max(0, Math.floor(Number(v.replace(/\D/g, '')) || 0));

/** "20% off, up to ₹60 · first order only · orders of ₹100+". */
export function offerSummary(o: MessOffer): string {
  if (o.kind === 'combo') {
    const full = o.items.map((i) => `${i.qty}× ${i.name}`).join(' + ');
    return `${full || 'Pick the dishes'} for ${rupees(o.price)}`;
  }
  const off = o.flatOff
    ? `${rupees(o.flatOff)} off`
    : `${o.percentOff}% off${o.maxOff ? `, up to ${rupees(o.maxOff)}` : ''}`;
  return [
    off,
    o.minTotal ? `orders of ${rupees(o.minTotal)}+` : '',
    o.firstOrderOnly ? 'first order only' : '',
    o.kind === 'code' && o.code ? `code ${o.code}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** One offer, opened for editing. */
function OfferForm({
  offer,
  dishes,
  onChange,
}: {
  offer: MessOffer;
  dishes: { name: string; price: number }[];
  onChange: (o: MessOffer) => void;
}) {
  const set = (p: Partial<MessOffer>) => onChange({ ...offer, ...p });
  const usePercent = offer.kind !== 'combo' && !offer.flatOff;
  const fullPrice = offer.items.reduce(
    (n, i) => n + i.qty * (dishes.find((d) => d.name.toLowerCase() === i.name.toLowerCase())?.price ?? 0),
    0,
  );
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
        Name students see
        <input
          className={field}
          value={offer.title}
          maxLength={60}
          placeholder={
            offer.kind === 'combo'
              ? 'Paneer meal'
              : offer.kind === 'code'
                ? '20% off your first order'
                : '₹30 off above ₹299'
          }
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>
      {offer.kind === 'code' && (
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
          Code
          <input
            className={`${field} uppercase tracking-[0.12em]`}
            value={offer.code}
            maxLength={15}
            placeholder="WELCOME20"
            onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
          />
        </label>
      )}
      {offer.kind !== 'combo' ? (
        <>
          <div
            role="radiogroup"
            aria-label="Discount type"
            className="inline-flex self-start rounded-full border border-line p-1"
          >
            {(
              [
                ['percent', '% off'],
                ['flat', '₹ off'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={(k === 'percent') === usePercent}
                onClick={() =>
                  k === 'percent'
                    ? set({ flatOff: 0, percentOff: offer.percentOff || 10 })
                    : set({ percentOff: 0, flatOff: offer.flatOff || 30, maxOff: 0 })
                }
                className={`h-8 rounded-full px-3.5 text-[13.5px] font-semibold border-0 cursor-pointer ${(k === 'percent') === usePercent ? 'bg-ink text-bg' : 'bg-transparent text-ink2'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {usePercent ? (
              <>
                <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
                  Percent off
                  <input
                    className={field}
                    inputMode="numeric"
                    value={offer.percentOff || ''}
                    onChange={(e) => set({ percentOff: Math.min(90, num(e.target.value)) })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
                  Up to ₹ (optional)
                  <input
                    className={field}
                    inputMode="numeric"
                    value={offer.maxOff || ''}
                    onChange={(e) => set({ maxOff: Math.min(2000, num(e.target.value)) })}
                  />
                </label>
              </>
            ) : (
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
                Rupees off
                <input
                  className={field}
                  inputMode="numeric"
                  value={offer.flatOff || ''}
                  onChange={(e) => set({ flatOff: Math.min(2000, num(e.target.value)) })}
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
              Order of at least ₹
              <input
                className={field}
                inputMode="numeric"
                value={offer.minTotal || ''}
                placeholder="0"
                onChange={(e) => set({ minTotal: Math.min(10000, num(e.target.value)) })}
              />
            </label>
          </div>
          <label className="flex items-center gap-2.5 text-[14px] text-ink cursor-pointer">
            <input
              type="checkbox"
              className="w-5 h-5 accent-[var(--teal)]"
              checked={offer.firstOrderOnly}
              onChange={(e) => set({ firstOrderOnly: e.target.checked })}
            />
            Only a student's first order here
          </label>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-ink2">Dishes in the combo</span>
          {offer.items.map((it, i) => (
            <div key={`${it.name}-${i}`} className="flex items-center gap-2">
              <select
                className={`${field} flex-1`}
                value={it.name}
                aria-label="Dish"
                onChange={(e) =>
                  set({ items: offer.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
                }
              >
                {dishes.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name} · {rupees(d.price)}
                  </option>
                ))}
              </select>
              <input
                className={`${field} !w-16 text-center`}
                inputMode="numeric"
                aria-label="How many"
                value={it.qty}
                onChange={(e) =>
                  set({
                    items: offer.items.map((x, j) =>
                      j === i ? { ...x, qty: Math.max(1, Math.min(10, num(e.target.value))) } : x,
                    ),
                  })
                }
              />
              <button
                type="button"
                aria-label={`Take ${it.name} out`}
                onClick={() => set({ items: offer.items.filter((_, j) => j !== i) })}
                className="grid place-items-center w-10 h-10 rounded-full border border-line bg-transparent text-ink2 cursor-pointer"
              >
                ×
              </button>
            </div>
          ))}
          {dishes.length > 0 && offer.items.length < 8 && (
            <button
              type="button"
              onClick={() => set({ items: [...offer.items, { name: dishes[0]!.name, qty: 1 }] })}
              className="self-start border-0 bg-transparent p-0 text-[14px] font-semibold text-teal-text underline underline-offset-4 cursor-pointer"
            >
              + Add a dish
            </button>
          )}
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2 max-w-[220px]">
            Combo price ₹
            <input
              className={field}
              inputMode="numeric"
              value={offer.price || ''}
              onChange={(e) => set({ price: Math.min(10000, num(e.target.value)) })}
            />
          </label>
          {fullPrice > 0 && offer.price > 0 && (
            <p className="m-0 text-[13px] text-ink2">
              Bought one by one: {rupees(fullPrice)}.{' '}
              {offer.price < fullPrice ? (
                <strong className="text-teal-text">Students save {rupees(fullPrice - offer.price)}.</strong>
              ) : (
                <strong className="text-blush-text">
                  The combo costs more than the dishes on their own.
                </strong>
              )}
            </p>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 max-w-[420px]">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
          Starts (optional)
          <input
            type="date"
            className={field}
            value={offer.startsOn}
            onChange={(e) => set({ startsOn: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
          Ends (optional)
          <input
            type="date"
            className={field}
            value={offer.endsOn}
            onChange={(e) => set({ endsOn: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

/**
 * The owner's Offers tab: promo codes, automatic deals and combos. Part of the dashboard's one
 * draft, so "Save changes" saves them with everything else.
 */
export function OffersEditor({
  offers,
  order,
  onChange,
}: {
  offers: MessOffer[];
  order: MessOrderSection[];
  onChange: (offers: MessOffer[]) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const dishes = order.flatMap((s) => s.items).filter((i) => !i.tiffin);
  const update = (id: string, o: MessOffer) => onChange(offers.map((x) => (x.id === id ? o : x)));
  const add = (kind: MessOfferKind) => {
    const o = blank(kind);
    if (kind === 'combo' && dishes.length >= 2)
      o.items = [
        { name: dishes[0]!.name, qty: 1 },
        { name: dishes[1]!.name, qty: 1 },
      ];
    onChange([...offers, o]);
    setOpen(o.id);
  };
  return (
    <div className="flex flex-col gap-6 max-w-[760px]">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display text-[26px] font-extrabold tracking-[-0.02em] text-ink">Offers</h2>
        <p className="m-0 text-[14.5px] leading-relaxed text-ink2">
          Bring students in and get bigger orders. One discount per order: a code a student types wins,
          otherwise the best automatic deal is applied for them. Combos are priced as they are.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(KIND_TEXT) as MessOfferKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => add(k)}
            disabled={offers.length >= 20}
            className="press flex flex-col gap-1 rounded-2xl border-[1.5px] border-dashed border-line bg-transparent p-4 text-left cursor-pointer hover:border-ink2 disabled:opacity-50"
          >
            <span className="text-[15px] font-bold text-ink">+ {KIND_TEXT[k].name}</span>
            <span className="text-[13px] leading-snug text-ink2">{KIND_TEXT[k].what}</span>
          </button>
        ))}
      </div>
      {offers.length === 0 ? (
        <p className="m-0 text-[14.5px] text-ink2">No offers yet. Add one above, then press Save changes.</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line border-y border-line">
          {offers.map((o) => {
            const problem = offerProblem(o, dishes);
            const isOpen = open === o.id;
            return (
              <li key={o.id} className="flex flex-col gap-3 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">
                      {KIND_TEXT[o.kind].name}
                      {!o.active && ' · paused'}
                    </span>
                    <span className="text-[17px] font-bold text-ink">{o.title || 'Untitled offer'}</span>
                    <span className="text-[13.5px] text-ink2">{offerSummary(o)}</span>
                    {problem && !isOpen && <span className="text-[13px] text-blush-text">{problem}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-ink cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-5 h-5 accent-[var(--teal)]"
                        checked={o.active}
                        onChange={(e) => update(o.id, { ...o, active: e.target.checked })}
                      />
                      On
                    </label>
                    <Button size="sm" variant="outline" onClick={() => setOpen(isOpen ? null : o.id)}>
                      {isOpen ? 'Done' : 'Edit'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        window.confirm(`Delete "${o.title || 'this offer'}"?`) &&
                        onChange(offers.filter((x) => x.id !== o.id))
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <>
                    <OfferForm offer={o} dishes={dishes} onChange={(n) => update(o.id, n)} />
                    {problem && <p className="m-0 text-[13.5px] text-blush-text">{problem}</p>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
