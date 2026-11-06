import type { SupportCreateInput } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';

const KEY = ['support', 'mine'] as const;

export function useMySupport() {
  const { status } = useSession();
  return useQuery({ queryKey: KEY, queryFn: api.mySupport, enabled: status === 'ready' });
}

export function useAsk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, files }: { input: SupportCreateInput; files: File[] }) =>
      api.askSupport(input, files),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useReply(id: string) {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: KEY });
  return {
    reply: useMutation({ mutationFn: (body: string) => api.replySupport(id, body), onSuccess: done }),
    close: useMutation({ mutationFn: () => api.closeSupport(id), onSuccess: done }),
  };
}
