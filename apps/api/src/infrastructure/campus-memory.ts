import {
  type ChatReportStatus,
  type ChatSender,
  type MessInput,
  type MessOrderStatus,
  type MessReportStatus,
  OPEN_MESS_ORDER,
  type ReminderPrefs,
} from '@ss/contracts';
import {
  type ChatMessageRecord,
  type ChatReportRecord,
  type ChatReportRepository,
  EMPTY_CHAT_STATE,
  type LiveSignal,
  type MessBlockRecord,
  type MessBlockRepository,
  type MessOrderRecord,
  type MessOrderRepository,
  type MessRecord,
  type MessReportRecord,
  type MessReportRepository,
  type MessRepository,
  type OrderChatRepository,
  type OrderChatState,
  type PushRepository,
  type PushSubscriptionRecord,
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
      email: sub.email || current?.email || '',
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
  async listForEmails(emails: string[]) {
    const want = new Set(emails);
    return [...this.subs.values()].filter((s) => s.email && want.has(s.email));
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
  async add(o: Omit<MessOrderRecord, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'ownerNote' | 'chat'>) {
    const at = this.now();
    const row: MessOrderRecord = {
      ...structuredClone(o),
      id: nextId('order'),
      status: 'placed',
      ownerNote: '',
      createdAt: at,
      updatedAt: at,
      chat: { ...EMPTY_CHAT_STATE },
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
  async patch(
    id: string,
    fields: Partial<OrderChatState> & { status?: MessOrderStatus; ownerNote?: string },
    ifStatus?: MessOrderStatus,
  ) {
    const row = this.rows.find((r) => r.id === id);
    if (!row || (ifStatus && row.status !== ifStatus)) return null;
    const { status, ownerNote, ...chat } = fields;
    if (status) {
      row.status = status;
      row.updatedAt = this.now();
    }
    if (ownerNote !== undefined) row.ownerNote = ownerNote;
    row.chat = { ...row.chat, ...chat };
    return structuredClone(row);
  }
  async listPlacedBefore(before: Date, limit: number) {
    return structuredClone(
      this.rows.filter((r) => r.status === 'placed' && r.createdAt < before).slice(0, limit),
    );
  }
  async listSince(since: Date, limit: number, slug?: string) {
    return structuredClone(
      this.rows.filter((r) => r.createdAt >= since && (!slug || r.messSlug === slug)).slice(0, limit),
    );
  }
}

export class MemoryOrderChat implements OrderChatRepository {
  readonly rows: ChatMessageRecord[] = [];
  constructor(
    private readonly orders: MemoryMessOrders,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async post(m: { orderId: string; sender: ChatSender; userId: string | null; body: string; photo: string }) {
    const order = this.orders.rows.find((o) => o.id === m.orderId);
    if (!order) throw new Error('no such order');
    const at = this.now();
    const c = order.chat;
    const row: ChatMessageRecord = {
      id: nextId('msg'),
      orderId: m.orderId,
      messSlug: order.messSlug,
      sender: m.sender,
      userId: m.userId,
      body: m.body,
      photo: m.photo,
      replyMs:
        m.sender === 'owner' && c.lastSender === 'student' && c.lastAt
          ? at.getTime() - c.lastAt.getTime()
          : null,
      createdAt: at,
    };
    this.rows.push(row);
    order.chat = {
      ...c,
      studentUnread: c.studentUnread + (m.sender === 'student' ? 0 : 1),
      ownerUnread: c.ownerUnread + (m.sender === 'student' ? 1 : 0),
      lastBody: m.body ? m.body.slice(0, 140) : '📷 Photo',
      lastSender: m.sender,
      lastAt: at,
    };
    return structuredClone(row);
  }
  async list(orderId: string, after: Date | null, limit: number) {
    return structuredClone(
      this.rows.filter((r) => r.orderId === orderId && (!after || r.createdAt > after)).slice(-limit),
    );
  }
  async removeAll(orderId: string) {
    const photos = this.rows.filter((r) => r.orderId === orderId && r.photo).map((r) => r.photo);
    const keep = this.rows.filter((r) => r.orderId !== orderId);
    this.rows.splice(0, this.rows.length, ...keep);
    return photos;
  }
  async countByUserSince(userId: string, since: Date) {
    return this.rows.filter((r) => r.userId === userId && r.createdAt >= since).length;
  }
  async countFor(orderIds: string[]) {
    const out = new Map<string, number>();
    for (const r of this.rows)
      if (orderIds.includes(r.orderId)) out.set(r.orderId, (out.get(r.orderId) ?? 0) + 1);
    return out;
  }
  async replyTimes(slug: string, since: Date) {
    return this.rows
      .filter((r) => r.messSlug === slug && r.createdAt >= since && r.replyMs !== null)
      .map((r) => r.replyMs!);
  }
}

export class MemoryMessBlocks implements MessBlockRepository {
  readonly rows: MessBlockRecord[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}
  async list(slug?: string) {
    return structuredClone(this.rows.filter((b) => !slug || b.messSlug === slug));
  }
  async find(slug: string, userId: string, phone?: string) {
    const hit = this.rows.find(
      (b) => b.messSlug === slug && (b.userId === userId || (!!phone && b.phone === phone)),
    );
    return hit ? structuredClone(hit) : null;
  }
  async add(b: Omit<MessBlockRecord, 'createdAt'>) {
    await this.remove(b.messSlug, b.userId);
    this.rows.unshift({ ...b, createdAt: this.now() });
  }
  async remove(slug: string, userId: string) {
    const i = this.rows.findIndex((b) => b.messSlug === slug && b.userId === userId);
    if (i >= 0) this.rows.splice(i, 1);
    return i >= 0;
  }
}

export class MemoryChatReports implements ChatReportRepository {
  readonly rows: ChatReportRecord[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}
  async add(r: Omit<ChatReportRecord, 'id' | 'status' | 'createdAt'>) {
    this.rows.unshift({ ...r, id: nextId('chat-report'), status: 'new', createdAt: this.now() });
  }
  async list(limit: number) {
    return structuredClone(this.rows.slice(0, limit));
  }
  async setStatus(id: string, status: ChatReportStatus) {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.status = status;
    return !!row;
  }
  async countFor(orderId: string, by: 'student' | 'owner', since: Date) {
    return this.rows.filter((r) => r.orderId === orderId && r.by === by && r.createdAt >= since).length;
  }
}

/** Demo and tests: pages poll instead of listening; pings are kept to check in tests. */
export class MemoryLiveSignal implements LiveSignal {
  readonly configured = false;
  readonly pings: string[][] = [];
  async topic() {
    return '';
  }
  async ping(topics: string[]) {
    this.pings.push(topics);
  }
}
