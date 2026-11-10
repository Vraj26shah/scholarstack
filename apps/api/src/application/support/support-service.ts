import {
  type MySupportDto,
  SUPPORT_LIMITS,
  type SupportCreateInput,
  type SupportQueryDto,
} from '@ss/contracts';
import type { Principal } from '../../domain/entities';
import type { Clock, ProfileRepository, SupportRepository, UploadStore } from '../../domain/ports';
import { fail } from '../errors';
import { SUPPORT_POLICY } from '../uploads/file-policy';
import { type IncomingFile, deleteFiles, storeFiles } from '../uploads/store-files';
import { toSupportDto } from './mappers';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The student's help desk: ask a question or report what's wrong (with screenshots), read the
 * answer, reply, close. Every limit is enforced here, on the server.
 */
export class SupportService {
  constructor(
    private readonly repo: SupportRepository,
    private readonly uploads: UploadStore,
    private readonly profiles: ProfileRepository,
    private readonly clock: Clock,
  ) {}

  async mine(principal: Principal): Promise<MySupportDto> {
    const [counts, list] = await Promise.all([
      this.repo.counts(principal.userId, new Date(this.clock.now().getTime() - DAY_MS)),
      this.repo.listForUser(principal.userId),
    ]);
    return {
      limits: SUPPORT_LIMITS,
      open: counts.open,
      todayLeft: Math.max(0, SUPPORT_LIMITS.newPerDay - counts.recent),
      queries: list.map(toSupportDto),
    };
  }

  async ask(
    principal: Principal,
    input: SupportCreateInput,
    files: IncomingFile[],
  ): Promise<SupportQueryDto> {
    const profile = await this.profiles.ensure(principal);
    const counts = await this.repo.counts(principal.userId, new Date(this.clock.now().getTime() - DAY_MS));
    if (counts.open >= SUPPORT_LIMITS.openAtOnce)
      throw fail.badRequest(
        `You have ${counts.open} questions waiting. Add to one of those, or close one you no longer need.`,
      );
    if (counts.recent >= SUPPORT_LIMITS.newPerDay)
      throw fail.badRequest(
        `You can ask ${SUPPORT_LIMITS.newPerDay} new questions a day. Try again tomorrow.`,
      );
    if (files.length > SUPPORT_LIMITS.filesPerQuery)
      throw fail.badRequest(`Attach up to ${SUPPORT_LIMITS.filesPerQuery} screenshots.`);

    const id = crypto.randomUUID();
    const stored = await storeFiles(
      this.uploads,
      `support/${principal.userId}/${id}/`,
      files,
      SUPPORT_POLICY,
    );
    try {
      const q = await this.repo.create(
        {
          id,
          userId: principal.userId,
          topic: input.topic,
          subject: input.subject,
          page: input.page,
          files: stored,
        },
        { author: profile.fullName?.trim() || principal.email.split('@')[0]!, body: input.message },
      );
      return toSupportDto(q);
    } catch (error) {
      await deleteFiles(this.uploads, stored);
      throw error;
    }
  }

  private async own(principal: Principal, id: string) {
    const q = await this.repo.find(id);
    if (!q || q.userId !== principal.userId) throw fail.notFound('That question');
    return q;
  }

  async reply(principal: Principal, id: string, body: string): Promise<SupportQueryDto> {
    const q = await this.own(principal, id);
    if (q.messages.length >= SUPPORT_LIMITS.messagesPerQuery)
      throw fail.badRequest('This conversation is long. Please start a new question.');
    const profile = await this.profiles.ensure(principal);
    await this.repo.addMessage(id, {
      fromAdmin: false,
      author: profile.fullName?.trim() || principal.email.split('@')[0]!,
      body,
    });
    return toSupportDto((await this.repo.find(id))!);
  }

  async close(principal: Principal, id: string): Promise<SupportQueryDto> {
    await this.own(principal, id);
    await this.repo.setStatus(id, 'closed');
    return toSupportDto((await this.repo.find(id))!);
  }

  /** One of the student's own screenshots (so they can check what they sent). */
  async file(principal: Principal, id: string, index: number) {
    const q = await this.own(principal, id);
    return fileOf(this.uploads, q, index);
  }
}

export async function fileOf(
  uploads: UploadStore,
  q: { files: { index: number; key: string; name: string; size: number; type: string }[] },
  index: number,
) {
  const f = q.files.find((x) => x.index === index);
  if (!f) throw fail.notFound('That file');
  const obj = await uploads.get(f.key);
  if (!obj) throw fail.notFound('That file');
  return { body: obj.body, name: f.name, size: f.size, type: f.type };
}
