import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeName } from '../lib/sentry';

describe('routeName', () => {
  it('groups pages with ids into one route, so each page type is one row in Sentry', () => {
    expect(routeName('/c/dbms-2025-cse-core')).toBe('/c/:slug');
    expect(routeName('/b/pack-2025-bce/')).toBe('/b/:slug');
    expect(routeName('/read/7f3a')).toBe('/read/:fileId');
    expect(routeName('/checkout/abc-123')).toBe('/checkout/:orderId');
    expect(routeName('/')).toBe('/');
    expect(routeName('/admin/')).toBe('/admin');
    expect(routeName('/shelf')).toBe('/shelf');
  });
});

describe('analytics → Sentry', () => {
  const sdk = {
    captureException: vi.fn(),
    setUser: vi.fn(),
    setTag: vi.fn(),
  };
  const startSentry = vi.fn(() => sdk);

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.us.sentry.io/2');
    vi.stubEnv('VITE_APP_RELEASE', 'abc123');
    vi.doMock('../lib/sentry', () => ({ startSentry, routeName }));
    for (const f of [sdk.captureException, sdk.setUser, sdk.setTag, startSentry]) f.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('../lib/sentry');
  });

  it('keeps errors and the student from before the SDK loaded, then sends them; reports through the tunnel', async () => {
    const a = await import('../lib/analytics');
    const early = new Error('crash during start');
    a.captureException(early);
    a.setMonitoringUser({ id: 'u1', email: 'asha@vitbhopal.ac.in', isAdmin: false });
    a.initAnalytics();
    await vi.waitFor(() => expect(startSentry).toHaveBeenCalled());
    expect(startSentry).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://k@o1.ingest.us.sentry.io/2',
        tunnel: '/api/monitoring',
        release: 'abc123',
        replaysSessionSampleRate: 0.1,
        tracesSampleRate: 0.2,
      }),
    );
    expect(sdk.captureException).toHaveBeenCalledWith(early);
    expect(sdk.setUser).toHaveBeenCalledWith({ id: 'u1', email: 'asha@vitbhopal.ac.in' });
    expect(sdk.setTag).toHaveBeenCalledWith('role', 'student');

    // After loading, changes go straight through; signing out clears the student.
    a.setMonitoringUser(null);
    expect(sdk.setUser).toHaveBeenLastCalledWith(null);
    expect(sdk.setTag).toHaveBeenLastCalledWith('role', 'visitor');
  });

  it('does nothing at all when no DSN is set', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const a = await import('../lib/analytics');
    a.captureException(new Error('x'));
    a.initAnalytics();
    await new Promise((r) => setTimeout(r, 20));
    expect(startSentry).not.toHaveBeenCalled();
  });
});
