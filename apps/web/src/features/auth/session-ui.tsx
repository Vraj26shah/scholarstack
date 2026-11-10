import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api, friendly } from '../../lib/api';
import { authGateway } from '../../lib/auth';
import { env } from '../../lib/env';
import { STUDENT_HOME } from '../../lib/landing';
import { useSession } from '../../lib/session';
import { Button } from '../../shared/ui/button';
import { Sheet, Spinner } from '../../shared/ui/feedback';

/** Wrap protected routes: waits for the session, sends signed-out visitors to sign in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading')
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner label="Loading your account" />
      </div>
    );
  if (status === 'signed-out' || status === 'unavailable')
    return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}

/** OAuth and email sign-in links redirect here to finish the session exchange. */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { claim } = useSession();
  const [failed, setFailed] = useState(false);
  const [callbackError, setCallbackError] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const callbackIssue = (() => {
    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.hash.slice(1));
    const error = (url.searchParams.get('error') || params.get('error') || '').toLowerCase();
    const detail = (
      url.searchParams.get('error_description') ||
      params.get('error_description') ||
      params.get('error_code') ||
      ''
    ).toLowerCase();
    if (error.includes('otp_expired') || detail.includes('otp_expired')) return null;
    if (detail.includes('vitbhopal.ac.in') || detail.includes('college email'))
      return `Please choose a Google account with an @${env.domain} email address to sign in.`;
    if (error === 'access_denied' || detail.includes('access_denied'))
      return 'Google sign-in was cancelled or declined. Return to sign-in and try Google again, or use your email link.';
    if (detail.includes('redirect') || detail.includes('redirect_uri'))
      return 'Supabase rejected the sign-in return URL. Add this site’s /auth/callback URL to Supabase Auth → URL Configuration.';
    if (error.includes('provider') || detail.includes('provider'))
      return 'Google sign-in is not enabled or is misconfigured in Supabase Auth. Check Authentication → Sign In / Providers → Google.';
    if (error || detail)
      return 'Google sign-in could not be completed. Check the Google provider settings in Supabase, then try again.';
    return null;
  })();
  const backToSignIn = () => {
    const next = sessionStorage.getItem('auth_next');
    navigate(next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in');
  };

  const showCallbackFailure = useCallback(async (error: unknown) => {
    const domainRejected =
      (error instanceof ApiError && error.code === 'NOT_COLLEGE_EMAIL') ||
      (error instanceof Error && /vitbhopal\.ac\.in|college email/i.test(error.message));
    if (domainRejected) {
      try {
        await useSession.getState().signOut();
      } catch {
        // Clear the rejected local identity best-effort; the user can still return to sign in.
      }
      setFailureMessage(`Please sign in with your @${env.domain} email address.`);
      setCallbackError(false);
    } else {
      setCallbackError(true);
    }
    setFailed(true);
  }, []);

  const retrySessionSetup = async () => {
    setFailed(false);
    try {
      if (!(await authGateway.completeRedirect())) {
        backToSignIn();
        return;
      }
      await claim();
      const target =
        sessionStorage.getItem('auth_next') || (useSession.getState().me?.isAdmin ? '/admin' : STUDENT_HOME);
      sessionStorage.removeItem('auth_next');
      navigate(target, { replace: true });
    } catch (error) {
      await showCallbackFailure(error);
    }
  };

  useEffect(() => {
    void (async () => {
      if (callbackIssue) {
        setCallbackError(true);
        setFailed(true);
        return;
      }
      if (await authGateway.completeRedirect()) {
        await claim();
        const target =
          sessionStorage.getItem('auth_next') ||
          (useSession.getState().me?.isAdmin ? '/admin' : STUDENT_HOME);
        sessionStorage.removeItem('auth_next');
        navigate(target, { replace: true });
      } else setFailed(true);
    })().catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'SESSION_REPLACED') {
        const target =
          sessionStorage.getItem('auth_next') ||
          (useSession.getState().me?.isAdmin ? '/admin' : STUDENT_HOME);
        sessionStorage.removeItem('auth_next');
        navigate(target, { replace: true });
        return;
      }
      void showCallbackFailure(error);
    });
  }, [callbackIssue, claim, navigate, showCallbackFailure]);
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
      {failed ? (
        <>
          <p className="font-display font-extrabold text-3xl m-0">
            {failureMessage ? 'Use your college email' : "That sign-in didn't finish."}
          </p>
          <p className="text-ink2 m-0">
            {failureMessage ||
              callbackIssue ||
              (callbackError
                ? 'We could not finish sign-in in this browser. Check your connection and retry here; if the link has expired, request a fresh one.'
                : 'This sign-in link has expired, was already used, or was opened in a different browser. Return to the browser where you requested it, or request a fresh link.')}
          </p>
          <Button
            onClick={() => (callbackError && !callbackIssue ? void retrySessionSetup() : backToSignIn())}
          >
            {callbackIssue
              ? 'Back to sign-in options'
              : callbackError
                ? 'Finish sign-in here'
                : 'Back to sign-in options'}
          </Button>
          {callbackError && !callbackIssue && (
            <Button variant="outline" onClick={backToSignIn}>
              Back to sign-in options
            </Button>
          )}
        </>
      ) : (
        <Spinner label="Finishing sign-in" />
      )}
    </div>
  );
}

/** Global sheets for the session rules: signed out elsewhere and device limit. */
export function SessionSheets() {
  const { status, blockingDevices, replacedReason, signOut, me, setMe, claim } = useSession();
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);
  const [removingDevice, setRemovingDevice] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const signInAgain = async () => {
    await signOut();
    navigate('/sign-in');
  };

  return (
    <>
      <Sheet
        open={status === 'replaced'}
        dismissible={false}
        title={
          <>
            This sign-in is <span className="text-blush-text">no longer active.</span>
          </>
        }
      >
        <p className="m-0 text-[15px] leading-relaxed text-ink2">
          {replacedReason === 'device-check'
            ? 'This browser’s sign-in was reset (cleared site data or a copied link). Sign in again here; your other device stays signed in.'
            : 'You signed in again on this account, so this older sign-in closed. Sign in again here; your other device stays signed in.'}
        </p>
        <Button variant="mist" size="lg" onClick={() => void signInAgain()}>
          Sign in again on this device
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await signOut();
            navigate('/sign-in?next=/account');
          }}
        >
          Review devices after sign-in
        </Button>
        <p className="m-0 text-xs text-ink2 text-center">
          You can review and remove registered devices in Account.
        </p>
      </Sheet>

      <Sheet open={status === 'device-limit'} dismissible={false} title="Two devices already.">
        {(() => {
          const when = (iso: string) =>
            new Date(iso).toLocaleString([], {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            });
          const freeAt = blockingDevices
            .map((d) => d.removalAt)
            .filter((x): x is string => Boolean(x))
            .sort()[0];
          const ready = freeAt ? new Date(freeAt).getTime() <= now : false;
          return freeAt ? (
            <div role="status" className="rounded-2xl bg-mist/50 px-4 py-3 flex flex-col gap-1">
              <span className="text-[13px] text-ink2">
                {ready ? 'A slot is free now' : 'You can sign in here from'}
              </span>
              <span className="font-display text-[22px] font-extrabold leading-tight">
                {ready ? 'Tap “Try again”.' : when(freeAt)}
              </span>
            </div>
          ) : (
            <p className="m-0 text-[15px] leading-relaxed text-ink2">
              Your account is signed in on two devices. Pick one to sign out; it keeps working for three days,
              then this device can sign in.
            </p>
          );
        })()}
        <ul className="list-none m-0 p-0 flex flex-col gap-2">
          {blockingDevices.map((d) => {
            const anyScheduled = blockingDevices.some((device) => Boolean(device.removalAt));
            const cooling = Boolean(
              me?.deviceCooldownUntil && new Date(me.deviceCooldownUntil).getTime() > now,
            );
            return (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sunk px-3.5 py-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{d.label}</span>
                  <span className="text-ink2">
                    Last used{' '}
                    {new Date(d.lastSeenAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                  </span>
                  {d.removalAt && (
                    <span className="block text-marigold-text">
                      Signs out{' '}
                      {new Date(d.removalAt).toLocaleString([], {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </span>
                {!d.removalAt && !anyScheduled && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={removingDevice !== null || cooling}
                    onClick={async () => {
                      setRemovingDevice(d.id);
                      setRemoveError(null);
                      setRemovalNotice(null);
                      try {
                        const updatedMe = await api.removeDevice(d.id);
                        setMe(updatedMe);
                        useSession.setState({ blockingDevices: updatedMe.devices });
                        setRemovalNotice(`${d.label} keeps working until then; nothing else to do.`);
                      } catch (error) {
                        setRemoveError(friendly(error));
                      } finally {
                        setRemovingDevice(null);
                      }
                    }}
                  >
                    {removingDevice === d.id ? 'Scheduling…' : 'Sign this one out'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="m-0 text-[13px] leading-relaxed text-ink2">
          Using the same phone or laptop as before? It's recognised by itself once its old sign-in hasn't been
          used for a day.
        </p>
        {removeError && (
          <p role="alert" className="m-0 text-sm text-blush-text">
            {removeError}
          </p>
        )}
        {removalNotice && (
          <p role="status" className="m-0 rounded-xl bg-mist px-3 py-2 text-sm text-ink">
            {removalNotice}
          </p>
        )}
        <Button
          variant="mist"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            setRemoveError(null);
            try {
              await claim();
            } catch (error) {
              setRemoveError(friendly(error));
            } finally {
              setRetrying(false);
            }
          }}
        >
          {retrying ? 'Checking…' : 'Try again'}
        </Button>
        <Button variant="ghost" onClick={signInAgain}>
          Sign out on this device
        </Button>
      </Sheet>
    </>
  );
}
