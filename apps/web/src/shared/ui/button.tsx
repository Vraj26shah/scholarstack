import { type ButtonHTMLAttributes, type MouseEvent, type ReactNode, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';

type Variant = 'buy' | 'mist' | 'brand' | 'ink' | 'outline' | 'outline-light' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  // Marigold is used only for buying, so it always means "get it".
  buy: 'bg-marigold text-on-marigold hover:brightness-105 shadow-[0_10px_24px_-12px_rgba(245,184,61,0.9)]',
  mist: 'bg-mist text-on-mist hover:brightness-95',
  brand: 'bg-brand text-white hover:brightness-110',
  ink: 'bg-ink text-bg hover:opacity-90',
  outline: 'border-[1.5px] border-line text-ink hover:border-ink2',
  'outline-light': 'border-[1.5px] border-white/45 text-white hover:border-white',
  ghost: 'text-ink hover:bg-sunk',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[14px]',
  md: 'h-11 px-5 text-[15px]',
  lg: 'h-14 px-7 text-[17px]',
};

export function buttonClass(variant: Variant = 'brand', size: Size = 'md', extra = '') {
  return `inline-flex items-center justify-center gap-2.5 rounded-full font-semibold no-underline press disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({
  variant = 'brand',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

/**
 * Smooth-scroll to an on-page #hash target, bypassing the native hash-jump which causes a
 * jarring snap before the ScrollManager's smooth follow-up kicks in.
 */
function smoothScrollToHash(hash: string) {
  const id = hash.slice(1);
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    // If the target isn't rendered yet, poll briefly (lazy-loaded sections).
    let tries = 0;
    const poll = () => {
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (tries++ < 20) {
        setTimeout(poll, 60);
      }
    };
    setTimeout(poll, 60);
  }
}

export function LinkButton({
  to,
  variant = 'brand',
  size = 'md',
  className = '',
  children,
}: {
  to: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();

  const handleHashClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      // Update the URL hash through React Router so ScrollManager stays in sync,
      // but tell it to keep the current scroll position (we handle scrolling ourselves).
      const hash = to;
      const currentPath = window.location.pathname + window.location.search;
      navigate(`${currentPath}${hash}`, { replace: true, state: { keepScroll: true } });
      smoothScrollToHash(hash);
    },
    [to, navigate],
  );

  if (to.startsWith('#')) {
    return (
        <a
          href={to}
          onClick={handleHashClick}
          className={buttonClass(variant, size, className)}
        >
          {children}
        </a>
        );
  }
        return (
        <Link to={to} className={buttonClass(variant, size, className)}>
          {children}
        </Link>
        );
}
