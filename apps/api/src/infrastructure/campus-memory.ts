import {
  type MessInput,
  type MessOrderStatus,
  type MessReportStatus,
  OPEN_MESS_ORDER,
  type ReminderPrefs,
} from '@ss/contracts';
import type {
  MessOrderRecord,
  MessOrderRepository,
  MessRecord,
  MessReportRecord,
  MessReportRepository,
  MessRepository,
  PushRepository,
  PushSubscriptionRecord,
} from '../domain/campus-ports';

let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

export class MemoryMesses implements MessRepository {
  readonly rows = new Map<string, MessRecord>();
  constructor(private readonly now: () => Date = () => new Date()) {}
  async list() {
    return [...this.rows.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  }
  async find(slug: string) {
    return this.rows.get(slug) ?? null;
  }
  async save(mess: MessInput & { sort: number }) {
    const row: MessRecord = structuredClone({ ...mess, updatedAt: this.now() });
    this.rows.set(mess.slug, row);
    return row;
  }
  async remove(slug: string) {
    this.rows.delete(slug);
  }
}

export class MemoryMessReports implements MessReportRepository {
  readonly rows: (MessReportRecord & { ipHash: string })[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}
  async add(r: Omit<MessReportRecord, 'id' | 'status' | 'createdAt'> & { ipHash: string }) {
    this.rows.unshift({ ...r, id: nextId('report'), status: 'new', createdAt: this.now() });
  }
  async list(limit: number) {
    return this.rows.slice(0, limit).map(({ ipHash: _i, ...r }) => r);
  }
  async setStatus(id: string, status: MessReportStatus) {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.status = status;
    return !!row;
  }
}

export class MemoryPush implements PushRepository {
  readonly subs = new Map<string, PushSubscriptionRecord>();
  readonly sent: { subscriptionId: string; key: string; day: string }[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}
  async upsert(sub: Omit<PushSubscriptionRecord, 'id' | 'createdAt'>) {
    const current = await this.findByEndpoint(sub.endpoint);
    const row: PushSubscriptionRecord = {
      ...sub,
      userId: sub.userId ?? current?.userId ?? null,
      id: current?.id ?? nextId('push'),
      createdAt: current?.createdAt ?? this.now(),
    };
    this.subs.set(row.id, row);
    return row;
  }
  async findByEndpoint(endpoint: string) {
    return [...this.subs.values()].find((s) => s.endpoint === endpoint) ?? null;
  }
  async setPrefs(endpoint: string, prefs: ReminderPrefs) {
    const row = await this.findByEndpoint(endpoint);
    if (row) row.prefs = prefs;
    return !!row;
  }
  async removeByEndpoint(endpoint: string) {
    const row = await this.findByEndpoint(endpoint);
    if (row) this.subs.delete(row.id);
  }
  async removeIds(ids: string[]) {
    for (const id of ids) this.subs.delete(id);
  }
  async listAll() {
    return [...this.subs.values()];
  }
  async listForUser(userId: string) {
    return [...this.subs.values()].filter((s) => s.userId === userId);
  }
  async sentSince(day: string) {
    return this.sent.filter((s) => s.day >= day && this.subs.has(s.subscriptionId));
  }
  async recordSent(rows: { subscriptionId: string; key: string; day: string }[]) {
    for (const r of rows)
      if (!this.sent.some((s) => s.subscriptionId === r.subscriptionId && s.key === r.key)) this.sent.push(r);
  }
  async pruneSent(beforeDay: string) {
    const keep = this.sent.filter((s) => s.day >= beforeDay);
    this.sent.splice(0, this.sent.length, ...keep);
  }
}

const OPEN = new Set<MessOrderStatus>(OPEN_MESS_ORDER);

export class MemoryMessOrders implements MessOrderRepository {
  readonly rows: MessOrderRecord[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}
  async add(o: Omit<MessOrderRecord, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'ownerNote'>) {
    const at = this.now();
    const row: MessOrderRecord = {
      ...structuredClone(o),
      id: nextId('order'),
      status: 'placed',
      ownerNote: '',
      createdAt: at,
      updatedAt: at,
    };
    this.rows.unshift(row);
    return structuredClone(row);
  }
  async find(id: string) {
    const row = this.rows.find((r) => r.id === id);
    return row ? structuredClone(row) : null;
  }
  async listForUser(userId: string, limit: number) {
    return structuredClone(this.rows.filter((r) => r.userId === userId).slice(0, limit));
  }
  async listForMess(slug: string, since: Date, limit: number) {
    return structuredClone(
      this.rows
        .filter((r) => r.messSlug === slug && (OPEN.has(r.status) || r.createdAt >= since))
        .slice(0, limit),
    );
  }
  async setStatus(id: string, status: MessOrderStatus, ownerNote: string) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    row.status = status;
    row.ownerNote = ownerNote;
    row.updatedAt = this.now();
    return structuredClone(row);
  }
  async countSince(by: { userId?: string; ipHash?: string; messSlug?: string }, since: Date) {
    return this.rows.filter(
      (r) =>
        r.createdAt >= since &&
        (!by.userId || r.userId === by.userId) &&
        (!by.ipHash || r.ipHash === by.ipHash) &&
        (!by.messSlug || r.messSlug === by.messSlug),
    ).length;
  }
  async countOpenForUser(userId: string) {
    return this.rows.filter((r) => r.userId === userId && OPEN.has(r.status)).length;
  }
}
