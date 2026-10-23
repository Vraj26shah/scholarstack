import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api, friendly } from '../../lib/api';
import { authGateway } from '../../lib/auth';
import { useSession } from '../../lib/session';
import { Button } from '../../shared/ui/button';
import { Sheet, Spinner } from '../../shared/ui/feedback';

/** Wrap protected routes: waits for the session, sends signed-out visitors to sign in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, bootstrap } = useSession();
  const location = useLocation();
  if (status === 'loading')
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner label="Loading your account" />
      </div>
    );
  if (status === 'unavailable')
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-display font-extrabold text-3xl m-0">Couldn't check your account.</p>
        <p className="text-ink2 m-0">Your sign-in is still saved. Check your connection and try again.</p>
        <Button onClick={() => void bootstrap()}>Retry</Button>
      </div>
    );
  if (status === 'signed-out')
    return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}

/** OAuth and email sign-in links redirect here to finish the session exchange. */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { claim } = useSession();
  const [failed, setFailed] = useState(false);
  const [callbackError, setCallbackError] = useState(false);

  const retrySessionSetup = async () => {
    setFailed(false);
    try {
      if (!(await authGateway.completeRedirect())) {
        navigate('/sign-in', { replace: true });
        return;
      }
      await claim();
      navigate('/shelf', { replace: true });
    } catch {
      setCallbackError(true);
      setFailed(true);
    }
  };

  useEffect(() => {
    void (async () => {
      if (await authGateway.completeRedirect()) {
        await claim();
        navigate('/shelf', { replace: true });
      } else setFailed(true);
    })().catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'SESSION_REPLACED') {
        navigate('/shelf', { replace: true });
        return;
      }
      setCallbackError(true);
      setFailed(true);
    });
  }, [claim, navigate]);
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
      {failed ? (
        <>
          <p className="font-display font-extrabold text-3xl m-0">That sign-in didn't finish.</p>
          <p className="text-ink2 m-0">
            {callbackError
              ? 'We could not finish sign-in in this browser. Check your connection and retry here; if the link has expired, request a fresh one.'
              : 'This sign-in link may have expired or already been used. Request a fresh link and open it in the same browser.'}
          </p>
          <Button onClick={() => (callbackError ? void retrySessionSetup() : navigate('/sign-in'))}>
            {callbackError ? 'Finish sign-in here' : 'Request a fresh sign-in link'}
          </Button>
        </>
      ) : (
        <Spinner label="Finishing sign-in" />
      )}
    </div>
  );
}

/** Global sheets for the session rules: signed out elsewhere and device limit. */
export function SessionSheets() {
  const { status, blockingDevices, replacedReason, signOut, claim } = useSession();
  const navigate = useNavigate();
  const [removingDevice, setRemovingDevice] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

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
            ? "This browser's saved device check did not match. Sign in again here; your other signed-in device will stay connected."
            : 'This browser’s previous sign-in is no longer active. Sign in again here; your other signed-in device will stay connected.'}
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
        <p className="m-0 text-[15px] leading-relaxed text-ink2">
          Your account can stay signed in on two devices at once. Remove an old device below to sign in on
          this one.
        </p>
        <ul className="list-none m-0 p-0 flex flex-col gap-2">
          {blockingDevices.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sunk px-3.5 py-3 text-sm"
            >
              <span>
                <span className="block font-semibold">{d.label}</span>
                <span className="text-ink2">Last seen {new Date(d.lastSeenAt).toLocaleDateString()}</span>
              </span>
              <Button
                variant="outline"
                disabled={removingDevice !== null}
                onClick={async () => {
                  setRemovingDevice(d.id);
                  setRemoveError(null);
                  try {
                    await api.removeDevice(d.id);
                    await claim();
                  } catch (error) {
                    setRemoveError(friendly(error));
                  } finally {
                    setRemovingDevice(null);
                  }
                }}
              >
                {removingDevice === d.id ? 'Removing…' : 'Remove and sign in here'}
              </Button>
            </li>
          ))}
        </ul>
        {removeError && (
          <p role="alert" className="m-0 text-sm text-blush-text">
            {removeError}
          </p>
        )}
        <Button variant="ghost" onClick={signInAgain}>
          Sign out on this device
        </Button>
      </Sheet>
    </>
  );
}
