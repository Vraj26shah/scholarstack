import { useState } from 'react';
import { Link } from 'react-router-dom';
import { isNativeApp } from '../../lib/app-mode';

const HIDDEN_KEY = 'ss_getapp_hidden';

/**
 * On an Android phone's browser (not inside the app): one quiet line offering the Android app,
 * until closed. The website stays the website; the app is an extra for those who want it.
 */
export function GetAppNudge({ onDark = false, className = '' }: { onDark?: boolean; className?: string }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return (
        isNativeApp() || !/Android/i.test(navigator.userAgent) || localStorage.getItem(HIDDEN_KEY) === '1'
      );
    } catch {
      return true;
    }
  });
  if (hidden) return null;
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Link
        to="/get-app"
        className={`flex-1 min-w-0 text-[14px] font-semibold no-underline ${onDark ? 'text-mist' : 'text-teal-text'}`}
      >
        Get the Android app: reminders and order alerts that ring even when it's closed →
      </Link>
      <button
        type="button"
        aria-label="Hide"
        onClick={() => {
          try {
            localStorage.setItem(HIDDEN_KEY, '1');
          } catch {
            // storage blocked: hidden for now
          }
          setHidden(true);
        }}
        className={`grid place-items-center size-8 flex-none rounded-full bg-transparent border-0 cursor-pointer ${onDark ? 'text-mist' : 'text-ink2'}`}
      >
        ×
      </button>
    </div>
  );
}
