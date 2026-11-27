import { useId, useRef, useState } from 'react';

/**
 * A PIN or one-time code as separate boxes, like an OTP screen: tap anywhere to type, each digit
 * fills the next box, backspace goes back, pasting or the phone's code suggestion fills them all.
 * One real input sits over the boxes, so the keyboard, paste and autofill all just work.
 */
export function CodeBoxes({
  length,
  value,
  onChange,
  label,
  masked = false,
  autoFocus = false,
  invalid = false,
  onComplete,
}: {
  length: number;
  value: string;
  onChange: (v: string) => void;
  label: string;
  /** Show dots instead of digits (a PIN). */
  masked?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  onComplete?: (v: string) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const digits = value.split('');
  const active = Math.min(value.length, length - 1);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[16px] font-bold text-ink2">
        {label}
      </label>
      <div className="relative" onClick={() => ref.current?.focus()} onKeyDown={() => {}}>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
          {Array.from({ length }, (_, i) => {
            const filled = i < digits.length;
            const current = focused && i === active && value.length < length;
            return (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed boxes, never reordered
                key={i}
                aria-hidden="true"
                className={`relative grid place-items-center rounded-2xl bg-card font-mono font-bold text-ink transition-[box-shadow,transform] duration-150 ${
                  length > 4 ? 'h-14 text-[24px]' : 'h-16 text-[28px]'
                } ${
                  invalid
                    ? 'ring-2 ring-blush-text'
                    : current
                      ? 'ring-2 ring-teal shadow-[0_8px_20px_-14px_rgba(25,149,173,0.9)]'
                      : filled
                        ? 'ring-[1.5px] ring-ink/40'
                        : 'ring-[1.5px] ring-line'
                } ${filled ? 'scale-100' : ''}`}
              >
                {filled ? masked ? <span className="size-3.5 rounded-full bg-ink" /> : digits[i] : null}
                {current && <span className="absolute h-7 w-[2px] rounded bg-teal animate-pulse" />}
              </span>
            );
          })}
        </div>
        <input
          ref={ref}
          id={id}
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, length);
            onChange(v);
            if (v.length === length) onComplete?.(v);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={length}
          // biome-ignore lint/a11y/noAutofocus: the one field on this step
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          className="absolute inset-0 w-full h-full opacity-0 cursor-text text-transparent caret-transparent"
          style={{ fontSize: 16 }}
        />
      </div>
    </div>
  );
}
