import { isCollegeEmail, isWellFormedEmail } from '@ss/contracts';
import { type FormEvent, useCallback, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api, friendly } from '../../lib/api';
import { authGateway } from '../../lib/auth';
import { env, isDemo } from '../../lib/env';
import { reportProblem } from '../../lib/problems';
import { useSession } from '../../lib/session';
import { Ambient } from '../../shared/ui/ambient';
import { BlockerHelp } from '../../shared/ui/blocker-help';
import { StackWord, Wordmark } from '../../shared/ui/brand';
import { Button } from '../../shared/ui/button';
import { ThemeToggle } from '../../shared/ui/theme-toggle';
import { Turnstile, turnstileProblem } from './turnstile';

function safeNext(raw: string | null): string {
  return raw?.startsWith('/') && !raw.startsWith('//') ? raw : '/shelf';
}

export function SignInPage({ adminMode: adminProp = false }: { adminMode?: boolean }) {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const { status, claim } = useSession();
  // The admin portal (/sign-in?admin=1) accepts a full address. It grants nothing by itself:
  // the database only lets listed admin addresses sign up, and the server only gives admin
  // rights to an exact listed address that proved its inbox (Google or a one-time link).
  const isAdmin = adminProp || params.get('admin') === '1' || next === '/admin';

  const [username, setUsername] = useState('');
  // Where to land after the emailed link or Google: the page they came from (already checked to
  // be a path on this site by safeNext), or the admin home for the admin portal.
  const returnTo = isAdmin && !next.startsWith('/admin') ? '/admin' : next;
  const [step, setStep] = useState<'email' | 'link-sent'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | undefined>();
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [captchaProblem, setCaptchaProblem] = useState<string | null>(null);
  const onCaptcha = useCallback((t: string) => {
    setCaptcha(t);
    setCaptchaProblem(null);
  }, []);
  // Tokens last a few minutes; Turnstile fetches a new one by itself, so this is silent.
  const onCaptchaExpired = useCallback(() => setCaptcha(undefined), []);
  const onCaptchaError = useCallback(
    (code?: string) => {
      setCaptcha(undefined);
      setCaptchaProblem(turnstileProblem(code, isAdmin));
      reportProblem(
        'blocked',
        `The sign-in security check failed (code ${code ?? 'unknown'})`,
        turnstileProblem(code, true),
      );
    },
    [isAdmin],
  );
  const retryCaptcha = () => {
    setCaptchaProblem(null);
    setCaptcha(undefined);
    setCaptchaResetKey((key) => key + 1);
  };
  const needsCaptcha = Boolean(env.turnstileSiteKey) && !isDemo;
  // The security check loads only once the student starts on the email form, so Google sign-in
  // (and just looking at this page) never loads it, and its console noise stays away.
  const [captchaArmed, setCaptchaArmed] = useState(false);

  if (status === 'ready') {
    const me = useSession.getState().me;
    const dest = me?.isAdmin && !next.startsWith('/admin') ? '/admin' : next;
    return <Navigate to={dest} replace />;
  }

  const isFullEmail = username.includes('@');
  const email = (isFullEmail ? username : `${username}@${env.domain}`).trim().toLowerCase();

  async function finish() {
    await claim();
    const me = useSession.getState().me;
    if (useSession.getState().status === 'ready') {
      // Admins land on the admin page they asked for (e.g. /admin?tab=tools), else the admin home.
      navigate(me?.isAdmin && !next.startsWith('/admin') ? '/admin' : next, { replace: true });
    }
  }

  async function submitEmail(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // A college username gets @vitbhopal.ac.in added. A full address is used exactly as typed, so an
    // admin can sign in with a Gmail (or any address) here too. That grants nothing by itself: the
    // sign-up check in Supabase and the server only accept a non-college address on the admin list.
    const allowed = isFullEmail
      ? isCollegeEmail(email, env.domain) || isWellFormedEmail(email)
      : isCollegeEmail(email, env.domain);
    if (!username.trim() || !allowed) {
      setError(
        isAdmin
          ? 'Enter your full admin email address.'
          : `Use your own @${env.domain} address (letters, numbers and dots only, no "+").`,
      );
      return;
    }
    if (needsCaptcha && !captcha) {
      setCaptchaArmed(true);
      setError(
        captchaProblem ??
          'One moment: the security check above is still finishing. Then press the button again.',
      );
      return;
    }
    setBusy(true);
    try {
      // The server says whether this address may sign in (college, or an admin of any domain),
      // and blocks a network that keeps trying addresses that can't.
      await api.checkSignInEmail(email);
      sessionStorage.setItem('auth_next', returnTo);
      await authGateway.startEmail(email, captcha, isAdmin);
      if (isDemo) await finish();
      else setStep('link-sent');
    } catch (err) {
      setError(err instanceof ApiError ? friendly(err) : (err as Error).message || friendly(err));
    } finally {
      setBusy(false);
      setCaptcha(undefined);
      setCaptchaResetKey((key) => key + 1);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">
      <section className="relative overflow-hidden bg-brand text-white md:w-[46%] px-6 pt-6 pb-28 md:pb-10 md:min-h-dvh flex flex-col rounded-b-[36px] md:rounded-none md:rounded-r-[36px]">
        <Ambient tone="navy" />
        <div className="flex items-center justify-between">
          <Wordmark onDark size="sm" />
          <ThemeToggle onDark />
        </div>
        <h1 className="mt-10 md:mt-auto mb-0 font-display font-extrabold text-[clamp(56px,9vw,96px)] leading-[0.9] tracking-[-0.055em]">
          {isAdmin ? (
            <>
              Admin,
              <br />
              <StackWord className="mt-2 text-mist">portal.</StackWord>
            </>
          ) : (
            <>
              Hey,
              <br />
              <StackWord className="mt-2 text-mist">scholar.</StackWord>
            </>
          )}
        </h1>
        <p className="hidden md:block text-on-brand2 text-lg max-w-[380px] mt-6 mb-auto">
          {isAdmin
            ? 'Administrator sign-in for scholars stack management.'
            : 'Your college email is your library card. Only VIT Bhopal students get in.'}
        </p>
      </section>

      <div className="relative -mt-24 md:mt-0 mx-6 md:mx-0 md:flex-1 md:flex md:items-center md:justify-center">
        <div className="w-full md:max-w-[440px] flex flex-col">
          <div
            aria-hidden="true"
            className="ruled relative rounded-2xl p-[14px_18px] h-[150px] -rotate-[1.5deg] shadow-[0_24px_40px_-24px_rgba(0,0,0,0.55)] md:mb-8 select-none"
            style={{ backgroundColor: '#fff', color: '#161B3A', backgroundImage: 'none' }}
          >
            <div className="flex justify-between font-mono text-[10px] tracking-[0.12em] text-[#4D5675] pb-2 border-b-2 border-[#E39AA6]">
              <span>{isAdmin ? 'ADMINISTRATOR CARD' : 'BORROWER CARD'}</span>
              <span>VIT BHOPAL</span>
            </div>
            <div className="mt-3.5 font-mono text-[10px] text-[#4D5675]">
              {isAdmin ? 'ADMINISTRATOR' : 'BORROWER'}
            </div>
            <div className="border-b border-dashed border-[#C7CCDA] h-6 font-display font-bold text-lg tracking-[-0.02em] truncate">
              {isFullEmail ? (
                <span>{username}</span>
              ) : (
                <>
                  {username || 'your.name'}
                  <span className="text-[#4D5675] font-medium">@{env.domain}</span>
                </>
              )}
            </div>
            <div className="mt-3 flex justify-between font-mono text-[10px] text-[#4D5675]">
              <span>{isAdmin ? 'SYSTEM ADMINISTRATOR' : "VALID WHILE YOU'RE A STUDENT"}</span>
              <span className="text-[#12728A] font-semibold">NO PASSWORD</span>
            </div>
          </div>

          <div className="py-6 flex flex-col gap-4">
            {step === 'email' ? (
              <>
                <p className="m-0 text-[15px] text-ink2 md:hidden">
                  {isAdmin
                    ? 'Administrator sign-in for scholars stack management.'
                    : 'Your college email is your library card. Only VIT Bhopal students get in.'}
                </p>
                {authGateway.supportsGoogle && (
                  <>
                    <Button
                      variant="brand"
                      size="lg"
                      disabled={busy}
                      onClick={async () => {
                        setError(null);
                        setBusy(true);
                        try {
                          sessionStorage.setItem('auth_next', returnTo);
                          await authGateway.startGoogle(isAdmin);
                        } catch (e) {
                          setError(
                            e instanceof ApiError
                              ? friendly(e)
                              : (e as Error).message || 'Google sign-in could not start. Please try again.',
                          );
                          setBusy(false);
                        }
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="w-6 h-6 rounded-full bg-white text-brand inline-flex items-center justify-center text-[13px] font-bold"
                      >
                        G
                      </span>
                      {busy
                        ? 'Opening Google…'
                        : isAdmin
                          ? 'Continue with Admin Google'
                          : 'Continue with Google'}
                    </Button>
                    <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.12em] text-ink2">
                      <span className="flex-1 h-px bg-line" />
                      OR USE EMAIL
                      <span className="flex-1 h-px bg-line" />
                    </div>
                  </>
                )}
                {isDemo && (
                  <p className="m-0 text-sm text-ink2">
                    Demo mode: any <strong>@{env.domain}</strong> email signs you straight in. Use{' '}
                    <strong>admin</strong> for the admin tools.
                  </p>
                )}
                <form onSubmit={submitEmail} className="flex flex-col gap-2.5" noValidate>
                  <label htmlFor="email" className="text-sm font-semibold">
                    {isAdmin ? 'Administrator email' : 'College email'}
                  </label>
                  <div className="flex items-center h-14 rounded-2xl bg-surface border-2 border-teal overflow-hidden focus-within:outline focus-within:outline-3 focus-within:outline-teal/40">
                    <input
                      id="email"
                      type="text"
                      inputMode="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder={isAdmin ? 'admin email address' : 'your.name'}
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setCaptchaArmed(true);
                      }}
                      onFocus={() => setCaptchaArmed(true)}
                      className="flex-1 min-w-0 h-full border-0 outline-none pl-4 text-base bg-transparent text-ink"
                      aria-describedby="email-hint"
                    />
                    {!isFullEmail && (
                      <span className="h-full inline-flex items-center px-3 bg-sunk text-ink2 font-mono text-xs">
                        @{env.domain}
                      </span>
                    )}
                  </div>
                  {captchaArmed && (
                    <Turnstile
                      key={captchaResetKey}
                      siteKey={env.turnstileSiteKey}
                      onToken={onCaptcha}
                      onExpired={onCaptchaExpired}
                      onError={onCaptchaError}
                    />
                  )}
                  {captchaProblem && (
                    <p role="alert" className="m-0 text-sm bg-blush text-blush-text rounded-xl px-3 py-2">
                      {captchaProblem}{' '}
                      <button type="button" onClick={retryCaptcha} className="font-semibold underline">
                        Try the check again
                      </button>
                    </p>
                  )}
                  {captchaProblem && /blocker/i.test(captchaProblem) && (
                    <div>
                      <BlockerHelp what="sign-in" />
                      <p className="m-0 mt-2 text-[13px] text-ink2">
                        Or skip the email link and use Continue with Google above.
                      </p>
                    </div>
                  )}
                  <Button type="submit" variant="mist" size="lg" disabled={busy}>
                    {busy ? 'Sending link…' : isDemo ? 'Sign in' : 'Email me a sign-in link'}
                  </Button>
                  <p id="email-hint" className="m-0 text-sm text-ink2">
                    {isAdmin
                      ? 'Only listed admin addresses can sign in here. We email a one-time link to prove it is you.'
                      : isFullEmail && !email.endsWith(`@${env.domain}`)
                        ? `Not a @${env.domain} address: only listed admins can sign in with it.`
                        : 'Just your username (admins: type your full email). We email a one-time link.'}
                  </p>
                </form>
              </>
            ) : (
              <div className="flex flex-col gap-3" role="status" aria-live="polite">
                <p className="m-0 text-lg font-semibold text-ink">
                  {isAdmin ? 'Check your inbox' : 'Check your college inbox'}
                </p>
                <p className="m-0 text-[15px] text-ink2">
                  We sent one sign-in link to <strong className="text-ink">{email}</strong>. Open that link in
                  this browser to finish signing in.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setCaptcha(undefined);
                    setStep('email');
                  }}
                  className="text-sm text-teal-text bg-transparent border-0 cursor-pointer self-start p-0"
                >
                  Use a different email or resend
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="m-0 text-sm bg-blush text-blush-text rounded-xl px-3 py-2">
                {error}
              </p>
            )}
            <p className="m-0 mt-2 text-xs text-ink2 text-center">
              By continuing you agree to the{' '}
              <Link to="/terms" className="text-teal-text">
                Terms
              </Link>{' '}
              and{' '}
              <Link to="/privacy" className="text-teal-text">
                Privacy policy
              </Link>
              .
            </p>
            <p className="m-0 text-xs text-ink2 text-center">
              {isAdmin ? (
                <>
                  Student?{' '}
                  <Link to="/sign-in" className="text-teal-text">
                    Sign in with your college email
                  </Link>
                </>
              ) : (
                <>
                  Admin with a Gmail or other address?{' '}
                  <Link to="/admin/login" className="text-teal-text">
                    Admin sign-in
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
