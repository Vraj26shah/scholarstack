/**
 * Where the site opens. Visitors who aren't signed in always start at the top of the home page
 * (the hero: what this is, why it's worth it), even when the address ends in #catalogue from an
 * earlier tap, so a refresh never drops a newcomer into a wall of cards. Signed-in students on a
 * phone open straight on the catalogue, the way an app opens on its main screen; on a laptop the
 * page opens where the address says.
 */

/** Where a student goes after signing in when nothing else was asked for. */
export const STUDENT_HOME = '/#catalogue';

/** True until the page the browser opened (a fresh visit or a refresh) has been placed. */
export const landing = { pending: typeof window !== 'undefined' };

/** The home page openings this rule decides: plain "/" and "/#catalogue". */
export const decidesLanding = (pathname: string, hash: string) =>
  pathname === '/' && (hash === '' || hash === '#catalogue');

export const isPhone = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 767px)').matches ?? false);

/**
 * Jump (no animation) to a section, then keep it in place while content above it loads, for
 * about a second and a half.
 */
export function jumpTo(id: string): () => void {
  let timer = 0;
  let tries = 0;
  let lastY = -1;
  const go = () => {
    const el = document.getElementById(id);
    if (!el) {
      if (tries++ < 40) timer = window.setTimeout(go, 50);
      return;
    }
    const y = el.getBoundingClientRect().top + window.scrollY;
    if (y !== lastY) {
      el.scrollIntoView({ behavior: 'auto', block: 'start' });
      lastY = y;
    }
    if (tries++ < 30) timer = window.setTimeout(go, 50);
  };
  go();
  return () => window.clearTimeout(timer);
}
