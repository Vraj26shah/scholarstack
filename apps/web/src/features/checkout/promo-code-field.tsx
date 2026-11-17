import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import type { useBuy } from './use-buy';

/**
 * "Have a promo code?" under the buy button. It shows only while the admin has a code running,
 * so when there is no campaign the page looks exactly as it always has. Optional: a student who
 * has no code just buys as usual.
 */
export function PromoCodeField({
  buyState,
  onDark = false,
}: {
  buyState: ReturnType<typeof useBuy>;
  /** On the navy course panel (light text) rather than a white card. */
  onDark?: boolean;
}) {
  const active = useQuery({
    queryKey: ['promo-active'],
    queryFn: api.promoActive,
    // Short, so a code the admin just switched on shows up on the next page a student opens (or
    // when they come back to the tab), not minutes later. The server answers from a 10 s copy.
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { promo, applyPromo, clearPromo, signedIn, buy } = buyState;

  // While a code is running everyone sees the link, so a student who heard about DIWALI20 knows
  // where it goes. A visitor who taps it signs in first and comes back to this page.
  if (!active.data?.active && !promo) return null;

  const muted = onDark ? 'text-on-brand2' : 'text-ink2';
  const linkClass = `self-start bg-transparent border-0 p-0 cursor-pointer text-[13px] font-semibold underline-offset-2 hover:underline ${
    onDark ? 'text-on-brand2 hover:text-white' : 'text-teal-text'
  }`;

  if (promo)
    return (
      <p className={`m-0 text-[13px] leading-relaxed ${muted}`} aria-live="polite">
        <span className={`font-mono font-semibold ${onDark ? 'text-mist' : 'text-teal-text'}`}>
          {promo.code}
        </span>{' '}
        applied · you save {formatRupees(promo.discountPaise)}{' '}
        <button
          type="button"
          className={linkClass}
          onClick={() => {
            clearPromo();
            setCode('');
          }}
        >
          Remove
        </button>
      </p>
    );

  if (!open)
    return (
      <button
        type="button"
        className={linkClass}
        // Signed out: buy() sends them to sign in and back here (it opens nothing else).
        onClick={() => (signedIn ? setOpen(true) : void buy())}
      >
        Have a promo code?{signedIn ? '' : ' Sign in to use it'}
      </button>
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await applyPromo(code);
      setOpen(false);
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          // biome-ignore lint/a11y/noAutofocus: opened on purpose by the student
          autoFocus
          aria-label="Promo code"
          placeholder="Promo code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError(null);
          }}
          className="h-9 w-full min-w-0 max-w-[200px] rounded-xl bg-surface border-[1.5px] border-line px-3 font-mono text-[14px] text-ink outline-none focus:border-teal"
        />
        <Button type="submit" size="sm" variant={onDark ? 'mist' : 'outline'} disabled={busy || !code.trim()}>
          {busy ? 'Checking…' : 'Apply'}
        </Button>
        <button
          type="button"
          className={linkClass}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <span role="alert" className={`text-[13px] ${onDark ? 'text-marigold' : 'text-blush-text'}`}>
          {error}
        </span>
      )}
    </form>
  );
}
