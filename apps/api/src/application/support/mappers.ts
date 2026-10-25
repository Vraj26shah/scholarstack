import type { SupportQueryDto } from '@ss/contracts';
import type { SupportQuery } from '../../domain/entities';

export const toSupportDto = (q: SupportQuery): SupportQueryDto => ({
  id: q.id,
  topic: q.topic,
  subject: q.subject,
  page: q.page,
  status: q.status,
  files: q.files.map(({ index, name, size, type }) => ({ index, name, size, type })),
  messages: q.messages.map((m) => ({
    id: m.id,
    fromAdmin: m.fromAdmin,
    author: m.author,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  })),
  createdAt: q.createdAt.toISOString(),
  updatedAt: q.updatedAt.toISOString(),
});

export const TOPIC_LABEL: Record<SupportQuery['topic'], string> = {
  feature: 'Something on the site isn’t working',
  notes: 'A course or its notes',
  payment: 'A payment',
  contribute: 'Sharing notes and rewards',
  account: 'My account or devices',
  suggestion: 'A suggestion',
  other: 'Something else',
};
