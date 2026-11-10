import { studentFromEmail } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';

const KEY = 'ss_last_drawer';

/** The drawer last opened in the catalogue ("2025:bce"), so other pages can show its pack. */
export function rememberDrawer(batchYear: number, branchSlug: string) {
  if (!batchYear || !branchSlug) return;
  try {
    localStorage.setItem(KEY, `${batchYear}:${branchSlug}`);
  } catch {
    // Private mode or blocked storage: the course page simply shows the bundles made by hand.
  }
}

/**
 * The reader's own drawer: from their college email when it maps to a batch and programme,
 * otherwise the one they last opened. Null when we can't tell.
 */
export function useMyDrawer(): string | null {
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue, staleTime: 60_000 });
  const me = useSession((s) => s.me);
  const mine = me ? studentFromEmail(me.email) : null;
  const batches = index.data?.batches ?? [];
  const branch = (index.data?.branches ?? []).find(
    (b) => !b.isCommon && mine && b.code.toUpperCase() === mine.branchCode,
  );
  if (mine && branch && batches.some((b) => b.year === mine.batchYear))
    return `${mine.batchYear}:${branch.slug}`;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Bundles for this reader: ones made by hand, and only their own drawer's pack. Their pack first. */
export function forMyDrawer<T extends { forDrawer?: string | null }>(bundles: T[], mine: string | null): T[] {
  return bundles
    .filter((b) => !b.forDrawer || b.forDrawer === mine)
    .sort((a, b) => Number(b.forDrawer === mine && !!mine) - Number(a.forDrawer === mine && !!mine));
}
