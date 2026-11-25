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
