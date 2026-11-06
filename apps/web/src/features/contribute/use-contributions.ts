import type { ContributionMetaInput } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';

const KEY = ['contributions', 'me'] as const;

/** The student's status and contributions. Only asked for once they're signed in. */
export function useContributionStatus() {
  const { status } = useSession();
  return useQuery({ queryKey: KEY, queryFn: api.contributionStatus, enabled: status === 'ready' });
}

/** Sending files, with progress. */
export function useSubmitContribution() {
  const qc = useQueryClient();
  const [progress, setProgress] = useState(0);
  const mutation = useMutation({
    mutationFn: ({ meta, files }: { meta: ContributionMetaInput; files: File[] }) => {
      setProgress(0);
      return api.uploadContribution(meta, files, setProgress);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
  return { ...mutation, progress };
}

export function useWithdrawContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.withdrawContribution,
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
