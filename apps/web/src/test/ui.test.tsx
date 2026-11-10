import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthCallbackPage, RequireAuth, SessionSheets } from '../features/auth/session-ui';
import { ApiError, friendly } from '../lib/api';
import { authGateway } from '../lib/auth';
import { useSession } from '../lib/session';
import { Header } from '../shared/ui/chrome';
import { ErrorState, OfflineBanner } from '../shared/ui/feedback';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('friendly()', () => {
  it('maps error codes to plain sentences', () => {
    expect(friendly(new ApiError(403, 'NOT_COLLEGE_EMAIL', 'x'))).toContain('@vitbhopal.ac.in');
    expect(friendly(new ApiError(429, 'RATE_LIMITED', 'x'))).toMatch(/fast/);
    expect(friendly(new ApiError(400, 'BAD_REQUEST', 'Server said no.'))).toBe('Server said no.');
    expect(friendly(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});

describe('OfflineBanner', () => {
  it('stays hidden online and appears when the browser goes offline', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    render(<OfflineBanner />);
    expect(screen.queryByText(/offline/)).toBeNull();
    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('offers a retry when given one', () => {
    const retry = vi.fn();
    render(<ErrorState title="Nope." message="It broke." onRetry={retry} />);
    act(() => screen.getByRole('button').click());
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('RequireAuth', () => {
  const app = () =>
    render(
      <MemoryRouter initialEntries={['/shelf']}>
        <Routes>
          <Route path="/shelf" element={<RequireAuth>secret shelf</RequireAuth>} />
          <Route path="/sign-in" element={<p>sign-in page</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it('sends signed-out visitors to sign in', () => {
    useSession.setState({ status: 'signed-out', me: null });
    app();
    expect(screen.getByText('sign-in page')).toBeInTheDocument();
  });

  it('shows the page once the session is ready', () => {
    useSession.setState({
      status: 'ready',
      me: {
        id: 'u',
        email: 'a@vitbhopal.ac.in',
        fullName: null,
        isAdmin: false,
        emailOptIn: true,
        devices: [],
        deviceCooldownUntil: null,
      },
    });
    app();
    expect(screen.getByText('secret shelf')).toBeInTheDocument();
  });

  it('redirects to sign in when account validation is unavailable', () => {
    useSession.setState({ status: 'unavailable', me: null });
    app();
    expect(screen.queryByText('secret shelf')).toBeNull();
    expect(screen.getByText('sign-in page')).toBeInTheDocument();
  });
});

describe('Google sign-in callback', () => {
  it('explains that a college email is required when the server rejects the Google account', async () => {
    const originalClaim = useSession.getState().claim;
    useSession.setState({ status: 'loading', me: null });
    vi.spyOn(authGateway, 'completeRedirect').mockResolvedValue(true);
    const signOut = vi.spyOn(authGateway, 'signOut').mockResolvedValue();
    vi.spyOn(useSession.getState(), 'claim').mockRejectedValue(
      new ApiError(403, 'NOT_COLLEGE_EMAIL', 'Please sign in with your @vitbhopal.ac.in email.'),
    );

    render(
      <MemoryRouter initialEntries={['/auth/callback']}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Use your college email')).toBeInTheDocument();
    expect(screen.getByText(/@vitbhopal\.ac\.in email address/)).toBeInTheDocument();
    expect(signOut).toHaveBeenCalledOnce();
    useSession.setState({ claim: originalClaim });
  });
});

describe('Header session action', () => {
  it('does not flash a sign-in link while checking an existing session', () => {
    useSession.setState({ status: 'loading', me: null });
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.getByLabelText('Checking your account')).toBeInTheDocument();
  });

  it('shows sign in instead of retry while account validation is unavailable', () => {
    useSession.setState({ status: 'unavailable', me: null });
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('Session replacement notice', () => {
  it('explains that a device check failed while reassuring the other device stays connected', () => {
    useSession.setState({ status: 'replaced', replacedReason: 'device-check' });
    render(
      <MemoryRouter>
        <SessionSheets />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/this browser’s sign-in was reset.*your other device stays signed in/i),
    ).toBeInTheDocument();
  });

  it('explains the three-day grace period when removing a device from the sign-in screen', () => {
    useSession.setState({
      status: 'device-limit',
      blockingDevices: [
        {
          id: 'device-1',
          label: 'Old phone',
          lastSeenAt: '2026-10-20T10:00:00.000Z',
          current: false,
          removalAt: null,
        },
      ],
    });
    render(
      <MemoryRouter>
        <SessionSheets />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/it keeps working for three days, then this device can sign in/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign this one out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out on this device' })).toBeInTheDocument();
  });
});
