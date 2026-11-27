import { type PhoneStatusDto, formatMobile, normaliseMobile } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../../lib/api';
import { Button } from '../../../../shared/ui/button';
import { field } from '../../core/ui';

/** The signed-in student's checked number (null while loading, or when there is none). */
export function usePhoneStatus(enabled: boolean) {
  return useQuery({ queryKey: ['my-phone'], queryFn: api.myPhone, enabled, staleTime: 60_000 });
}

/** Counts down to 0 once a second from `from` (re-armed when `from` changes). */
function useCountdown(from: number) {
  const [left, setLeft] = useState(from);
  useEffect(() => {
    setLeft(from);
    if (from <= 0) return;
    const t = window.setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => window.clearInterval(t);
  }, [from]);
  return left;
}

/**
 * "Mobile number" on the order form. Once the student has proved the number with an SMS code it is
 * shown locked (the restaurant can rely on it); before that they type it, get a code, and enter it.
 */
export function PhoneCheck({
  status,
  draft,
  onDraft,
  tried,
}: {
  status: PhoneStatusDto;
  /** What's typed in the number box (kept with the other order details on this device). */
  draft: string;
  onDraft: (v: string) => void;
  /** The student pressed Confirm: show what's missing. */
  tried: boolean;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const pending = status.pending;
  const typed = normaliseMobile(draft);
  const waiting = !!pending && pending.phone === typed;
  const resendIn = useCountdown(pending?.resendInSeconds ?? 0);
  const done = (s: PhoneStatusDto) => qc.setQueryData(['my-phone'], s);
  const send = useMutation({ mutationFn: () => api.sendPhoneCode(typed ?? ''), onSuccess: done });
  const check = useMutation({
    mutationFn: () => api.checkPhoneCode(typed ?? '', code),
    onSuccess: (s) => {
      setCode('');
      done(s);
    },
  });

  if (status.phone)
    return (
      <div className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
        Mobile number (for the restaurant to reach you)
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border-[1.5px] border-line bg-sunk px-3 h-11">
          <span className="text-[15px] font-semibold text-ink tabular-nums">
            {formatMobile(status.phone)}
          </span>
          <span className="text-[13px] font-semibold text-teal-text">✓ Verified</span>
        </div>
        <span className="text-[12.5px] font-normal">
          Changed your number?{' '}
          <Link to="/help" className="text-ink underline underline-offset-2">
            Ask us to reset it
          </Link>
          .
        </span>
      </div>
    );

  // Free check through WhatsApp, when it's set up: no number to type, no SMS.
  if (status.whatsapp) return <WhatsAppCheck status={status} tried={tried} />;

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
        Mobile number (we'll text you a code to check it's yours)
        <span className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-ink">+91</span>
          <input
            className={`${field} flex-1`}
            value={draft}
            inputMode="tel"
            autoComplete="tel-national"
            maxLength={14}
            onChange={(e) => onDraft(e.target.value)}
            placeholder="98765 43210"
            aria-invalid={tried && !typed}
          />
          {!waiting && (
            <Button
              type="button"
              variant="ink"
              disabled={!typed || send.isPending}
              onClick={() => send.mutate()}
            >
              {send.isPending ? 'Sending…' : 'Send code'}
            </Button>
          )}
        </span>
      </label>

      {waiting && (
        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
            Code sent to {formatMobile(pending.phone)}
            <span className="flex items-center gap-2">
              <input
                className={`${field} flex-1 tracking-[0.3em] tabular-nums`}
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                  // Enter checks the code instead of sending the order.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (code.length >= 4) check.mutate();
                  }
                }}
                placeholder="6-digit code"
                aria-invalid={tried}
              />
              <Button
                type="button"
                variant="brand"
                disabled={code.length < 4 || check.isPending}
                onClick={() => check.mutate()}
              >
                {check.isPending ? 'Checking…' : 'Verify'}
              </Button>
            </span>
          </label>
          <p className="m-0 text-[12.5px] text-ink2">
            Didn't get it?{' '}
            {resendIn > 0 ? (
              <span className="tabular-nums">Send again in {resendIn}s</span>
            ) : (
              <button
                type="button"
                disabled={send.isPending}
                onClick={() => send.mutate()}
                className="font-semibold text-ink underline underline-offset-2 bg-transparent border-0 p-0 cursor-pointer"
              >
                Send again
              </button>
            )}
          </p>
        </div>
      )}

      {(send.error || check.error) && (
        <p role="alert" className="m-0 text-[14px] text-blush-text">
          {(check.error ?? send.error)?.message}
        </p>
      )}
    </div>
  );
}

/**
 * Free phone check through WhatsApp: one tap opens WhatsApp with "VERIFY <code>" typed; the student
 * taps Send, and the number they sent it from is kept. The page waits for it on its own.
 */
function WhatsAppCheck({ status, tried }: { status: PhoneStatusDto; tried: boolean }) {
  const qc = useQueryClient();
  const waiting = status.whatsapp?.waiting ?? null;
  const left = useCountdown(waiting?.expiresInSeconds ?? 0);
  const start = useMutation({
    mutationFn: api.startWhatsAppCheck,
    onSuccess: (s) => {
      qc.setQueryData(['my-phone'], s);
      const link = s.whatsapp?.waiting?.link;
      if (link) openWhatsApp(link);
    },
  });
  // While a code is out, ask every 2 s (and at once when the student comes back from WhatsApp).
  useEffect(() => {
    if (!waiting) return;
    const refresh = () => void qc.invalidateQueries({ queryKey: ['my-phone'] });
    const t = window.setInterval(refresh, 2000);
    const back = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', back);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', back);
    };
  }, [waiting, qc]);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-ink2">
        Mobile number (for the restaurant to reach you)
      </span>
      {waiting && left > 0 ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-[#e7f8ee] dark:bg-[#10291b] px-4 py-3.5 ring-1 ring-[#25d366]/40">
          <p className="m-0 flex items-center gap-2 text-[15px] font-bold text-ink">
            <span className="size-2.5 rounded-full bg-[#25d366] animate-pulse" aria-hidden="true" />
            Waiting for your WhatsApp message…
          </p>
          <p className="m-0 text-[13.5px] leading-relaxed text-ink2">
            In WhatsApp, just tap <strong className="text-ink">Send</strong> on the message{' '}
            <span className="font-mono font-bold text-ink">VERIFY {waiting.code}</span>. This page ticks
            itself when it arrives.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ink" onClick={() => openWhatsApp(waiting.link)}>
              Open WhatsApp again
            </Button>
            <span className="text-[12.5px] text-ink2 tabular-nums">
              Code works for {Math.ceil(left / 60)} more min
            </span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={start.isPending}
          onClick={() => start.mutate()}
          aria-invalid={tried || undefined}
          className={`flex items-center justify-center gap-2.5 h-12 rounded-2xl bg-[#25d366] text-[#0b2e18] text-[16px] font-extrabold press disabled:opacity-60 ${tried ? 'ring-2 ring-blush-text' : ''}`}
        >
          <WhatsAppMark />
          {start.isPending ? 'Opening WhatsApp…' : waiting ? 'Get a new code' : 'Verify with WhatsApp'}
        </button>
      )}
      {!waiting && (
        <p className="m-0 text-[12.5px] text-ink2">
          Free. Opens WhatsApp with the message ready: just tap Send. Your number is checked once and kept.
        </p>
      )}
      {start.error && (
        <p role="alert" className="m-0 text-[14px] text-blush-text">
          {start.error.message}
        </p>
      )}
    </div>
  );
}

/** Opens WhatsApp with the message typed (the app on phones, WhatsApp Web elsewhere). */
function openWhatsApp(link: string) {
  if (/Android|iPhone|iPad/i.test(navigator.userAgent)) window.location.href = link;
  else window.open(link, '_blank', 'noopener');
}

function WhatsAppMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2-.2-.2-.4-.3z" />
    </svg>
  );
}
