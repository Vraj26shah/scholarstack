import type { RunningOfferDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

const COVERS: Record<RunningOfferDto['scope'], string> = {
  everything: 'every course and bundle',
  courses: 'every course',
  bundles: 'every bundle',
  some: 'selected notes',
};

/** "2 days left", "8 hours left", "Last hour". */
export function timeLeft(endsAt: string, now = Date.now()): string {
  const ms = new Date(endsAt).getTime() - now;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} days left`;
  if (hours >= 24) return '1 day left';
  if (hours >= 2) return `${hours} hours left`;
  return ms > 0 ? 'Last hour' : 'Ending now';
}

const endsOn = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * A slim strip above the catalogue while a sale runs ("Diwali offer · 20% off every course and
 * bundle · 5 days left"). It comes from the running offers, so it appears when an offer starts and
 * disappears when it ends, with nothing to switch on or off. No offer: nothing is drawn at all.
 */
export function OfferBanner() {
  const q = useQuery({
    queryKey: ['offers-running'],
    queryFn: api.runningOffers,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
  // Tick once a minute so "hours left" stays true, and the strip leaves the moment the offer ends.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const offer = q.data?.find((o) => new Date(o.endsAt).getTime() > now);
  if (!offer) return null;
  const more = (q.data?.filter((o) => new Date(o.endsAt).getTime() > now).length ?? 1) - 1;
  return (
    <aside
      aria-label="Sale on now"
      className="relative overflow-hidden mb-8 rounded-2xl bg-marigold text-on-marigold px-5 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-1 shadow-[0_14px_30px_-22px_var(--shadow)]"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-brand" />
      <span className="font-display font-extrabold text-[20px] leading-tight tracking-[-0.02em]">
        {offer.title} · {offer.percentOff}% off
      </span>
      <span className="text-[14.5px] font-semibold">
        on {COVERS[offer.scope]}
        {more > 0 ? ` (and ${more} more ${more === 1 ? 'offer' : 'offers'})` : ''}
      </span>
      <span className="sm:ml-auto text-[13.5px] font-semibold tabular-nums">
        {timeLeft(offer.endsAt, now)} · ends {endsOn(offer.endsAt)}
      </span>
    </aside>
  );
}
