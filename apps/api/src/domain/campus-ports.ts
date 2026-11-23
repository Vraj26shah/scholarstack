import type {
  DayKey,
  MealKey,
  MessInput,
  MessOrderStatus,
  MessReportStatus,
  ReminderPrefs,
} from '@ss/contracts';

// Ports for the campus tools: mess menus, menu corrections from students, and push reminders.

export interface MessRecord extends MessInput {
  sort: number;
  updatedAt: Date;
}

export interface MessRepository {
  list(): Promise<MessRecord[]>;
  find(slug: string): Promise<MessRecord | null>;
  /** Insert or replace by slug. */
  save(mess: MessInput & { sort: number }): Promise<MessRecord>;
  remove(slug: string): Promise<void>;
}

export interface MessReportRecord {
  id: string;
  slug: string;
  day: DayKey | null;
  meal: MealKey | null;
  message: string;
  contact: string;
  status: MessReportStatus;
  createdAt: Date;
}

export interface MessReportRepository {
  add(report: Omit<MessReportRecord, 'id' | 'status' | 'createdAt'> & { ipHash: string }): Promise<void>;
  list(limit: number): Promise<MessReportRecord[]>;
  setStatus(id: string, status: MessReportStatus): Promise<boolean>;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionRecord extends PushTarget {
  id: string;
  prefs: ReminderPrefs;
  /** Set when the student was signed in when turning reminders on (to manage it from elsewhere). */
  userId: string | null;
  label: string;
  createdAt: Date;
}

export interface PushRepository {
  /** Insert, or update the keys and settings of the same push address. */
  upsert(sub: Omit<PushSubscriptionRecord, 'id' | 'createdAt'>): Promise<PushSubscriptionRecord>;
  findByEndpoint(endpoint: string): Promise<PushSubscriptionRecord | null>;
  setPrefs(endpoint: string, prefs: ReminderPrefs): Promise<boolean>;
  removeByEndpoint(endpoint: string): Promise<void>;
  removeIds(ids: string[]): Promise<void>;
  listAll(): Promise<PushSubscriptionRecord[]>;
  listForUser(userId: string): Promise<PushSubscriptionRecord[]>;
  /** Keys already sent on or after this campus date, per subscription. */
  sentSince(day: string): Promise<{ subscriptionId: string; key: string }[]>;
  recordSent(rows: { subscriptionId: string; key: string; day: string }[]): Promise<void>;
  /** Forget the send log before this campus date. */
  pruneSent(beforeDay: string): Promise<void>;
}

export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  url: string;
  /** Android shows these as buttons ("Full menu", "Mute today"). */
  actions?: { action: string; title: string }[];
}

export type PushResult = 'ok' | 'gone' | 'failed';

/** Delivers one notification to one device through its browser's push service. */
export interface PushSender {
  /** The VAPID public key browsers subscribe with ('' when not set up). */
  readonly publicKey: string;
  send(target: PushTarget, message: PushMessage, ttlSeconds: number): Promise<PushResult>;
}

// ── Orders ──

export interface MessOrderRecord {
  id: string;
  code: string;
  messSlug: string;
  userId: string;
  email: string;
  lines: { name: string; qty: number; price: number; detail: string }[];
  total: number;
  mode: 'delivery' | 'pickup';
  address: string;
  name: string;
  phone: string;
  note: string;
  status: MessOrderStatus;
  ownerNote: string;
  ipHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessOrderRepository {
  add(
    order: Omit<MessOrderRecord, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'ownerNote'>,
  ): Promise<MessOrderRecord>;
  find(id: string): Promise<MessOrderRecord | null>;
  listForUser(userId: string, limit: number): Promise<MessOrderRecord[]>;
  /** Every order still open, plus anything since `since`, newest first. */
  listForMess(slug: string, since: Date, limit: number): Promise<MessOrderRecord[]>;
  setStatus(id: string, status: MessOrderStatus, ownerNote: string): Promise<MessOrderRecord | null>;
  /** How many orders since `since`: by this student, from this network, at this restaurant. */
  countSince(by: { userId?: string; ipHash?: string; messSlug?: string }, since: Date): Promise<number>;
  countOpenForUser(userId: string): Promise<number>;
}
