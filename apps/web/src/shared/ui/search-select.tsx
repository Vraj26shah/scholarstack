import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import { Check, ChevronDown, Cross, SearchIcon } from './icons';

export interface SearchOption {
  value: string;
  label: string;
  /** A short tag shown on the right ("BCE"). */
  tag?: string;
  /** Extra words that also match a search ("CSE", "computer"). */
  keywords?: string;
}

/**
 * A pick-one field that works on every screen: a button showing the choice, which opens a sheet
 * (from the bottom on a phone, in the middle on a laptop) with a search box and the full list.
 * Long names wrap instead of running off the screen, unlike a phone's built-in dropdown.
 */
export function SearchSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose',
  searchPlaceholder = 'Search',
  hint,
}: {
  label: string;
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const chosen = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.tag ?? ''} ${o.keywords ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [q, options]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ('');
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${chosen?.label ?? placeholder}`}
          className="group w-full min-h-[56px] flex items-center gap-3 rounded-[18px] bg-card px-4 py-2.5 text-left ring-1 ring-line shadow-[0_1px_0_var(--line)] hover:ring-ink2/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal transition-shadow"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-[12px] font-semibold text-ink2">{label}</span>
            <span className="block text-[15.5px] font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
              {chosen?.label ?? placeholder}
            </span>
          </span>
          {chosen?.tag && (
            <span className="flex-none rounded-md bg-sunk px-2 py-0.5 font-mono text-[11.5px] font-semibold text-ink2">
              {chosen.tag}
            </span>
          )}
          <ChevronDown size={18} className="flex-none text-ink2 group-hover:text-ink" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(6,9,26,0.45)] backdrop-blur-[2px] data-[state=open]:animate-[fade-in_160ms_ease-out]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 inset-x-0 bottom-0 max-h-[82dvh] flex flex-col rounded-t-[26px] bg-bg shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.5)] pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[12vh] sm:-translate-x-1/2 sm:w-[min(520px,calc(100vw-48px))] sm:max-h-[72vh] sm:rounded-[26px] data-[state=open]:animate-[sheet-up_220ms_cubic-bezier(0.2,0.8,0.2,1)]"
        >
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2">
            <Dialog.Title className="m-0 font-display text-[22px] font-bold tracking-[-0.02em]">
              {label}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="size-9 grid place-items-center rounded-full text-ink2 hover:bg-sunk hover:text-ink"
            >
              <Cross size={17} />
            </Dialog.Close>
          </div>
          <div className="px-5 pb-3">
            <label className="flex items-center gap-2.5 h-12 rounded-2xl bg-card px-4 ring-1 ring-line focus-within:ring-2 focus-within:ring-teal">
              <SearchIcon size={18} className="flex-none text-ink2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="flex-1 min-w-0 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink2/70"
              />
              {q && (
                <button
                  type="button"
                  aria-label="Clear"
                  onClick={() => setQ('')}
                  className="text-ink2 hover:text-ink"
                >
                  <Cross size={15} />
                </button>
              )}
            </label>
            {hint && <p className="m-0 mt-2 px-1 text-[12.5px] text-ink2">{hint}</p>}
          </div>
          <ul
            role="listbox"
            aria-label={label}
            className="m-0 px-3 pb-4 list-none overflow-y-auto overscroll-contain"
          >
            {shown.length === 0 && (
              <li className="px-3 py-6 text-center text-[15px] text-ink2">Nothing matches “{q}”.</li>
            )}
            {shown.map((o) => {
              const on = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => choose(o.value)}
                    className={`w-full flex items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${on ? 'bg-brand/[0.07] dark:bg-white/[0.07]' : 'hover:bg-sunk active:bg-sunk'}`}
                  >
                    <span className="flex-1 min-w-0 text-[15.5px] leading-snug [overflow-wrap:anywhere] font-medium text-ink">
                      {o.label}
                    </span>
                    {o.tag && (
                      <span className="flex-none rounded-md bg-sunk px-2 py-0.5 font-mono text-[11.5px] font-semibold text-ink2">
                        {o.tag}
                      </span>
                    )}
                    <span
                      className={`flex-none size-6 grid place-items-center rounded-full ${on ? 'bg-brand text-white' : ''}`}
                    >
                      {on && <Check size={14} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
