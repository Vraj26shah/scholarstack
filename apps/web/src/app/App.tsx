import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthCallbackPage, RequireAuth, SessionSheets } from '../features/auth/session-ui';
import { SignInPage } from '../features/auth/sign-in-page';
import { HomePage } from '../features/catalogue/home-page';
import { CoursePage } from '../features/course/course-page';
import { ShelfPage } from '../features/shelf/shelf-page';
import { ApiError } from '../lib/api';
import { authGateway } from '../lib/auth';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { LinkButton } from '../shared/ui/button';
import { Page, TabBar } from '../shared/ui/chrome';
import { OfflineBanner, Spinner } from '../shared/ui/feedback';

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
    },
  },
});

/** Scrolls to #hash targets (e.g. /#catalogue) and to the top on page change. */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not an input.
  useEffect(() => {
    if (hash) {
      const id = hash.slice(1);
      const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 60);
      return () => clearTimeout(t);
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
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
        if (active) navigate('/shelf', { replace: true });
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.code === 'SESSION_REPLACED') {
          navigate('/shelf', { replace: true });
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
        <p className="m-0 font-mono text-xs tracking-[0.14em] text-ink2">404 · NOT IN THE CATALOGUE</p>
        <h1 className="m-0 font-display font-extrabold text-[clamp(44px,8vw,80px)] leading-[0.92] tracking-[-0.05em]">
          This card's misfiled.
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
          <Route path="/unsubscribe" element={<UnsubscribePage />} />
          <Route path="/sign-in" element={<SignInPage />} />
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
