import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';

/**
 * Food (mess menus and ordering) is shown only once its launch switch (Admin › mess-menu) is
 * live. Until then every way in stays hidden: the Food tab, Order food buttons, My orders links.
 * Admins still see it, to set it up. Hidden while the answer loads, so it never flashes up.
 */
export function useFoodLive(): boolean {
  const isAdmin = useSession((s) => !!s.me?.isAdmin);
  const q = useQuery({ queryKey: ['features'], queryFn: api.features, staleTime: 60_000 });
  return isAdmin || q.data?.find((f) => f.key === 'mess-menu')?.status === 'live';
}
