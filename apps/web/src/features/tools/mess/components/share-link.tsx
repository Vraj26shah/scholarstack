import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { buttonClass } from '../../../../shared/ui/button';

/** A mess's or restaurant's own short address: /m/<slug> opens the menu with it already chosen. */
export const messPath = (slug: string) => `/m/${encodeURIComponent(slug)}`;
export const messLink = (slug: string) =>
  `${typeof window === 'undefined' ? '' : window.location.origin}${messPath(slug)}`;

/** /m/:slug → the mess menu with that mess chosen (the address stays shareable there too). */
export function MessShortLink() {
  const { slug = '' } = useParams();
  return <Navigate to={`/tools/mess-menu?mess=${encodeURIComponent(slug)}`} replace />;
}

/**
 * "Share" for a mess or restaurant: the phone's own share sheet where there is one (WhatsApp,
 * Instagram…), otherwise the link is copied. Anyone opening it lands straight on this menu.
 */
export function ShareMessButton({
  slug,
  name,
  size = 'sm',
  label = 'Share link',
}: {
  slug: string;
  name: string;
  size?: 'sm' | 'md';
  label?: string;
}) {
  const [done, setDone] = useState<'' | 'copied' | 'failed'>('');
  const share = async () => {
    const url = messLink(slug);
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && window.matchMedia?.('(pointer: coarse)').matches) {
      try {
        await nav.share({ title: name, text: `${name}: menu and ordering`, url });
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setDone('copied');
    } catch {
      setDone('failed');
    }
    window.setTimeout(() => setDone(''), 2500);
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={() => void share()} className={buttonClass('outline', size)}>
        {done === 'copied' ? 'Link copied ✓' : label}
      </button>
      {done === 'failed' && (
        <span className="text-[13px] text-ink2 select-all break-all">{messLink(slug)}</span>
      )}
    </span>
  );
}

/** The owner's dashboard: their restaurant's link, to print on the card or post in groups. */
export function RestaurantLink({ slug, name }: { slug: string; name: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink2">
      <span>Your link:</span>
      <a
        href={messPath(slug)}
        className="font-semibold text-ink tabular-nums break-all underline underline-offset-4 decoration-line hover:decoration-ink"
      >
        {messLink(slug).replace(/^https?:\/\//, '')}
      </a>
      <ShareMessButton slug={slug} name={name} label="Copy / share" />
    </div>
  );
}
