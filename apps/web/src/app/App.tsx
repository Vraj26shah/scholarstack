import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useEffect, useRef } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { AuthCallbackPage, RequireAuth, SessionSheets } from '../features/auth/session-ui';
import { SignInPage } from '../features/auth/sign-in-page';
import { HomePage } from '../features/catalogue/home-page';
import { CoursePage } from '../features/course/course-page';
import { ShelfPage } from '../features/shelf/shelf-page';
import { ApiError } from '../lib/api';
import { authGateway } from '../lib/auth';
import { recordVisit } from '../lib/nav-history';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { LinkButton } from '../shared/ui/button';
import { Page, TabBar } from '../shared/ui/chrome';
import { OfflineBanner, Spinner } from '../shared/ui/feedback';

/** Only ever return to a page on this site (never an outside address or "//evil.com"). */
const localPath = (p: string | null) => (p?.startsWith('/') && !p.startsWith('//') ? p : null);

const AccountPage = lazy(() =>
  import('../features/account/account-page').then((m) => ({ default: m.AccountPage })),
);
const AdminPage = lazy(() => import('../features/admin/admin-page').then((m) => ({ default: m.AdminPage })));
const CheckoutPage = lazy(() =>
  import('../features/checkout/checkout-page').then((m) => ({ default: m.CheckoutPage })),
);
const ReaderPage = lazy(() =>
  import('../features/reader/reader-page').then((m) => ({ default: m.ReaderPage })),
);
const BundlePage = lazy(() =>
  import('../features/bundles/bundle-page').then((m) => ({ default: m.BundlePage })),
);
const ContributePage = lazy(() =>
  import('../features/contribute/contribute-page').then((m) => ({ default: m.ContributePage })),
);
const HelpPage = lazy(() => import('../features/help/help-page').then((m) => ({ default: m.HelpPage })));
const ToolPage = lazy(() => import('../features/tools/tool-page').then((m) => ({ default: m.ToolPage })));
const UnsubscribePage = lazy(() =>
  import('../features/tools/unsubscribe-page').then((m) => ({ default: m.UnsubscribePage })),
);
const legal = () => import('../features/legal/legal-pages');
const TermsPage = lazy(() => legal().then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => legal().then((m) => ({ default: m.PrivacyPage })));
const ContactPage = lazy(() => legal().then((m) => ({ default: m.ContactPage })));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Don't hammer the API on errors the user has to act on.
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
      // Retry quickly (0.5 s, then 1 s) so a real outage shows its message in about two seconds.
      retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2_000),
    },
  },
});

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
  const { pathname, search, hash } = useLocation();
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
  }, [pathname, hash, type]);
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
        const target =
          localPath(sessionStorage.getItem('auth_next')) ||
          (useSession.getState().me?.isAdmin ? '/admin' : '/shelf');
        sessionStorage.removeItem('auth_next');
        if (active) navigate(target, { replace: true });
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.code === 'SESSION_REPLACED') {
          const target =
            localPath(sessionStorage.getItem('auth_next')) ||
            (useSession.getState().me?.isAdmin ? '/admin' : '/shelf');
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

function NotFound() {
  return (
    <Page>
      <div className="py-20 flex flex-col items-start gap-5">
        <p className="m-0 font-mono text-xs tracking-[0.14em] text-ink2">404 · Not in the catalogue</p>
        <h1 className="m-0 font-display font-extrabold text-[clamp(44px,8vw,80px)] leading-[0.92] tracking-[-0.05em]">
          This card’s misfiled.
        </h1>
        <LinkButton to="/">Back to the catalogue</LinkButton>
      </div>
    </Page>
  );
}

function Shell() {
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
      <ScrollManager />
      <RootAuthCodeHandler />
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
          <Route path="/tools/:key" element={<ToolPage />} />
          <Route path="/contribute" element={<ContributePage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/unsubscribe" element={<UnsubscribePage />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/admin/login" element={<SignInPage adminMode />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/checkout/:orderId" element={guard(<CheckoutPage />)} />
          <Route path="/shelf" element={guard(<ShelfPage />)} />
          <Route path="/read/:fileId" element={guard(<ReaderPage />)} />
          <Route path="/account" element={guard(<AccountPage />)} />
          <Route path="/admin" element={guard(<AdminPage />)} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <TabBar />
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
