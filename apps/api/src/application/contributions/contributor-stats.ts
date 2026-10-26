import type { ContributorStatsDto, EarningsDto } from '@ss/contracts';
import type { ContributionRepository } from '../../domain/ports';
import { type FiledCourses, filedFiles } from './pipeline';

/**
 * How each contributor is doing: what they sent, what we used, how much of it students can read,
 * what it sold and what they've earned and been paid. Read-only; built from data we already keep.
 */
export class ContributorStatsService {
  constructor(
    private readonly repo: ContributionRepository,
    private readonly filedCourses: FiledCourses,
    private readonly earnings: { overview(): Promise<EarningsDto> },
  ) {}

  async list(): Promise<ContributorStatsDto[]> {
    const all = await this.repo.list('all', 2000);
    const ids = [...new Set(all.map((c) => c.userId))];
    const [people, filed, money] = await Promise.all([
      this.repo.contributors(ids),
      this.filedCourses.load(all),
      this.earnings.overview(),
    ]);
    const rows = new Map<string, ContributorStatsDto>();
    for (const id of ids) {
      const p = people.get(id);
      rows.set(id, {
        userId: id,
        email: p?.email ?? '',
        name: p?.name ?? null,
        blocked: p?.blocked ?? false,
        uploads: 0,
        accepted: 0,
        rejected: 0,
        waiting: 0,
        filesLive: 0,
        pagesLive: 0,
        royaltyCourses: 0,
        royaltySales: 0,
        earnedPaise: 0,
        paidPaise: 0,
        owedPaise: 0,
        lastUploadAt: '',
      });
    }
    for (const c of all) {
      const r = rows.get(c.userId)!;
      r.uploads++;
      if (c.status === 'approved') r.accepted++;
      else if (c.status === 'rejected') r.rejected++;
      else r.waiting++;
      if (c.createdAt.toISOString() > r.lastUploadAt) r.lastUploadAt = c.createdAt.toISOString();
      const course = filed.course(c);
      if (course?.status === 'live')
        for (const f of filedFiles(c, filed.files(c)))
          if (f.status === 'ready') {
            r.filesLive++;
            r.pagesLive += f.pages;
          }
    }
    for (const course of money.courses) {
      const royalty = course.royalty;
      const r = royalty && rows.get(royalty.contributorId);
      if (!royalty || !r) continue;
      r.royaltyCourses++;
      r.royaltySales += royalty.sales;
      r.earnedPaise += royalty.earnedPaise;
      r.paidPaise += royalty.paidPaise;
    }
    for (const cash of money.cashRewards) {
      const r = rows.get(cash.contributorId);
      if (!r) continue;
      r.earnedPaise += cash.amountRupees * 100;
      if (cash.paidAt) r.paidPaise += cash.amountRupees * 100;
    }
    for (const r of rows.values()) r.owedPaise = Math.max(0, r.earnedPaise - r.paidPaise);
    // Most useful first: what they've earned, then pages students can read, then acceptance.
    return [...rows.values()].sort(
      (a, b) => b.earnedPaise - a.earnedPaise || b.pagesLive - a.pagesLive || b.accepted - a.accepted,
    );
  }
}
