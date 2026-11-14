import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useEffect, useRef } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom';
import { AuthCallbackPage, RequireAuth, SessionSheets } from '../features/auth/session-ui';
import { SignInPage } from '../features/auth/sign-in-page';
import { HomePage } from '../features/catalogue/home-page';
import { CoursePage } from '../features/course/course-page';
import { ShelfPage } from '../features/shelf/shelf-page';
import { track, trackPageView } from '../lib/analytics';
import { ApiError } from '../lib/api';
import { authGateway } from '../lib/auth';
import { STUDENT_HOME, decidesLanding, isPhone, jumpTo, landing } from '../lib/landing';
import { recordVisit } from '../lib/nav-history';
import { persistQueries, restoreQueries } from '../lib/persist-queries';
import { loadScreen, releaseWaiting } from '../lib/release-sync';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { LinkButton } from '../shared/ui/button';
import { Page, TabBar } from '../shared/ui/chrome';
import { ErrorBoundary } from '../shared/ui/error-boundary';
import { OfflineBanner, Spinner } from '../shared/ui/feedback';
import { Eyebrow, PageTitle } from '../shared/ui/page-title';
import { SwipeTabs } from '../shared/ui/swipe';

/** Only ever return to a page on this site (never an outside address or "//evil.com"). */
const localPath = (p: string | null) => (p?.startsWith('/') && !p.startsWith('//') ? p : null);

const AccountPage = lazy(
  loadScreen(() => import('../features/account/account-page').then((m) => ({ default: m.AccountPage }))),
);
const AdminPage = lazy(
  loadScreen(() => import('../features/admin/admin-page').then((m) => ({ default: m.AdminPage }))),
);
const CheckoutPage = lazy(
  loadScreen(() => import('../features/checkout/checkout-page').then((m) => ({ default: m.CheckoutPage }))),
);
const ReaderPage = lazy(
  loadScreen(() => import('../features/reader/reader-page').then((m) => ({ default: m.ReaderPage }))),
);
const BundlePage = lazy(
  loadScreen(() => import('../features/bundles/bundle-page').then((m) => ({ default: m.BundlePage }))),
);
const ContributePage = lazy(
  loadScreen(() =>
    import('../features/contribute/contribute-page').then((m) => ({ default: m.ContributePage })),
  ),
);
const HelpPage = lazy(
  loadScreen(() => import('../features/help/help-page').then((m) => ({ default: m.HelpPage }))),
);
const ToolPage = lazy(
  loadScreen(() => import('../features/tools/tool-page').then((m) => ({ default: m.ToolPage }))),
);
const UnsubscribePage = lazy(
  loadScreen(() =>
    import('../features/tools/unsubscribe-page').then((m) => ({ default: m.UnsubscribePage })),
  ),
);
const legal = loadScreen(() => import('../features/legal/legal-pages'));
const TermsPage = lazy(() => legal().then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => legal().then((m) => ({ default: m.PrivacyPage })));
const ContactPage = lazy(() => legal().then((m) => ({ default: m.ContactPage })));

export const queryClient: QueryClient = new QueryClient({
  // Any admin change that succeeds refreshes every admin list and the public pages it affects,
  // so each section shows the same truth at once: a badge clears, a course moves to Live, a
  // student's row shows the new access. Only what's on screen reloads; the rest reloads when opened.
  mutationCache: new MutationCache({
    onSuccess: () => {
      if (!window.location.pathname.startsWith('/admin')) return;
      void queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return (
            typeof k === 'string' &&
            (k.startsWith('admin') || ['catalogue', 'drawer', 'course', 'bundles', 'bundle'].includes(k))
          );
        },
      });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Coming back to the tab brings in anything an admin changed meanwhile (only data that is
      // older than staleTime is fetched again, so this stays cheap).
      refetchOnWindowFocus: true,
      // Don't hammer the API on errors the user has to act on.
      // A busy moment on the server (a 5xx or a dropped connection) is retried three times over
      // about five seconds before anything is shown; real outages still surface quickly.
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 3,
      retryDelay: (attempt) => Math.min(600 * 2 ** attempt, 3_000),
    },
  },
});

// The catalogue the student saw last time shows at once on their next visit, then refreshes.
declare const __BUILD_ID__: string;
const BUILD = typeof __BUILD_ID__ === 'undefined' ? 'dev' : __BUILD_ID__;
restoreQueries(queryClient, BUILD);
persistQueries(queryClient, BUILD);

// The browser must not put the old scroll back on a refresh: the landing rule decides.
if (typeof window !== 'undefined' && 'scrollRestoration' in window.history)
  window.history.scrollRestoration = 'manual';

/** Where each page in this tab was scrolled to, by history position. */
const scrollByIdx = new Map<number, number>();
const historyIdx = () => {
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === 'number' ? state.idx : 0;
};

/**
 * Scroll like a native app: a new page starts at the top (or at its #hash), and going Back
 * returns to exactly where you were on that page, waiting for its content to load first.
 * Also records each visit for the "Back to …" buttons.
 */
function ScrollManager() {
  const { pathname, search, hash, state } = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    let raf = 0;
    const save = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => scrollByIdx.set(historyIdx(), window.scrollY));
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', save);
    };
  }, []);
  const scrolledFor = useRef<{ pathname: string; hash: string } | null>(null);
  useEffect(() => {
    recordVisit(`${pathname}${search}${hash}`);
  }, [pathname, search, hash]);
  // Query-string-only updates (live catalogue search, batch tabs) must not jump the page.
  useEffect(() => {
    const saved = scrollByIdx.get(historyIdx());
    if (type === 'POP' && saved !== undefined) {
      scrolledFor.current = { pathname, hash };
      // The page may still be loading its cards: keep trying until it is tall enough (max ~1.5 s).
      let tries = 0;
      const restore = () => {
        const reachable = document.documentElement.scrollHeight - window.innerHeight >= saved - 4;
        window.scrollTo(0, saved);
        if (!reachable && tries++ < 30) t = setTimeout(restore, 50);
      };
      let t = setTimeout(restore, 0);
      return () => clearTimeout(t);
    }
    const samePlace =
      scrolledFor.current !== null &&
      scrolledFor.current.pathname === pathname &&
      scrolledFor.current.hash === hash;
    if (samePlace) return;
    scrolledFor.current = { pathname, hash };
    // An address tidy-up (the landing taking #catalogue off) never moves the page.
    if ((state as { keepScroll?: boolean } | null)?.keepScroll) return;
    // The page the browser opened: <LandingManager> places the home page once it knows who
    // is here. Until then it stays at the top.
    if (landing.pending && decidesLanding(pathname, hash)) {
      window.scrollTo(0, 0);
      return;
    }
    if (hash) {
      const id = hash.slice(1);
      // A tab tap from another route lands here while the section is still mounting, and cards
      // loading above the target can push it down. Scroll smoothly once, then follow it with
      // instant nudges until its absolute position settles (max ~1.5 s).
      let timer = 0;
      let tries = 0;
      let smoothed = false;
      let lastY = -1;
      const go = () => {
        const el = document.getElementById(id);
        if (!el) {
          if (tries++ < 30) timer = setTimeout(go, 50);
          return;
        }
        // Absolute document position is invariant under scrolling, so it only changes when
        // content loads above the target and shifts it.
        const y = el.getBoundingClientRect().top + window.scrollY;
        if (!smoothed) {
          el.scrollIntoView({ behavior: 'smooth' });
          smoothed = true;
          lastY = y;
          timer = setTimeout(go, 100);
          return;
        }
        if (y !== lastY && tries++ < 30) {
          window.scrollTo(0, y);
          lastY = y;
          timer = setTimeout(go, 50);
        }
      };
      timer = setTimeout(go, 60);
      return () => clearTimeout(timer);
    }
    window.scrollTo(0, 0);
  }, [pathname, hash, type, state]);
  return null;
}

/**
 * Places the page the browser opened (see lib/landing.ts): signed out → the top of the home
 * page, and "#catalogue" comes off the address so the next refresh does the same; signed in on a
 * phone → straight to the catalogue. Waits for the session (at most 2.5 s, then treats the
 * visitor as signed out).
 */
function LandingManager() {
  const status = useSession((s) => s.status);
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const decided = useRef(false);
  const decide = useRef<(signedIn: boolean) => void>(() => {});
  decide.current = (signedIn) => {
    if (decided.current) return;
    decided.current = true;
    landing.pending = false;
    if (!decidesLanding(pathname, hash)) return;
    if (signedIn && isPhone()) {
      jumpTo('catalogue');
      if (hash !== '#catalogue') navigate(`/${search}#catalogue`, { replace: true });
    } else if (signedIn && hash === '#catalogue') {
      jumpTo('catalogue');
    } else if (hash === '#catalogue') {
      // The page is already at the top (or wherever the visitor has scrolled since): only the
      // address changes, so the next refresh opens on the hero too.
      navigate(`/${search}`, { replace: true, state: { keepScroll: true } });
    }
  };
  useEffect(() => {
    if (decided.current) return;
    // Opened on another page: nothing to place.
    if (!decidesLanding(pathname, hash)) {
      decided.current = true;
      landing.pending = false;
      return;
    }
    if (status === 'loading') return;
    decide.current(status === 'ready');
  }, [status, pathname, hash]);
  useEffect(() => {
    const t = window.setTimeout(() => decide.current(false), 2500);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}

/** Accept links generated before the callback redirect was configured (Supabase returns to `/`). */
function RootAuthCodeHandler() {
  const location = useLocation();
  const navigate = useNavigate();
  const claim = useSession((s) => s.claim);
  const code = new URLSearchParams(location.search).get('code');

  useEffect(() => {
    if (!code || location.pathname === '/auth/callback') return;
    let active = true;
    void (async () => {
      try {
        if (!(await authGateway.completeRedirect())) {
          if (active) navigate('/auth/callback?failed=1', { replace: true });
          return;
        }
        await claim();
        track('login');
        const target =
          localPath(sessionStorage.getItem('auth_next')) ||
          (useSession.getState().me?.isAdmin ? '/admin' : STUDENT_HOME);
        sessionStorage.removeItem('auth_next');
        if (active) navigate(target, { replace: true });
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.code === 'SESSION_REPLACED') {
          const target =
            localPath(sessionStorage.getItem('auth_next')) ||
            (useSession.getState().me?.isAdmin ? '/admin' : STUDENT_HOME);
          sessionStorage.removeItem('auth_next');
          navigate(target, { replace: true });
          return;
        }
        navigate('/auth/callback?failed=1', { replace: true });
      }
    })();
    return () => {
      active = false;
    };
  }, [claim, code, location.pathname, navigate]);

  if (!code || location.pathname === '/auth/callback') return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg">
      <Spinner label="Finishing sign-in" />
    </div>
  );
}

/** One page_view per route change; the Google tag does not see SPA navigations by itself. */
function PageViews() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    trackPageView(`${pathname}${search}`);
  }, [pathname, search]);
  return null;
}

/** TEMPORARY: throws on render so Sentry's pipeline can be verified on the live site. */
function SentryTestCrash(): never {
  throw new Error(`Sentry test error ${new Date().toISOString()}`);
}

function NotFound() {
  return (
    <Page>
      <div className="py-20 flex flex-col items-start gap-5">
        <Eyebrow>404 · Not in the catalogue</Eyebrow>
        <PageTitle>This card’s misfiled.</PageTitle>
        <LinkButton to="/">Back to the catalogue</LinkButton>
      </div>
    </Page>
  );
}

function Shell() {
  const { pathname: routeKey } = useLocation();
  // A new release went live while this tab was open: move to it between screens, not mid-task.
  const lastRoute = useRef(routeKey);
  useEffect(() => {
    if (lastRoute.current !== routeKey && releaseWaiting()) window.location.reload();
    lastRoute.current = routeKey;
  }, [routeKey]);
  const bootstrap = useSession((s) => s.bootstrap);
  const status = useSession((s) => s.status);
  useTheme(); // applies the persisted theme
  useEffect(() => {
    // Let the link callback exchange its PKCE code first; bootstrapping here would see no session.
    if (new URLSearchParams(window.location.search).has('code')) return;
    void bootstrap();
  }, [bootstrap]);
  // A different user's data must never linger in the cache.
  useEffect(() => {
    if (status === 'signed-out')
      queryClient.removeQueries({
        // Only the signed-in student's own data. Public queries (catalogue, bundles, tools…) stay,
        // and removing them mid-flight would leave their screens stuck loading.
        predicate: (q) => {
          const k = String(q.queryKey[0]);
          return k === 'shelf' || k.startsWith('admin-') || k === 'demo-outbox';
        },
      });
  }, [status]);

  const guard = (el: React.ReactNode) => <RequireAuth>{el}</RequireAuth>;
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 bg-brand text-white px-4 py-2 rounded-full"
      >
        Skip to content
      </a>
      <OfflineBanner />
      <PageViews />
      <ScrollManager />
      <LandingManager />
      <RootAuthCodeHandler />
      <ErrorBoundary resetKey={routeKey}>
        <Suspense
          fallback={
            <div className="min-h-dvh flex items-center justify-center">
              <Spinner label="Loading" />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/c/:slug" element={<CoursePage />} />
            <Route path="/b/:slug" element={<BundlePage />} />
            <Route path="/tools" element={<Navigate to="/#toolbox" replace />} />
            <Route path="/tools/:key" element={<ToolPage />} />
            <Route path="/contribute" element={<ContributePage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/unsubscribe" element={<UnsubscribePage />} />
            <Route path="/sign-in" element={<SignInPage />} />
            <Route path="/admin/login" element={<SignInPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/checkout/:orderId" element={guard(<CheckoutPage />)} />
            <Route path="/shelf" element={guard(<ShelfPage />)} />
            <Route path="/read/:fileId" element={guard(<ReaderPage />)} />
            <Route path="/account" element={guard(<AccountPage />)} />
            <Route path="/admin" element={guard(<AdminPage />)} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/contact" element={<ContactPage />} />
            {/* TEMPORARY: remove once Sentry is verified live. */}
            <Route path="/__sentry-test" element={<SentryTestCrash />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      <TabBar />
      <SwipeTabs />
      <SessionSheets />
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
