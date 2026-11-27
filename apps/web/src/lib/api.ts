import type {
  AdminOrderRowDto,
  AdminOrdersOverviewDto,
  AdminPushDeviceDto,
  AdminPushStatsDto,
  AppsSummaryDto,
  ChatMessageDto,
  ChatMessageInput,
  ChatReportDto,
  ChatReportStatus,
  MessBlockDto,
  MessDto,
  MessInput,
  MessOrderDto,
  MessOrderStatus,
  MessReportDto,
  MessReportInput,
  MessReportStatus,
  MessSummaryDto,
  OrderChatDto,
  OwnedMessDto,
  OwnerCustomerDetailDto,
  OwnerCustomerDto,
  OwnerLoginDto,
  OwnerMessInput,
  OwnerSetupCodeDto,
  PartnerSessionDto,
  PlaceMessOrderInput,
  PushAccountInput,
  PushDeviceDto,
  PushRunDto,
  PushStatusDto,
  PushSubscribeInput,
  ReminderPrefs,
  ReplyTimeDto,
  TiffinSheetDto,
} from '@ss/contracts';
import type {
  AcademicDto,
  AccessChangeInput,
  AccessGrantInput,
  AdminActivityDto,
  AdminBundleDto,
  AdminContributionDto,
  AdminCourseAccessDto,
  AdminCourseBooksDto,
  AdminCourseDto,
  AdminGrantResultDto,
  AdminInsightsDto,
  AdminOfferDto,
  AdminOverviewDto,
  AdminPromoCodeDto,
  AdminStudentDto,
  AdminSupportQueryDto,
  AdminSyncHealthDto,
  AdminTodayDto,
  AdminUnitDto,
  AnnouncementDto,
  ApiErrorBody,
  BranchSaveInput,
  BundleCardDto,
  BundleDetailDto,
  CatalogueIndexDto,
  CatalogueSearchDto,
  CheckoutQuoteDto,
  ContributionCourseInput,
  ContributionMetaInput,
  ContributionReviewInput,
  ContributionStatusDto,
  ContributorStatsDto,
  ConversionBoardDto,
  ConvertScopeInput,
  ConvertScopeResultDto,
  CourseBookInput,
  CourseCardDto,
  CourseDetailDto,
  CourseInventoryDto,
  DeleteCourseResultDto,
  DeliveryDto,
  DiscountOrderDto,
  DiscountReportDto,
  DrawerRef,
  EarningsDto,
  EmailStatusDto,
  ErrorCode,
  FeatureDto,
  FeatureStatus,
  FilePlanDto,
  HeartbeatDto,
  ImportCourseInput,
  ImportTreeDto,
  InsightPeriod,
  MeDto,
  MoveCourseFolderInput,
  MoveCourseFolderResultDto,
  MyContributionDto,
  MySupportDto,
  OpenReaderDto,
  OrderDto,
  OrderStandingDto,
  OwnerInsightsDto,
  PackRunBody,
  PackRunDto,
  PhoneStatusDto,
  PreviewPick,
  ProblemDto,
  PromoPayoutBody,
  PromoPayoutDto,
  PromoQuoteDto,
  PublishCheckDto,
  RoyaltyPayoutDto,
  RunningOfferDto,
  SaveOfferBody,
  SavePromoCodeBody,
  ShelfItemDto,
  StartCheckoutDto,
  StorageCleanInput,
  StorageCleanResultDto,
  StorageCompareDto,
  StorageDeletePreviewDto,
  StorageDeleteResultDto,
  StorageMapDto,
  StorageMovePlanDto,
  StorageTreeDto,
  StorageUnusedDto,
  StudentActivityDto,
  SupportCreateInput,
  SupportQueryDto,
  SyncResultDto,
  TiffinMarkInput,
} from '@ss/contracts';
import { TILE_SEED_HEADER, VIEWER_TOKEN_HEADER } from '@ss/contracts';
import { env } from './env';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type TokenSource = () => Promise<string | null>;
type ProblemListener = (error: ApiError) => void;

/**
 * Thin typed client for the Worker API. Knows nothing about React; the auth layer
 * gives it a token source, and session problems are broadcast to one listener.
 */
export class ApiClient {
  private tokenSource: TokenSource = async () => null;
  private onProblem: ProblemListener = () => {};
  private claimer: (() => Promise<void>) | null = null;
  private claiming: Promise<void> | null = null;

  constructor(private readonly base: string) {}

  /**
   * Fire and forget (page activity): sent with the sign-in token when there is one, so the server
   * knows who it is; any failure is ignored and nothing is retried or shown.
   */
  async beacon(path: string, body: unknown): Promise<void> {
    try {
      const token = await this.tokenSource();
      await fetch(`${this.base}${path}`, {
        method: 'POST',
        credentials: 'omit',
        keepalive: true,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      // offline, blocked, or the tab is closing: activity is best effort
    }
  }

  useTokens(source: TokenSource) {
    this.tokenSource = source;
  }

  onSessionProblem(listener: ProblemListener) {
    this.onProblem = listener;
  }

  /** How to claim this device. Called once however many requests need it at the same time. */
  useClaimer(claim: () => Promise<void>) {
    this.claimer = claim;
  }

  private claimOnce(): Promise<void> {
    if (!this.claimer) return Promise.resolve();
    this.claiming ??= this.claimer()
      .catch(() => {})
      .finally(() => {
        this.claiming = null;
      });
    return this.claiming;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    retried = false,
  ): Promise<T> {
    const token = await this.tokenSource();
    // A Blob (an image) goes as it is; anything else as JSON.
    const raw = typeof Blob !== 'undefined' && body instanceof Blob;
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          ...(body !== undefined
            ? { 'content-type': raw ? (body as Blob).type || 'application/octet-stream' : 'application/json' }
            : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          // Expected session states come back as 200 + x-ss-status (see the API's onError).
          'x-ss-soft-errors': '1',
          ...headers,
        },
        body: body === undefined ? undefined : raw ? (body as Blob) : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'You seem to be offline. Check your connection and try again.');
    }
    const soft = Number(res.headers.get('x-ss-status') ?? 0);
    if (res.ok && !soft) return (res.status === 204 ? undefined : await res.json()) as T;
    const status = soft || res.status;
    const err = (await res.json().catch(() => null)) as
      | (ApiErrorBody & { error: { details?: unknown } })
      | null;
    const apiError = new ApiError(
      status,
      err?.error.code ?? 'INTERNAL',
      err?.error.message ?? 'Something went wrong.',
      err?.error.details,
    );
    // A page that loads several things at once must not claim the device several times
    // (that registered extra devices and signed the user out). One claim, then retry once.
    if (apiError.code === 'DEVICE_UNCLAIMED' && !retried && path !== '/session/claim' && this.claimer) {
      await this.claimOnce();
      return this.request<T>(method, path, body, headers, true);
    }
    if (apiError.code === 'SESSION_REPLACED' || apiError.code === 'DEVICE_UNCLAIMED')
      this.onProblem(apiError);
    throw apiError;
  }

  // Mess menus and reminders
  messes = () => this.request<MessSummaryDto[]>('GET', '/mess');
  mess = (slug: string) => this.request<MessDto>('GET', `/mess/${encodeURIComponent(slug)}`);
  reportMess = (r: MessReportInput) => this.request<{ ok: true }>('POST', '/mess/reports', r);
  pushStatus = () => this.request<PushStatusDto>('GET', '/push/status');
  pushSubscribe = (s: PushSubscribeInput) => this.request<{ ok: true }>('POST', '/push/subscribe', s);
  pushPrefs = (endpoint: string, prefs: ReminderPrefs) =>
    this.request<{ ok: true }>('PUT', '/push/prefs', { endpoint, prefs });
  pushUnsubscribe = (endpoint: string) =>
    this.request<{ ok: true }>('POST', '/push/unsubscribe', { endpoint });
  pushTest = (endpoint: string, kind?: 'meal' | 'class') =>
    this.request<{ ok: true }>('POST', '/push/test', { endpoint, kind });
  pushDevices = () => this.request<PushDeviceDto[]>('GET', '/push/devices');
  pushRemoveDevice = (id: string) =>
    this.request<{ ok: true }>('DELETE', `/push/devices/${encodeURIComponent(id)}`);
  // Orders: students order from restaurants; owners run them at /orders
  placeMessOrder = (slug: string, o: PlaceMessOrderInput) =>
    this.request<MessOrderDto>('POST', `/mess/${encodeURIComponent(slug)}/orders`, o);
  myMessOrders = () => this.request<MessOrderDto[]>('GET', '/me/mess-orders');
  /** A restaurant page was opened (counted once per visitor per day for its owner). */
  messView = (slug: string) => this.request<{ ok: true }>('POST', `/mess/${encodeURIComponent(slug)}/view`);
  ownerInsights = (slug: string, period: InsightPeriod, date?: string) =>
    this.request<OwnerInsightsDto>(
      'GET',
      `/owner/messes/${encodeURIComponent(slug)}/insights?period=${period}${date ? `&date=${date}` : ''}`,
    );
  // The student's mobile number, checked once with an SMS code
  myPhone = () => this.request<PhoneStatusDto>('GET', '/me/phone');
  sendPhoneCode = (phone: string) => this.request<PhoneStatusDto>('POST', '/me/phone/start', { phone });
  /** A one-time code to send from WhatsApp ("VERIFY <code>"): free phone check. */
  startWhatsAppCheck = () => this.request<PhoneStatusDto>('POST', '/me/phone/whatsapp');
  checkPhoneCode = (phone: string, code: string) =>
    this.request<PhoneStatusDto>('POST', '/me/phone/check', { phone, code });
  adminResetPhone = (email: string) =>
    this.request<{ found: boolean; phone: string | null }>('POST', '/admin/phones/reset', { email });
  cancelMessOrder = (id: string) =>
    this.request<MessOrderDto>('POST', `/me/mess-orders/${encodeURIComponent(id)}/cancel`);
  ownedMesses = () => this.request<OwnedMessDto[]>('GET', '/owner/messes');
  /** Partner app: owners sign in with mobile number + PIN (first time: the admin's setup code). */
  partnerStatus = () => this.request<{ available: boolean }>('GET', '/partner/status');
  partnerLookup = (phone: string) =>
    this.request<{ next: 'pin' | 'setup' | 'unknown' }>('POST', '/partner/lookup', { phone });
  partnerLogin = (phone: string, pin: string) =>
    this.request<PartnerSessionDto>('POST', '/partner/login', { phone, pin });
  partnerSetPin = (phone: string, code: string, pin: string) =>
    this.request<PartnerSessionDto>('POST', '/partner/set-pin', { phone, code, pin });
  /** Admin › Apps: owners' mobile + PIN sign-ins. */
  adminAppsSummary = () => this.request<AppsSummaryDto>('GET', '/admin/apps-summary');
  adminOwnerLogins = () =>
    this.request<{ available: boolean; owners: OwnerLoginDto[] }>('GET', '/admin/owner-logins');
  adminAddOwnerLogin = (m: { phone: string; name: string; messSlug: string; email?: string }) =>
    this.request<OwnerSetupCodeDto>('POST', '/admin/owner-logins', m);
  adminOwnerSetupCode = (phone: string) =>
    this.request<OwnerSetupCodeDto>('POST', `/admin/owner-logins/${encodeURIComponent(phone)}/setup-code`);
  adminOwnerUnlock = (phone: string) =>
    this.request<{ ok: true }>('POST', `/admin/owner-logins/${encodeURIComponent(phone)}/unlock`);
  adminOwnerRemove = (phone: string) =>
    this.request<{ ok: true }>('DELETE', `/admin/owner-logins/${encodeURIComponent(phone)}`);
  ownerOrders = (slug: string) =>
    this.request<MessOrderDto[]>('GET', `/owner/messes/${encodeURIComponent(slug)}/orders`);
  ownerSetOpen = (slug: string, open: boolean) =>
    this.request<OwnedMessDto>('PUT', `/owner/messes/${encodeURIComponent(slug)}/open`, { open });
  /** The owner's dashboard: their restaurant to edit, saving it, and item photos. */
  ownerMess = (slug: string) => this.request<MessDto>('GET', `/owner/messes/${encodeURIComponent(slug)}`);
  ownerSaveMess = (slug: string, m: OwnerMessInput) =>
    this.request<MessDto>('PUT', `/owner/messes/${encodeURIComponent(slug)}`, m);
  ownerUploadPhoto = (slug: string, image: Blob) =>
    this.request<{ photo: string }>('POST', `/owner/messes/${encodeURIComponent(slug)}/photos`, image);
  /** Where an item photo is served ('' when the item has none). */
  messPhotoUrl = (slug: string, photo: string) =>
    photo ? `${this.base}/mess-photos/${encodeURIComponent(slug)}/${photo}` : '';
  /** Pay-first orders: the student says they paid; the owner saw it arrive. */
  claimMessOrderPaid = (id: string) =>
    this.request<MessOrderDto>('POST', `/me/mess-orders/${encodeURIComponent(id)}/paid`);
  ownerConfirmPaid = (id: string) =>
    this.request<MessOrderDto>('POST', `/owner/orders/${encodeURIComponent(id)}/paid`);
  /** The student never collected an accepted order. */
  ownerNoShow = (id: string) =>
    this.request<MessOrderDto>('POST', `/owner/orders/${encodeURIComponent(id)}/no-show`);
  orderStanding = () => this.request<OrderStandingDto>('GET', '/me/order-standing');
  ownerSetOrder = (id: string, status: MessOrderStatus, note = '') =>
    this.request<MessOrderDto>('PUT', `/owner/orders/${encodeURIComponent(id)}`, { status, note });
  adminMesses = () => this.request<MessDto[]>('GET', '/admin/mess');
  adminCreateMess = (m: MessInput) => this.request<MessDto>('POST', '/admin/mess', m);
  adminSaveMess = (slug: string, m: MessInput) =>
    this.request<MessDto>('PUT', `/admin/mess/${encodeURIComponent(slug)}`, m);
  adminDeleteMess = (slug: string) =>
    this.request<{ ok: true }>('DELETE', `/admin/mess/${encodeURIComponent(slug)}`);
  adminMessReports = () => this.request<MessReportDto[]>('GET', '/admin/mess-reports');
  adminSetMessReport = (id: string, status: MessReportStatus) =>
    this.request<{ ok: true }>('PUT', `/admin/mess-reports/${encodeURIComponent(id)}`, { status });
  adminPushStats = () => this.request<AdminPushStatsDto>('GET', '/admin/push');
  // Order chat (student and restaurant), blocks, reports, and the admin's view of it all
  /** `side`: 'owner' when the chat is opened from the restaurant's dashboard. */
  private chatSide = (side?: 'owner'): Record<string, string> => (side ? { 'x-chat-side': side } : {});
  chat = (orderId: string, side?: 'owner') =>
    this.request<OrderChatDto>(
      'GET',
      `/chats/${encodeURIComponent(orderId)}`,
      undefined,
      this.chatSide(side),
    );
  chatSend = (orderId: string, m: ChatMessageInput, side?: 'owner') =>
    this.request<ChatMessageDto>(
      'POST',
      `/chats/${encodeURIComponent(orderId)}/messages`,
      m,
      this.chatSide(side),
    );
  chatUploadPhoto = (orderId: string, image: Blob, side?: 'owner') =>
    this.request<{ photo: string }>(
      'POST',
      `/chats/${encodeURIComponent(orderId)}/photos`,
      image,
      this.chatSide(side),
    );
  chatRead = (orderId: string, side?: 'owner') =>
    this.request<{ ok: true }>(
      'POST',
      `/chats/${encodeURIComponent(orderId)}/read`,
      undefined,
      this.chatSide(side),
    );
  chatClear = (orderId: string, side?: 'owner') =>
    this.request<{ ok: true }>(
      'POST',
      `/chats/${encodeURIComponent(orderId)}/clear`,
      undefined,
      this.chatSide(side),
    );
  chatReport = (orderId: string, reason: string, side?: 'owner') =>
    this.request<{ ok: true }>(
      'POST',
      `/chats/${encodeURIComponent(orderId)}/report`,
      { reason },
      this.chatSide(side),
    );
  chatBlock = (orderId: string, reason = '') =>
    this.request<{ ok: true }>(
      'POST',
      `/chats/${encodeURIComponent(orderId)}/block`,
      { reason },
      this.chatSide('owner'),
    );
  chatUnblock = (orderId: string) =>
    this.request<{ ok: true }>(
      'DELETE',
      `/chats/${encodeURIComponent(orderId)}/block`,
      undefined,
      this.chatSide('owner'),
    );
  /** A private chat photo, as a local address for an <img> (it needs the sign-in token). */
  async chatPhoto(orderId: string, file: string): Promise<string> {
    const token = await this.tokenSource();
    const res = await fetch(
      `${this.base}/chats/${encodeURIComponent(orderId)}/photos/${encodeURIComponent(file)}`,
      { credentials: 'same-origin', headers: token ? { authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) throw new ApiError(res.status, 'INTERNAL', 'Could not load that photo.');
    return URL.createObjectURL(await res.blob());
  }
  ownerCustomer = (slug: string, userId: string) =>
    this.request<OwnerCustomerDetailDto>(
      'GET',
      `/owner/messes/${encodeURIComponent(slug)}/customers/${encodeURIComponent(userId)}`,
    );
  ownerCustomers = (slug: string) =>
    this.request<OwnerCustomerDto[]>('GET', `/owner/messes/${encodeURIComponent(slug)}/customers`);
  ownerMarkTiffin = (m: TiffinMarkInput) => this.request<TiffinSheetDto>('PUT', '/owner/tiffin/marks', m);
  ownerTiffin = (slug: string, date?: string) =>
    this.request<TiffinSheetDto>(
      'GET',
      `/owner/messes/${encodeURIComponent(slug)}/tiffin${date ? `?date=${encodeURIComponent(date)}` : ''}`,
    );
  ownerBlocks = (slug: string) =>
    this.request<MessBlockDto[]>('GET', `/owner/messes/${encodeURIComponent(slug)}/blocks`);
  ownerUnblock = (slug: string, userId: string) =>
    this.request<{ ok: true }>(
      'DELETE',
      `/owner/messes/${encodeURIComponent(slug)}/blocks/${encodeURIComponent(userId)}`,
    );
  replyTime = (slug: string) =>
    this.request<ReplyTimeDto>('GET', `/mess/${encodeURIComponent(slug)}/reply-time`);
  pushAccount = (s: PushAccountInput) => this.request<{ ok: true }>('POST', '/push/account', s);
  adminOrdersOverview = () => this.request<AdminOrdersOverviewDto>('GET', '/admin/orders/overview');
  adminOrders = (mess?: string) =>
    this.request<AdminOrderRowDto[]>(
      'GET',
      `/admin/orders${mess ? `?mess=${encodeURIComponent(mess)}` : ''}`,
    );
  adminOrderChat = (orderId: string) =>
    this.request<OrderChatDto>('GET', `/admin/orders/${encodeURIComponent(orderId)}/chat`);
  adminClearChat = (orderId: string) =>
    this.request<{ ok: true }>('DELETE', `/admin/orders/${encodeURIComponent(orderId)}/chat`);
  adminClearAllChats = (mess?: string) =>
    this.request<{ cleared: number }>(
      'DELETE',
      `/admin/chats${mess ? `?mess=${encodeURIComponent(mess)}` : ''}`,
    );
  adminChatReports = () => this.request<ChatReportDto[]>('GET', '/admin/chat-reports');
  adminSetChatReport = (id: string, status: ChatReportStatus) =>
    this.request<{ ok: true }>('PUT', `/admin/chat-reports/${encodeURIComponent(id)}`, { status });
  adminBlocks = () => this.request<MessBlockDto[]>('GET', '/admin/mess-blocks');
  adminUnblock = (slug: string, userId: string) =>
    this.request<{ ok: true }>(
      'DELETE',
      `/admin/mess-blocks/${encodeURIComponent(slug)}/${encodeURIComponent(userId)}`,
    );
  adminTestAlert = (slug: string) =>
    this.request<{ devices: number; sent: number }>(
      'POST',
      `/admin/mess/${encodeURIComponent(slug)}/test-alert`,
    );
  adminPushRun = () => this.request<PushRunDto>('POST', '/admin/push/run');
  adminPushDevices = (emails: string[]) =>
    this.request<AdminPushDeviceDto[]>(
      'GET',
      `/admin/push/devices?emails=${encodeURIComponent(emails.join(','))}`,
    );
  adminPushTestPerson = (email: string) =>
    this.request<AdminPushDeviceDto[]>('POST', '/admin/push/test-person', { email });

  // Catalogue
  catalogue = () => this.request<CatalogueIndexDto>('GET', '/catalogue');
  drawer = (batch: number, branch: string) =>
    this.request<CourseCardDto[]>(
      'GET',
      `/catalogue/drawer?batch=${batch}&branch=${encodeURIComponent(branch)}`,
    );
  course = (idOrSlug: string) =>
    this.request<CourseDetailDto>('GET', `/courses/${encodeURIComponent(idOrSlug)}`);
  search = (q: string) =>
    this.request<CatalogueSearchDto>('GET', `/catalogue/search?q=${encodeURIComponent(q)}`);
  /** Bundles one drawer shows (batch and programme), or all of a batch, or all. */
  bundles = (batch?: number, branch?: string) => {
    const q = new URLSearchParams();
    if (batch) q.set('batch', String(batch));
    if (batch && branch) q.set('branch', branch);
    const qs = q.toString();
    return this.request<BundleCardDto[]>('GET', `/bundles${qs ? `?${qs}` : ''}`);
  };
  bundle = (idOrSlug: string) =>
    this.request<BundleDetailDto>('GET', `/bundles/${encodeURIComponent(idOrSlug)}`);
  /** Public, cacheable first page of a unit. Safe as an <img src>. */
  // Bump this when preview content is quarantined or regenerated. Preview responses
  // are browser-cacheable, so a versioned URL prevents an old bad image resurfacing.
  previewUrl = (fileId: string) => `${this.base}/previews/${fileId}?v=2`;
  features = () => this.request<FeatureDto[]>('GET', '/features');
  unsubscribe = (token: string) => this.request<{ ok: true }>('POST', '/email/unsubscribe', { token });

  // Account
  checkSignInEmail = (email: string) => this.request<{ ok: true }>('POST', '/auth/check-email', { email });
  claim = (label: string, phoneKey?: string) =>
    this.request<MeDto>('POST', '/session/claim', phoneKey ? { label, phoneKey } : { label });
  me = () => this.request<MeDto>('GET', '/me');
  updateName = (fullName: string) => this.request<MeDto>('PATCH', '/me', { fullName });
  removeDevice = (id: string) => this.request<MeDto>('DELETE', `/me/devices/${id}`);
  cancelDeviceRemoval = (id: string) => this.request<MeDto>('POST', `/me/devices/${id}/cancel-removal`);
  setEmailOptIn = (emailOptIn: boolean) => this.request<MeDto>('PUT', '/me/email', { emailOptIn });
  shelf = () => this.request<ShelfItemDto[]>('GET', '/me/shelf');

  // Checkout
  startCheckout = (item: ({ courseId: string } | { bundleId: string }) & { promoCode?: string }) =>
    this.request<StartCheckoutDto>('POST', '/orders', item);
  /** Sales running right now, for the catalogue banner. */
  runningOffers = () => this.request<RunningOfferDto[]>('GET', '/offers/running');
  /** Whether any promo code is running (the "Have a promo code?" link shows only then). */
  checkPromo = (item: { courseId: string } | { bundleId: string }, code: string) =>
    this.request<PromoQuoteDto>('POST', '/promo/check', { ...item, code });
  /** The check-out slip: price, running offer, optional promo code, and the total to pay. */
  checkoutQuote = (item: { courseId: string } | { bundleId: string }, code?: string) =>
    this.request<CheckoutQuoteDto>('POST', '/checkout/quote', code ? { ...item, code } : item);
  verifyPayment = (b: {
    orderId: string;
    gatewayOrderId: string;
    gatewayPaymentId: string;
    signature: string;
  }) => this.request<OrderDto>('POST', '/orders/verify', b);
  order = (id: string) => this.request<OrderDto>('GET', `/orders/${id}`);

  // Reader
  openReader = (fileId: string) => this.request<OpenReaderDto>('POST', '/reader/open', { fileId });
  heartbeat = (viewerToken: string, b: { fileId: string; page: number; pagesViewed: number }) =>
    this.request<HeartbeatDto>('POST', '/reader/heartbeat', b, { [VIEWER_TOKEN_HEADER]: viewerToken });

  /** Fetches one scrambled page image and its tile seed. */
  async page(viewerToken: string, fileId: string, page: number): Promise<{ blob: Blob; seed: string }> {
    // The viewer token says which file; the sign-in token proves who is reading it.
    const access = await this.tokenSource();
    const res = await fetch(`${this.base}/reader/pages/${fileId}/${page}`, {
      headers: {
        [VIEWER_TOKEN_HEADER]: viewerToken,
        ...(access ? { authorization: `Bearer ${access}` } : {}),
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(
        res.status,
        err?.error.code ?? 'INTERNAL',
        err?.error.message ?? 'Could not load the page.',
      );
    }
    return { blob: await res.blob(), seed: res.headers.get(TILE_SEED_HEADER) ?? '' };
  }

  /** One page of a unit's free preview (public), or any page of a file (admin), with its seed. */
  async previewPage(fileId: string, page: number, admin = false): Promise<{ blob: Blob; seed: string }> {
    const access = admin ? await this.tokenSource() : null;
    const path = admin ? `/admin/files/${fileId}/pages/${page}` : `/previews/${fileId}/pages/${page}`;
    const res = await fetch(`${this.base}${path}`, {
      headers: access ? { authorization: `Bearer ${access}` } : {},
      cache: admin ? 'no-store' : 'default',
    });
    if (!res.ok) throw new ApiError(res.status, 'NOT_FOUND', 'That page isn’t available.');
    return { blob: await res.blob(), seed: res.headers.get(TILE_SEED_HEADER) ?? '' };
  }
  /** A unit's free previews, in order; an empty list goes back to the default. */
  adminSetUnitPreview = (courseId: string, unitKey: string, previews: PreviewPick[]) =>
    this.request<{ previews: PreviewPick[] }>(
      'PUT',
      `/admin/courses/${encodeURIComponent(courseId)}/units/${encodeURIComponent(unitKey)}/preview`,
      { previews },
    );

  // Contributions
  contributionStatus = () => this.request<ContributionStatusDto>('GET', '/contributions/me');
  withdrawContribution = (id: string) => this.request<{ ok: true }>('DELETE', `/contributions/${id}`);

  /** Send a JSON `meta` field and files, with upload progress (fetch can't report it, so XHR). */
  private async sendForm<T>(
    path: string,
    meta: unknown,
    files: File[],
    onProgress: (fraction: number) => void = () => {},
  ): Promise<T> {
    const token = await this.tokenSource();
    const form = new FormData();
    form.set('meta', JSON.stringify(meta));
    for (const f of files) form.append('files', f, f.name);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.base}${path}`);
      if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onerror = () =>
        reject(new ApiError(0, 'NETWORK', 'The upload stopped. Check your connection and try again.'));
      xhr.onabort = () => reject(new ApiError(0, 'NETWORK', 'Upload cancelled.'));
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T);
        const err = (body as { error?: { code?: ErrorCode; message?: string } } | null)?.error;
        reject(new ApiError(xhr.status, err?.code ?? 'INTERNAL', err?.message ?? 'The upload failed.'));
      };
      xhr.send(form);
    });
  }

  /** Save a protected file (it needs the sign-in token, so it can't be a plain link). */
  private async download(path: string, name: string) {
    const token = await this.tokenSource();
    const res = await fetch(`${this.base}${path}`, {
      credentials: 'same-origin',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, 'INTERNAL', 'Could not download that file.');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  uploadContribution = (meta: ContributionMetaInput, files: File[], onProgress: (f: number) => void) =>
    this.sendForm<MyContributionDto>('/contributions', meta, files, onProgress);

  // Help desk
  mySupport = () => this.request<MySupportDto>('GET', '/support');
  askSupport = (meta: SupportCreateInput, files: File[], onProgress?: (f: number) => void) =>
    this.sendForm<SupportQueryDto>('/support', meta, files, onProgress);
  replySupport = (id: string, body: string) =>
    this.request<SupportQueryDto>('POST', `/support/${id}/reply`, { body });
  closeSupport = (id: string) => this.request<SupportQueryDto>('POST', `/support/${id}/close`, {});
  downloadMySupportFile = (id: string, index: number, name: string) =>
    this.download(`/support/${id}/files/${index}`, name);

  // Admin
  adminContributions = (status: 'pending' | 'approved' | 'rejected' | 'all') =>
    this.request<{ open: boolean; items: AdminContributionDto[] }>(
      'GET',
      `/admin/contributions?status=${status}`,
    );
  adminReviewContribution = (id: string, body: ContributionReviewInput) =>
    this.request<AdminContributionDto>('POST', `/admin/contributions/${id}/review`, body);
  adminDeleteContribution = (id: string) =>
    this.request<{ ok: true }>('DELETE', `/admin/contributions/${id}`);
  adminSetContributionsOpen = (open: boolean) =>
    this.request<{ open: boolean }>('POST', '/admin/contributions-settings', { open });
  adminBlockContributor = (userId: string, blocked: boolean) =>
    this.request<{ userId: string; blocked: boolean }>('POST', '/admin/contributors/block', {
      userId,
      blocked,
    });
  adminDownloadContribution = (id: string, index: number, name: string) =>
    this.download(`/admin/contributions/${id}/files/${index}`, name);

  adminFileContribution = (
    id: string,
    body: {
      courseId: string;
      unit: string;
      dryRun: boolean;
      preserveFolders?: boolean;
      replaceFolder?: boolean;
      files?: { from: string; unit?: string; name?: string; skip?: boolean; replace?: boolean }[];
    },
  ) => this.request<FilePlanDto>('POST', `/admin/contributions/${id}/file`, body);
  adminCreateContributionCourse = (id: string, body: ContributionCourseInput) =>
    this.request<{ id: string; title: string }>('POST', `/admin/contributions/${id}/course`, body);
  adminCheckContribution = (id: string) =>
    this.request<AdminContributionDto>('POST', `/admin/contributions/${id}/check`);
  adminCompleteContribution = (id: string, body: { done: boolean; notify: boolean }) =>
    this.request<AdminContributionDto>('POST', `/admin/contributions/${id}/complete`, body);
  adminContributors = () => this.request<ContributorStatsDto[]>('GET', '/admin/contributors');
  adminRewardPaid = (contributionId: string, note: string) =>
    this.request<{ ok: true }>('POST', `/admin/contributions/${contributionId}/reward-paid`, { note });
  adminRecordBonus = (body: {
    userId: string;
    year: number;
    amountRupees: number;
    note: string;
    kind?: 'cash' | 'gift';
  }) => this.request<{ ok: true }>('POST', '/admin/royalties/bonus', body);
  adminEarnings = () => this.request<EarningsDto>('GET', '/admin/earnings');
  adminSetRoyalty = (body: { courseId: string; email: string; sharePercent: number }) =>
    this.request<{ ok: true }>('POST', '/admin/royalties', body);
  adminRemoveRoyalty = (courseId: string) =>
    this.request<{ ok: true }>('DELETE', `/admin/royalties/${courseId}`);
  adminRecordPayout = (body: { courseId: string; amountRupees: number; note: string }) =>
    this.request<RoyaltyPayoutDto>('POST', '/admin/royalties/payouts', body);

  adminSupport = (status: 'open' | 'answered' | 'closed' | 'all') =>
    this.request<{ counts: Record<'open' | 'answered' | 'closed', number>; items: AdminSupportQueryDto[] }>(
      'GET',
      `/admin/support?status=${status}`,
    );
  adminReplySupport = (id: string, body: { body: string; close: boolean; notify: boolean }) =>
    this.request<AdminSupportQueryDto>('POST', `/admin/support/${id}/reply`, body);
  adminSetSupportStatus = (id: string, status: 'open' | 'answered' | 'closed') =>
    this.request<{ ok: true }>('POST', `/admin/support/${id}/status`, { status });
  adminDeleteSupport = (id: string) => this.request<{ ok: true }>('DELETE', `/admin/support/${id}`);
  adminSupportBulk = (ids: string[], action: 'delete' | 'close' | 'open') =>
    this.request<{ done: number; failed: string[] }>('POST', '/admin/support/bulk', { ids, action });
  adminDownloadSupportFile = (id: string, index: number, name: string) =>
    this.download(`/admin/support/${id}/files/${index}`, name);

  adminCourses = () => this.request<AdminCourseDto[]>('GET', '/admin/courses');
  adminStudents = () => this.request<AdminStudentDto[]>('GET', '/admin/students');
  adminChangeAccess = (body: AccessChangeInput) =>
    this.request<AdminCourseAccessDto & { changed: number; emailed?: string[] }>(
      'POST',
      '/admin/access/change',
      body,
    );
  adminGrantAccess = (body: AccessGrantInput) =>
    this.request<AdminGrantResultDto>('POST', '/admin/access/grant', body);
  adminSyncHealth = () => this.request<AdminSyncHealthDto>('GET', '/admin/sync-health');
  adminDeleteCourse = (courseId: string, deleteNotes: boolean) =>
    this.request<DeleteCourseResultDto>('POST', `/admin/courses/${courseId}/delete`, { deleteNotes });
  adminProblems = () => this.request<ProblemDto[]>('GET', '/admin/problems');
  adminClearProblems = (fingerprints?: string[]) =>
    this.request<{ cleared: number }>('POST', '/admin/problems/clear', { fingerprints });
  adminStorageTree = () => this.request<StorageTreeDto>('GET', '/admin/storage-tree');
  adminStoragePreview = (paths: string[]) =>
    this.request<StorageDeletePreviewDto>('POST', '/admin/storage-tree/preview', { paths });
  adminStorageDelete = (paths: string[]) =>
    this.request<StorageDeleteResultDto>('POST', '/admin/storage-tree/delete', { paths, confirm: 'DELETE' });
  adminStorageMove = (body: { paths: string[]; toFolder: string; dryRun: boolean }) =>
    this.request<StorageMovePlanDto>('POST', '/admin/storage-tree/move', body);
  adminStorageRename = (body: { path: string; newName: string; dryRun: boolean }) =>
    this.request<StorageMovePlanDto>('POST', '/admin/storage-tree/rename', body);
  adminAcademic = () => this.request<AcademicDto>('GET', '/admin/academic');
  adminAddYear = (year: number) => this.request<AcademicDto>('POST', '/admin/academic/years', { year });
  adminSetYearVisible = (year: number, visible: boolean) =>
    this.request<AcademicDto>('PUT', `/admin/academic/years/${year}`, { visible });
  adminDeleteYear = (year: number) => this.request<AcademicDto>('DELETE', `/admin/academic/years/${year}`);
  adminSaveBranch = (body: BranchSaveInput) =>
    this.request<AcademicDto>('POST', '/admin/academic/branches', body);
  adminMoveYear = (body: { fromYear: number; toYear: number; branchSlug?: string }) =>
    this.request<AcademicDto & { moved: number }>('POST', '/admin/academic/move-year', body);
  adminStorageMap = () => this.request<StorageMapDto>('GET', '/admin/storage-map');
  adminStorageUnused = () => this.request<StorageUnusedDto>('GET', '/admin/storage-unused');
  adminMoveCourseFolder = (input: MoveCourseFolderInput) =>
    this.request<MoveCourseFolderResultDto>('POST', '/admin/storage-map/move-course', input);
  adminStorageClean = (input: StorageCleanInput) =>
    this.request<StorageCleanResultDto>('POST', '/admin/storage-map/clean', input);
  adminOverview = () => this.request<AdminOverviewDto>('GET', '/admin/overview');
  adminToday = () => this.request<AdminTodayDto>('GET', '/admin/today');
  adminCompareScopes = (scopes: string[]) =>
    this.request<StorageCompareDto>('POST', '/admin/storage-compare', { scopes });
  adminConversionsFor = (scopes: string[]) =>
    this.request<ConversionBoardDto>('POST', '/admin/conversions/query', { scopes });
  adminConvertSelection = (scopes: string[], include: 'waiting' | 'failed' | 'both') =>
    this.request<ConvertScopeResultDto>('POST', '/admin/convert-selection', { scopes, include });
  adminConvert = (input: Partial<ConvertScopeInput> & { courseId: string }) =>
    this.request<ConvertScopeResultDto>('POST', '/admin/convert', input);
  adminBooks = (courseId: string) =>
    this.request<AdminCourseBooksDto>('GET', `/admin/courses/${encodeURIComponent(courseId)}/books`);
  adminLookupIsbn = (isbn: string) =>
    this.request<{ isbn: string; title: string; author: string }>(
      'GET',
      `/admin/books/lookup?isbn=${encodeURIComponent(isbn)}`,
    );
  adminAddBook = (courseId: string, book: CourseBookInput) =>
    this.request<AdminCourseBooksDto>('POST', `/admin/courses/${encodeURIComponent(courseId)}/books`, book);
  adminUpdateBook = (bookId: string, book: CourseBookInput) =>
    this.request<AdminCourseBooksDto>('PUT', `/admin/books/${encodeURIComponent(bookId)}`, book);
  adminDeleteBook = (bookId: string) =>
    this.request<AdminCourseBooksDto>('DELETE', `/admin/books/${encodeURIComponent(bookId)}`);
  adminOrderBooks = (courseId: string, ids: string[]) =>
    this.request<AdminCourseBooksDto>('PUT', `/admin/courses/${encodeURIComponent(courseId)}/books/order`, {
      ids,
    });
  adminUnits = (courseId: string) => this.request<AdminUnitDto[]>('GET', `/admin/courses/${courseId}/units`);
  adminPublishCheck = (courseId: string) =>
    this.request<PublishCheckDto>('GET', `/admin/courses/${courseId}/publish-check`);
  adminInventory = (courseId: string) =>
    this.request<CourseInventoryDto>('GET', `/admin/courses/${courseId}/inventory`);
  adminSyncFile = (courseId: string, sourceKey: string) =>
    this.request<SyncResultDto>('POST', `/admin/courses/${courseId}/sync-file`, { sourceKey });
  adminSetUnitHidden = (courseId: string, key: string, hidden: boolean) =>
    this.request<AdminUnitDto[]>('PUT', `/admin/courses/${courseId}/units/${encodeURIComponent(key)}`, {
      hidden,
    });
  adminSetFileHidden = (fileId: string, hidden: boolean) =>
    this.request<AdminUnitDto[]>('PUT', `/admin/files/${fileId}`, { hidden });
  adminRetryConversion = (fileId: string) =>
    this.request<{ ok: true; queued: number }>('POST', `/admin/files/${fileId}/retry-conversion`);
  adminPauseConversion = (fileIds: string[]) =>
    this.request<{ ok: true; paused: number }>('POST', '/admin/conversions/pause', { fileIds });
  adminResumeConversion = (fileIds: string[]) =>
    this.request<{ ok: true; queued: number }>('POST', '/admin/conversions/resume', { fileIds });
  adminCancelConversion = (fileIds: string[]) =>
    this.request<{ ok: true; cancelled: number }>('POST', '/admin/conversions/cancel', { fileIds });
  adminCreateFolder = (parent: string, name: string) =>
    this.request<{ path: string }>('POST', '/admin/storage-tree/folder', { parent, name });
  /** Files straight into a storage folder; into a course folder they are registered and sent for pages. */
  adminUploadToFolder = (folder: string, files: File[], replace: boolean, onProgress: (f: number) => void) =>
    this.sendForm<{
      folder: string;
      keys: string[];
      courseId: string | null;
      courseTitle: string | null;
      queued: number;
      problems: string[];
    }>('/admin/storage-tree/upload', { folder, replace }, files, onProgress);
  adminImportTree = () => this.request<ImportTreeDto>('GET', '/admin/import');
  adminImport = (courses: ImportCourseInput[]) =>
    this.request<SyncResultDto>('POST', '/admin/import', { courses });
  adminUpdateCourse = (
    id: string,
    patch: Partial<{
      title: string;
      courseCode: string | null;
      description: string;
      batchYear: number;
      branchSlugs: string[];
      branchSlug: string;
      semester: number;
      pricePaise: number;
      status: 'draft' | 'live' | 'archived';
      offeredTo: { batchYear: number; branchSlug: string }[] | null;
    }>,
  ) => this.request<{ ok: true }>('PATCH', `/admin/courses/${id}`, patch);
  adminDeleteBundle = (id: string) =>
    this.request<{ ok: true }>('DELETE', `/admin/bundles/${encodeURIComponent(id)}`);
  adminBundles = () => this.request<AdminBundleDto[]>('GET', '/admin/bundles');
  adminSaveBundle = (b: {
    id?: string;
    title: string;
    description: string;
    batchYear: number | null;
    courseIds: string[];
    pricePaise: number;
    status: 'draft' | 'live' | 'archived';
    offeredTo: DrawerRef[] | null;
  }) => this.request<AdminBundleDto>('POST', '/admin/bundles', b);
  adminPacks = () => this.request<PackRunDto>('GET', '/admin/bundles/packs');
  adminRunPacks = (b: PackRunBody) => this.request<PackRunDto>('POST', '/admin/bundles/packs', b);
  adminDetachPack = (id: string) =>
    this.request<AdminBundleDto>('POST', `/admin/bundles/${encodeURIComponent(id)}/detach`);
  adminOffers = () => this.request<AdminOfferDto[]>('GET', '/admin/offers');
  adminSaveOffer = (o: SaveOfferBody) => this.request<AdminOfferDto>('POST', '/admin/offers', o);
  /** Draft the email inviting students to an offer (or its last-day reminder). */
  adminInviteToOffer = (id: string, kind: 'launch' | 'reminder') =>
    this.request<AnnouncementDto>('POST', `/admin/offers/${encodeURIComponent(id)}/invite`, { kind });
  adminDeleteOffer = (id: string) =>
    this.request<{ ok: true }>('DELETE', `/admin/offers/${encodeURIComponent(id)}`);
  adminPromoCodes = () => this.request<AdminPromoCodeDto[]>('GET', '/admin/promo-codes');
  adminPromoOrders = (id: string) =>
    this.request<DiscountOrderDto[]>('GET', `/admin/promo-codes/${encodeURIComponent(id)}/orders`);
  adminOfferOrders = (id: string) =>
    this.request<DiscountOrderDto[]>('GET', `/admin/offers/${encodeURIComponent(id)}/orders`);
  adminDiscounts = (days: '7' | '30' | '90' | 'all') =>
    this.request<DiscountReportDto>('GET', `/admin/discounts?days=${days}`);
  adminActivity = (days: '1' | '7' | '30' | '90') =>
    this.request<AdminActivityDto>('GET', `/admin/activity?days=${days}`);
  adminStudentActivity = (userId: string, days: '7' | '30' | '90') =>
    this.request<StudentActivityDto>(
      'GET',
      `/admin/students/${encodeURIComponent(userId)}/activity?days=${days}`,
    );
  adminInsights = (days: '1' | '7' | '30' | '90') =>
    this.request<AdminInsightsDto>('GET', `/admin/insights?days=${days}`);
  adminAddPromoPayout = (b: PromoPayoutBody) =>
    this.request<PromoPayoutDto>('POST', '/admin/discounts/payouts', b);
  adminSavePromoCode = (p: SavePromoCodeBody) =>
    this.request<AdminPromoCodeDto>('POST', '/admin/promo-codes', p);
  adminDeletePromoCode = (id: string) =>
    this.request<{ ok: true }>('DELETE', `/admin/promo-codes/${encodeURIComponent(id)}`);
  adminSuggestPrice = (courseIds: string[]) =>
    this.request<{ pricePaise: number }>('POST', '/admin/bundles/suggest-price', { courseIds });
  adminFeatures = () => this.request<FeatureDto[]>('GET', '/admin/features');
  adminSaveFeature = (key: string, f: { title: string; blurb: string; status: FeatureStatus }) =>
    this.request<FeatureDto>('PUT', `/admin/features/${key}`, f);
  adminCreateFeature = (f: { key: string; title: string; blurb: string; status: FeatureStatus }) =>
    this.request<FeatureDto>('POST', '/admin/features', f);
  adminLaunchFeature = (key: string) =>
    this.request<AnnouncementDto>('POST', `/admin/features/${key}/launch`);
  adminDeliveries = (id: string) => this.request<DeliveryDto>('GET', `/admin/announcements/${id}/deliveries`);
  adminEmailStatus = () => this.request<EmailStatusDto>('GET', '/admin/email');
  adminDeleteAnnouncement = (id: string) =>
    this.request<{ ok: true }>('DELETE', `/admin/announcements/${encodeURIComponent(id)}`);
  adminDeleteFeature = (key: string) =>
    this.request<{ ok: true }>('DELETE', `/admin/features/${encodeURIComponent(key)}`);
  adminAnnouncements = () => this.request<AnnouncementDto[]>('GET', '/admin/announcements');
  adminSaveAnnouncement = (a: {
    id?: string;
    subject: string;
    heading: string;
    body: string;
    ctaLabel: string;
    ctaUrl: string;
    featureKey: string | null;
    courseId: string | null;
  }) => this.request<AnnouncementDto>('POST', '/admin/announcements', a);
  adminPreviewAnnouncement = (id: string) =>
    this.request<{ subject: string; html: string }>('GET', `/admin/announcements/${id}/preview`);
  adminTestAnnouncement = (id: string) =>
    this.request<{ ok: true; to: string }>('POST', `/admin/announcements/${id}/test`);
  adminSendAnnouncement = (id: string) =>
    this.request<AnnouncementDto>('POST', `/admin/announcements/${id}/send`);
  // Demo-only stand-ins (404 on a real deployment)
  demoLogin = (email: string) =>
    this.request<{ accessToken: string; email: string }>('POST', '/dev/login', { email });
  demoOutbox = () => this.request<{ to: string; subject: string; html: string }[]>('GET', '/dev/outbox');
  demoPay = (gatewayOrderId: string) =>
    this.request<{ gatewayPaymentId: string; signature: string }>('POST', '/dev/pay', { gatewayOrderId });
}

export const api = new ApiClient(env.apiBase);

/** True when the current page is part of the admin area. */
function isAdminRoute(): boolean {
  return typeof globalThis.location !== 'undefined' && globalThis.location?.pathname.startsWith('/admin');
}

/** Friendly text for every error code. Admins see full details; students see calm messages. */
export function friendly(error: unknown): string {
  const admin = isAdminRoute();

  if (error instanceof ApiError) {
    switch (error.code) {
      case 'NOT_COLLEGE_EMAIL':
        return `Only @${env.domain} accounts can sign in.`;
      case 'RATE_LIMITED':
        // A blocked network or a spent mail budget is told why and until when (and pointed at
        // Google, which needs no email); ordinary speed limits get the calm line.
        if (/network|Google|links are available/i.test(error.message)) return error.message;
        return "You're going a bit fast. Take a breath and try again in a minute.";
      case 'DEVICE_COOLDOWN':
        return error.message;
      case 'NOT_PURCHASED':
        return 'Buy this course to open its files.';
      case 'NOT_READY':
        // Admins get the server's exact reason (which file, what to do); students the calm version.
        if (admin) return error.message;
        return 'This file is still being prepared. Check back in a few minutes.';
      case 'SYNC_FAILED':
        if (admin) return error.message;
        return 'Something went wrong while syncing. Please try again shortly.';
      case 'PAYMENTS_UNAVAILABLE':
        return error.message;
      case 'NETWORK':
        return 'We couldn\u2019t reach Scholars Stack. Check your connection, then try again.';
      case 'ALREADY_OWNED':
        return 'You already own this course. Check your shelf!';
      default:
        // Admins always see the server's real message for debugging.
        if (admin) return error.message;
        // Server-side failures: students get a calm, human sentence.
        if (error.status >= 500)
          return 'The library is having a moment on our side. Nothing is lost. Try again in a minute.';
        // Client errors (400, 403, 404, 409, etc.): show the server's message only if it looks
        // human-readable (no stack traces, no long technical dumps).
        if (
          error.message &&
          error.message.length < 200 &&
          !/\b(stack|trace|error at|ERR_|ECONNREFUSED|ENOTFOUND|uncaught|exception|undefined|null pointer)\b/i.test(
            error.message,
          )
        )
          return error.message;
        return 'Something went wrong. Please try again or contact support if this keeps happening.';
    }
  }
  return 'Something went wrong. Please try again.';
}
