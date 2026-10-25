import type { AdminSupportQueryDto } from '@ss/contracts';
import type { SupportQuery } from '../../domain/entities';
import type { PeopleDirectory, SupportRepository, UploadStore } from '../../domain/ports';
import { fail } from '../errors';
import type { StudentMailer } from '../notify/student-mailer';
import { deleteFiles } from '../uploads/store-files';
import { TOPIC_LABEL, toSupportDto } from './mappers';
import { fileOf } from './support-service';

export const DESK_NAME = 'Scholars Stack';

/** The admin side of the help desk: read, answer (the student is emailed), close, delete. */
export class SupportDeskService {
  constructor(
    private readonly repo: SupportRepository,
    private readonly uploads: UploadStore,
    private readonly people: PeopleDirectory,
    private readonly mail: StudentMailer,
  ) {}

  private async withStudents(list: SupportQuery[]): Promise<AdminSupportQueryDto[]> {
    const people = await this.people.byIds([...new Set(list.map((q) => q.userId))]);
    return list.map((q) => {
      const p = people.get(q.userId);
      return { ...toSupportDto(q), student: { id: q.userId, email: p?.email ?? '', name: p?.name ?? null } };
    });
  }

  async list(status: SupportQuery['status'] | 'all') {
    const all = await this.repo.list('all', 500);
    const counts = {
      open: all.filter((q) => q.status === 'open').length,
      answered: all.filter((q) => q.status === 'answered').length,
      closed: all.filter((q) => q.status === 'closed').length,
    };
    const items = await this.withStudents(status === 'all' ? all : all.filter((q) => q.status === status));
    return { counts, items };
  }

  async file(id: string, index: number) {
    const q = await this.repo.find(id);
    if (!q) throw fail.notFound('That question');
    return fileOf(this.uploads, q, index);
  }

  async reply(id: string, input: { body: string; close: boolean; notify: boolean }) {
    const q = await this.repo.find(id);
    if (!q) throw fail.notFound('That question');
    await this.repo.addMessage(id, { fromAdmin: true, author: DESK_NAME, body: input.body });
    if (input.close) await this.repo.setStatus(id, 'closed');
    const updated = (await this.repo.find(id))!;
    if (input.notify) {
      const p = (await this.people.byIds([q.userId])).get(q.userId);
      if (p)
        await this.mail.send(
          { userId: q.userId, email: p.email, name: p.name },
          {
            subject: `Re: ${q.subject}`,
            heading: 'We answered your question',
            paragraphs: [
              `About “${q.subject}” (${TOPIC_LABEL[q.topic].toLowerCase()}):`,
              input.body,
              input.close
                ? 'We’ve marked this as sorted. If it isn’t, reply from the Help page and it opens again.'
                : 'You can reply from the Help page.',
            ],
            ctaLabel: 'Open my questions',
            ctaUrl: '/help',
            kicker: 'HELP DESK',
            reason: 'You are getting this because you asked a question on Scholars Stack.',
          },
        );
    }
    return (await this.withStudents([updated]))[0]!;
  }

  async setStatus(id: string, status: SupportQuery['status']) {
    const q = await this.repo.find(id);
    if (!q) throw fail.notFound('That question');
    await this.repo.setStatus(id, status);
  }

  async remove(id: string) {
    const q = await this.repo.find(id);
    if (!q) throw fail.notFound('That question');
    await deleteFiles(this.uploads, q.files);
    await this.repo.remove(id);
  }
}
