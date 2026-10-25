import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

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
  return `inline-flex items-center justify-center gap-2.5 rounded-full font-semibold no-underline transition press disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({
  variant = 'brand',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
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
  if (to.startsWith('#')) {
    return (
      <a href={to} className={buttonClass(variant, size, className)}>
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
