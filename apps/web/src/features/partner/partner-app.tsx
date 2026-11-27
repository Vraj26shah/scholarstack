import { type OwnedMessDto, isOwnerAddress } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { authGateway } from '../../lib/auth';
import { nativePush } from '../../lib/native-push';
import { useSession } from '../../lib/session';
import { LogoMark, Wordmark } from '../../shared/ui/brand';
import { CodeBoxes } from '../../shared/ui/code-boxes';
import { Spinner } from '../../shared/ui/feedback';
import { Bowl, Calculator, Check, Toolbox } from '../../shared/ui/icons';
import { useSectionSwipe } from '../../shared/ui/swipe';
import { useAccountAlerts } from '../chat/alerts';
import { type TextKey, setLang, useT } from './i18n';
import { PartnerMenu } from './partner-menu';
import { PartnerMore } from './partner-more';
import { PartnerOrders } from './partner-orders';
import { PartnerSales } from './partner-sales';

type Tab = 'orders' | 'sales' | 'menu' | 'more';
const TABS: { key: Tab; label: TextKey; icon: ReactNode }[] = [
  { key: 'orders', label: 'tabOrders', icon: <Bowl size={22} /> },
  { key: 'sales', label: 'tabSales', icon: <Calculator size={22} /> },
  { key: 'menu', label: 'tabMenu', icon: <Check size={22} /> },
  { key: 'more', label: 'tabMore', icon: <Toolbox size={22} /> },
];

/**
 * /partner: the restaurant owner's app. Minimal on purpose: the shop switch, four tabs, big
 * buttons, Hindi first. The Android Partner app opens this page; it works in a browser too.
 */
/**
 * The PIN lock: an owner who is still signed in types their 4-digit PIN every time the app opens,
 * and again after more than a minute away (another app, the screen off). Signing in with the PIN
 * unlocks it, so the PIN is never asked twice in a row.
 */
const RELOCK_AFTER_MS = 60_000;
const lock = { open: false, hiddenAt: 0, listeners: new Set<() => void>() };
const tellLock = () => {
  for (const f of lock.listeners) f();
};
export const unlockPartner = () => {
  lock.open = true;
  tellLock();
};
if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') lock.hiddenAt = Date.now();
    else if (lock.open && lock.hiddenAt && Date.now() - lock.hiddenAt > RELOCK_AFTER_MS) {
      lock.open = false;
      tellLock();
    }
  });
function usePartnerUnlocked() {
  const [open, setOpen] = useState(lock.open);
  useEffect(() => {
    const on = () => setOpen(lock.open);
    lock.listeners.add(on);
    on();
    return () => {
      lock.listeners.delete(on);
    };
  }, []);
  return open;
}

/** The app turns order alerts on by itself only once per phone; after that, More › Order alerts. */
const ASKED_KEY = 'ss_partner_alerts_asked';
const askedOnThisPhone = () => {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
};
const rememberAsked = () => {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // storage blocked: asked again next time
  }
};

export default function PartnerApp() {
  const status = useSession((s) => s.status);
  const me = useSession((s) => s.me);
  const unlocked = usePartnerUnlocked();
  if (status === 'loading')
    return (
      <Frame>
        <div className="flex-1 grid place-items-center">
          <Spinner label="Loading" />
        </div>
      </Frame>
    );
  if (status !== 'ready') return <PartnerSignIn />;
  // Only a restaurant owner's own sign-in opens the dashboard. An admin's or a student's website
  // session (admins can see every restaurant) gets the PIN screen instead.
  if (me?.isAdmin) return <PartnerSignIn otherAccount={me.email} />;
  // Signed in, but the app was just opened: the PIN first. The number is the one this phone
  // remembers, or the one in the owner's own address.
  // Only owners (a student's session gets "restaurant owners only" further on).
  const fromAddress = me && isOwnerAddress(me.email) ? me.email.slice(1, 11) : '';
  const lockPhone = fromAddress || savedPhone();
  if (!unlocked && lockPhone) return <PartnerSignIn lockPhone={lockPhone} />;
  return <Signed />;
}

function Brand() {
  return (
    <span className="inline-flex items-center">
      <Wordmark size="sm" />
    </span>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh flex flex-col bg-bg text-ink [font-size:17px]">{children}</div>;
}

function LangSwitch({ onDark = false }: { onDark?: boolean }) {
  const { lang } = useT();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
      className={`flex-none h-9 rounded-full px-3.5 text-[14px] font-bold ${onDark ? 'text-white hover:bg-white/10' : 'text-ink bg-surface ring-1 ring-line'}`}
      aria-label={lang === 'hi' ? 'Switch to English' : 'हिंदी में देखें'}
    >
      {lang === 'hi' ? 'English' : 'हिंदी'}
    </button>
  );
}

function Signed() {
  const { t } = useT();
  // Keyed by account: a student's empty answer must never stand in for the owner's.
  const meId = useSession((s) => s.me?.id ?? '');
  const q = useQuery({ queryKey: ['owned-messes', meId], queryFn: api.ownedMesses, refetchInterval: 30_000 });
  const [params, setParams] = useSearchParams();
  const tab: Tab =
    (['orders', 'sales', 'menu', 'more'] as const).find((k) => k === params.get('tab')) ?? 'orders';
  const go = (k: Tab) => setParams(k === 'orders' ? {} : { tab: k }, { replace: true });
  const [picked, setPicked] = useState<string | null>(null);
  const messes = q.data ?? [];
  // Swipe sideways between the four tabs, like the student app. Not inside a More page (its
  // forms), and the Menu tab turns it off while prices are being changed (data-no-swipe).
  const keys = TABS.map((x) => x.key);
  const at = keys.indexOf(tab);
  useSectionSwipe({
    enabled: messes.length > 0 && !(tab === 'more' && params.get('page')),
    ...(at < keys.length - 1 ? { onNext: () => go(keys[at + 1]!) } : {}),
    ...(at > 0 ? { onPrev: () => go(keys[at - 1]!) } : {}),
  });
  // In the Partner app, an owner who is signed in gets order alerts straight away (once per
  // phone): a missed order is the one thing that must never happen.
  const alerts = useAccountAlerts();
  const asked = useRef(false);
  useEffect(() => {
    if (
      asked.current ||
      !nativePush() ||
      !messes.length ||
      !alerts.configured ||
      !alerts.checked ||
      alerts.on ||
      alerts.busy ||
      alerts.support !== 'ok' ||
      askedOnThisPhone()
    )
      return;
    asked.current = true;
    rememberAsked();
    void alerts.enable();
  }, [messes.length, alerts]);
  const mess = messes.find((m) => m.slug === picked) ?? messes[0];

  if (q.isLoading)
    return (
      <Frame>
        <div className="flex-1 grid place-items-center">
          <Spinner label="Loading" />
        </div>
      </Frame>
    );
  if (!mess && !q.isError) return <PartnerSignIn otherAccount={useSession.getState().me?.email ?? ''} />;
  if (!mess)
    return (
      <Frame>
        <div className="flex-1 px-5 pt-16 flex flex-col gap-5 max-w-[520px]">
          <Brand />
          <p className="m-0 text-[19px] font-semibold leading-snug">
            {q.isError ? t('offline') : t('notOwner')}
          </p>
          <div className="flex gap-3">
            {q.isError && (
              <button type="button" onClick={() => q.refetch()} className={bigButton('brand')}>
                {t('retry')}
              </button>
            )}
            <button
              type="button"
              onClick={() => useSession.getState().signOut()}
              className={bigButton('outline')}
            >
              {t('logout')}
            </button>
          </div>
        </div>
      </Frame>
    );

  return (
    <Frame>
      <header
        data-splash-target="0"
        className="sticky top-0 z-20 bg-brand text-white px-4 pt-[env(safe-area-inset-top)] [color-scheme:dark]"
      >
        <div className="flex items-center justify-between gap-3 max-w-[720px] mx-auto h-16">
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="grid place-items-center size-9 flex-none rounded-xl bg-white/10 ring-1 ring-white/15">
              <LogoMark size={22} onDark />
            </span>
            {messes.length > 1 ? (
              <select
                value={mess.slug}
                onChange={(e) => setPicked(e.target.value)}
                className="max-w-full bg-transparent text-white text-[17px] font-bold tracking-[-0.01em] truncate [&>option]:text-ink"
                aria-label="Restaurant"
              >
                {messes.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="min-w-0 flex flex-col">
                <h1 className="m-0 text-[16.5px] font-bold leading-tight tracking-[-0.01em] truncate">
                  {mess.name}
                </h1>
                <span className="text-[11.5px] font-medium text-mist leading-tight">{t('appName')}</span>
              </span>
            )}
          </div>
          <span className="flex-none flex items-center gap-1 rounded-full bg-white/10 p-1 ring-1 ring-white/15">
            {tab === 'orders' ? <LangSwitch onDark /> : <ShopSwitch mess={mess} compact />}
          </span>
        </div>
      </header>

      <main
        id="main"
        className="flex-1 w-full max-w-[720px] mx-auto px-4 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))]"
      >
        {tab === 'orders' && (
          <>
            <ShopSwitch mess={mess} />
            <div className="h-5" />
            <PartnerOrders mess={mess} />
          </>
        )}
        {tab === 'sales' && <PartnerSales mess={mess} />}
        {tab === 'menu' && <PartnerMenu key={mess.slug} mess={mess} />}
        {tab === 'more' && <PartnerMore mess={mess} />}
      </main>

      <nav
        aria-label="Partner"
        className="fixed inset-x-0 bottom-0 z-30 bg-surface border-t border-line pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_-18px_var(--shadow)]"
      >
        <ul className="m-0 p-0 list-none grid grid-cols-4 max-w-[720px] mx-auto">
          {TABS.map((x) => {
            const on = tab === x.key;
            return (
              <li key={x.key}>
                <button
                  type="button"
                  onClick={() => go(x.key)}
                  aria-current={on ? 'page' : undefined}
                  className={`relative w-full h-[68px] flex flex-col items-center justify-center gap-1 text-[14px] font-bold ${on ? 'text-brand dark:text-teal' : 'text-ink2'}`}
                >
                  <span
                    className={`grid place-items-center h-8 w-14 rounded-full ${on ? 'bg-mist/60 text-on-mist' : ''}`}
                  >
                    {x.icon}
                  </span>
                  {t(x.label)}
                  {x.key === 'orders' && mess.unread > 0 && (
                    <span className="absolute top-2 right-[calc(50%-30px)] min-w-5 h-5 px-1 rounded-full bg-blush-text text-white text-[11px] grid place-items-center">
                      {mess.unread}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </Frame>
  );
}

/** The one switch an owner touches most: open or closed for orders. */
function ShopSwitch({ mess, compact = false }: { mess: OwnedMessDto; compact?: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (open: boolean) => api.ownerSetOpen(mess.slug, open),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owned-messes'] }),
  });
  const open = m.isPending ? !!m.variables : mess.ordersOpen;
  if (compact)
    return (
      <button
        type="button"
        role="switch"
        aria-checked={open}
        disabled={m.isPending}
        onClick={() => m.mutate(!open)}
        className="flex-none inline-flex items-center gap-2 h-9 rounded-full pl-3 pr-1 text-[13.5px] font-bold text-white"
      >
        {open ? t('openShort') : t('closedShort')}
        <span className={`relative h-7 w-12 rounded-full ${open ? 'bg-[#2fb365]' : 'bg-white/25'}`}>
          <span
            className={`absolute top-1 size-5 rounded-full bg-white shadow transition-[left] ${open ? 'left-6' : 'left-1'}`}
          />
        </span>
      </button>
    );
  return (
    <button
      type="button"
      role="switch"
      aria-checked={open}
      disabled={m.isPending}
      onClick={() => m.mutate(!open)}
      className="w-full flex items-center gap-4 rounded-[22px] bg-card text-ink px-4 py-3.5 text-left ring-1 ring-line/80 shadow-[0_14px_32px_-24px_var(--shadow)]"
    >
      <span className={`relative flex-none size-3 rounded-full ${open ? 'bg-[#2fb365]' : 'bg-ink2/40'}`}>
        {open && <span className="absolute inset-0 rounded-full bg-[#2fb365] animate-ping opacity-60" />}
      </span>
      <span className="flex-1 flex flex-col">
        <span className="text-[18px] font-extrabold leading-tight">{open ? t('open') : t('closed')}</span>
        <span className="text-[14px] text-ink2">{open ? t('openHint') : t('closedHint')}</span>
      </span>
      <span
        className={`relative flex-none h-9 w-16 rounded-full transition-colors ${open ? 'bg-[#1f8a4c]' : 'bg-line'}`}
      >
        <span
          className={`absolute top-1 size-7 rounded-full bg-white shadow transition-[left] ${open ? 'left-8' : 'left-1'}`}
        />
      </span>
    </button>
  );
}

export function bigButton(kind: 'brand' | 'outline' | 'accept' | 'reject' | 'ghost') {
  const base =
    'inline-flex items-center justify-center gap-2 min-h-14 rounded-2xl px-5 text-[18px] font-extrabold press disabled:opacity-50 select-none';
  return `${base} ${
    kind === 'brand'
      ? 'bg-brand text-white'
      : kind === 'accept'
        ? 'bg-[#1f8a4c] text-white'
        : kind === 'reject'
          ? 'bg-blush text-blush-text'
          : kind === 'ghost'
            ? 'text-ink'
            : 'border-[1.5px] border-line bg-surface text-ink'
  }`;
}

// ── Sign-in, like Groww: the number once, then just the 4-digit PIN ──

/** The owner's number, kept on this phone after the first sign-in (only the number, never the PIN). */
const PHONE_KEY = 'ss_partner_phone';
const savedPhone = () => {
  try {
    const v = localStorage.getItem(PHONE_KEY) ?? '';
    return /^[6-9]\d{9}$/.test(v) ? v : '';
  } catch {
    return '';
  }
};
const keepPhone = (p: string | null) => {
  try {
    if (p) localStorage.setItem(PHONE_KEY, p);
    else localStorage.removeItem(PHONE_KEY);
  } catch {
    // storage blocked: the number is asked for next time
  }
};
const shown = (d: string) => `+91 ${d.slice(0, 5)} ${d.slice(5)}`;

type Step = 'phone' | 'pin' | 'code' | 'newPin' | 'confirmPin';

function PartnerSignIn({
  otherAccount = '',
  lockPhone = '',
}: {
  otherAccount?: string;
  /** Signed in already: the app-open PIN lock for this number. */
  lockPhone?: string;
}) {
  const { t } = useT();
  const remembered = lockPhone || savedPhone();
  const [step, setStep] = useState<Step>(remembered ? 'pin' : 'phone');
  const [phone, setPhone] = useState(remembered);
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const digits = phone.replace(/\D/g, '').slice(-10);
  const go = (s: Step) => {
    setError('');
    setPin('');
    setStep(s);
  };
  const fail = (e: unknown) => setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));

  // 1. The number: what does it need next?
  const lookup = async () => {
    if (digits.length !== 10 || busy) return;
    setBusy(true);
    setError('');
    try {
      const { next } = await api.partnerLookup(digits);
      if (next === 'unknown') setError(t('notRegistered'));
      else go(next === 'pin' ? 'pin' : 'code');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // 2. Signed in (with the PIN, or after choosing one): straight into the app.
  const finish = async (s: Awaited<ReturnType<typeof api.partnerLogin>>) => {
    keepPhone(digits);
    await authGateway.adoptSession(s);
    await useSession.getState().claim();
    unlockPartner();
  };

  const loginWith = async (p: string) => {
    if (p.length !== 4 || busy) return;
    setBusy(true);
    setError('');
    try {
      await finish(await api.partnerLogin(digits, p));
    } catch (e) {
      fail(e);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const savePin = async (p: string) => {
    if (busy) return;
    if (p !== first) {
      setError(t('pinsDiffer'));
      setFirst('');
      setPin('');
      setStep('newPin');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await finish(await api.partnerSetPin(digits, code, p));
    } catch (e) {
      fail(e);
      // A wrong or old setup code: ask for it again.
      setCode('');
      setFirst('');
      setPin('');
      setStep('code');
    } finally {
      setBusy(false);
    }
  };

  const title =
    step === 'phone'
      ? t('signInTitle')
      : step === 'pin'
        ? t('welcomeBack')
        : step === 'code'
          ? t('enterSetupCode')
          : step === 'newPin'
            ? t('newPin')
            : t('confirmPin');

  return (
    <Frame>
      <div className="flex-1 w-full max-w-[460px] mx-auto px-5 pt-[max(24px,env(safe-area-inset-top))] pb-10 flex flex-col gap-7">
        <div className="flex items-center justify-between">
          <Brand />
          <LangSwitch />
        </div>
        <div className="flex flex-col gap-2 pt-4">
          <p className="m-0 font-mono text-[13px] text-teal-text">{t('appName')}</p>
          <h1 className="m-0 font-display font-extrabold text-[34px] leading-[1.05] tracking-[-0.03em]">
            {title}
          </h1>
          {step !== 'phone' && (
            <p className="m-0 flex flex-wrap items-center gap-x-3 text-[17px] font-semibold text-ink2">
              <span className="font-mono tracking-[0.04em] text-ink">{shown(digits)}</span>
              <button
                type="button"
                onClick={() => {
                  keepPhone(null);
                  // From the lock: a different number means signing this one out.
                  if (lockPhone) void useSession.getState().signOut();
                  setPhone('');
                  setCode('');
                  setFirst('');
                  go('phone');
                }}
                className="text-[15px] font-bold text-teal-text underline underline-offset-4"
              >
                {t('changeNumber')}
              </button>
            </p>
          )}
        </div>
        {otherAccount && (
          <p className="m-0 rounded-2xl bg-marigold-soft px-4 py-3 text-[15px] leading-snug text-marigold-text">
            {t('otherAccount')} <span className="font-bold break-all">{otherAccount}</span>
          </p>
        )}

        {step === 'phone' && (
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void lookup();
            }}
          >
            <label className="flex flex-col gap-2">
              <span className="text-[16px] font-bold text-ink2">{t('mobile')}</span>
              <span
                className={`flex items-center h-16 rounded-2xl bg-card px-2 gap-3 transition-shadow ring-[1.5px] focus-within:ring-2 focus-within:ring-teal ${digits.length === 10 ? 'ring-ink/40' : 'ring-line'}`}
              >
                <span className="flex-none flex items-center h-12 px-3 rounded-xl bg-sunk font-mono text-[18px] font-bold text-ink">
                  +91
                </span>
                <input
                  value={digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits}
                  onChange={(e) => {
                    let d = e.target.value.replace(/\D/g, '');
                    if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
                    if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
                    setPhone(d.slice(0, 10));
                    setError('');
                  }}
                  inputMode="tel"
                  autoComplete="tel-national"
                  aria-label={t('mobile')}
                  className="flex-1 min-w-0 bg-transparent font-mono text-[23px] tracking-[0.06em] text-ink outline-none placeholder:text-ink2/40"
                  placeholder="98765 43210"
                />
                {digits.length === 10 && (
                  <span
                    className="flex-none grid place-items-center size-8 mr-1 rounded-full bg-[#1f8a4c] text-white text-[15px] font-bold"
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                )}
              </span>
            </label>
            {error && <ErrorLine text={error} />}
            <button
              type="submit"
              disabled={digits.length !== 10 || busy}
              className={`${bigButton('brand')} w-full`}
            >
              {busy ? t('pleaseWait') : t('continue')}
            </button>
          </form>
        )}

        {step === 'pin' && (
          <div className="flex flex-col gap-5">
            <CodeBoxes
              key="pin"
              label={t('pin')}
              value={pin}
              onChange={(v) => {
                setPin(v);
                setError('');
              }}
              onComplete={(v) => void loginWith(v)}
              length={4}
              masked
              autoFocus
              invalid={!!error}
            />
            {error && <ErrorLine text={error} />}
            {busy && <p className="m-0 text-[16px] font-semibold text-ink2">{t('pleaseWait')}</p>}
          </div>
        )}

        {step === 'code' && (
          <div className="flex flex-col gap-5">
            <p className="m-0 text-[16px] leading-relaxed text-ink2">{t('setupHelp')}</p>
            <CodeBoxes
              key="code"
              label={t('setupCode')}
              value={code}
              onChange={(v) => {
                setCode(v);
                setError('');
              }}
              onComplete={() => go('newPin')}
              length={6}
              autoFocus
              invalid={!!error}
            />
            {error && <ErrorLine text={error} />}
          </div>
        )}

        {(step === 'newPin' || step === 'confirmPin') && (
          <div className="flex flex-col gap-5">
            <p className="m-0 text-[16px] leading-relaxed text-ink2">
              {step === 'newPin' ? t('newPinHelp') : t('confirmPinHelp')}
            </p>
            <CodeBoxes
              key={step}
              label={step === 'newPin' ? t('newPin') : t('confirmPin')}
              value={pin}
              onChange={(v) => {
                setPin(v);
                if (step === 'newPin') setError('');
              }}
              onComplete={(v) => {
                if (step === 'newPin') {
                  setFirst(v);
                  setPin('');
                  setStep('confirmPin');
                } else void savePin(v);
              }}
              length={4}
              masked
              autoFocus
              invalid={!!error}
            />
            {error && <ErrorLine text={error} />}
            {busy && <p className="m-0 text-[16px] font-semibold text-ink2">{t('pleaseWait')}</p>}
          </div>
        )}

        <div className="flex flex-col items-start gap-3">
          {step === 'pin' && (
            <button
              type="button"
              onClick={() => {
                setCode('');
                go('code');
              }}
              className="text-[16px] font-bold text-teal-text underline underline-offset-4"
            >
              {t('forgotPinCode')}
            </button>
          )}
          <a href="/contact" className="text-[15px] font-semibold text-ink2 underline underline-offset-4">
            {t('forgot')}
          </a>
        </div>
      </div>
    </Frame>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="m-0 rounded-2xl bg-blush px-4 py-3 text-[16px] font-semibold text-blush-text">
      {text}
    </p>
  );
}
