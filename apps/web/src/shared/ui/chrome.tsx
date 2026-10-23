import { Link, NavLink, useLocation } from 'react-router-dom';
import { useSession } from '../../lib/session';
import { Wordmark } from './brand';
import { Button, LinkButton } from './button';
import { Catalogue, ShelfIcon, User } from './icons';
import { ThemeToggle } from './theme-toggle';

function initials(email: string, name: string | null) {
  const src = name?.trim() || email.split('@')[0] || '?';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0]!.toUpperCase();
}

/** Top bar. `onDark` renders inside the Ink Blue hero panel. */
export function Header({ onDark = false }: { onDark?: boolean }) {
  const { status, me, bootstrap } = useSession();
  const link = `no-underline font-medium ${onDark ? 'text-white' : 'text-ink'} hover:opacity-80`;
  return (
    <header className="mx-auto max-w-[1280px] px-4 sm:px-9 py-5 flex items-center justify-between gap-3">
      <Wordmark onDark={onDark} />
      <nav aria-label="Main" className="flex-none flex items-center gap-2 sm:gap-6 text-[15px]">
        <span className="hidden md:flex items-center gap-6">
          <Link to="/#catalogue" className={link}>
            Catalogue
          </Link>
          {status === 'ready' && (
            <NavLink to="/shelf" className={link}>
              My shelf
            </NavLink>
          )}
          {me?.isAdmin && (
            <NavLink to="/admin" className={link}>
              Admin
            </NavLink>
          )}
        </span>
        <ThemeToggle onDark={onDark} />
        {status === 'ready' && me ? (
          <Link
            to="/account"
            aria-label="Your account"
            className={`w-11 h-11 rounded-full inline-flex items-center justify-center text-sm font-semibold no-underline ${
              onDark ? 'bg-mist text-on-mist' : 'bg-brand text-white'
            }`}
          >
            {initials(me.email, me.fullName)}
          </Link>
        ) : status === 'signed-out' ? (
          <LinkButton to="/sign-in" variant={onDark ? 'mist' : 'brand'} className="!px-4 sm:!px-5">
            Sign in
          </LinkButton>
        ) : status === 'unavailable' ? (
          <Button
            variant={onDark ? 'mist' : 'brand'}
            className="!px-4 sm:!px-5"
            onClick={() => void bootstrap()}
          >
            Retry
          </Button>
        ) : (
          <span
            aria-label="Checking your account"
            aria-busy="true"
            className="inline-flex h-11 w-[90px] items-center justify-center rounded-full bg-white/10 text-xs text-current/70"
          >
            Checking…
          </span>
        )}
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto max-w-[1280px] px-5 sm:px-9 pt-14 pb-28 md:pb-10">
      <div className="grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)] items-end gap-5 md:gap-10 pb-8 border-b border-line">
        <Wordmark />
        <p className="m-0 md:justify-self-end font-display font-bold text-[clamp(22px,2.6vw,30px)] leading-tight tracking-[-0.035em] text-ink2 max-w-[640px] text-balance md:text-right">
          Notes from your seniors, <span className="text-ink">filed and ready.</span>
        </p>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 text-sm text-ink2">
        <span>Independent student project. Not affiliated with VIT Bhopal University.</span>
        <nav aria-label="Footer" className="flex flex-wrap gap-6 font-medium">
          <Link to="/terms" className="text-ink no-underline">
            Terms
          </Link>
          <Link to="/privacy" className="text-ink no-underline">
            Privacy
          </Link>
          <Link to="/contact" className="text-ink no-underline">
            Contact
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/** Phone-only bottom tab bar for signed-in students. */
export function TabBar() {
  const { status } = useSession();
  const { pathname } = useLocation();
  // The reader has its own controls at the bottom; sign-in is a full-screen card.
  if (status !== 'ready' || pathname.startsWith('/read/') || pathname === '/sign-in') return null;
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center gap-0.5 h-[50px] rounded-full text-[11px] no-underline ${
      isActive ? 'bg-brand text-white font-semibold' : 'text-ink2 font-medium'
    }`;
  return (
    <nav
      aria-label="App"
      className="md:hidden fixed left-3.5 right-3.5 bottom-4 z-30 h-[66px] rounded-full bg-surface border border-line grid grid-cols-3 items-center px-2 shadow-lg"
    >
      <NavLink to="/" end className={item}>
        <Catalogue />
        Catalogue
      </NavLink>
      <NavLink to="/shelf" className={item}>
        <ShelfIcon />
        Shelf
      </NavLink>
      <NavLink to="/account" className={item}>
        <User />
        Account
      </NavLink>
    </nav>
  );
}

/** Standard page frame for inner pages. */
export function Page({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <Header />
      <main id="main" className={`mx-auto ${wide ? 'max-w-[1280px]' : 'max-w-[1100px]'} px-5 sm:px-9 pb-16`}>
        {children}
      </main>
      <Footer />
    </>
  );
}
