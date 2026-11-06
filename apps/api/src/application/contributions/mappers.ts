import type { MyContributionDto } from '@ss/contracts';
import type { Contribution } from '../../domain/entities';

export const toMyContribution = (
  c: Contribution,
  progress: MyContributionDto['progress'] = {
    step: c.status === 'pending' ? 'review' : c.status === 'rejected' ? 'rejected' : 'accepted',
    courseTitle: null,
    courseSlug: null,
  },
): MyContributionDto => ({
  id: c.id,
  title: c.title,
  courseHint: c.courseHint,
  kind: c.kind,
  files: c.files.map(({ index, name, size, type, check }) => ({
    index,
    name,
    size,
    type,
    ...(check ? { check } : {}),
  })),
  totalBytes: c.totalBytes,
  status: c.status,
  reviewNote: c.reviewNote,
  reward: c.reward,
  rewardPaidAt: c.rewardPaidAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
  reviewedAt: c.reviewedAt?.toISOString() ?? null,
  progress,
});
