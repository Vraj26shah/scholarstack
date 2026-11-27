import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { appMode } from '../../lib/app-mode';
import { useFoodLive } from '../../lib/food-live';
import { signInPath } from '../../lib/return-to';
import { useSession } from '../../lib/session';
import { LABEL } from '../copy';
import { LogoMark, StackWord, Wordmark } from './brand';
import { LinkButton } from './button';
import { Bowl, Calendar, Catalogue, ChevronLeft, ShelfIcon, Toolbox, Upload, User } from './icons';
import { ThemeToggle } from './theme-toggle';

function initials(email: string, name: string | null) {
  const src = name?.trim() || email.split('@')[0] || '?';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0]!.toUpperCase();
}

/** Top bar. `onDark` renders inside the Ink Blue hero panel. */
/**
 * What the header knows about this account (runs a restaurant; food orders and unread chat),
 * remembered on the device so the buttons are there the moment a page opens, then refreshed in
 * the background. Without this they popped in late and pushed the header around.
 */
const HEADER_KEY = 'ss_header_facts';
type HeaderFacts = { owner?: boolean; orders?: { has: boolean; unread: number } };
function readFacts(accountId: string): HeaderFacts {
  try {
    const all = JSON.parse(localStorage.getItem(HEADER_KEY) ?? '{}') as Record<string, unknown>;
    const mine = all[accountId];
    if (!mine || typeof mine !== 'object') return {};
    const m = mine as Record<string, unknown>;
    const o = m.orders as Record<string, unknown> | undefined;
    return {
      owner: m.owner === true,
      orders:
        o && typeof o === 'object'
          ? {
              has: o.has === true,
              unread: typeof o.unread === 'number' && o.unread > 0 ? Math.floor(o.unread) : 0,
            }
          : undefined,
    };
  } catch {
    return {};
  }
}
function saveFacts(accountId: string, patch: HeaderFacts) {
  try {
    const all = JSON.parse(localStorage.getItem(HEADER_KEY) ?? '{}') as Record<string, HeaderFacts>;
    all[accountId] = { ...(all[accountId] ?? {}), ...patch };
    localStorage.setItem(HEADER_KEY, JSON.stringify(all));
  } catch {
    // storage blocked: the buttons just wait for the server
  }
}

/** Restaurant owners get a "My restaurant" link. Asked once per account per visit. */
const ownerAnswer = new Map<string, boolean>();
function useRunsRestaurant(accountId: string | null) {
  const [owner, setOwner] = useState(() =>
    accountId ? (ownerAnswer.get(accountId) ?? readFacts(accountId).owner ?? false) : false,
  );
  useEffect(() => {
    if (!accountId) return setOwner(false);
    if (ownerAnswer.has(accountId)) return setOwner(ownerAnswer.get(accountId)!);
    let live = true;
    api
      .ownedMesses()
      .then((list) => {
        ownerAnswer.set(accountId, list.length > 0);
        saveFacts(accountId, { owner: list.length > 0 });
        if (live) setOwner(list.length > 0);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [accountId]);
  return owner;
}

/**
 * A signed-in student with restaurant orders: a "My orders" link with their unread messages.
 * Shown at once from the last answer; refreshed when a notification arrives, when the tab comes
 * back into view, and every 10 seconds while an order is still going.
 */
function useMyOrderCount(enabled: boolean, accountId = '') {
  const [state, setState] = useState(
    () => (enabled && accountId ? readFacts(accountId).orders : undefined) ?? { has: false, unread: 0 },
  );
  useEffect(() => {
    if (!enabled) return setState({ has: false, unread: 0 });
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      clearTimeout(timer);
      return api
        .myMessOrders()
        .then((list) => {
          if (!live) return;
          const next = { has: list.length > 0, unread: list.reduce((n, o) => n + o.unread, 0) };
          setState(next);
          if (accountId) saveFacts(accountId, { orders: next });
          if (list.some((o) => ['placed', 'accepted', 'ready'].includes(o.status)))
            timer = setTimeout(load, 10_000);
        })
        .catch(() => {});
    };
    void load();
    const onPush = (e: MessageEvent) => {
      if (e.data?.type === 'push' || e.data?.type === 'shown') void load();
    };
    const onShow = () => {
      if (document.visibilityState === 'visible') void load();
    };
    navigator.serviceWorker?.addEventListener('message', onPush);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      live = false;
      clearTimeout(timer);
      navigator.serviceWorker?.removeEventListener('message', onPush);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [enabled, accountId]);
  return state;
}

/** The site's header; inside the student app, a compact app bar instead. */
export function Header({ onDark = false }: { onDark?: boolean }) {
  return appMode() === 'student' ? <AppBar /> : <SiteHeader onDark={onDark} />;
}

/** Tab roots of the student app (no back arrow there) and each screen's title. */
const APP_ROOTS = ['/app', '/tools/mess-menu', '/app/notes', '/app/tools', '/app/me'];
function appTitle(pathname: string): string {
  if (pathname === '/app') return '';
  const exact: Record<string, string> = {
    '/tools/mess-menu': 'Food',
    '/app/notes': 'Notes',
    '/get-app': 'Android app',
    '/app/tools': 'Tools',
    '/app/me': 'Me',
    '/tools/timetable': 'Timetable',
    '/tools/attendance': 'Attendance',
    '/tools/cgpa': 'CGPA',
    '/shelf': 'My shelf',
    '/my-orders': 'My orders',
    '/account': 'Account',
    '/contribute': 'Contribute',
    '/help': 'Help',
    '/terms': 'Terms',
    '/privacy': 'Privacy',
    '/contact': 'Contact',
    '/orders': 'My restaurant',
    '/admin': 'Admin',
  };
  if (exact[pathname]) return exact[pathname]!;
  if (pathname.startsWith('/c/')) return 'Course';
  if (pathname.startsWith('/b/')) return 'Bundle';
  if (pathname.startsWith('/m/')) return 'Food';
  return '';
}

/** The student app's top bar: back (inside a tab), the screen's name, your orders and you. */
function AppBar() {
  const { status, me } = useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const food = useFoodLive();
  const myOrders = useMyOrderCount(status === 'ready' && !!me && food, me?.id ?? '');
  const title = appTitle(pathname) || 'Today';
  const root = APP_ROOTS.includes(pathname);
  const sub =
    pathname === '/app'
      ? new Date().toLocaleDateString('en-IN', {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
          timeZone: 'Asia/Kolkata',
        })
      : 'Scholars Stack';
  return (
    <header className="sticky top-0 z-30 bg-card/95 backdrop-blur-xl text-ink pt-[env(safe-area-inset-top)] shadow-[0_1px_0_var(--line)]">
      <div className="mx-auto max-w-[720px] h-16 px-4 flex items-center gap-3">
        {root ? (
          <span className="grid place-items-center size-10 flex-none rounded-[14px] bg-brand shadow-[0_6px_14px_-8px_rgba(47,60,126,0.9)]">
            <LogoMark size={24} onDark />
          </span>
        ) : (
          <button
            type="button"
            aria-label="Back"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/app'))}
            className="grid place-items-center size-10 flex-none rounded-[14px] bg-sunk text-ink active:scale-95 transition-transform"
          >
            <ChevronLeft size={21} />
          </button>
        )}
        <span className="min-w-0 flex flex-col">
          <span className="font-brand text-[18px] font-bold leading-tight tracking-[-0.02em] truncate">
            {title}
          </span>
          <span className="text-[12px] font-medium leading-tight text-ink2 truncate">{sub}</span>
        </span>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-sunk p-1 ring-1 ring-line/60">
          {myOrders.has && (
            <Link
              to="/my-orders"
              aria-label={myOrders.unread ? `My orders, ${myOrders.unread} unread` : 'My orders'}
              className="relative size-9 grid place-items-center rounded-full text-ink hover:bg-card no-underline"
            >
              <Bowl size={18} />
              {myOrders.unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] grid place-items-center rounded-full bg-marigold px-1 text-[10px] font-bold text-on-marigold ring-2 ring-sunk">
                  {myOrders.unread}
                </span>
              )}
            </Link>
          )}
          {status === 'ready' && me ? (
            <Link
              to="/app/me"
              aria-label="You"
              className="size-9 rounded-full grid place-items-center text-[13px] font-bold no-underline bg-brand text-white active:scale-95 transition-transform"
            >
              {initials(me.email, me.fullName)}
            </Link>
          ) : status === 'signed-out' || status === 'unavailable' ? (
            <Link
              to={signInPath(pathname)}
              className="inline-flex items-center h-9 px-4 rounded-full bg-brand text-white text-[13.5px] font-bold no-underline"
            >
              Sign in
            </Link>
          ) : (
            <span className="size-9 rounded-full bg-line/60" aria-hidden="true" />
          )}
        </span>
      </div>
    </header>
  );
}

function SiteHeader({ onDark = false }: { onDark?: boolean }) {
  const { status, me } = useSession();
  const location = useLocation();
  const owner = useRunsRestaurant(status === 'ready' && me && !me.isAdmin ? me.id : null);
  const food = useFoodLive();
  const myOrders = useMyOrderCount(status === 'ready' && !!me && !owner && food, me?.id ?? '');
  const link = `no-underline font-medium ${onDark ? 'text-white' : 'text-ink'} hover:opacity-80`;
  // With extra buttons (My restaurant, My orders, Admin) the full name needs a wide screen;
  // below that the logo mark stands in, so nothing ever runs into the name.
  const crowded = owner || myOrders.has || !!me?.isAdmin;
  const full = crowded ? 'hidden lg:inline-flex' : 'hidden min-[440px]:inline-flex';
  const mark = crowded ? 'lg:hidden' : 'min-[440px]:hidden';
  return (
    <header className="mx-auto max-w-[1280px] px-4 sm:px-9 py-5 flex items-center justify-between gap-3">
      {/* Narrow phones: just the mark, so the buttons never run into the name. */}
      <span className={`${full} flex-none`}>
        <Wordmark onDark={onDark} />
      </span>
      <Link to="/" aria-label="Scholars Stack home" className={`${mark} flex-none`}>
        <LogoMark size={34} onDark={onDark} />
      </Link>
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
            <span className="sm:hidden">Restaurant</span>
            <span className="hidden sm:inline">My restaurant</span>
          </NavLink>
        )}
        {myOrders.has && (
          <NavLink
            to="/my-orders"
            aria-label={myOrders.unread ? `My orders, ${myOrders.unread} unread` : 'My orders'}
            className={`relative inline-flex items-center justify-center h-9 w-9 sm:w-auto sm:px-3 rounded-full text-[13px] font-semibold no-underline border ${
              onDark ? 'border-white/40 text-white' : 'border-line text-ink'
            }`}
          >
            <span aria-hidden="true" className="sm:hidden">
              <Bowl size={18} />
            </span>
            <span className="hidden sm:inline">My orders</span>
            {myOrders.unread > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] grid place-items-center rounded-full bg-[#25d366] px-1 text-[11px] font-bold text-white">
                {myOrders.unread}
              </span>
            )}
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
          <LinkButton
            to={signInPath(`${location.pathname}${location.search}${location.hash}`)}
            variant={onDark ? 'mist' : 'brand'}
            className="!px-4 sm:!px-5"
          >
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
  // Inside the app there is no website footer: just room above the tab bar.
  if (appMode()) return <div className="h-[calc(88px+env(safe-area-inset-bottom))]" />;
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
          <Link to="/get-app" className="text-ink no-underline">
            Android app
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
  const mode = appMode();
  const food = useFoodLive();
  if (
    (status !== 'ready' && status !== 'signed-out') ||
    pathname.startsWith('/read/') ||
    pathname === '/sign-in' ||
    pathname.startsWith('/partner') ||
    mode === 'partner'
  )
    return null;
  const onToolbox = (pathname === '/' && hash === '#toolbox') || pathname.startsWith('/tools/');
  // The student app: its own five tabs (Today first), on every screen size.
  const appTabs = [
    { to: '/app', label: 'Today', icon: <Calendar size={20} />, active: pathname === '/app' },
    {
      to: '/tools/mess-menu',
      label: 'Food',
      icon: <Bowl size={20} />,
      active:
        pathname.startsWith('/tools/mess-menu') ||
        pathname.startsWith('/m/') ||
        pathname.startsWith('/my-orders'),
    },
    {
      to: '/app/notes',
      label: 'Notes',
      icon: <ShelfIcon size={20} />,
      active:
        pathname.startsWith('/app/notes') ||
        pathname.startsWith('/shelf') ||
        pathname.startsWith('/c/') ||
        pathname.startsWith('/b/') ||
        pathname.startsWith('/checkout'),
    },
    {
      to: '/app/tools',
      label: 'Tools',
      icon: <Toolbox size={20} />,
      active:
        pathname.startsWith('/app/tools') ||
        (pathname.startsWith('/tools/') && !pathname.startsWith('/tools/mess-menu')),
    },
    {
      to: '/app/me',
      label: 'Me',
      icon: <User size={20} />,
      active: ['/app/me', '/account', '/contribute', '/help', '/terms', '/privacy', '/contact'].some((x) =>
        pathname.startsWith(x),
      ),
    },
  ];
  const siteTabs = [
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
  // Food (menus and ordering) appears only once the mess menu is live.
  const tabs = mode === 'student' ? appTabs.filter((t) => food || t.label !== 'Food') : siteTabs;
  return (
    <nav
      aria-label="App"
      // The deep blue bar with white labels reads clearly in light and dark, in bright sun, and
      // when a phone browser darkens pages by itself. It sits above the phone's own gesture area.
      className={`${mode === 'student' ? '' : 'md:hidden '}fixed inset-x-0 bottom-0 z-30 bg-[#2F3C7E] text-white border-t border-white/15 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_rgba(16,22,58,0.45)] [color-scheme:dark]`}
    >
      <ul
        className={`m-0 p-0 list-none grid h-16 max-w-[720px] mx-auto ${tabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}
      >
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
        // At least a screen tall: while a page's content is still loading, the footer waits below the
        // fold instead of sitting under the header and jumping down when the content arrives.
        className={`page-enter mx-auto min-h-[calc(100dvh-180px)] ${wide ? 'max-w-[1280px]' : 'max-w-[1100px]'} px-5 sm:px-9 pb-16`}
      >
        {children}
      </main>
      {appMode() ? <div className="h-[calc(88px+env(safe-area-inset-bottom))]" /> : <Footer />}
    </>
  );
}
