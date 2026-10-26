import { Link, NavLink, useLocation } from 'react-router-dom';
import { useSession } from '../../lib/session';
import { LABEL } from '../copy';
import { StackWord, Wordmark } from './brand';
import { Button, LinkButton } from './button';
import { Catalogue, ShelfIcon, Toolbox, Upload } from './icons';
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
            {LABEL.catalogue}
          </Link>
          <NavLink to="/contribute" className={link}>
            {LABEL.contribute}
          </NavLink>
          {status === 'ready' && (
            <NavLink to="/shelf" className={link}>
              {LABEL.shelf}
            </NavLink>
          )}
          {me?.isAdmin && (
            <NavLink to="/admin" className={link}>
              {LABEL.admin}
            </NavLink>
          )}
        </span>
        {me?.isAdmin && (
          <NavLink
            to="/admin"
            className={`md:hidden inline-flex items-center h-9 px-3 rounded-full text-[13px] font-semibold no-underline border ${
              onDark ? 'border-white/40 text-white' : 'border-line text-ink'
            }`}
          >
            Admin
          </NavLink>
        )}
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
    <footer className="mx-auto max-w-[1280px] px-5 sm:px-9 pt-14 pb-[calc(84px+env(safe-area-inset-bottom))] md:pb-10">
      <div className="grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)] items-end gap-5 md:gap-10 pb-8 border-b border-line">
        <Wordmark />
        <p className="m-0 md:justify-self-end font-display font-bold text-[clamp(22px,2.6vw,30px)] leading-tight tracking-[-0.035em] text-ink2 max-w-[640px] text-balance md:text-right">
          Notes from your seniors, <StackWord className="text-ink">filed and ready.</StackWord>
        </p>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 text-sm text-ink2">
        <span>Independent student project. Not affiliated with VIT Bhopal University.</span>
        <nav aria-label="Footer" className="flex flex-wrap gap-6 font-medium">
          <Link to="/contribute" className="text-ink no-underline">
            {LABEL.contribute}
          </Link>
          <Link to="/help" className="text-ink no-underline">
            {LABEL.help}
          </Link>
          <Link to="/terms" className="text-ink no-underline">
            {LABEL.terms}
          </Link>
          <Link to="/privacy" className="text-ink no-underline">
            {LABEL.privacy}
          </Link>
          <Link to="/contact" className="text-ink no-underline">
            {LABEL.contact}
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/**
 * Phone-only tab bar for signed-in students, docked to the bottom edge like a native app:
 * full width, a hairline on top, the phone's home-indicator area respected, and the current
 * tab marked by a short teal line and bold label. Account lives behind the profile picture.
 */
export function TabBar() {
  const { status } = useSession();
  const { pathname, hash } = useLocation();
  // Visitors get it too (Shelf asks them to sign in). The reader has its own controls at the
  // bottom; sign-in is a full-screen card.
  if (
    (status !== 'ready' && status !== 'signed-out') ||
    pathname.startsWith('/read/') ||
    pathname === '/sign-in'
  )
    return null;
  const onToolbox = (pathname === '/' && hash === '#toolbox') || pathname.startsWith('/tools/');
  const tabs = [
    {
      to: '/#catalogue',
      label: 'Catalogue',
      icon: <Catalogue size={22} />,
      active: pathname === '/' && !onToolbox,
    },
    { to: '/shelf', label: 'Shelf', icon: <ShelfIcon size={22} />, active: pathname.startsWith('/shelf') },
    {
      to: '/contribute',
      label: 'Earn',
      icon: <Upload size={22} />,
      active: pathname.startsWith('/contribute'),
    },
    { to: '/#toolbox', label: 'Toolbox', icon: <Toolbox size={22} />, active: onToolbox },
  ];
  return (
    <nav
      aria-label="App"
      className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_18px_-14px_var(--shadow)]"
    >
      <ul className="m-0 p-0 list-none grid grid-cols-4 h-[60px]">
        {tabs.map((t) => (
          <li key={t.label} className="h-full">
            <Link
              to={t.to}
              aria-current={t.active ? 'page' : undefined}
              className={`relative h-full flex flex-col items-center justify-center gap-1 no-underline text-[11.5px] ${
                t.active ? 'text-teal-text font-semibold' : 'text-ink2 font-medium'
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-0 h-[3px] w-10 rounded-b-full bg-teal transition-opacity ${
                  t.active ? 'opacity-100' : 'opacity-0'
                }`}
              />
              {t.icon}
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Standard page frame for inner pages. */
export function Page({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <Header />
      <main
        id="main"
        className={`page-enter mx-auto ${wide ? 'max-w-[1280px]' : 'max-w-[1100px]'} px-5 sm:px-9 pb-16`}
      >
        {children}
      </main>
      <Footer />
    </>
  );
}
