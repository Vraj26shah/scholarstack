import { isCollegeEmail } from '@ss/contracts';
import { type FormEvent, useCallback, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, friendly } from '../../lib/api';
import { authGateway } from '../../lib/auth';
import { env, isDemo } from '../../lib/env';
import { useSession } from '../../lib/session';
import { StackWord, Wordmark } from '../../shared/ui/brand';
import { Button } from '../../shared/ui/button';
import { ThemeToggle } from '../../shared/ui/theme-toggle';
import { Turnstile } from './turnstile';

function safeNext(raw: string | null): string {
  return raw?.startsWith('/') && !raw.startsWith('//') ? raw : '/shelf';
}

export function SignInPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const { status, claim } = useSession();
  const [username, setUsername] = useState('');
  const [step, setStep] = useState<'email' | 'link-sent'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | undefined>();
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const onCaptcha = useCallback((t: string) => setCaptcha(t), []);
  const onCaptchaError = useCallback(() => {
    setCaptcha(undefined);
    setError('The security check expired or could not load. Please try again.');
  }, []);

  if (status === 'ready') return <Navigate to={next} replace />;

  const email = (username.includes('@') ? username : `${username}@${env.domain}`).trim().toLowerCase();

  async function finish() {
    await claim();
    if (useSession.getState().status === 'ready') navigate(next, { replace: true });
  }

  async function submitEmail(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !isCollegeEmail(email, env.domain)) {
      setError(`Only @${env.domain} accounts can sign in.`);
      return;
    }
    setBusy(true);
    try {
      await authGateway.startEmail(email, captcha);
      if (isDemo) await finish();
      else setStep('link-sent');
    } catch (err) {
      setError(err instanceof ApiError ? friendly(err) : (err as Error).message);
    } finally {
      setBusy(false);
      setCaptcha(undefined);
      setCaptchaResetKey((key) => key + 1);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">
      <section className="bg-brand text-white md:w-[46%] px-6 pt-6 pb-28 md:pb-10 md:min-h-dvh flex flex-col rounded-b-[36px] md:rounded-none md:rounded-r-[36px]">
        <div className="flex items-center justify-between">
          <Wordmark onDark size="sm" />
          <ThemeToggle onDark />
        </div>
        <h1 className="mt-10 md:mt-auto mb-0 font-display font-extrabold text-[clamp(56px,9vw,96px)] leading-[0.9] tracking-[-0.055em]">
          Hey,
          <br />
          <StackWord className="mt-2 text-mist">scholar.</StackWord>
        </h1>
        <p className="hidden md:block text-on-brand2 text-lg max-w-[380px] mt-6 mb-auto">
          Your college email is your library card. Only VIT Bhopal students get in.
        </p>
      </section>

      <div className="relative -mt-24 md:mt-0 mx-6 md:mx-0 md:flex-1 md:flex md:items-center md:justify-center">
        <div className="w-full md:max-w-[440px] flex flex-col">
          <div
            aria-hidden="true"
            className="ruled relative rounded-2xl p-[14px_18px] h-[150px] -rotate-[1.5deg] shadow-[0_24px_40px_-24px_rgba(0,0,0,0.55)] md:mb-8"
            style={{ backgroundColor: '#fff', color: '#161B3A', backgroundImage: 'none' }}
          >
            <div className="flex justify-between font-mono text-[10px] tracking-[0.12em] text-[#4D5675] pb-2 border-b-2 border-[#E39AA6]">
              <span>BORROWER CARD</span>
              <span>VIT BHOPAL</span>
            </div>
            <div className="mt-3.5 font-mono text-[10px] text-[#4D5675]">BORROWER</div>
            <div className="border-b border-dashed border-[#C7CCDA] h-6 font-display font-bold text-lg tracking-[-0.02em] truncate">
              {username.replace(/@.*/, '') || 'your.name'}
              <span className="text-[#4D5675] font-medium">@{env.domain}</span>
            </div>
            <div className="mt-3 flex justify-between font-mono text-[10px] text-[#4D5675]">
              <span>VALID WHILE YOU'RE A STUDENT</span>
              <span className="text-[#12728A] font-semibold">NO PASSWORD</span>
            </div>
          </div>

          <div className="py-6 flex flex-col gap-4">
            {step === 'email' ? (
              <>
                <p className="m-0 text-[15px] text-ink2 md:hidden">
                  Your college email is your library card. Only VIT Bhopal students get in.
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
                          await authGateway.startGoogle();
                        } catch (e) {
                          setError((e as Error).message);
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
                      {busy ? 'Opening Google…' : 'Continue with Google'}
                    </Button>
                    <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.12em] text-ink2">
                      <span className="flex-1 h-px bg-line" />
                      OR USE EMAIL
                      <span className="flex-1 h-px bg-line" />
                    </div>
                  </>
                )}
                {isDemo && (
                  <p className="m-0 text-sm rounded-xl bg-sunk px-3 py-2 text-ink2">
                    Demo mode: any <strong>@{env.domain}</strong> email signs you straight in. Use{' '}
                    <strong>admin</strong> for the admin tools.
                  </p>
                )}
                <form onSubmit={submitEmail} className="flex flex-col gap-2.5" noValidate>
                  <label htmlFor="email" className="text-sm font-semibold">
                    College email
                  </label>
                  <div className="flex items-center h-14 rounded-2xl bg-surface border-2 border-teal overflow-hidden focus-within:outline focus-within:outline-3 focus-within:outline-teal/40">
                    <input
                      id="email"
                      type="text"
                      inputMode="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="your.name"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="flex-1 min-w-0 h-full border-0 outline-none pl-4 text-base bg-transparent text-ink"
                      aria-describedby="email-hint"
                    />
                    <span className="h-full inline-flex items-center px-3 bg-sunk text-ink2 font-mono text-xs">
                      @{env.domain}
                    </span>
                  </div>
                  <Turnstile
                    key={captchaResetKey}
                    siteKey={env.turnstileSiteKey}
                    onToken={onCaptcha}
                    onError={onCaptchaError}
                  />
                  <Button type="submit" variant="mist" size="lg" disabled={busy}>
                    {busy ? 'Sending link…' : isDemo ? 'Sign in' : 'Email me a sign-in link'}
                  </Button>
                  <p id="email-hint" className="m-0 text-sm text-ink2">
                    Just your username.
                  </p>
                </form>
              </>
            ) : (
              <div className="flex flex-col gap-3" role="status" aria-live="polite">
                <p className="m-0 text-lg font-semibold text-ink">Check your college inbox</p>
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
          </div>
        </div>
      </div>
    </div>
  );
}
