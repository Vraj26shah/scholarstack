import type {
  ChatReportStatus,
  ChatSender,
  DayKey,
  MealKey,
  MessInput,
  MessOrderStatus,
  MessReportStatus,
  OrderEndedBy,
  ReminderPrefs,
  TiffinPlan,
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
  /** The account's address, when the device asked for order alerts and chat messages. */
  email: string;
  label: string;
  createdAt: Date;
  /** Last time the device reported a notification reached its screen. */
  seenAt: Date | null;
}

export interface PushRepository {
  /** Insert, or update the keys and settings of the same push address. */
  upsert(sub: Omit<PushSubscriptionRecord, 'id' | 'createdAt' | 'seenAt'>): Promise<PushSubscriptionRecord>;
  /** The device showed a notification just now (its service worker said so). */
  markSeen(endpoint: string): Promise<boolean>;
  findByEndpoint(endpoint: string): Promise<PushSubscriptionRecord | null>;
  setPrefs(endpoint: string, prefs: ReminderPrefs): Promise<boolean>;
  removeByEndpoint(endpoint: string): Promise<void>;
  removeIds(ids: string[]): Promise<void>;
  listAll(): Promise<PushSubscriptionRecord[]>;
  listForUser(userId: string): Promise<PushSubscriptionRecord[]>;
  /** Devices signed up for order alerts under any of these addresses (restaurant owners). */
  listForEmails(emails: string[]): Promise<PushSubscriptionRecord[]>;
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
  /** Stays on screen until tapped (new orders). */
  requireInteraction?: boolean;
  /** Not shown while a focused tab of the site has this in its address (that chat is open). */
  quietWhen?: string;
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
  chat: OrderChatState;
  /** A monthly tiffin plan (null for an ordinary order). */
  tiffin: { plan: TiffinPlan; startsOn: string; endsOn: string } | null;
  /** Rupees an offer took off (`total` is after it), and which offer ("WELCOME20", "₹30 off above ₹299"). */
  discount: number;
  offer: string;
}

/** The chat's bookkeeping on each order. */
export interface OrderChatState {
  studentUnread: number;
  ownerUnread: number;
  studentReadAt: Date | null;
  ownerReadAt: Date | null;
  studentClearedAt: Date | null;
  ownerClearedAt: Date | null;
  lastBody: string;
  lastSender: ChatSender | '';
  lastAt: Date | null;
  respondedAt: Date | null;
  nudgedAt: Date | null;
  endedBy: OrderEndedBy;
  alertNote: string;
}

export const EMPTY_CHAT_STATE: OrderChatState = {
  studentUnread: 0,
  ownerUnread: 0,
  studentReadAt: null,
  ownerReadAt: null,
  studentClearedAt: null,
  ownerClearedAt: null,
  lastBody: '',
  lastSender: '',
  lastAt: null,
  respondedAt: null,
  nudgedAt: null,
  endedBy: '',
  alertNote: '',
};

export interface MessOrderRepository {
  add(
    order: Omit<MessOrderRecord, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'ownerNote' | 'chat'>,
  ): Promise<MessOrderRecord>;
  find(id: string): Promise<MessOrderRecord | null>;
  listForUser(userId: string, limit: number): Promise<MessOrderRecord[]>;
  /** Every order still open, plus anything since `since`, newest first. */
  listForMess(slug: string, since: Date, limit: number): Promise<MessOrderRecord[]>;
  setStatus(id: string, status: MessOrderStatus, ownerNote: string): Promise<MessOrderRecord | null>;
  /** How many orders since `since`: by this student, from this network, at this restaurant. */
  countSince(by: { userId?: string; ipHash?: string; messSlug?: string }, since: Date): Promise<number>;
  countOpenForUser(userId: string): Promise<number>;
  /** Change some of an order's chat bookkeeping (and its status, for the timers). */
  patch(
    id: string,
    fields: Partial<OrderChatState> & { status?: MessOrderStatus; ownerNote?: string },
    /** Only when the order is still at this step (null otherwise): two timers can't both act. */
    ifStatus?: MessOrderStatus,
  ): Promise<MessOrderRecord | null>;
  /** Orders still waiting for the restaurant that were placed before this moment. */
  listPlacedBefore(before: Date, limit: number): Promise<MessOrderRecord[]>;
  /** Every order since `since` (admins), optionally at one restaurant, newest first. */
  listSince(since: Date, limit: number, slug?: string): Promise<MessOrderRecord[]>;
}

// ── Order chat ──

export interface ChatMessageRecord {
  id: string;
  orderId: string;
  messSlug: string;
  sender: ChatSender;
  userId: string | null;
  body: string;
  photo: string;
  /** An owner's answer to a student's message: how long the student waited. */
  replyMs: number | null;
  createdAt: Date;
}

export interface OrderChatRepository {
  /** Adds a message and updates the order's unread count, latest line and reply time. */
  post(m: {
    orderId: string;
    sender: ChatSender;
    userId: string | null;
    body: string;
    photo: string;
  }): Promise<ChatMessageRecord>;
  /** Oldest first; only messages after `after` when given. */
  list(orderId: string, after: Date | null, limit: number): Promise<ChatMessageRecord[]>;
  /** Deletes every message of the order (an admin's "clear for everyone"); returns their photos. */
  removeAll(orderId: string): Promise<string[]>;
  /** Messages this account sent since `since` (for the rate limits). */
  countByUserSince(userId: string, since: Date): Promise<number>;
  /** Messages per order (admins' list). */
  countFor(orderIds: string[]): Promise<Map<string, number>>;
  /** Owners' answer times at a restaurant since `since`, in milliseconds. */
  replyTimes(slug: string, since: Date): Promise<number[]>;
}

export interface MessBlockRecord {
  messSlug: string;
  userId: string;
  phone: string;
  email: string;
  name: string;
  reason: string;
  createdAt: Date;
}

export interface MessBlockRepository {
  /** One restaurant's blocks, or every block (admins). */
  list(slug?: string): Promise<MessBlockRecord[]>;
  /** Is this account, or this phone number, blocked at this restaurant? */
  find(slug: string, userId: string, phone?: string): Promise<MessBlockRecord | null>;
  add(b: Omit<MessBlockRecord, 'createdAt'>): Promise<void>;
  remove(slug: string, userId: string): Promise<boolean>;
}

export interface ChatReportRecord {
  id: string;
  orderId: string;
  by: 'student' | 'owner';
  reason: string;
  status: ChatReportStatus;
  createdAt: Date;
}

export interface ChatReportRepository {
  add(r: Omit<ChatReportRecord, 'id' | 'status' | 'createdAt'>): Promise<void>;
  list(limit: number): Promise<ChatReportRecord[]>;
  setStatus(id: string, status: ChatReportStatus): Promise<boolean>;
  /** Reports made by this side of this order since `since` (one report a while is enough). */
  countFor(orderId: string, by: 'student' | 'owner', since: Date): Promise<number>;
}

/**
 * Tells open pages that something changed, so they fetch at once instead of waiting for their next
 * check. Carries no content: the page always reads through the signed-in API.
 */
export interface LiveSignal {
  /** False when pages have to poll instead (demo, tests, or no Supabase). */
  readonly configured: boolean;
  /** An unguessable channel name for this key ('' when not configured). */
  topic(key: string): Promise<string>;
  ping(topics: string[]): Promise<void>;
}

// ── Mobile number checks ──

/** One account's mobile number: the checked one, and a code waiting to be entered. */
export interface PhoneRecord {
  userId: string;
  /** The checked number (10 digits), '' until one is checked. */
  phone: string;
  verifiedAt: Date | null;
  /** The number a code was last sent to, and the SMS service's handle for that code. */
  pendingPhone: string;
  pendingRef: string;
  pendingAt: Date | null;
  /** Wrong tries for the pending code. */
  attempts: number;
  /** Codes sent on `sendsDay` (campus date, YYYY-MM-DD). */
  sendsDay: string;
  sends: number;
}

export interface PhoneRepository {
  find(userId: string): Promise<PhoneRecord | null>;
  save(r: PhoneRecord): Promise<void>;
  /** Codes sent to this number on this day, by any account. */
  sendsTo(phone: string, day: string): Promise<number>;
}

/**
 * Sends a one-time code by SMS and checks what was typed (2Factor or Twilio Verify in production).
 * The service makes and keeps the code; we only keep its handle.
 */
export interface SmsVerifier {
  /** False when no SMS service is set up (then codes can't be sent). */
  readonly configured: boolean;
  /** Sends a code to this 10-digit Indian number; returns the service's handle for it. */
  start(phone: string): Promise<string>;
  check(phone: string, ref: string, code: string): Promise<boolean>;
}

// ── Restaurant page views (for the owner's insights) ──

/** One visitor's opens of one restaurant's page on one campus day. */
export interface MessViewRecord {
  day: string;
  /** "u:<account id>" when signed in, else "a:<hashed network>" (changes daily, not reversible). */
  visitor: string;
  userId: string | null;
  views: number;
}

export interface MessViewRepository {
  /** Count one open of the page. */
  hit(slug: string, day: string, visitor: string, userId: string | null): Promise<void>;
  /** Every visitor-day from `fromDay` to `toDay` (inclusive). */
  between(slug: string, fromDay: string, toDay: string): Promise<MessViewRecord[]>;
}

// ── Tiffin delivery marks ──

/** One tiffin meal marked on a day. `makeupFor` is '' for the regular meal, or the missed day it makes up. */
export interface TiffinMarkRecord {
  orderId: string;
  day: string;
  meal: 'lunch' | 'dinner';
  makeupFor: string;
  status: 'delivered' | 'missed';
}

export interface TiffinMarkRepository {
  /** Marks on these plans between two days (inclusive). */
  list(orderIds: string[], fromDay: string, toDay: string): Promise<TiffinMarkRecord[]>;
  set(m: TiffinMarkRecord): Promise<void>;
  clear(m: Omit<TiffinMarkRecord, 'status'>): Promise<void>;
}
