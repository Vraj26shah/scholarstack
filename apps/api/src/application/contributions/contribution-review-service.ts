import type { AdminContributionDto, ContributionReviewInput } from '@ss/contracts';
import type { Contribution } from '../../domain/entities';
import type {
  CatalogueReader,
  Clock,
  ContributionRepository,
  EarningsRepository,
  EntitlementRepository,
  ObjectStore,
  SettingsRepository,
  UploadStore,
} from '../../domain/ports';
import { fail } from '../errors';
import type { StudentMailer } from '../notify/student-mailer';
import { safeFileName } from '../uploads/file-policy';
import { OPEN_SETTING } from './contribution-service';
import { toMyContribution } from './mappers';

/**
 * The admin side: see what students sent, download it, decide, reward, put good notes into a
 * course folder, and switch uploads on or off. Rewards reuse the existing "give a course" path.
 */
export class ContributionReviewService {
  constructor(
    private readonly repo: ContributionRepository,
    private readonly uploads: UploadStore,
    private readonly sources: ObjectStore,
    private readonly catalogue: CatalogueReader,
    private readonly entitlements: EntitlementRepository,
    private readonly settings: SettingsRepository,
    private readonly earnings: EarningsRepository,
    private readonly mail: StudentMailer,
    private readonly clock: Clock,
  ) {}

  private async toDto(list: Contribution[]): Promise<AdminContributionDto[]> {
    const people = await this.repo.contributors([...new Set(list.map((c) => c.userId))]);
    return list.map((c) => {
      const p = people.get(c.userId);
      return {
        ...toMyContribution(c),
        description: c.description,
        reviewedBy: c.reviewedBy,
        contributor: {
          id: c.userId,
          email: p?.email ?? '',
          name: p?.name ?? null,
          blocked: p?.blocked ?? false,
          approvedBefore: p?.approved ?? 0,
        },
      };
    });
  }

  async list(
    status: Contribution['status'] | 'all',
  ): Promise<{ open: boolean; items: AdminContributionDto[] }> {
    const [open, items] = await Promise.all([
      this.settings.get(OPEN_SETTING, true),
      this.repo.list(status, 300),
    ]);
    return { open, items: await this.toDto(items) };
  }

  /** One uploaded file, for download. */
  async file(id: string, index: number) {
    const c = await this.repo.find(id);
    const f = c?.files.find((x) => x.index === index);
    if (!c || !f) throw fail.notFound('That file');
    const obj = await this.uploads.get(f.key);
    if (!obj) throw fail.notFound('That file');
    return { body: obj.body, name: f.name, size: f.size };
  }

  async review(
    id: string,
    input: ContributionReviewInput,
    adminEmail: string,
  ): Promise<AdminContributionDto> {
    const c = await this.repo.find(id);
    if (!c) throw fail.notFound('That contribution');
    if (input.decision === 'rejected' && input.reward.type !== 'none')
      throw fail.badRequest('A rejected contribution can’t carry a reward.');
    let reward: Contribution['reward'] = input.decision === 'approved' ? { type: 'none' } : null;
    if (input.decision === 'approved' && input.reward.type === 'course') {
      const course = await this.catalogue.findCourse(input.reward.courseId);
      if (!course) throw fail.notFound('That course');
      const until = course.accessUntil && course.accessUntil > this.clock.now() ? course.accessUntil : null;
      await this.entitlements.grantByAdmin(course.id, [c.userId], until, adminEmail);
      reward = { type: 'course', courseId: course.id, courseTitle: course.title };
    } else if (input.decision === 'approved' && input.reward.type === 'royalty') {
      const course = await this.catalogue.findCourse(input.reward.courseId);
      if (!course) throw fail.notFound('That course');
      await this.earnings.setRoyalty({
        courseId: course.id,
        userId: c.userId,
        sharePercent: input.reward.sharePercent,
        since: this.clock.now(),
        contributionId: c.id,
        createdBy: adminEmail,
      });
      reward = {
        type: 'royalty',
        courseId: course.id,
        courseTitle: course.title,
        sharePercent: input.reward.sharePercent,
      };
    } else if (input.decision === 'approved' && input.reward.type === 'cash') {
      reward = { type: 'cash', amountRupees: input.reward.amountRupees };
    } else if (input.decision === 'approved' && input.reward.type === 'thanks') {
      reward = { type: 'thanks' };
    }
    const updated = await this.repo.review(id, {
      status: input.decision,
      reviewNote: input.note,
      reward,
      reviewedBy: adminEmail,
    });
    if (!updated) throw fail.notFound('That contribution');
    if (input.notify) await this.tell(updated).catch(() => {});
    return (await this.toDto([updated]))[0]!;
  }

  /** Email the contributor about the decision (best effort; counts towards the daily limit). */
  private async tell(c: Contribution) {
    const person = (await this.repo.contributors([c.userId])).get(c.userId);
    if (!person?.email) return;
    const r = c.reward;
    const rewardLine =
      r?.type === 'course'
        ? `As a thank-you, ${r.courseTitle} is now on your shelf, free.`
        : r?.type === 'cash'
          ? `As a thank-you, we'll pay you ₹${r.amountRupees}. We'll reply to this email to arrange it.`
          : r?.type === 'royalty'
            ? `Your notes are now part of ${r.courseTitle}. You earn ${r.sharePercent}% of what every sale of it brings in, from today. You can follow your earnings on the Contribute page.`
            : r?.type === 'thanks'
              ? 'Thank you: your notes help everyone in your batch.'
              : '';
    const approved = c.status === 'approved';
    await this.mail.send(
      { userId: c.userId, email: person.email, name: person.name },
      {
        subject: approved ? `Your notes “${c.title}” were accepted` : `About your notes “${c.title}”`,
        heading: approved ? 'Your notes were accepted' : 'We couldn’t use these notes',
        paragraphs: [
          approved
            ? `We've reviewed “${c.title}” and we'd like to use it on Scholars Stack.`
            : `We've reviewed “${c.title}”, and this time we can't use it.`,
          rewardLine,
          c.reviewNote ? `A note from the library: ${c.reviewNote}` : '',
          approved
            ? 'Have more? Share them any time from the Contribute page.'
            : 'You can always share other notes from the Contribute page.',
        ],
        ctaLabel: r?.type === 'course' ? 'Open my shelf' : 'See my contributions',
        ctaUrl: r?.type === 'course' ? '/shelf' : '/contribute',
        kicker: approved ? 'NOTES ACCEPTED' : 'NOTES REVIEWED',
        reason: 'You are getting this because you shared notes on Scholars Stack.',
      },
    );
  }

  /**
   * Copy an approved contribution's files into an R2 folder (for example a course's unit folder),
   * where the usual R2 → Website flow turns them into pages. The originals stay until deleted.
   */
  async copyToFolder(id: string, folder: string) {
    const c = await this.repo.find(id);
    if (!c) throw fail.notFound('That contribution');
    if (c.status !== 'approved')
      throw fail.badRequest('Approve the contribution before adding it to a course folder.');
    const clean = folder.replace(/^\/+/, '').replace(/\/*$/, '/');
    if (
      clean.split('/').some((p) => p === '..' || p === '.') ||
      /^(pages|contributions|support|_system)\//.test(clean)
    )
      throw fail.badRequest('That folder name is not allowed.');
    const copied: string[] = [];
    for (const f of c.files) {
      const to = `${clean}${safeFileName(f.name)}`;
      if ((await this.sources.listPage(to, undefined, 1)).objects.some((o) => o.key === to))
        throw fail.badRequest(`${to} already exists. Pick another folder or rename the file first.`);
      await this.sources.copy(f.key, to);
      copied.push(to);
    }
    return { copied };
  }

  /** Remove a contribution and its files for good. */
  async remove(id: string) {
    const c = await this.repo.find(id);
    if (!c) throw fail.notFound('That contribution');
    for (const f of c.files) await this.uploads.delete(f.key).catch(() => {});
    await this.repo.remove(id);
  }

  setOpen(open: boolean) {
    return this.settings.set(OPEN_SETTING, open);
  }

  setBlocked(userId: string, blocked: boolean) {
    return this.repo.setBlocked(userId, blocked);
  }
}
