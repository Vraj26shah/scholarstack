/**
 * Where the student has been in this tab, keyed by the browser history position React Router
 * keeps in `history.state.idx`. "Back" buttons use it to return to the page the student actually
 * came from (with the browser restoring its scroll), instead of a fixed page such as the shelf.
 */
const visited = new Map<number, string>();

const currentIdx = () => {
  const state = typeof window !== 'undefined' ? (window.history.state as { idx?: number } | null) : null;
  return typeof state?.idx === 'number' ? state.idx : 0;
};

/** Called on every route change. */
export function recordVisit(path: string) {
  visited.set(currentIdx(), path);
}

/**
 * The nearest earlier page in this tab that `skip` doesn't reject, as a history step count
 * (e.g. -2) plus its path. Null when the student arrived here directly (a link, a new tab, a
 * sign-in redirect), so the caller falls back to a sensible page.
 */
export function previousPage(
  skip: (path: string) => boolean = () => false,
): { delta: number; path: string } | null {
  const here = currentIdx();
  for (let i = here - 1; i >= 0; i--) {
    const path = visited.get(i);
    if (path === undefined) return null;
    if (!skip(path)) return { delta: i - here, path };
  }
  return null;
}

/** A short human name for a page, for "Back to …" labels. */
export function pageName(path: string): string {
  const p = path.split(/[?#]/)[0] ?? '/';
  if (p === '/') return path.includes('#toolbox') ? 'toolbox' : 'catalogue';
  if (p.startsWith('/shelf')) return 'my shelf';
  if (p.startsWith('/c/')) return 'course';
  if (p.startsWith('/b/')) return 'bundle';
  if (p.startsWith('/tools/')) return 'tool';
  if (p.startsWith('/admin')) return 'admin';
  if (p.startsWith('/account')) return 'account';
  if (p.startsWith('/read/')) return 'reader';
  return 'previous page';
}
