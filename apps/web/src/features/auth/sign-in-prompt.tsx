import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { track } from '../../lib/analytics';
import { herePath, signInPath } from '../../lib/return-to';
import { Button } from '../../shared/ui/button';
import { Sheet } from '../../shared/ui/feedback';

interface Ask {
  /** "Sign in to place your order". */
  title?: string;
  /** One line on why, and what's kept ("Your cart stays as it is."). */
  body?: string;
  /** Where to come back to once signed in (default: this page, with its #section). */
  next?: string;
  /** "Not now" (or closing it): e.g. leave a page that needs an account. */
  onCancel?: () => void;
}

interface PromptState {
  ask: Ask | null;
  open: (a?: Ask) => void;
  close: () => void;
}

/**
 * The one "Sign in to continue?" sheet for the whole site. Anything that needs an account calls
 * `askToSignIn()` instead of throwing the visitor onto the sign-in page: they can sign in (and
 * come straight back to where they were) or carry on browsing. Buttons that already say "Sign in"
 * go to the sign-in page directly.
 */
export const useSignInPrompt = create<PromptState>((set) => ({
  ask: null,
  open: (a = {}) => set({ ask: a }),
  close: () => set({ ask: null }),
}));

export const askToSignIn = (a?: Ask) => useSignInPrompt.getState().open(a);

/** Mounted once, in the app shell. */
export function SignInPrompt() {
  const ask = useSignInPrompt((s) => s.ask);
  const close = useSignInPrompt((s) => s.close);
  const navigate = useNavigate();
  const location = useLocation();
  // Moving to another page closes it (its question was about the old page).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on navigation only
  useEffect(() => {
    if (useSignInPrompt.getState().ask && !useSignInPrompt.getState().ask?.onCancel) close();
  }, [location.pathname]);

  const cancel = () => {
    const after = ask?.onCancel;
    close();
    after?.();
  };
  return (
    <Sheet
      open={!!ask}
      onOpenChange={(o) => !o && cancel()}
      title={ask?.title ?? 'Sign in to continue'}
      closeButton
    >
      <p className="m-0 text-[15px] leading-relaxed text-ink2">
        {ask?.body ??
          'Sign in with your college email. It takes a few seconds, and you come straight back here.'}
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={cancel}>
          Not now
        </Button>
        <Button
          variant="brand"
          autoFocus
          onClick={() => {
            const to = signInPath(ask?.next ?? herePath());
            track('sign_in_prompt_yes', {});
            close();
            navigate(to);
          }}
        >
          Sign in
        </Button>
      </div>
    </Sheet>
  );
}
