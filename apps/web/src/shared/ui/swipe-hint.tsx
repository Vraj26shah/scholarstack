import { useEffect, useState } from 'react';

const read = (key: string) => {
  try {
    return Number(localStorage.getItem(`ss-swipe-hint:${key}`) ?? '0');
  } catch {
    return 0;
  }
};
const write = (key: string, n: number) => {
  try {
    localStorage.setItem(`ss-swipe-hint:${key}`, String(n));
  } catch {
    // private mode: the hint just shows again next time
  }
};

/**
 * Phones only: a small note that this place can be swiped, with a hand-drawn nudge. It shows the
 * first few visits (or until closed), then stays out of the way for good.
 */
export function SwipeHint({
  id,
  children,
  times = 3,
  className = '',
  floating = false,
}: {
  /** One per place ("catalogue", "course"…), so each is learned once. */
  id: string;
  children: React.ReactNode;
  times?: number;
  className?: string;
  /** Over the page (above the tab bar): a solid pill instead of a tinted one. */
  floating?: boolean;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!window.matchMedia?.('(max-width: 767px)').matches) return;
    const seen = read(id);
    if (seen >= times) return;
    write(id, seen + 1);
    setShow(true);
  }, [id, times]);
  if (!show) return null;
  return (
    <p
      className={`swipe-hint md:hidden m-0 inline-flex items-center gap-2 self-start rounded-full py-1.5 pl-3 pr-1 text-[13px] font-medium ${
        floating ? 'bg-ink text-bg' : 'bg-mist/45 text-ink'
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`swipe-hint-arrows inline-flex items-center font-mono text-[15px] ${floating ? 'text-mist' : 'text-teal-text'}`}
      >
        ‹
        <span
          className={`swipe-hint-dot mx-0.5 inline-block size-1.5 rounded-full ${floating ? 'bg-mist' : 'bg-teal'}`}
        />
        ›
      </span>
      <span>{children}</span>
      <button
        type="button"
        aria-label="Got it"
        onClick={() => {
          write(id, times);
          setShow(false);
        }}
        className={`pointer-events-auto ml-0.5 grid size-7 place-items-center rounded-full ${floating ? 'text-bg/70 hover:bg-white/10' : 'text-ink2 hover:bg-white/50'}`}
      >
        ×
      </button>
    </p>
  );
}
