import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, useSyncExternalStore } from 'react';
import { Button } from './button';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function Spinner({ size = 72, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 76 76" role="img" aria-label={label} className="spin">
      <circle cx="38" cy="38" r="31" fill="none" strokeWidth="7" style={{ stroke: 'var(--line)' }} />
      <path
        d="M38 7a31 31 0 0 1 31 31"
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        style={{ stroke: 'var(--teal)' }}
      />
    </svg>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
}: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border-2 border-dashed border-line p-8 text-center flex flex-col items-center gap-3"
    >
      <p className="font-display font-extrabold text-2xl tracking-[-0.03em] m-0">{title}</p>
      <p className="text-ink2 m-0 max-w-md">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Bottom sheet on phones, centred dialog on larger screens. Accessible via Radix. */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  dismissible?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(6,9,26,0.6)]" />
        <Dialog.Content
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          className="fixed z-50 inset-x-2.5 bottom-2.5 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[460px] bg-surface text-ink rounded-[30px] px-6 pt-4 pb-6 flex flex-col gap-4 shadow-2xl"
        >
          <span aria-hidden="true" className="self-center w-10 h-[5px] rounded-full bg-line sm:hidden" />
          <Dialog.Title className="m-0 font-display font-extrabold text-[34px] leading-[0.98] tracking-[-0.05em]">
            {title}
          </Dialog.Title>
          <Dialog.Description asChild>
            <div className="flex flex-col gap-4">{children}</div>
          </Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** Shows only while the browser reports no connection. */
export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-50 bg-blush text-blush-text text-center text-sm font-semibold py-2"
    >
      You're offline. Pages you've opened stay put; new ones load when you're back.
    </div>
  );
}
