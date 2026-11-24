import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { LABEL } from '../copy';
import { StackWord, Wordmark } from './brand';
import { LinkButton } from './button';
import { Catalogue, ShelfIcon, Toolbox, Upload } from './icons';
import { ThemeToggle } from './theme-toggle';

function initials(email: string, name: string | null) {
  const src = name?.trim() || email.split('@')[0] || '?';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0]!.toUpperCase();
}

/** Top bar. `onDark` renders inside the Ink Blue hero panel. */
/** Restaurant owners get an "Orders" link. Asked once per signed-in account per visit. */
const ownerAnswer = new Map<string, boolean>();
function useRunsRestaurant(accountId: string | null) {
  const [owner, setOwner] = useState(() => (accountId ? (ownerAnswer.get(accountId) ?? false) : false));
  useEffect(() => {
    if (!accountId) return setOwner(false);
    if (ownerAnswer.has(accountId)) return setOwner(ownerAnswer.get(accountId)!);
    let live = true;
    api
      .ownedMesses()
      .then((list) => {
        ownerAnswer.set(accountId, list.length > 0);
        if (live) setOwner(list.length > 0);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [accountId]);
  return owner;
}

export function Header({ onDark = false }: { onDark?: boolean }) {
  const { status, me } = useSession();
  const owner = useRunsRestaurant(status === 'ready' && me && !me.isAdmin ? me.id : null);
  const link = `no-underline font-medium ${onDark ? 'text-white' : 'text-ink'} hover:opacity-80`;
  return (
    <header className="mx-auto max-w-[1280px] px-4 sm:px-9 py-5 flex items-center justify-between gap-3">
      <Wordmark onDark={onDark} />
      <nav
        aria-label="Main"
        className="min-w-0 flex-none flex items-center gap-2 sm:gap-4 lg:gap-6 text-[15px]"
      >
        <Link to="/#catalogue" className={`${link} hidden md:inline-flex lg:hidden`}>
          {LABEL.catalogue}
        </Link>
        <span className="hidden lg:flex items-center gap-4 xl:gap-6">
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
        {owner && (
          <NavLink
            to="/orders"
            className={`inline-flex items-center h-9 px-3 rounded-full text-[13px] font-semibold no-underline ${
              onDark ? 'bg-white text-ink' : 'bg-ink text-bg'
            }`}
          >
            My restaurant
          </NavLink>
        )}
        {me?.isAdmin && (
          <NavLink
            to="/admin"
            className={`lg:hidden inline-flex items-center h-9 px-3 rounded-full text-[13px] font-semibold no-underline border ${
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
        ) : status === 'signed-out' || status === 'unavailable' ? (
          <LinkButton to="/sign-in" variant={onDark ? 'mist' : 'brand'} className="!px-4 sm:!px-5">
            Sign in
          </LinkButton>
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
    <footer className="mx-auto max-w-[1280px] px-5 sm:px-9 pt-14 pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-10">
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
      icon: <Catalogue size={20} />,
      // A tab is always lit, so a first-time visitor sees where they are: the whole home page
      // (welcome included) and every course and bundle page belong to the Catalogue.
      active: (pathname === '/' && !onToolbox) || pathname.startsWith('/c/') || pathname.startsWith('/b/'),
    },
    { to: '/shelf', label: 'Shelf', icon: <ShelfIcon size={20} />, active: pathname.startsWith('/shelf') },
    {
      to: '/contribute',
      label: 'Contribute',
      icon: <Upload size={20} />,
      active: pathname.startsWith('/contribute'),
    },
    { to: '/#toolbox', label: 'Toolbox', icon: <Toolbox size={20} />, active: onToolbox },
  ];
  return (
    <nav
      aria-label="App"
      // The deep blue bar with white labels reads clearly in light and dark, in bright sun, and
      // when a phone browser darkens pages by itself. It sits above the phone's own gesture area.
      className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-[#2F3C7E] text-white border-t border-white/15 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_rgba(16,22,58,0.45)] [color-scheme:dark]"
    >
      <ul className="m-0 p-0 list-none grid grid-cols-4 h-16">
        {tabs.map((t) => (
          <li key={t.label} className="h-full">
            <Link
              to={t.to}
              aria-current={t.active ? 'page' : undefined}
              className={`h-full flex flex-col items-center justify-center gap-1 no-underline text-[12px] ${
                t.active ? 'text-white font-bold' : 'text-white/85 font-medium'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-flex h-7 w-12 items-center justify-center rounded-full ${
                  t.active ? 'bg-[#A1D6E2] text-[#2F3C7E]' : ''
                }`}
              >
                {t.icon}
              </span>
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
