import {
  CONTRIBUTION_LIMITS,
  type ContributionMetaInput,
  type ContributionStatusDto,
  type MyContributionDto,
} from '@ss/contracts';
import type { Principal } from '../../domain/entities';
import type {
  Clock,
  ContributionRepository,
  ProfileRepository,
  SettingsRepository,
  UploadStore,
} from '../../domain/ports';
import type { RoyaltyStatements } from '../earnings/earnings-service';
import { fail } from '../errors';
import { type IncomingFile, deleteFiles, storeFiles } from '../uploads/store-files';
import { inspectFile } from './inspect';
import { toMyContribution } from './mappers';
import { type FiledCourses, progressOf } from './pipeline';

export type { IncomingFile };

export const OPEN_SETTING = 'contributions_open';
const DAY_MS = 24 * 60 * 60 * 1000;
const refuse = (message: string) => fail.badRequest(message);

/**
 * The student side of contributions: what they may do now, sending files, and taking back a
 * submission that hasn't been reviewed. Every limit is checked here, on the server.
 */
export class ContributionService {
  constructor(
    private readonly repo: ContributionRepository,
    private readonly uploads: UploadStore,
    private readonly settings: SettingsRepository,
    private readonly profiles: ProfileRepository,
    private readonly royalties: RoyaltyStatements,
    private readonly clock: Clock,
    private readonly filedCourses?: FiledCourses,
  ) {}

  async status(principal: Principal): Promise<ContributionStatusDto> {
    const [open, blocked, counts, mine, royalties] = await Promise.all([
      this.settings.get(OPEN_SETTING, true),
      this.repo.isBlocked(principal.userId),
      this.repo.counts(principal.userId, new Date(this.clock.now().getTime() - DAY_MS)),
      this.repo.listForUser(principal.userId),
      this.royalties.forContributor(principal.userId),
    ]);
    const filed = this.filedCourses ? await this.filedCourses.load(mine) : null;
    return {
      open,
      blocked,
      pending: counts.pending,
      todayLeft: Math.max(0, CONTRIBUTION_LIMITS.submissionsPerDay - counts.recent),
      limits: CONTRIBUTION_LIMITS,
      mine: mine.map((c) =>
        toMyContribution(c, filed ? progressOf(c, filed.course(c), filed.files(c)) : undefined),
      ),
      royalties,
    };
  }

  async submit(
    principal: Principal,
    meta: ContributionMetaInput,
    files: IncomingFile[],
  ): Promise<MyContributionDto> {
    await this.profiles.ensure(principal);
    if (!(await this.settings.get(OPEN_SETTING, true)))
      throw refuse('Sharing notes is paused right now. Please try again later.');
    if (await this.repo.isBlocked(principal.userId)) throw fail.forbidden();
    const counts = await this.repo.counts(principal.userId, new Date(this.clock.now().getTime() - DAY_MS));
    if (counts.pending >= CONTRIBUTION_LIMITS.pendingAtOnce)
      throw refuse(
        `You have ${counts.pending} contributions waiting for review. Send more once they're reviewed.`,
      );
    if (counts.recent >= CONTRIBUTION_LIMITS.submissionsPerDay)
      throw refuse(
        `You can share up to ${CONTRIBUTION_LIMITS.submissionsPerDay} times a day. Try again tomorrow.`,
      );
    if (files.length === 0) throw refuse('Add at least one file.');
    if (files.length > CONTRIBUTION_LIMITS.filesPerSubmission)
      throw refuse(
        `Up to ${CONTRIBUTION_LIMITS.filesPerSubmission} files at a time. Zip them if you have more.`,
      );
    const total = files.reduce((t, f) => t + f.bytes.byteLength, 0);
    if (total > CONTRIBUTION_LIMITS.bytesPerSubmission)
      throw refuse(
        `All files together must be under ${CONTRIBUTION_LIMITS.bytesPerSubmission / 1024 / 1024} MB.`,
      );

    const id = crypto.randomUUID();
    const saved = await storeFiles(this.uploads, `contributions/${principal.userId}/${id}/`, files);
    // The automatic check: what each file is and whether pages can be made from it.
    const stored = saved.map((f) => ({ ...f, check: inspectFile(f.name, files[f.index - 1]!.bytes) }));
    try {
      const created = await this.repo.create({
        id,
        userId: principal.userId,
        title: meta.title,
        courseHint: meta.courseHint,
        kind: meta.kind,
        description: meta.description,
        files: stored,
        totalBytes: total,
      });
      return toMyContribution(created);
    } catch (error) {
      // Never leave files behind that nothing points at.
      await deleteFiles(this.uploads, stored);
      throw error;
    }
  }

  /** A student can take back a contribution that hasn't been reviewed yet. */
  async withdraw(principal: Principal, id: string): Promise<void> {
    const c = await this.repo.find(id);
    if (!c || c.userId !== principal.userId) throw fail.notFound('That contribution');
    if (c.status !== 'pending') throw refuse('This contribution has already been reviewed.');
    await deleteFiles(this.uploads, c.files);
    await this.repo.remove(id);
  }
}
