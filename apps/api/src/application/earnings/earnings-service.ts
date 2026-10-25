import type {
  BonusPaidInput,
  CourseEarningDto,
  EarningsDto,
  MyRoyaltyDto,
  RoyaltyPayoutInput,
  SetRoyaltyInput,
} from '@ss/contracts';
import type { Course, CourseEarningRow } from '../../domain/entities';
import type {
  CatalogueReader,
  CatalogueWriter,
  Clock,
  ContributionRepository,
  EarningsRepository,
  PeopleDirectory,
  ProfileRepository,
} from '../../domain/ports';
import { fail } from '../errors';
import { royaltyBalance } from './royalty-math';

const EMPTY: Omit<CourseEarningRow, 'courseId'> = {
  sales: 0,
  buyers: 0,
  revenuePaise: 0,
  lastSaleAt: null,
  freeAccess: 0,
  readingNow: 0,
  royaltySales: 0,
  royaltyRevenuePaise: 0,
  paidOutPaise: 0,
};

/** The contributor's side, kept separate so the contribution page depends only on this. */
export interface RoyaltyStatements {
  forContributor(userId: string): Promise<MyRoyaltyDto[]>;
}

/**
 * Money, per course: what it sold, to how many students, and the royalty owed to the student
 * whose notes it is built on. Payouts happen outside the site (UPI); the admin records them here.
 */
export class EarningsService implements RoyaltyStatements {
  constructor(
    private readonly repo: EarningsRepository,
    private readonly courses: Pick<CatalogueWriter, 'listAllCourses'>,
    private readonly catalogue: Pick<CatalogueReader, 'findCourse' | 'coursesByIds'>,
    private readonly people: PeopleDirectory,
    private readonly profiles: Pick<ProfileRepository, 'findByEmails'>,
    private readonly clock: Clock,
    private readonly contributions?: Pick<ContributionRepository, 'cashRewards' | 'markRewardPaid'>,
  ) {}

  /** The year the bonus is for: the 12 months up to now. */
  private bonusYear() {
    return this.clock.now().getUTCFullYear();
  }

  /**
   * The contributors whose notes sold most in the last 12 months, by royalty earned. The first
   * is the year's top contributor, whose bonus is what they earned again (paid twice over).
   */
  private async topContributors() {
    const since = new Date(this.clock.now().getTime() - 365 * 86_400_000);
    const rows = await this.repo.royaltyEarningsSince(since);
    const byUser = new Map<string, { courses: number; sales: number; earnedPaise: number }>();
    for (const r of rows) {
      const u = byUser.get(r.userId) ?? { courses: 0, sales: 0, earnedPaise: 0 };
      u.courses++;
      u.sales += r.sales;
      u.earnedPaise += Math.floor((r.revenuePaise * r.sharePercent) / 100);
      byUser.set(r.userId, u);
    }
    const ranked = [...byUser.entries()]
      .filter(([, u]) => u.sales > 0)
      .sort((a, b) => b[1].earnedPaise - a[1].earnedPaise || b[1].sales - a[1].sales)
      .slice(0, 5);
    const [people, paid] = await Promise.all([
      this.people.byIds(ranked.map(([id]) => id)),
      this.repo.bonuses(this.bonusYear()),
    ]);
    return ranked.map(([id, u]) => ({
      contributorId: id,
      email: people.get(id)?.email ?? '',
      name: people.get(id)?.name ?? null,
      ...u,
      bonusPaise: u.earnedPaise,
      bonusPaidAt: paid.find((b) => b.userId === id)?.paidAt.toISOString() ?? null,
    }));
  }

  private async cashRewards() {
    const list = (await this.contributions?.cashRewards()) ?? [];
    const people = await this.people.byIds([...new Set(list.map((c) => c.userId))]);
    return list.map((c) => ({
      contributionId: c.id,
      title: c.title,
      contributorId: c.userId,
      email: people.get(c.userId)?.email ?? '',
      name: people.get(c.userId)?.name ?? null,
      amountRupees: c.reward?.type === 'cash' ? c.reward.amountRupees : 0,
      approvedAt: c.reviewedAt?.toISOString() ?? null,
      paidAt: c.rewardPaidAt?.toISOString() ?? null,
      note: c.rewardPaidNote ?? '',
    }));
  }

  async markRewardPaid(contributionId: string, note: string) {
    const list = (await this.contributions?.cashRewards()) ?? [];
    const c = list.find((x) => x.id === contributionId);
    if (!c) throw fail.notFound('That cash reward');
    if (c.rewardPaidAt) throw fail.badRequest('That reward is already marked paid.');
    await this.contributions!.markRewardPaid(contributionId, note);
  }

  /** Record the yearly bonus paid to the top contributor (once per person per year). */
  async recordBonus(input: BonusPaidInput, adminEmail: string) {
    const top = await this.topContributors();
    const who = top.find((t) => t.contributorId === input.userId);
    if (!who) throw fail.badRequest('Only one of this year’s top contributors can get the bonus.');
    if (who.bonusPaidAt) throw fail.badRequest('This year’s bonus is already recorded for them.');
    await this.repo.addBonus({
      userId: input.userId,
      year: input.year,
      amountPaise: input.amountRupees * 100,
      note: input.note,
      recordedBy: adminEmail,
    });
  }

  async overview(): Promise<EarningsDto> {
    const [courses, rows, royalties, payouts, totals, cashRewards, topContributors] = await Promise.all([
      this.courses.listAllCourses(),
      this.repo.courseEarnings(),
      this.repo.royalties(),
      this.repo.payouts(200),
      this.repo.paidTotals(),
      this.cashRewards(),
      this.topContributors(),
    ]);
    const byCourse = new Map(rows.map((r) => [r.courseId, r]));
    const royaltyOf = new Map(royalties.map((r) => [r.courseId, r]));
    const people = await this.people.byIds([
      ...new Set([...royalties.map((r) => r.userId), ...payouts.map((p) => p.userId)]),
    ]);
    const title = new Map(courses.map((c) => [c.id, c.title]));

    const list: CourseEarningDto[] = courses.map((c: Course) => {
      const row = byCourse.get(c.id) ?? { courseId: c.id, ...EMPTY };
      const r = royaltyOf.get(c.id);
      const who = r ? people.get(r.userId) : undefined;
      return {
        courseId: c.id,
        title: c.title,
        slug: c.slug,
        status: c.status,
        pricePaise: c.pricePaise,
        sales: row.sales,
        buyers: row.buyers,
        freeAccess: row.freeAccess,
        readingNow: row.readingNow,
        revenuePaise: row.revenuePaise,
        lastSaleAt: row.lastSaleAt?.toISOString() ?? null,
        royalty: r
          ? {
              contributorId: r.userId,
              email: who?.email ?? '',
              name: who?.name ?? null,
              sharePercent: r.sharePercent,
              since: r.since.toISOString(),
              contributionId: r.contributionId,
              ...royaltyBalance(row, r),
            }
          : null,
      };
    });
    list.sort((a, b) => b.revenuePaise - a.revenuePaise || a.title.localeCompare(b.title));

    return {
      totals: {
        revenuePaise: list.reduce((t, c) => t + c.revenuePaise, 0),
        sales: totals.orders,
        buyers: totals.buyers,
        royaltyOwedPaise: list.reduce((t, c) => t + (c.royalty?.owedPaise ?? 0), 0),
        royaltyPaidPaise: payouts.reduce((t, p) => t + p.amountPaise, 0),
        cashOwedPaise: cashRewards.filter((c) => !c.paidAt).reduce((t, c) => t + c.amountRupees * 100, 0),
      },
      cashRewards,
      topContributors,
      bonusYear: this.bonusYear(),
      courses: list,
      payouts: payouts.map((p) => ({
        id: p.id,
        courseId: p.courseId,
        courseTitle: title.get(p.courseId) ?? 'Deleted course',
        contributorId: p.userId,
        email: people.get(p.userId)?.email ?? '',
        amountPaise: p.amountPaise,
        note: p.note,
        paidAt: p.paidAt.toISOString(),
        recordedBy: p.recordedBy,
      })),
    };
  }

  /** Give a student a share of a course's future sales (replaces any royalty already on it). */
  async setRoyalty(input: SetRoyaltyInput, adminEmail: string) {
    const course = await this.catalogue.findCourse(input.courseId);
    if (!course) throw fail.notFound('That course');
    const [person] = await this.profiles.findByEmails([input.email]);
    if (!person)
      throw fail.badRequest(
        `${input.email} hasn't signed in to Scholars Stack yet. Ask them to sign in once.`,
      );
    await this.repo.setRoyalty({
      courseId: course.id,
      userId: person.id,
      sharePercent: input.sharePercent,
      since: this.clock.now(),
      contributionId: null,
      createdBy: adminEmail,
    });
  }

  removeRoyalty(courseId: string) {
    return this.repo.removeRoyalty(courseId);
  }

  /** Record money paid to a course's royalty holder. Refuses more than they are owed. */
  async recordPayout(input: RoyaltyPayoutInput, adminEmail: string) {
    const [royalty, rows] = await Promise.all([this.repo.royalties(), this.repo.courseEarnings()]);
    const r = royalty.find((x) => x.courseId === input.courseId);
    if (!r) throw fail.badRequest('This course has no royalty to pay.');
    const row = rows.find((x) => x.courseId === input.courseId) ?? { courseId: r.courseId, ...EMPTY };
    const { owedPaise } = royaltyBalance(row, r);
    const amountPaise = input.amountRupees * 100;
    if (amountPaise > owedPaise)
      throw fail.badRequest(`Only ₹${Math.floor(owedPaise / 100)} is owed on this course right now.`);
    return this.repo.addPayout({
      courseId: r.courseId,
      userId: r.userId,
      amountPaise,
      note: input.note,
      recordedBy: adminEmail,
    });
  }

  async forContributor(userId: string): Promise<MyRoyaltyDto[]> {
    const mine = await this.repo.royaltiesForUser(userId);
    if (mine.length === 0) return [];
    const [rows, courses] = await Promise.all([
      this.repo.courseEarnings(),
      this.catalogue.coursesByIds(mine.map((r) => r.courseId)),
    ]);
    const title = new Map(courses.map((c) => [c.id, c.title]));
    return mine.map((r) => {
      const row = rows.find((x) => x.courseId === r.courseId) ?? { courseId: r.courseId, ...EMPTY };
      return {
        courseId: r.courseId,
        courseTitle: title.get(r.courseId) ?? 'A course',
        sharePercent: r.sharePercent,
        since: r.since.toISOString(),
        ...royaltyBalance(row, r),
      };
    });
  }
}
